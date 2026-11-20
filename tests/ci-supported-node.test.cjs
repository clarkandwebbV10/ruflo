// SEC-028: dependency-free regression gate for four Ruflo CI workflows.
// Verifies only the shared NODE_VERSION consumers; intentional matrix lanes remain separate.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PINNED = '22.23.5';
const workflows = {
  'ci.yml': 4,
  'v3-ci.yml': 6,
  'integration-tests.yml': 5,
  'verification-pipeline.yml': 5,
};

function checkConfig(source, expectedConsumers) {
  const pins = [...source.matchAll(/^  NODE_VERSION:\s*'([^']+)'$/gm)];
  assert.equal(pins.length, 1, 'expected one shared NODE_VERSION pin');
  assert.equal(pins[0][1], PINNED, 'shared Node runtime must use tested security-patch floor');
  const consumers = [...source.matchAll(/node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}/g)];
  assert.equal(consumers.length, expectedConsumers, 'shared-runtime consumers unexpectedly changed');
}

for (const [name, count] of Object.entries(workflows)) {
  const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8');
  test(name + ' uses patched Node for all ' + count + ' shared-runtime consumers', () => {
    checkConfig(source, count);
  });
  test(name + ' rejects reverting to EOL Node 20', () => {
    const bad = source.replace("NODE_VERSION: '" + PINNED + "'", "NODE_VERSION: '20'");
    assert.throws(() => checkConfig(bad, count));
  });
}

test('main CI runs regression gate before dependency installation', () => {
  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const regression = ci.indexOf('run: node --test tests/ci-supported-node.test.cjs');
  const install = ci.indexOf('uses: ./.github/actions/npm-ci-retry');
  assert.ok(regression >= 0, 'regression must be wired into the CI workflow');
  assert.ok(install > regression, 'run this regression before installing vulnerable dependencies');
});
