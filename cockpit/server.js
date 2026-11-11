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
const PUBLIC_DIR = path.join(__dirname, 'public');

// Track background child processes started by the cockpit
const managedProcesses = {
  web: null,
  worker: null,
};

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
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function checkProcessRunning(pattern) {
  return new Promise((resolve) => {
    exec(`pgrep -f "${pattern}"`, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ running: false, pids: [] });
      } else {
        const pids = stdout.trim().split('\n').map((p) => p.trim()).filter(Boolean);
        resolve({ running: pids.length > 0, pids });
      }
    });
  });
}

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    exec(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, () => {
      resolve(true);
    });
  });
}

function killProcessByPattern(pattern) {
  return new Promise((resolve) => {
    exec(`pkill -9 -f "${pattern}" 2>/dev/null`, () => {
      resolve(true);
    });
  });
}

async function getSystemStatus() {
  const [webPort, workerPort, workerProc, dbPort, ollamaPort, n8nPort] = await Promise.all([
    checkPort(3000),
    checkPort(8081),
    checkProcessRunning('agent-worker/.venv/bin/python main.py start'),
    checkPort(54330),
    checkPort(11434),
    checkPort(5678),
  ]);

  const webRunning = webPort;
  const workerRunning = workerPort || workerProc.running;
  const dbRunning = dbPort;

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
      database: {
        name: 'PostgreSQL Database',
        port: 54330,
        running: dbRunning,
      },
      ollama: {
        name: 'Local Ollama AI (Air-Gapped)',
        port: 11434,
        running: ollamaPort,
      },
      n8n: {
        name: 'n8n Automation Engine',
        port: 5678,
        running: n8nPort,
        url: 'http://localhost:5678',
      },
    },
    timestamp: new Date().toISOString(),
  };
}

function startWebService() {
  return new Promise((resolve, reject) => {
    const webDir = path.join(ROOT_DIR, 'web');
    const child = spawn('npm', ['run', 'start'], {
      cwd: webDir,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    managedProcesses.web = child;
    setTimeout(resolve, 1500);
  });
}

function startWorkerService() {
  return new Promise((resolve, reject) => {
    const workerDir = path.join(ROOT_DIR, 'agent-worker');
    const child = spawn('.venv/bin/python', ['main.py', 'start'], {
      cwd: workerDir,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    managedProcesses.worker = child;
    setTimeout(resolve, 1500);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS headers for local usage
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API Routes
  if (url.pathname === '/api/status' && req.method === 'GET') {
    const status = await getSystemStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(status));
  }

  if (url.pathname === '/api/tools' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(REGISTRY_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('[]');
    }
  }

  if (url.pathname === '/api/tools' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const newTool = JSON.parse(body);
        let current = [];
        try {
          current = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
        } catch {}
        current.push({ ...newTool, id: newTool.id || `tool-${Date.now()}` });
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(current, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: current.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Webhook for receiving AI telemetry, evaluations, and sales coaching insights from LM Arena / external agents
  if (url.pathname === '/api/webhook/arena' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const entry = {
          id: `eval-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: payload.model || 'frontier-agent',
          category: payload.category || 'sales-coding',
          benchmarkScore: payload.score ?? null,
          verdict: payload.verdict || '',
          codeExperience: payload.experience || '',
          diffOrSnippet: payload.snippet || '',
          source: 'LM Arena Agentic Mode',
        };

        const auditLogFile = path.join(__dirname, 'arena_evals.json');
        let logs = [];
        try {
          logs = JSON.parse(fs.readFileSync(auditLogFile, 'utf8'));
        } catch {}
        logs.unshift(entry);
        fs.writeFileSync(auditLogFile, JSON.stringify(logs.slice(0, 50), null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, entryId: entry.id, count: logs.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/webhook/arena' && req.method === 'GET') {
    const auditLogFile = path.join(__dirname, 'arena_evals.json');
    try {
      const data = fs.readFileSync(auditLogFile, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  if (url.pathname === '/api/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const target = payload.service; // 'master', 'web', 'worker'
        const action = payload.action;   // 'start', 'stop', 'toggle'

        const status = await getSystemStatus();

        if (target === 'master') {
          const shouldStart = action === 'start' || (action === 'toggle' && !status.master);
          if (shouldStart) {
            if (!status.services.web.running) await startWebService();
            if (!status.services.worker.running) await startWorkerService();
          } else {
            await killProcessOnPort(3000);
            await killProcessByPattern('agent-worker/.venv/bin/python main.py start');
            await killProcessOnPort(8081);
          }
        } else if (target === 'web') {
          const shouldStart = action === 'start' || (action === 'toggle' && !status.services.web.running);
          if (shouldStart) {
            await startWebService();
          } else {
            await killProcessOnPort(3000);
          }
        } else if (target === 'worker') {
          const shouldStart = action === 'start' || (action === 'toggle' && !status.services.worker.running);
          if (shouldStart) {
            await startWorkerService();
          } else {
            await killProcessByPattern('agent-worker/.venv/bin/python main.py start');
            await killProcessOnPort(8081);
          }
        }

        const updated = await getSystemStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, status: updated }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Webhook for receiving AI telemetry, evaluations, and sales coaching insights from LM Arena / external agents
  if (url.pathname === '/api/webhook/arena' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const entry = {
          id: `eval-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: payload.model || 'frontier-agent',
          category: payload.category || 'sales-coding',
          benchmarkScore: payload.score ?? null,
          verdict: payload.verdict || '',
          codeExperience: payload.experience || '',
          diffOrSnippet: payload.snippet || '',
          source: 'LM Arena Agentic Mode',
        };

        const auditLogFile = path.join(__dirname, 'arena_evals.json');
        let logs = [];
        try {
          logs = JSON.parse(fs.readFileSync(auditLogFile, 'utf8'));
        } catch {}
        logs.unshift(entry);
        fs.writeFileSync(auditLogFile, JSON.stringify(logs.slice(0, 50), null, 2));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, entryId: entry.id, count: logs.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/webhook/arena' && req.method === 'GET') {
    const auditLogFile = path.join(__dirname, 'arena_evals.json');
    try {
      const data = fs.readFileSync(auditLogFile, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Cockpit] Master Controller running at http://localhost:${PORT}`);
});
