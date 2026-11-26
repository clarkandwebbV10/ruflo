'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/validate-marketplace.yml'), 'utf8');
const patchedVersion = text => (text.match(/node-version:\s*['"]22\.23\.5['"]/g) || []).length === 1
  && !/node-version:\s*['"]?20['"]?\s*(?:\n|$)/.test(text);
const minimumPermissions = text => /(?:^|\n)permissions:\s*\n\s{2}contents: read\s*\n/.test(text)
  && !/(?:^|\n)\s{2}(?:issues|actions|packages|pull-requests|id-token|contents): write\s*(?:\n|$)/.test(text);
const triggerPaths = text => {
  const push = text.match(/\n  push:\s*\n    paths:\s*\n([\s\S]*?)(?=\n  pull_request:)/)?.[1] || '';
  const pr = text.match(/\n  pull_request:\s*\n    paths:\s*\n([\s\S]*?)(?=\npermissions:)/)?.[1] || '';
  return [push, pr].every(block => block.includes("- '.github/workflows/validate-marketplace.yml'")
    && block.includes("- 'tests/marketplace-ci-security.test.cjs'"));
};

test('marketplace CI uses one patched Node 22.23.5 runtime', () => {
  assert.equal((source.match(/uses:\s*actions\/setup-node@v4/g) || []).length, 1);
  assert.ok(patchedVersion(source));
});
test('downgrading to end-of-life Node 20 fails the runtime guard', () => {
  assert.equal(patchedVersion(source.replace("node-version: '22.23.5'", "node-version: '20'")), false);
});
test('GitHub token has explicitly limited read-only repository scope', () => {
  assert.ok(minimumPermissions(source));
});
test('escalating token permission to write fails the guard', () => {
  assert.equal(minimumPermissions(source.replace('contents: read', 'contents: write')), false);
});
test('both push and PR triggers cover workflow and regression changes', () => {
  assert.ok(triggerPaths(source));
});
test('removing the PR self-trigger fails the guard', () => {
  const prStart = source.indexOf("\n  pull_request:");
  const altered = source.slice(0, prStart) + source.slice(prStart).replace("      - '.github/workflows/validate-marketplace.yml'\n", "");
  assert.equal(triggerPaths(altered), false);
});
test('security regressions run after Node setup but before both marketplace validators', () => {
  const setup = source.indexOf('uses: actions/setup-node@v4');
  const gate = source.indexOf('run: node --test tests/marketplace-ci-security.test.cjs');
  const marketplace = source.indexOf('- name: Validate marketplace.json');
  const plugins = source.indexOf('- name: Validate plugin structure');
  assert.ok(setup >= 0 && gate > setup && marketplace > gate && plugins > marketplace);
});
