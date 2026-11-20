// Dependency-free regression guard for the Codex integration workflow.
// These tests are static CI-configuration checks; they do not certify the full audit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workflowPath = path.resolve(__dirname, '../.github/workflows/codex-integration-audit.yml');
const original = fs.readFileSync(workflowPath, 'utf8');
const ownPath = 'tests/codex-ci-security.test.cjs';
const workflowName = '.github/workflows/codex-integration-audit.yml';

function assertSafe(text) {
  const setup = [...text.matchAll(/node-version:\s*['"]?([^'"\s]+)/g)].map(m => m[1]);
  assert.deepEqual(setup, ['22.23.5'], 'all Node CI setups must use patched Node 22.23.5');
  assert.match(text, /^permissions:\s*\n  contents: read\s*$/m, 'workflow must declare read-only token');
  assert.doesNotMatch(text, /^\s+(?:actions|checks|contents|deployments|issues|packages|pull-requests|statuses|workflows):\s*write\s*$/m, 'unexpected write grants');
  const pushStart = text.indexOf('\n  push:');
  const prStart = text.indexOf('\n  pull_request:');
  const permissionsStart = text.indexOf('\npermissions:');
  assert.ok(pushStart >= 0 && prStart > pushStart && permissionsStart > prStart, 'push and PR events required');
  const push = text.slice(pushStart, prStart);
  const pr = text.slice(prStart, permissionsStart);
  for (const section of [push, pr]) {
    assert.ok(section.includes("'" + workflowName + "'"), 'workflow must trigger its own verification');
    assert.ok(section.includes("'" + ownPath + "'"), 'test edits must trigger verification');
  }
  const guard = text.indexOf('run: node --test ' + ownPath);
  const originalAudit = text.indexOf('run: node scripts/audit-codex-integration.mjs');
  assert.ok(guard >= 0 && originalAudit > guard, 'regression must run before preserved audit');
}

test('patched Node pin and original audit retained', () => {
  assertSafe(original);
});
test('EOL Node downgrade is rejected', () => {
  assert.throws(() => assertSafe(original.replace("node-version: '22.23.5'", "node-version: '20'")));
});
test('token permission escalation is rejected', () => {
  assert.throws(() => assertSafe(original.replace('  contents: read', '  contents: write')));
});
test('PR self-trigger removal is rejected', () => {
  const s = original.replace(/(\n  pull_request:[\s\S]*?)(?=\npermissions:)/, segment => segment.replace("      - '" + ownPath + "'", ''));
  assert.throws(() => assertSafe(s));
});
test('missing or reordered pre-audit regression gate is rejected', () => {
  assert.throws(() => assertSafe(original.replace('run: node --test ' + ownPath, 'run: echo skip-security-test')));
});
