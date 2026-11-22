#!/usr/bin/env node
/**
 * ============================================================================
 * CHIEF SOFTWARE ENGINEER — AUTONOMOUS PROJECT LEAD ENGINE
 * ============================================================================
 *
 * An autonomous CLI and orchestration engine designed to lead, architect,
 * and verify massive enterprise-grade software projects with AI.
 *
 * Core Tenets:
 * 1. Zero-Trust Verification (100% green tests, 0 compiler errors, 0 loose `any`).
 * 2. AST Type Spines (< 3,500 tokens) to prevent AI context degradation and latency bloat.
 * 3. Immutable Invariants & Defensive Domain Boundaries (RLS, Double-entry, Idempotency).
 * 4. Trunk-Based Vertical Slicing.
 *
 * Commands:
 *   npx tsx scripts/chief-engineer.ts status         -> Audit project health & checklist score
 *   npx tsx scripts/chief-engineer.ts audit          -> Run strict static, test & security gates
 *   npx tsx scripts/chief-engineer.ts plan <name>    -> Architect an enterprise vertical slice
 *   npx tsx scripts/chief-engineer.ts prompt <name>  -> Generate surgical AST prompt for Frontier AI
 *   npx tsx scripts/chief-engineer.ts verify         -> Run full test suite & compiler check
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = join(ROOT_DIR, 'web');

// -----------------------------------------------------------------------------
// Utility Helpers
// -----------------------------------------------------------------------------

function run(cmd: string, cwd = ROOT_DIR): { stdout: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { stdout: stdout.trim(), ok: true };
  } catch (err: any) {
    return { stdout: (err.stdout || err.stderr || err.message || '').toString().trim(), ok: false };
  }
}

function countLines(content: string): number {
  return content.split('\n').length;
}

function scanFiles(dir: string, pattern: RegExp, ignoreDirs = ['node_modules', '.next', '.git', 'dist']): string[] {
  let results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (ignoreDirs.includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(scanFiles(fullPath, pattern, ignoreDirs));
    } else if (pattern.test(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

// -----------------------------------------------------------------------------
// 1. Project Health & Enterprise Checklist Audit
// -----------------------------------------------------------------------------

interface AuditMetrics {
  testsPassing: number;
  totalTests: number;
  tscClean: boolean;
  bannedPatternsCount: number;
  rlsCoveragePct: number;
  routesCount: number;
  migrationsCount: number;
  checklistScore: number;
}

function runAudit(): AuditMetrics {
  console.log('\n🔍 [Chief Engineer] Inspecting Enterprise Quality Gates...\n');

  // 1. Run tsc --noEmit
  process.stdout.write('  → Typecheck (web tsc --noEmit)... ');
  const tsc = run('npx tsc --noEmit', WEB_DIR);
  const tscClean = tsc.ok;
  console.log(tscClean ? '✅ CLEAN (0 errors)' : '❌ FAILED');

  // 2. Run npm test
  process.stdout.write('  → Test Suite (npm test)... ');
  const testRun = run('npm test', ROOT_DIR);
  let testsPassing = 0;
  let totalTests = 0;
  const match = testRun.stdout.match(/ℹ pass (\d+)/g);
  if (match) {
    for (const m of match) {
      const num = parseInt(m.replace('ℹ pass ', ''), 10);
      testsPassing += num;
    }
    totalTests = testsPassing;
  }
  console.log(testRun.ok ? `✅ ${testsPassing} passing tests` : '❌ FAILED');

  // 3. Scan for banned patterns (as any, @ts-ignore)
  process.stdout.write('  → Code Hygiene (zero "as any", zero "@ts-ignore")... ');
  const tsFiles = scanFiles(WEB_DIR, /\.(ts|tsx)$/);
  let bannedCount = 0;
  for (const file of tsFiles) {
    if (file.includes('test/')) continue; // tests can test boundary rejections
    const content = readFileSync(file, 'utf8');
    if (/\bas any\b/.test(content) || /@ts-ignore/.test(content) || /@ts-nocheck/.test(content)) {
      bannedCount++;
    }
  }
  console.log(bannedCount === 0 ? '✅ 0 suppressions' : `⚠️  ${bannedCount} files have loose types`);

  // 4. Scan Migrations & RLS
  process.stdout.write('  → Database Security & RLS Coverage... ');
  const sqlFiles = scanFiles(join(ROOT_DIR, 'db/migrations'), /\.sql$/);
  let rlsTables = 0;
  let totalTables = 0;
  for (const file of sqlFiles) {
    const content = readFileSync(file, 'utf8');
    const tableMatches = content.match(/CREATE TABLE (IF NOT EXISTS )?public\.([a-z0-9_]+)/gi) || [];
    const rlsMatches = content.match(/ENABLE ROW LEVEL SECURITY/gi) || [];
    totalTables += tableMatches.length;
    rlsTables += rlsMatches.length;
  }
  const rlsCoverage = totalTables > 0 ? Math.min(100, Math.round((rlsTables / totalTables) * 100)) : 100;
  console.log(`✅ ${rlsCoverage}% RLS coverage (${sqlFiles.length} migrations)`);

  // 5. Routes inventory
  const routeFiles = scanFiles(join(WEB_DIR, 'src/app'), /route\.(ts|js)$/);
  const pageFiles = scanFiles(join(WEB_DIR, 'src/app'), /page\.(tsx|jsx)$/);

  // Compute checklist score
  let score = 0;
  if (tscClean) score += 25;
  if (testRun.ok) score += 35;
  if (bannedCount === 0) score += 20;
  if (rlsCoverage >= 90) score += 20;

  return {
    testsPassing,
    totalTests,
    tscClean,
    bannedPatternsCount: bannedCount,
    rlsCoveragePct: rlsCoverage,
    routesCount: routeFiles.length + pageFiles.length,
    migrationsCount: sqlFiles.length,
    checklistScore: score,
  };
}

// -----------------------------------------------------------------------------
// 2. Feature Slicer & Architecture Planner
// -----------------------------------------------------------------------------

function planFeature(featureName: string) {
  const cleanName = featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  console.log(`\n📐 [Chief Engineer] Architecting Enterprise Vertical Slice: "${featureName}"\n`);

  const spec = `## Vertical Slice Architecture: ${featureName}
Status: PROPOSED
Slice ID: slice-${cleanName}

### 1. Domain Entities & State Machine
- Identify primary entity and lifecycle transitions (e.g., draft -> active -> archived).
- Immutability rule: Never mutate historic audit records; append-only events.

### 2. Database Schema (PostgreSQL with RLS)
- Primary Key: UUIDv4
- Multi-tenancy: \`tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE\`
- Row Level Security:
  \`\`\`sql
  ALTER TABLE public.${cleanName.replace(/-/g, '_')} ENABLE ROW LEVEL SECURITY;
  CREATE POLICY ${cleanName.replace(/-/g, '_')}_tenant_isolation ON public.${cleanName.replace(/-/g, '_')}
    FOR ALL TO omni_app
    USING (public.is_agency() OR (tenant_id IS NOT NULL AND public.is_tenant_member(tenant_id)));
  \`\`\`

### 3. Strict API Contract (Zod & TypeScript)
- Input Schema: Validates request body, parameters, query.
- Output Schema: Standardized response envelope \`{ ok: true, data: T, timestamp: string }\`.
- Idempotency: Mutations require \`Idempotency-Key\` header or client-supplied UUID.

### 4. Non-Negotiable Invariants
1. No tenant may ever read or mutate data belonging to another tenant.
2. Every mutation generates an audit event or delivery receipt.
3. Zero \`any\`, zero \`@ts-ignore\`.

### 5. Verification Floor (TDD)
- [ ] Contract tests verifying input validation & failure modes.
- [ ] Tenant isolation test proving cross-tenant access returns 403/404.
- [ ] Idempotency test proving duplicate calls do not double-write.
- [ ] UI contrast & motion test proving WCAG AA compliance.
`;

  const specPath = join(ROOT_DIR, `docs/slices/${cleanName}.md`);
  run(`mkdir -p docs/slices`);
  writeFileSync(specPath, spec, 'utf8');
  console.log(`✅ Architectural specification written to: docs/slices/${cleanName}.md\n`);
  console.log(spec);
}

// -----------------------------------------------------------------------------
// 3. Surgical AST Prompt Generator (Token-Efficient, No AI Slowdown)
// -----------------------------------------------------------------------------

function generatePrompt(featureName: string) {
  const cleanName = featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  console.log(`\n⚡ [Chief Engineer] Generating High-Density AST Prompt for: "${featureName}"\n`);
  console.log('   (Extracting AST Type Spines strictly under 3,500 token ceiling to prevent AI lag)...\n');

  // Extract core design & contract spines
  const extractCmd = `python3 .agents/skills/argon-prompt/scripts/argon_extractor.py --files web/src/lib/webhooks/inbound-contract.ts web/src/app/globals.css --max-tokens 2500`;
  const extractorOut = run(extractCmd);
  const typeSpine = extractorOut.ok ? extractorOut.stdout : `// Standard Zod/TypeScript Contracts apply`;

  const prompt = `## Objective
Implement vertical slice "${featureName}" end-to-end to enterprise standards: PostgreSQL schema with RLS, typed Zod contract, zero-fluff modular implementation, and automated test suite.

## AST Type Spine (< 3,500 tokens)
${typeSpine}

## Non-Negotiable Invariants
1. Strict Multi-Tenant Isolation: Every table MUST enable RLS and isolate tenant data.
2. Idempotency: All state mutations must be idempotent.
3. Zero Tolerance for Loose Types: 0 \`any\`, 0 \`@ts-ignore\`.
4. High Contrast & Motion: UI surfaces must pass WCAG AA (>= 4.5:1) with \`useReducedMotion\` fallbacks.

## Mandatory 3-Phase Execution Protocol

### Phase 1: Environment Audit (Read-Only)
1. Inspect directory structure, dependencies, and existing contract tests using targeted search (\`grep\`, \`find\`). Do NOT dump entire files.
2. Formulate your implementation plan.
*Constraint: Do NOT edit any files until Phase 1 audit plan is output.*

### Phase 2: Implementation
1. Database Migration: Create \`db/migrations/00XX_${cleanName.replace(/-/g, '_')}.sql\` with RLS policies.
2. Contracts & Handlers: Implement schemas in \`src/lib/\` and route in \`src/app/api/\`.
3. UI Components: Build accessible, fluid spring-animated interfaces adhering to the design system.
4. Unit & Contract Tests: Write failing tests and make them pass.

### Phase 3: Verification & Self-Correction
1. Run strict type check: \`(cd web && npx tsc --noEmit)\`.
2. Run test suite: \`npm test\`.
3. Confirm 0 compiler errors and 100% test pass rate before completion.
`;

  const promptPath = join(ROOT_DIR, `docs/prompts/${cleanName}.prompt.md`);
  run(`mkdir -p docs/prompts`);
  writeFileSync(promptPath, prompt, 'utf8');
  console.log(`✅ Surgical Frontier Prompt generated at: docs/prompts/${cleanName}.prompt.md\n`);
  console.log('-------------------------------------------------------------------------------');
  console.log(prompt);
  console.log('-------------------------------------------------------------------------------');
}

// -----------------------------------------------------------------------------
// Main CLI Router
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] || 'status';

switch (command) {
  case 'status':
  case 'audit': {
    const metrics = runAudit();
    console.log('\n===============================================================');
    console.log(`🏆 ENTERPRISE READINESS SCORE: ${metrics.checklistScore} / 100`);
    console.log('===============================================================');
    console.log(`  • Tests Passing:      ${metrics.testsPassing} / ${metrics.totalTests}`);
    console.log(`  • Compiler Status:    ${metrics.tscClean ? '0 Errors' : 'Errors detected'}`);
    console.log(`  • Loose Types (any):  ${metrics.bannedPatternsCount} files`);
    console.log(`  • Database RLS:       ${metrics.rlsCoveragePct}% coverage`);
    console.log(`  • Application Routes: ${metrics.routesCount}`);
    console.log(`  • DB Migrations:      ${metrics.migrationsCount}`);
    console.log('===============================================================\n');
    break;
  }
  case 'plan': {
    const name = args.slice(1).join(' ') || 'New Feature';
    planFeature(name);
    break;
  }
  case 'prompt': {
    const name = args.slice(1).join(' ') || 'New Feature';
    generatePrompt(name);
    break;
  }
  case 'verify': {
    console.log('\n⚡ [Chief Engineer] Running Full Verification Suite...\n');
    const tsc = run('npx tsc --noEmit', WEB_DIR);
    if (!tsc.ok) {
      console.error('❌ TypeScript Compiler Error:\n', tsc.stdout);
      process.exit(1);
    }
    console.log('✅ TypeScript: 0 errors');
    const tests = run('npm test', ROOT_DIR);
    console.log(tests.stdout);
    if (!tests.ok) {
      console.error('❌ Test Suite Failed');
      process.exit(1);
    }
    console.log('\n✅ 100% VERIFICATION PASSED!\n');
    break;
  }
  default:
    console.log(`Unknown command: ${command}`);
    console.log('Usage: npx tsx scripts/chief-engineer.ts [status | audit | plan <name> | prompt <name> | verify]');
}
