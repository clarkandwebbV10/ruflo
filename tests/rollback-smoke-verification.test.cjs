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
    .replace(/\$\(date[^)]*\)/g, '2026-11-19T00:00:00Z')
    .replaceAll('$(printf \'%s\' "$MC2_ROLLBACK_TARGET" | jq -Rs .)', '"placeholder"')
    .replaceAll('$(printf \'%s\' "$MC2_ROLLBACK_REASON" | jq -Rs .)', '"placeholder"');
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


 
test('SEC-020: rollback produces a new descendant commit without erasing history', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-rollback-history-'));
  const outputFile = path.join(os.tmpdir(), 'mc2-rollback-outputs-' + process.pid + '-' + Date.now());
  function git(...args) {
    const result = spawnSync('git', args, { cwd: tmpDir, encoding: 'utf8' });
    assert.equal(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr);
    return result.stdout.trim();
  }
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'MC2 CI Test');
    git('config', 'user.email', 'ci-test@example.invalid');
    fs.writeFileSync(path.join(tmpDir, 'stable.txt'), 'safe baseline\n');
    git('add', '-A');
    git('commit', '-qm', 'baseline');
    const target = git('rev-parse', 'HEAD');

    fs.rmSync(path.join(tmpDir, 'stable.txt'));
    fs.writeFileSync(path.join(tmpDir, 'later.txt'), 'changed state\n');
    git('add', '-A');
    git('commit', '-qm', 'latest state');
    const originalHead = git('rev-parse', 'HEAD');
    // Validation backup artifacts are downloaded into this runner and MUST stay untracked.
    fs.mkdirSync(path.join(tmpDir, 'rollback-data', 'backup'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'rollback-data', 'backup', 'fixture-private-backup.txt'), 'do not commit\n');

    // Substitute only known GitHub context fields in the real workflow run block.
    const replacements = {
      'github.event.inputs.rollback_target || needs.failure-detection.outputs.rollback-target': target,
      "github.event.inputs.rollback_reason || 'Automated rollback due to CI failure'": 'CI failure test',
      'github.actor': 'mc2-test',
      'github.sha': originalHead,
      'github.ref_name': 'main',
      "needs.failure-detection.outputs.rollback-session-id || 'manual'": 'test-session',
      "github.event.inputs.rollback_scope || 'application'": 'application',
      "github.event.inputs.emergency_mode || 'false'": 'false',
    };
    const script = namedStepScript('Execute rollback').replace(/[$][{][{]([^}]+)[}][}]/g, (_, key) => {
      const k = key.trim();
      assert.ok(Object.hasOwn(replacements, k), 'unexpected GitHub expression: ' + k);
      return replacements[k];
    });
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputFile, MC2_ROLLBACK_TARGET: target, MC2_ROLLBACK_REASON: 'CI failure test', MC2_ROLLBACK_SCOPE: 'application', MC2_EMERGENCY_MODE: 'false' },
    });
    assert.equal(result.status, 0, result.stderr + '\n' + result.stdout);
    const rollbackHead = git('rev-parse', 'HEAD');
    assert.notEqual(rollbackHead, originalHead);
    assert.equal(git('rev-parse', 'HEAD^'), originalHead, 'new rollback must preserve previous branch tip as parent');
    git('merge-base', '--is-ancestor', originalHead, rollbackHead);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'stable.txt'), 'utf8'), 'safe baseline\n');
    assert.equal(fs.existsSync(path.join(tmpDir, 'later.txt')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'ROLLBACK_INFO.md')), true);
    assert.equal(git('ls-files', 'rollback-data'), '', 'untracked validation backups must not enter rollback commit');
    assert.equal(fs.existsSync(path.join(tmpDir, 'rollback-data', 'backup', 'fixture-private-backup.txt')), true);
    assert.match(fs.readFileSync(outputFile, 'utf8'), /rollback-executed=true/);
    assert.match(fs.readFileSync(outputFile, 'utf8'), /rollback-commit=[a-f0-9]{40}/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(outputFile, { force: true });
  }
});

test('SEC-020: push step rejects non-fast-forward and never force-pushes', () => {
  const step = namedStepScript('Push rollback commit');
  assert.match(step, /git push origin HEAD:/);
  assert.doesNotMatch(step, /--force(?:-with-lease)?|git push[^\n]*\s-f\b/);
  assert.doesNotMatch(workflow, /git reset --hard "\$ROLLBACK_TARGET"/);
  assert.match(namedStepScript('Execute rollback'), /git restore --source="\$ROLLBACK_TARGET" --staged --worktree -- \./);
});
