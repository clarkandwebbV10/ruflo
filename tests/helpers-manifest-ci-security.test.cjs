'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/helpers-manifest-guard.yml'), 'utf8');
function checkNode(s) {
  assert.equal((s.match(/uses:\s*actions\/setup-node@v4/g) || []).length, 1);
  assert.match(s, /^\s+node-version:\s*'22\.23\.5'$/m);
  assert.doesNotMatch(s, /^\s+node-version:\s*['"]?20['"]?\s*$/m);
}
function checkPermissions(s) {
  assert.match(s, /^permissions:\s*\n  contents: read\s*$/m);
  assert.doesNotMatch(s, /^permissions:\s*\n  contents: write\s*$/m);
}
function eventBlock(s, name) {
  const re = new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  (?:push|pull_request):|^permissions:|^jobs:)', 'm');
  return s.match(re)?.[1] || '';
}
function checkTrigger(s) {
  const paths = ["'.github/workflows/helpers-manifest-guard.yml'", "'tests/helpers-manifest-ci-security.test.cjs'"];
  for (const event of ['pull_request', 'push']) {
    const block = eventBlock(s, event);
    for (const p of paths) assert.ok(block.includes(p), event + ' is missing ' + p);
  }
}
function checkEarlyStep(s) {
  const step = 'run: node --test tests/helpers-manifest-ci-security.test.cjs';
  const a = s.indexOf('uses: actions/setup-node@v4');
  const b = s.indexOf(step);
  const c = s.indexOf('name: sign-helpers.mjs and verify-helpers.mjs exist');
  assert.ok(a >= 0 && b > a && c > b, 'regression must execute after setup-node and before helper validation');
}
test('supported patched Node and downgrade rejection', () => {
  checkNode(workflow);
  assert.throws(() => checkNode(workflow.replace("node-version: '22.23.5'", "node-version: '20'")));
});
test('root token is least-privilege and write escalation rejected', () => {
  checkPermissions(workflow);
  assert.throws(() => checkPermissions(workflow.replace('contents: read', 'contents: write')));
});
test('both events trigger on security workflow and test changes', () => {
  checkTrigger(workflow);
  const prefix = '  push:';
  const p = workflow.indexOf(prefix);
  assert.ok(p >= 0);
  const mutated = workflow.slice(0, p) + workflow.slice(p).replace("      - 'tests/helpers-manifest-ci-security.test.cjs'\n", '');
  assert.throws(() => checkTrigger(mutated));
});
test('dependency-free regression executes before original guard checks', () => {
  checkEarlyStep(workflow);
  assert.throws(() => checkEarlyStep(workflow.replace('run: node --test tests/helpers-manifest-ci-security.test.cjs', 'run: echo skipped')));
});
test('existing sign/verify and helper-transport checks remain', () => {
  assert.match(workflow, /node scripts\/smoke-helper-signing-security\.mjs/);
  assert.match(workflow, /prepublishOnly wires sign-helpers \+ verify-helpers/);
  assert.match(workflow, /sign runs before verify in prepublishOnly/);
});
