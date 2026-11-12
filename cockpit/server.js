/**
 * COCKPIT MASTER CONTROLLER
 * Zero-dependency local control daemon for your personal operating system.
 * Port: 4000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const net = require('net');

const PORT = 4000;
const ROOT_DIR = path.resolve(__dirname, '..');
const REGISTRY_FILE = path.join(__dirname, 'tools_registry.json');
const EVALUATIONS_FILE = path.join(__dirname, 'arena_evals.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;
const WORKER_PROCESS_PATTERN = '[a]gent-worker/\\.venv/bin/python main\\.py start';
let writeSequence = 0;
let evaluationSequence = 0;

const managedProcesses = { web: null, worker: null };

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, value) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
    socket.connect(port, host);
  });
}

function checkProcessRunning(pattern) {
  return new Promise((resolve) => {
    exec(`pgrep -f "${pattern}"`, (err, stdout) => {
      if (err || !stdout.trim()) return resolve({ running: false, pids: [] });
      const pids = stdout.trim().split('\n').map((pid) => pid.trim()).filter(Boolean);
      resolve({ running: pids.length > 0, pids });
    });
  });
}

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    exec(`lsof -ti :${port} | xargs -r kill -9 2>/dev/null`, () => resolve(true));
  });
}

function killProcessByPattern(pattern) {
  return new Promise((resolve) => {
    exec(`pkill -9 -f "${pattern}" 2>/dev/null`, () => resolve(true));
  });
}

async function getSystemStatus() {
  const [webRunning, workerPort, workerProc, databaseRunning, ollamaRunning, n8nRunning] =
    await Promise.all([
      checkPort(3000),
      checkPort(8081),
      checkProcessRunning(WORKER_PROCESS_PATTERN),
      checkPort(54330),
      checkPort(11434),
      checkPort(5678),
    ]);
  const workerRunning = workerPort || workerProc.running;

  return {
    master: webRunning && workerRunning,
    services: {
      web: {
        name: 'Web Portal & Call App',
        port: 3000,
        running: webRunning,
        url: 'http://localhost:3000/call/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      },
      worker: {
        name: 'Voice AI Agent Worker',
        port: 8081,
        running: workerRunning,
        voice: 'azure:da-DK-ChristelNeural',
      },
      database: { name: 'PostgreSQL Database', port: 54330, running: databaseRunning },
      ollama: { name: 'Local Ollama AI (Air-Gapped)', port: 11434, running: ollamaRunning },
      n8n: {
        name: 'n8n Automation Engine',
        port: 5678,
        running: n8nRunning,
        url: 'http://localhost:5678',
      },
    },
    timestamp: new Date().toISOString(),
  };
}

function startManagedService(kind) {
  return new Promise((resolve, reject) => {
    const isWeb = kind === 'web';
    const child = isWeb
      ? spawn('npm', ['run', 'start'], {
          cwd: path.join(ROOT_DIR, 'web'), detached: true, stdio: 'ignore', env: process.env,
        })
      : spawn('.venv/bin/python', ['main.py', 'start'], {
          cwd: path.join(ROOT_DIR, 'agent-worker'), detached: true, stdio: 'ignore', env: process.env,
        });
    managedProcesses[kind] = child;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('error', onError);
      resolve();
    }, 1500);
    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      managedProcesses[kind] = null;
      reject(error);
    };
    child.once('error', onError);
    child.unref();
  });
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, 'Payload Too Large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (error) => fail(error);
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  try {
    const value = JSON.parse(body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'Expected a JSON object');
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON');
  }
}

function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${path.basename(file)} must contain an array`);
  return value;
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${++writeSequence}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function validateArenaPayload(payload) {
  for (const field of ['model', 'category', 'score', 'verdict', 'experience', 'snippet']) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new HttpError(400, `Missing required field: ${field}`);
    }
  }
  for (const field of ['model', 'category', 'verdict']) {
    if (typeof payload[field] !== 'string' || !payload[field].trim()) {
      throw new HttpError(400, `${field} must be a non-empty string`);
    }
  }
  for (const field of ['experience', 'snippet']) {
    if (typeof payload[field] !== 'string') {
      throw new HttpError(400, `${field} must be a string`);
    }
  }
  if (typeof payload.score !== 'number' || !Number.isFinite(payload.score)) {
    throw new HttpError(400, 'score must be a finite number');
  }
}

function isInside(directory, candidate) {
  return candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
}

function createCockpitServer(options = {}) {
  const publicDir = path.resolve(options.publicDir || PUBLIC_DIR);
  const registryFile = options.registryFile || REGISTRY_FILE;
  const evaluationsFile = options.evaluationsFile || EVALUATIONS_FILE;
  const status = options.getSystemStatus || getSystemStatus;
  const controls = {
    startWeb: options.startWeb || (() => startManagedService('web')),
    startWorker: options.startWorker || (() => startManagedService('worker')),
    stopWeb: options.stopWeb || (() => killProcessOnPort(3000)),
    stopWorker: options.stopWorker || (async () => {
      await killProcessByPattern(WORKER_PROCESS_PATTERN);
      await killProcessOnPort(8081);
    }),
  };

  return http.createServer((req, res) => {
    const handle = async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      if (url.pathname === '/api/status' && req.method === 'GET') {
        return sendJson(res, 200, await status());
      }
      if (url.pathname === '/api/tools' && req.method === 'GET') {
        return sendJson(res, 200, readJsonArray(registryFile));
      }
      if (url.pathname === '/api/tools' && req.method === 'POST') {
        const newTool = await readJson(req);
        const current = readJsonArray(registryFile);
        const id = typeof newTool.id === 'string' && newTool.id.trim()
          ? newTool.id
          : `tool-${Date.now()}-${++writeSequence}`;
        current.push({ ...newTool, id });
        writeJsonAtomic(registryFile, current);
        return sendJson(res, 200, { success: true, count: current.length });
      }

      // The single Arena webhook pair. The persisted entry schema is stable.
      if (url.pathname === '/api/webhook/arena' && req.method === 'POST') {
        const payload = await readJson(req);
        validateArenaPayload(payload);
        const entry = {
          id: `eval-${Date.now()}-${++evaluationSequence}`,
          timestamp: new Date().toISOString(),
          model: payload.model,
          category: payload.category,
          benchmarkScore: payload.score,
          verdict: payload.verdict,
          codeExperience: payload.experience,
          diffOrSnippet: payload.snippet,
          source: 'LM Arena Agentic Mode',
        };
        const logs = readJsonArray(evaluationsFile);
        logs.unshift(entry);
        const stored = logs.slice(0, 50);
        writeJsonAtomic(evaluationsFile, stored);
        return sendJson(res, 200, { success: true, entryId: entry.id, count: stored.length });
      }
      if (url.pathname === '/api/webhook/arena' && req.method === 'GET') {
        return sendJson(res, 200, readJsonArray(evaluationsFile));
      }

      if (url.pathname === '/api/toggle' && req.method === 'POST') {
        const payload = await readJson(req);
        const target = payload.service;
        const action = payload.action;
        if (!['master', 'web', 'worker'].includes(target)) {
          throw new HttpError(400, 'service must be master, web, or worker');
        }
        if (!['start', 'stop', 'toggle'].includes(action)) {
          throw new HttpError(400, 'action must be start, stop, or toggle');
        }
        const current = await status();
        const shouldStart = (running) => action === 'start' || (action === 'toggle' && !running);
        if (target === 'master') {
          if (shouldStart(current.master)) {
            if (!current.services.web.running) await controls.startWeb();
            if (!current.services.worker.running) await controls.startWorker();
          } else {
            await controls.stopWeb();
            await controls.stopWorker();
          }
        } else if (target === 'web') {
          if (shouldStart(current.services.web.running)) await controls.startWeb();
          else await controls.stopWeb();
        } else {
          if (shouldStart(current.services.worker.running)) await controls.startWorker();
          else await controls.stopWorker();
        }
        return sendJson(res, 200, { success: true, status: await status() });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        throw new HttpError(400, 'Invalid URL encoding');
      }
      if (decoded.includes('\0')) throw new HttpError(400, 'Invalid path');
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
      const filePath = path.resolve(publicDir, relative);
      if (!isInside(publicDir, filePath)) throw new HttpError(403, 'Forbidden');
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return sendJson(res, 404, { error: 'Not Found' });
      }
      const realPublicDir = fs.realpathSync(publicDir);
      const realFilePath = fs.realpathSync(filePath);
      if (!isInside(realPublicDir, realFilePath)) throw new HttpError(403, 'Forbidden');

      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(realFilePath)] || 'text/plain' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(realFilePath).pipe(res);
    };

    void handle().catch((error) => {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      sendJson(res, statusCode, { error: error.message || 'Internal Server Error' });
    });
  });
}

if (require.main === module) {
  const server = createCockpitServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Cockpit] Master Controller running at http://localhost:${PORT}`);
  });
}

module.exports = {
  MAX_BODY_BYTES,
  WORKER_PROCESS_PATTERN,
  checkProcessRunning,
  createCockpitServer,
  getSystemStatus,
  validateArenaPayload,
  writeJsonAtomic,
};
