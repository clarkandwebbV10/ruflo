'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'all-plugins-smoke.yml'), 'utf8');
function checkRuntime(text) {
  assert.match(text, /node-version:\s*['"]22\.23\.5['"]/);
  assert.doesNotMatch(text, /node-version:\s*['"]?20(?:['"]|\s|$)/m);
}
function checkPermissions(text) {
  assert.match(text, /\npermissions:\n  contents: read\n\njobs:/);
  assert.doesNotMatch(text, /^  (?:actions|contents|deployments|packages|pull-requests|issues|id-token|security-events): write\s*$/m);
}
function checkTriggers(text) {
  const push = text.split('  push:')[1]?.split('  pull_request:')[0] || '';
  const pr = text.split('  pull_request:')[1]?.split('  workflow_dispatch:')[0] || '';
  for (const block of [push, pr]) {
    assert.match(block, /tests\/all-plugins-ci-security\.test\.cjs/);
    assert.match(block, /\.github\/workflows\/all-plugins-smoke\.yml/);
  }
}
function checkGates(text) {
  const verify = text.indexOf('node --test tests/all-plugins-ci-security.test.cjs');
  const smoke = text.indexOf('node scripts/smoke-all-plugins.mjs --timeout 300');
  assert.ok(verify > 0 && smoke > verify, 'security gate must run before plugin smoke');
  for (const required of [
    'scripts/audit-exit-bypass-antipattern.mjs',
    'scripts/audit-skill-frontmatter.mjs',
    'scripts/audit-plugin-manifest.mjs',
    'scripts/audit-plugin-mcp-prefix.mjs',
    'actions/upload-artifact@v4'
  ]) assert.ok(text.includes(required), 'existing check was removed: ' + required);
}
test('patched and supported Node runtime is pinned', () => checkRuntime(source));
test('token is least-privilege read-only', () => checkPermissions(source));
test('self and test edits trigger CI for push and PR', () => checkTriggers(source));
test('security guard precedes unchanged smoke checks', () => checkGates(source));
test('downgrade mutation is rejected', () =>
  assert.throws(() => checkRuntime(source.replace("node-version: '22.23.5'", "node-version: '20'"))));
test('token escalation mutation is rejected', () =>
  assert.throws(() => checkPermissions(source.replace('contents: read', 'contents: write'))));
test('missing test trigger mutation is rejected', () =>
  assert.throws(() => checkTriggers(source.replaceAll("      - 'tests/all-plugins-ci-security.test.cjs'\n", ''))));
