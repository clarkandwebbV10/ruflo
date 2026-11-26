// ADR-078 lint gate (v3/@claude-flow/cli/scripts/lint-adr078.mjs).
// Run: node --test tests/lint-adr078.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliDir = path.join(repoRoot, 'v3', '@claude-flow', 'cli');
const script = path.join(cliDir, 'scripts', 'lint-adr078.mjs');
const ts = require(require.resolve('typescript', { paths: [cliDir, repoRoot] }));
const load = () => import(require('node:url').pathToFileURL(script).href);

test('detects every child_process import form, with and without node: prefix', async () => {
  const { findChildProcessImports } = await load();
  const forms = [
    "import { execFile } from 'child_process';",
    "import * as cp from 'node:child_process';",
    "export { spawn } from 'child_process';",
    "import cp = require('child_process');",
    "const cp = require('node:child_process');",
    "const cp = await import('child_process');",
  ];
  for (const src of forms) assert.deepEqual(findChildProcessImports(src, 'x.ts', ts), [1], src);
});

test('ignores mentions in comments, strings and unrelated modules', async () => {
  const { findChildProcessImports } = await load();
  const src = [
    "// import { exec } from 'child_process';",
    "const doc = \"require('child_process')\";",
    "const tpl = `import x from 'node:child_process'`;",
    "import { readFile } from 'node:fs';",
    "const other = require('child_process_shim');",
  ].join('\n');
  assert.deepEqual(findChildProcessImports(src, 'x.ts', ts), []);
});

test('ratchet: new importer and stale baseline entry both fail', async () => {
  const { evaluate } = await load();
  const allowlist = new Set(['src/allowed.ts']);
  assert.equal(evaluate({ importers: new Set(['src/allowed.ts', 'src/debt.ts']), allowlist, baseline: new Set(['src/debt.ts']) }).ok, true);
  const added = evaluate({ importers: new Set(['src/debt.ts', 'src/new.ts']), allowlist, baseline: new Set(['src/debt.ts']) });
  assert.deepEqual(added.unexpected, ['src/new.ts']);
  const stale = evaluate({ importers: new Set([]), allowlist, baseline: new Set(['src/debt.ts']) });
  assert.deepEqual(stale.stale, ['src/debt.ts']);
  assert.equal(stale.ok, false);
});

function fixture(files, baseline) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr078-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.copyFileSync(path.join(cliDir, '.eslintrc.json'), path.join(dir, '.eslintrc.json'));
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'src', name), src);
  const baselinePath = path.join(dir, 'scripts', 'baseline.txt');
  fs.writeFileSync(baselinePath, baseline.join('\n'));
  return { dir, baselinePath };
}

test('CLI exits 0 for baselined/allowlisted importers and 1 for a new one', () => {
  const ok = fixture({ 'debt.ts': "import { spawn } from 'child_process';", 'mcp-server.ts': "import 'child_process';" }, ['src/debt.ts']);
  const bad = fixture({ 'debt.ts': "import { spawn } from 'child_process';", 'new.ts': "import { exec } from 'node:child_process';" }, ['src/debt.ts']);
  try {
    const run = (f) => spawnSync(process.execPath, [script, '--root', f.dir, '--baseline', f.baselinePath], { encoding: 'utf8', cwd: repoRoot });
    const pass = run(ok);
    assert.equal(pass.status, 0, pass.stderr);
    const fail = run(bad);
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /src\/new\.ts:1 imports child_process/);
  } finally {
    fs.rmSync(ok.dir, { recursive: true, force: true });
    fs.rmSync(bad.dir, { recursive: true, force: true });
  }
});

test('the committed CLI tree passes its own ADR-078 baseline', () => {
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: cliDir });
  assert.equal(run.status, 0, run.stderr);
});
