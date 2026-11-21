'use strict';
// SEC-029: dependency-free CI contract tests; no simulated deployment claims.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '..', '.github', 'workflows', 'no-agentbbs-smoke.yml'), 'utf8');

function issues(yaml) {
  const errors = [];
  const pins = [...yaml.matchAll(/^\s+node-version:\s*['"]([^'"]+)['"]\s*$/gm)].map(x => x[1]);
  if (pins.length !== 2 || pins.some(x => x !== '22.23.5')) errors.push('runtime-pin');
  if (!/^permissions:\r?\n  contents: read\s*$/m.test(yaml)) errors.push('least-privilege');
  const push = yaml.slice(yaml.indexOf('  push:'), yaml.indexOf('  pull_request:'));
  const pr = yaml.slice(yaml.indexOf('  pull_request:'), yaml.indexOf('  workflow_dispatch:'));
  if (!push.includes("'tests/no-agentbbs-ci-security.test.cjs'")) errors.push('push-trigger');
  if (!pr.includes("'tests/no-agentbbs-ci-security.test.cjs'")) errors.push('pr-trigger');
  const guard = yaml.indexOf('name: Security regression guard');
  const rule1 = yaml.indexOf('name: Rule 1');
  if (guard < 0 || rule1 < 0 || guard > rule1 || !yaml.includes('run: node --test tests/no-agentbbs-ci-security.test.cjs')) errors.push('guard-order');
  if (!yaml.includes('name: Rule 2') || !yaml.includes('name: Rule 3')) errors.push('architecture-rules');
  if (!yaml.includes('bash scripts/smoke-agentbbs.sh') || !yaml.includes('pnpm install --frozen-lockfile')) errors.push('runtime-drill');
  if (!yaml.includes('find v3 -type d -name agentbbs')) errors.push('absence-check');
  return errors;
}
test('both Node setup pins are supported/patched', () => assert.ok(!issues(source).includes('runtime-pin')));
test('workflow token is read-only', () => assert.ok(!issues(source).includes('least-privilege')));
test('push changes to guard trigger workflow', () => assert.ok(!issues(source).includes('push-trigger')));
test('PR changes to guard trigger workflow', () => assert.ok(!issues(source).includes('pr-trigger')));
test('guard runs before original architecture checks', () => assert.ok(!issues(source).includes('guard-order')));
test('all three architectural rules retained', () => assert.ok(!issues(source).includes('architecture-rules')));
test('original runtime drill and agentbbs-removal check retained', () => assert.deepEqual(issues(source), []));
test('negative: first Node 20 downgrade rejected', () => assert.ok(issues(source.replace("node-version: '22.23.5'", "node-version: '20'")).includes('runtime-pin')));
test('negative: second Node 20 downgrade rejected', () => assert.ok(issues(source.replace(/node-version: '22.23.5'(?![\s\S]*node-version: '22.23.5')/, "node-version: '20'")).includes('runtime-pin')));
test('negative: write permission escalation rejected', () => assert.ok(issues(source.replace('contents: read', 'contents: write')).includes('least-privilege')));
test('negative: missing self-test trigger rejected', () => assert.ok(issues(source.replace("'tests/no-agentbbs-ci-security.test.cjs'", "'tests/other.cjs'")).includes('push-trigger')));
test('negative: missing regression guard rejected', () => assert.ok(issues(source.replace('name: Security regression guard', 'name: Disabled guard')).includes('guard-order')));
test('negative: removed smoke drill rejected', () => assert.ok(issues(source.replace('bash scripts/smoke-agentbbs.sh', 'echo skipped')).includes('runtime-drill')));
