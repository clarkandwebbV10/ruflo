'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'business-pods-smoke.yml'), 'utf8');
const guard = 'node --test tests/business-pods-ci-security.test.cjs';

function checkNode(source) {
  const pins = [...source.matchAll(/^\s*node-version:\s*['"]?([^'"\s#]+)/gm)].map(m => m[1]);
  assert.deepEqual(pins, ['22.23.5']);
}
function checkPermissions(source) {
  assert.match(source, /^permissions:\s*\n\s{2}contents:\s*read\s*$/m);
  assert.doesNotMatch(source, /^\s+(?:actions|contents|deployments|id-token|issues|packages|pull-requests|security-events):\s*write\s*$/m);
}
function checkTriggers(source) {
  const push = source.split('  push:')[1]?.split('  pull_request:')[0] ?? '';
  const pr = source.split('  pull_request:')[1]?.split('  workflow_dispatch:')[0] ?? '';
  for (const block of [push, pr]) {
    assert.match(block, /tests\/business-pods-ci-security\.test\.cjs/);
    assert.match(block, /\.github\/workflows\/business-pods-smoke\.yml/);
  }
}
function checkGuard(source) {
  const index = source.indexOf(guard);
  const install = source.indexOf('pnpm install --frozen-lockfile');
  assert.ok(index > 0 && install > index, 'guard must precede dependency installation');
}
function checkOriginal(source) {
  for (const required of [
    'pnpm install --frozen-lockfile',
    'pnpm -r --no-bail build || pnpm --filter @claude-flow/cli build',
    'pnpm vitest run __tests__/business-pod-tools.test.ts',
    'node --test plugins/ruflo-business-pods/scripts/pod-tick.test.mjs',
    'bash plugins/ruflo-business-pods/scripts/smoke.sh',
  ]) assert.ok(source.includes(required), `removed existing smoke contract: ${required}`);
}
test('supported Node 22.23.5 is the only setup-node pin', () => checkNode(workflow));
test('workflow token is restricted to contents read', () => checkPermissions(workflow));
test('workflow and test changes trigger push and PR checks', () => checkTriggers(workflow));
test('dependency-free guard executes before install', () => checkGuard(workflow));
test('existing business-pod smoke contract remains intact', () => checkOriginal(workflow));
test('Node 20 downgrade mutation fails', () =>
  assert.throws(() => checkNode(workflow.replace("node-version: '22.23.5'", "node-version: '20'"))));
test('token write escalation mutation fails', () =>
  assert.throws(() => checkPermissions(workflow.replace('contents: read', 'contents: write'))));
test('missing test-trigger mutation fails', () =>
  assert.throws(() => checkTriggers(workflow.replaceAll("      - 'tests/business-pods-ci-security.test.cjs'\n", ''))));
test('missing guard mutation fails', () =>
  assert.throws(() => checkGuard(workflow.replace(guard, 'echo security checks omitted'))));
