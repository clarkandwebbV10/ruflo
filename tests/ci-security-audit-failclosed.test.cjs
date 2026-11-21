// SEC-033: the CI security audit must block on material dependency findings.
// Dependency-free; uses isolated mock npm to test the actual workflow shell.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

function auditStep(text) {
  const start = text.indexOf('      - name: Run security audit\n');
  assert.ok(start !== -1, 'security audit step exists');
  const next = text.indexOf('\n      - name:', start + 1);
  assert.ok(next > start, 'security audit ends at next step');
  const block = text.slice(start, next);
  const match = block.match(/        run: \|\n((?:          [^\n]*\n)+)/);
  assert.ok(match, 'audit is a multiline shell step');
  return { block, script: match[1].split('\n').filter(Boolean).map(line => line.slice(10)).join('\n') };
}

function simulate(script, mode) {
  // Use an on-disk Bash fixture, never a real npm executable or OS-specific PATH.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-sec033-'));
  try {
    const mock = [
      'npm() {',
      '  printf "MC2_AUDIT_CALL:%s\\n" "$*"',
      '  if [ "$MOCK_MODE" = "full" ] && [ "$*" = "audit --audit-level=high" ]; then return 42; fi',
      '  if [ "$MOCK_MODE" = "prod" ] && [ "$*" = "audit --omit=dev --audit-level=moderate" ]; then return 43; fi',
      '  return 0',
      '}',
    ].join('\n') + '\n';
    assert.ok(['clean', 'full', 'prod'].includes(mode));
    fs.writeFileSync(path.join(scratch, 'run.sh'), 'MOCK_MODE=' + mode + '\n' + mock + script, 'utf8');
    // Bash's working directory must be the PARENT to avoid Windows EBUSY at cleanup.
    const execution = spawnSync('bash', ['./' + path.basename(scratch) + '/run.sh'], {
      cwd: os.tmpdir(), encoding: 'utf8', timeout: 6000,
    });
    assert.ifError(execution.error);
    const calls = execution.stdout.split(/\r?\n/)
      .filter(line => line.startsWith('MC2_AUDIT_CALL:'))
      .map(line => line.slice('MC2_AUDIT_CALL:'.length));
    return { status: execution.status, calls, stderr: execution.stderr };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const { block, script } = auditStep(workflow);

test('required audit is not continue-on-error or swallowed by echo', () => {
  assert.doesNotMatch(block, /continue-on-error\s*:\s*true/);
  assert.doesNotMatch(script, /\|\|\s*(echo|true)/);
  assert.match(script, /^set -euo pipefail/m);
});

test('full dependency audit blocks on high findings', () => {
  assert.match(script, /^npm audit --audit-level=high$/m);
});

test('production-only audit blocks on moderate findings', () => {
  assert.match(script, /^npm audit --omit=dev --audit-level=moderate$/m);
});

test('clean scans run both audit commands and succeed', () => {
  const r = simulate(script, 'clean');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ['audit --audit-level=high', 'audit --omit=dev --audit-level=moderate']);
});

test('high vulnerability in full tree fails the shell and skips production scan', () => {
  const r = simulate(script, 'full');
  assert.equal(r.status, 42, r.stderr);
  assert.deepEqual(r.calls, ['audit --audit-level=high']);
});

test('moderate production vulnerability fails the shell', () => {
  const r = simulate(script, 'prod');
  assert.equal(r.status, 43, r.stderr);
  assert.deepEqual(r.calls, ['audit --audit-level=high', 'audit --omit=dev --audit-level=moderate']);
});

test('old nonblocking audit reproduces false-green failure', () => {
  const old = 'npm audit --audit-level=high || echo ignored\n' +
              'npm audit --omit=dev --audit-level=moderate || echo ignored';
  assert.equal(simulate(old, 'full').status, 0);
  assert.equal(simulate(old, 'prod').status, 0);
});
