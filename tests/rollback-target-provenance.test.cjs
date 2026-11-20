'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/rollback-manager.yml'), 'utf8');
const detect = workflow.match(/^      - name: Detect failure conditions\n        id: detect\n        run: \|\n([\s\S]*?)(?=^      - name: Create failure report)/m);
assert.ok(detect, 'detection job run block exists');

function executeDetection(eventName, conclusion, upstreamName) {
  // Use stdout for step outputs, avoiding host-path rewriting inside Windows Git Bash.
  let script = detect[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const bindings = {
    'github.sha': '0123456789abcdef0123456789abcdef01234567',
    'github.event_name': eventName,
    'github.event.workflow_run.conclusion': conclusion,
    'github.event.workflow_run.name': upstreamName,
  };
  for (const [name, value] of Object.entries(bindings)) {
    script = script.replaceAll('${{ ' + name + ' }}', value);
  }
  assert.ok(!script.includes('${{'), 'all GitHub expressions replaced');
  const run = spawnSync('bash', ['-e', '-o', 'pipefail'], {
    encoding: 'utf8', input: script,
    env: { ...process.env, GITHUB_OUTPUT: '/dev/stdout' }, timeout: 10000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const values = Object.fromEntries(run.stdout.split('\n')
    .filter(s => /^(rollback-required|failure-type|failure-severity|rollback-target|rollback-session-id)=/.test(s))
    .map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
  return { values, logs: run.stdout };
}

test('SEC-023: no unverified message/HEAD~1 rollback selector is allowed', () => {
  assert.doesNotMatch(detect[1], /git log\s+--oneline|ROLLBACK_TARGET="HEAD~1"/);
  assert.match(detect[1], /CI-success-verified target/);
  assert.match(workflow, /"rollbackRequired": \$\{\{ steps\.detect\.outputs\.rollback-required \}\}/);
});

test('SEC-023: failed high-severity CI preserves incident evidence without an arbitrary target', () => {
  const r = executeDetection('workflow_run', 'failure', 'Verification Pipeline');
  assert.equal(r.values['rollback-required'], 'false');
  assert.equal(r.values['rollback-target'], '');
  assert.equal(r.values['failure-type'], 'ci_failure_unverified_target');
  assert.equal(r.values['failure-severity'], 'high');
  assert.match(r.logs, /Automatic rollback held/);
  assert.match(workflow, /if: steps\.detect\.outputs\.failure-type != 'none'/);
});

test('SEC-023: failed medium CI is held, successful CI and push remain no-op', () => {
  const fail = executeDetection('workflow_run', 'failure', 'Truth Scoring Pipeline');
  assert.equal(fail.values['rollback-required'], 'false');
  assert.equal(fail.values['failure-type'], 'ci_failure_unverified_target');
  assert.equal(fail.values['failure-severity'], 'medium');
  for (const [event, conclusion] of [['workflow_run', 'success'], ['push', '']]) {
    const r = executeDetection(event, conclusion, 'Verification Pipeline');
    assert.equal(r.values['rollback-required'], 'false');
    assert.equal(r.values['failure-type'], 'none');
    assert.equal(r.values['rollback-target'], '');
  }
});
