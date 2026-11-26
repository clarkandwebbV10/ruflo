'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'neural-trader-smoke.yml'), 'utf8');
const guard = 'node --test tests/neural-trader-ci-security.test.cjs';

function checkRuntime(text) {
  const matches = [...text.matchAll(/^\s*node-version:\s*['"]?([^'"\s#]+)/gm)].map(x => x[1]);
  assert.deepEqual(matches, ['22.23.5'], 'all setup-node runtimes must be the patched version');
}
function checkPermissions(text) {
  assert.match(text, /^permissions:\s*\n  contents: read\s*$/m);
  assert.doesNotMatch(text, /^\s+(?:actions|contents|deployments|id-token|issues|packages|pull-requests|security-events):\s*write\s*$/m);
}
function checkTriggers(text) {
  const push = text.split('  push:')[1]?.split('  pull_request:')[0] ?? '';
  const pr = text.split('  pull_request:')[1]?.split('  workflow_dispatch:')[0] ?? '';
  for (const block of [push, pr]) {
    assert.match(block, /\.github\/workflows\/neural-trader-smoke\.yml/);
    assert.match(block, /tests\/neural-trader-ci-security\.test\.cjs/);
  }
}
function checkGate(text) {
  const i = text.indexOf(guard);
  const install = text.indexOf('sudo apt-get update');
  const smoke = text.indexOf('bash plugins/ruflo-neural-trader/scripts/runtime-smoke.sh');
  assert.ok(i > 0 && install > i && smoke > install, 'guard must precede installation and runtime smoke');
}
function checkOriginal(text) {
  for (const required of [
    "branches: [main]", "- cron: '17 6 * * 1'", 'workflow_dispatch:',
    'sudo apt-get install -y jq',
    'bash plugins/ruflo-neural-trader/scripts/runtime-smoke.sh',
    'if: failure()', 'actions/upload-artifact@v4',
    '/tmp/runtime-smoke-*.log',
  ]) assert.ok(text.includes(required), `existing contract removed: ${required}`);
}

test('CI pins the supported patched Node version', () => checkRuntime(workflow));
test('workflow token stays read-only', () => checkPermissions(workflow));
test('workflow and test edits trigger CI on push and pull requests', () => checkTriggers(workflow));
test('dependency-free security gate precedes package setup and smoke', () => checkGate(workflow));
test('original smoke, cron, dispatch and failure-artifact controls remain', () => checkOriginal(workflow));
test('rejects Node 20 downgrade', () => assert.throws(() => checkRuntime(workflow.replace("node-version: '22.23.5'", "node-version: '20'"))));
test('rejects write permission', () => assert.throws(() => checkPermissions(workflow.replace('contents: read', 'contents: write'))));
test('rejects missing PR test trigger', () => assert.throws(() => checkTriggers(workflow.replace("      - 'tests/neural-trader-ci-security.test.cjs'\n  workflow_dispatch:", '  workflow_dispatch:'))));
test('rejects bypassing the pre-install security gate', () => assert.throws(() => checkGate(workflow.replace(guard, 'echo gate-disabled'))));
test('rejects removal of failure artifacts', () => assert.throws(() => checkOriginal(workflow.replace('if: failure()', 'if: never()'))));
