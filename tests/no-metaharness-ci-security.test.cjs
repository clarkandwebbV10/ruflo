'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const workflow = readFileSync(join(__dirname, '../.github/workflows/no-metaharness-smoke.yml'), 'utf8');
const testPath = "      - 'tests/no-metaharness-ci-security.test.cjs'";
function check(source) {
  assert.match(source, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'restrict GITHUB_TOKEN to read scope');
  assert.doesNotMatch(source, /^\s+(?:actions|contents|packages|workflows|pull-requests):\s*write\s*$/m, 'no write access');
  const versions = Array.from(source.matchAll(/\bnode-version:\s*['"]?([^\s'"]+)/g), m => m[1]);
  assert.deepEqual(versions, ['22.23.5'], 'one pinned, security-patched CI Node runtime');
  const push = source.match(/^  push:\s*\n([\s\S]*?)(?=^  (?:pull_request|workflow_dispatch):)/m);
  const pr = source.match(/^  pull_request:\s*\n([\s\S]*?)(?=^  workflow_dispatch:)/m);
  assert.ok(push && push[1].includes(testPath), 'push must run when regression guard changes');
  assert.ok(pr && pr[1].includes(testPath), 'PR must run when regression guard changes');
  const checkAt = source.indexOf('node --test tests/no-metaharness-ci-security.test.cjs');
  const originalAt = source.indexOf('Verify no \`@metaharness/*\` or \`metaharness\` appears');
  assert.ok(checkAt > 0 && originalAt > checkAt, 'security guard must execute first');
  assert.ok(source.includes('node scripts/smoke-all-plugins.mjs --timeout 300'), 'keep existing plugin smoke');
  assert.ok(source.includes('RUFLO_METAHARNESS_SKIP_LOCAL=1'), 'preserve absent-runtime simulation');
  assert.ok(source.includes('npm_config_registry=http://127.0.0.1:9/'), 'preserve unreachable registry drill');
}
test('no-metaharness CI maintains least privilege and patched Node', () => check(workflow));
test('reject Node 20 downgrade', () => assert.throws(() => check(workflow.replace("node-version: '22.23.5'", "node-version: '20'"))));
test('reject write permission', () => assert.throws(() => check(workflow.replace('contents: read', 'contents: write'))));
test('reject loss of permissions', () => assert.throws(() => check(workflow.replace('permissions:\n  contents: read\n', ''))));
test('reject push trigger omission', () => assert.throws(() => check(workflow.replace(testPath, ''))));
test('reject PR trigger omission', () => {
  const pos = workflow.lastIndexOf(testPath);
  assert.ok(pos >= 0);
  assert.throws(() => check(workflow.slice(0,pos) + workflow.slice(pos+testPath.length)));
});
test('reject missing regression gate', () => assert.throws(() => check(workflow.replace('node --test tests/no-metaharness-ci-security.test.cjs', 'echo skipped'))));
test('reject dropped original smoke', () => assert.throws(() => check(workflow.replace('node scripts/smoke-all-plugins.mjs --timeout 300', 'echo skipped'))));
test('reject dropped absence simulation', () => assert.throws(() => check(workflow.replace('RUFLO_METAHARNESS_SKIP_LOCAL=1', 'RUFLO_METAHARNESS_SKIP_LOCAL=0'))));
test('reject dropped offline drill', () => assert.throws(() => check(workflow.replace('npm_config_registry=http://127.0.0.1:9/', 'npm_config_registry=https://registry.npmjs.org/'))));
