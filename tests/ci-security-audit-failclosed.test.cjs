// SEC-033: the CI security audit must block on material dependency findings.
// The CI step runs scripts/audit-gate.mjs, which performs the full-tree
// (high+) and production-tree (moderate+) scans and allows only reviewed,
// expiring exceptions from config/audit-exceptions.json. Dependency-free:
// behavior is tested against recorded npm audit JSON fixtures, never the
// network.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const gate = path.join(root, 'scripts', 'audit-gate.mjs');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

function auditStep(text) {
  const start = text.indexOf('      - name: Run security audit\n');
  assert.ok(start !== -1, 'security audit step exists');
  const next = text.indexOf('\n      - name:', start + 1);
  assert.ok(next > start, 'security audit ends at next step');
  const block = text.slice(start, next);
  const match = block.match(/        run: \|\n((?:          [^\n]*\n)+)/);
  assert.ok(match, 'audit is a multiline shell step');
  return { block, script: match[1].split('\n').filter(Boolean).map((line) => line.slice(10)).join('\n') };
}

function report(advisories) {
  const vulnerabilities = {};
  for (const a of advisories) {
    vulnerabilities[a.name] ??= { name: a.name, severity: a.severity, via: [] };
    vulnerabilities[a.name].via.push({ name: a.name, severity: a.severity, title: 't', url: `https://github.com/advisories/${a.ghsa}` });
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } };
}

const HIGH = { name: 'pkg-high', severity: 'high', ghsa: 'GHSA-2222-3333-4444' };
const MOD = { name: 'pkg-mod', severity: 'moderate', ghsa: 'GHSA-5555-6666-7777' };
const exception = (a, expires = '2099-01-01') => ({
  package: a.name, advisory: a.ghsa, reason: 'reviewed: semver-major fix tracked separately', remediation: 'upgrade', expires,
});

function runGate({ full = [], prod = [], exceptions = [], today = '2026-11-26', raw }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec033-'));
  try {
    const write = (name, value) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
      return file;
    };
    const args = [gate,
      '--input-all', write('all.json', raw ?? report(full)),
      '--input-prod', write('prod.json', report(prod)),
      '--exceptions', write('exceptions.json', { exceptions }),
      '--today', today];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const { block, script } = auditStep(workflow);

test('required audit is not continue-on-error or swallowed by echo', () => {
  assert.doesNotMatch(block, /continue-on-error\s*:\s*true/);
  assert.doesNotMatch(script, /\|\|\s*(echo|true)/);
  assert.match(script, /^set -euo pipefail/m);
});

test('CI runs the fail-closed audit gate', () => {
  assert.match(script, /^node scripts\/audit-gate\.mjs$/m);
});

test('the committed exception list is well-formed and every entry expires', async () => {
  const { validateExceptions } = await import(require('node:url').pathToFileURL(gate).href);
  const { exceptions } = JSON.parse(fs.readFileSync(path.join(root, 'config', 'audit-exceptions.json'), 'utf8'));
  assert.deepEqual(validateExceptions(exceptions), []);
});

test('clean scans pass', () => {
  const r = runGate({});
  assert.equal(r.status, 0, r.out);
});

test('an unexcepted high advisory in the full tree blocks', () => {
  const r = runGate({ full: [HIGH] });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /BLOCKING \(full scan\) high pkg-high GHSA-2222-3333-4444/);
});

test('a moderate advisory blocks in production but not in the dev-only full tree', () => {
  assert.equal(runGate({ full: [MOD], prod: [MOD] }).status, 1);
  assert.equal(runGate({ full: [MOD] }).status, 0);
});

test('a reviewed, unexpired exception allows exactly its advisory', () => {
  assert.equal(runGate({ full: [HIGH], exceptions: [exception(HIGH)] }).status, 0);
  const other = { ...HIGH, ghsa: 'GHSA-8888-9999-cccc' };
  assert.equal(runGate({ full: [HIGH, other], exceptions: [exception(HIGH)] }).status, 1);
});

test('an expired exception blocks', () => {
  const r = runGate({ full: [HIGH], exceptions: [exception(HIGH, '2026-11-01')] });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /EXPIRED exception pkg-high/);
});

test('a stale exception blocks so the list can only shrink', () => {
  const r = runGate({ exceptions: [exception(HIGH)] });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /STALE exception pkg-high GHSA-2222-3333-4444/);
});

test('an exception without a substantive reason is rejected', () => {
  const r = runGate({ full: [HIGH], exceptions: [{ ...exception(HIGH), reason: 'ok' }] });
  assert.equal(r.status, 1, r.out);
});

test('an unreadable audit report fails closed', () => {
  const r = runGate({ raw: '{"error":{"code":"ENOAUDIT"}}' });
  assert.equal(r.status, 2, r.out);
});

test('old nonblocking audit reproduces false-green failure', () => {
  const old = 'npm() { return 42; }\nnpm audit --audit-level=high || echo ignored\n';
  const r = spawnSync('bash', ['-c', old], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});
