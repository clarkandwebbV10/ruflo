'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/funnel-gates.yml'), 'utf8');
const supported = '22.23.5';

function verifyFunnelRuntime(source) {
  const pinned = source.match(/^  NODE_VERSION:\s*['"]([^'"]+)['"]\s*$/m);
  assert.ok(pinned, 'funnel workflow must declare a shared Node runtime');
  assert.equal(pinned[1], supported, 'funnel jobs must use the reviewed patched Node release');
  const setups = [...source.matchAll(/^\s*- uses: actions\/setup-node@v4\s*$/gm)];
  const consumers = [...source.matchAll(/^\s*node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}\s*$/gm)];
  assert.equal(setups.length, 2, 'funnel must have exactly two audited setup-node steps');
  assert.equal(consumers.length, setups.length, 'every setup-node must use the central supported runtime');
  assert.doesNotMatch(source, /^\s*node-version:\s*['"]?20(?:['"]|\s|$)/m, 'EOL Node 20 must not return');
}

test('both funnel jobs use security-patched Node 22.23.5', () => {
  verifyFunnelRuntime(workflow);
});

test('reject a rollback of shared runtime pin to end-of-life Node 20', () => {
  const downgraded = workflow.replace("NODE_VERSION: '22.23.5'", "NODE_VERSION: '20'");
  assert.notEqual(downgraded, workflow);
  assert.throws(() => verifyFunnelRuntime(downgraded));
});

test('reject a newly introduced setup-node step without the central pin', () => {
  const drift = workflow.replace('node-version: ${{ env.NODE_VERSION }}', "node-version: '20'");
  assert.notEqual(drift, workflow);
  assert.throws(() => verifyFunnelRuntime(drift));
});

test('the dependency-free regression executes before dependency installation', () => {
  const step = workflow.indexOf('run: node --test tests/funnel-ci-supported-node.test.cjs');
  const install = workflow.indexOf('run: pnpm install --frozen-lockfile');
  assert.ok(step >= 0 && install > step, 'run regression before installing dependencies');
});
