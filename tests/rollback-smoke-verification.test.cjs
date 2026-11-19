'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/rollback-manager.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function smokeStepScript() {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf('      - name: Run smoke tests');
  assert.ok(start >= 0, 'rollback smoke-test step must exist');
  assert.equal(lines[start + 1], '        run: |', 'smoke step must use a shell run block');
  const body = [];
  for (let index = start + 2; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.startsWith('          ') ? line.slice(10) : '');
  }
  return body.join('\n');
}

test('rollback uses existing Vitest script, not missing test:unit', () => {
  assert.equal(packageJson.scripts.test, 'vitest');
  assert.equal(Object.hasOwn(packageJson.scripts, 'test:unit'), false);
  assert.match(smokeStepScript(), /timeout 120s npm run test -- --run/);
});

test('rollback smoke gate cannot suppress errors or produce success unconditionally', () => {
  const script = smokeStepScript();
  assert.match(script, /set -euo pipefail/);
  assert.doesNotMatch(script, /\|\|\s*(?:echo|true)/);
  assert.match(script, /✅ Rollback smoke tests passed/);
});

for (const [exitCode, expected] of [[0, 0], [1, 1], [124, 124]]) {
  test('rollback smoke shell propagates timeout exit ' + exitCode, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-rollback-test-'));
    try {
      const stub = path.join(tmpDir, 'timeout');
      const argsFile = path.join(tmpDir, 'args.txt');
      fs.writeFileSync(stub, '#!/bin/sh\nprintf "%s" "$*" > "$MOCK_ARGS_FILE"\nexit "$MOCK_TIMEOUT_STATUS"\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-e', '-c', smokeStepScript()], {
        cwd: repoRoot,
        env: { ...process.env, PATH: tmpDir + path.delimiter + process.env.PATH, MOCK_ARGS_FILE: argsFile, MOCK_TIMEOUT_STATUS: String(exitCode) },
        encoding: 'utf8',
      });
      assert.equal(result.status, expected, result.stderr);
      assert.equal(fs.readFileSync(argsFile, 'utf8'), '120s npm run test -- --run');
      assert.equal(result.stdout.includes('✅ Rollback smoke tests passed'), exitCode === 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}


function namedStepScript(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf('      - name: ' + name);
  assert.ok(start >= 0, 'rollback step must exist: ' + name);
  const runLine = lines.slice(start + 1).findIndex(line => line.trim() === 'run: |');
  assert.ok(runLine >= 0 && runLine <= 3, 'expected shell step: ' + name);
  const runStart = start + 1 + runLine;
  const body = [];
  for (let i = runStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && !line.startsWith('          ')) break;
    body.push(line.startsWith('          ') ? line.slice(10) : '');
  }
  return body.join('\n');
}

test('SEC-018: root build:ts masks errors; direct CLI build script is tsc', () => {
  assert.match(packageJson.scripts['build:ts'], /\|\|\s*true/);
  const cliPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'v3/@claude-flow/cli/package.json'), 'utf8'));
  assert.equal(cliPkg.scripts.build, 'tsc');
});

test('SEC-018: pre-rollback viability bypasses root masking build script', () => {
  const script = namedStepScript('Test rollback target viability');
  assert.match(script, /set -e\b/);
  assert.match(script, /npm --prefix v3\/@claude-flow\/cli run build/);
  assert.doesNotMatch(script, /^\s*npm run build:ts\b/m);
});

test('SEC-018: post-rollback build gate fails closed', () => {
  const script = namedStepScript('Verify build functionality');
  assert.match(script, /set -euo pipefail/);
  assert.match(script, /npm --prefix v3\/@claude-flow\/cli run build/);
  assert.doesNotMatch(script, /^\s*npm run build:ts\b/m);
  assert.match(script, /✅ Build verification passed/);
});

for (const [exitCode, expected] of [[0, 0], [1, 1], [124, 124]]) {
  test('SEC-018: post-rollback build propagates npm exit ' + exitCode, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-rollback-build-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'npm'), '#!/bin/sh\nprintf "%s" "$*" > "$MOCK_ARGS_FILE"\nexit "$MOCK_NPM_STATUS"\n', { mode: 0o755 });
      const argsFile = path.join(tmpDir, 'args.txt');
      const result = spawnSync('bash', ['-e', '-c', namedStepScript('Verify build functionality')], {
        cwd: repoRoot,
        env: { ...process.env, PATH: tmpDir + path.delimiter + process.env.PATH, MOCK_ARGS_FILE: argsFile, MOCK_NPM_STATUS: String(exitCode) },
        encoding: 'utf8',
      });
      assert.equal(result.status, expected, result.stderr);
      assert.equal(fs.readFileSync(argsFile, 'utf8'), '--prefix v3/@claude-flow/cli run build');
      assert.equal(result.stdout.includes('✅ Build verification passed'), exitCode === 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}


function rollbackReportTemplate() {
  const marker = 'cat > rollback-reports/rollback-report.json << EOF';
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, 'rollback JSON report generator must exist');
  const lines = workflow.slice(start + marker.length).split(/\r?\n/);
  const body = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === 'EOF') break;
    body.push(line.trimStart());
  }
  return body.join('\n');
}

test('SEC-019: rollback report parses and explicitly declines unsupported health claims', () => {
  const raw = rollbackReportTemplate()
    .replace(/\$\{\{[^}]+\}\}/g, 'placeholder')
    .replace(/\$\(date[^)]*\)/g, '2026-11-19T00:00:00Z');
  const report = JSON.parse(raw);
  assert.equal(report.verification.liveRuntimeVerified, false);
  assert.equal(report.monitoring.configured, false);
  assert.equal(report.monitoring.runtimeMetricsCollected, false);
  assert.equal(report.monitoring.systemStable, null);
  assert.equal(report.monitoring.issuesDetected, null);
  assert.equal(report.monitoring.status, 'not_verified');
  assert.match(report.status, /unverified/);
  assert.equal(report.verification.postRollbackJobResult, 'placeholder');
});

test('SEC-019: report, workflow logs and issue notification do not invent monitoring results', () => {
  assert.doesNotMatch(workflow, /"systemStable":\s*true/);
  assert.doesNotMatch(workflow, /"issuesDetected":\s*0/);
  assert.doesNotMatch(workflow, /system appears stable|system is now stable|Monitoring completed successfully/);
  assert.doesNotMatch(workflow, /Simulate monitoring|sleep 30  # Short monitoring/);
  assert.match(workflow, /No live runtime probes or deployed health metrics are configured/);
  assert.match(workflow, /live runtime health unverified/);
});
