// SEC-029 CI-only security regression; no dependencies or network calls.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../.github/workflows/metaharness-ci.yml');
const yml = fs.readFileSync(file, 'utf8');
const pins = s => [...s.matchAll(/^\\s+node-version:\\s*['\"]?([^'\"\\s#]+)['\"]?\\s*$/gm)].map(x => x[1]);
const pinCheck = s => pins(s).length === 7 && pins(s).every(x => x === '22.23.5');
const readOnly = s => /^permissions:\\s*\\n  contents: read\\s*$/m.test(s) && !/^\\s+(?:contents|issues|actions|packages|pull-requests): write\\s*$/m.test(s);
const bothTriggerPaths = s => {
  const push = s.split(/^  push:\\s*$/m)[1]?.split(/^  pull_request:\\s*$/m)[0] || '';
  const pr = s.split(/^  pull_request:\\s*$/m)[1]?.split(/^  workflow_dispatch:\\s*$/m)[0] || '';
  return [push, pr].every(x => x.includes("'tests/metaharness-ci-security.test.cjs'") && x.includes("'.github/workflows/metaharness-ci.yml'"));
};
test('all 7 setup-node consumers use patched Node 22.23.5', () => {
  assert.equal((yml.match(/uses: actions\\/setup-node@v4/g)||[]).length, 7);
  assert.equal(pinCheck(yml), true);
});
test('reject unsupported Node 20 downgrade', () => {
  assert.equal(pinCheck(yml.replace('22.23.5', '20')), false);
});
test('workflow token is explicitly read-only', () => assert.equal(readOnly(yml), true));
test('reject write-token escalation', () => assert.equal(readOnly(yml.replace('contents: read', 'contents: write')), false));
test('both push and pull_request paths exercise the regression', () => assert.equal(bothTriggerPaths(yml), true));
test('reject missing PR trigger coverage', () => {
  const m=yml.replace(/(  pull_request:[\\s\\S]*?)(      - 'tests\\/metaharness-ci-security.test.cjs')/, '$1');
  assert.equal(bothTriggerPaths(m), false);
});
test('regression gate precedes existing plugin smoke and npm/npx work', () => {
  const gate=yml.indexOf('run: node --test tests/metaharness-ci-security.test.cjs');
  const firstSmoke=yml.indexOf('- name: Plugin structural smoke');
  assert.ok(gate > 0 && firstSmoke > gate);
});
