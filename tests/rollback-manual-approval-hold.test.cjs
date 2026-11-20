'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/rollback-manager.yml'), 'utf8');

function job(name) {
  const marker = '\n  ' + name + ':\n';
  const at = workflow.indexOf(marker);
  assert.notEqual(at, -1, 'job must exist: ' + name);
  const remaining = workflow.slice(at + marker.length);
  const next = remaining.search(/\n  [a-z][a-z0-9-]*:\n/);
  return next >= 0 ? remaining.slice(0, next) : remaining;
}

test('SEC-024: GITHUB_TOKEN is globally restricted to read-only', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /^\s{4}permissions:\n\s{6}contents: write\b/m);
});

test('SEC-024: manual dispatch is rejected visibly with no mutating command', () => {
  const hold = job('manual-dispatch-hold');
  assert.match(hold, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(hold, /::error::Manual rollback is on HOLD/);
  assert.match(hold, /^\s+exit 1$/m);
  assert.doesNotMatch(hold, /git (push|reset|restore)|npm ci/);
});

test('SEC-024: executor remains held and depends on approval job', () => {
  const exec = job('execute-rollback');
  assert.match(exec, /needs: \[failure-detection, pre-rollback-validation, manual-rollback-approval\]/);
  assert.match(exec, /^\s+if: \$\{\{ false \}\}$/m);
  assert.match(exec, /name: rollback-approval/);
});

test('SEC-024: unverified automated targets remain held by SEC-023', () => {
  assert.match(workflow, /Automatic rollback held: no CI-success-verified target/);
  assert.doesNotMatch(workflow, /ROLLBACK_TARGET="HEAD~1"/);
});

// SEC-026: refuse an end-of-life CI runtime (Node 20 EOL 2026-04-30).
test('SEC-026: rollback workflow pins a supported, security-patched Node 22 release', () => {
  assert.match(workflow, /^  NODE_VERSION: '22\\.23\\.5'$/m);
  assert.doesNotMatch(workflow, /^  NODE_VERSION: '20'$/m);
});

test('SEC-026: every explicit setup-node action uses the audited central version', () => {
  const versions = [...workflow.matchAll(/^\\s*node-version:\\s*(.+)$/gm)].map((match) => match[1].trim());
  assert.ok(versions.length > 0, 'at least one setup-node version is present');
  assert.ok(versions.every((version) => version === '${{ env.NODE_VERSION }}'));
});
