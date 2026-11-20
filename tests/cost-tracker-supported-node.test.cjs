'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '.github/workflows/cost-tracker-smoke.yml'), 'utf8');
const pinned = text => /node-version:\s*['"]22\.23\.5['"]/.test(text) && !/node-version:\s*['"]?20['"]?/.test(text);

test('smoke workflow selects patched Node 22.23.5 exactly once', () => {
  assert.equal((source.match(/uses:\s*actions\/setup-node@v4/g) || []).length, 1);
  assert.equal((source.match(/node-version:\s*['"]22\.23\.5['"]/g) || []).length, 1);
  assert.ok(pinned(source));
});
test('downgrade to EOL Node 20 is rejected', () => {
  const downgrade = source.replace("node-version: '22.23.5'", "node-version: '20'");
  assert.equal(pinned(downgrade), false);
});
test('runtime gate runs before smoke and before dependency installation', () => {
  const gate = source.indexOf('run: node --test tests/cost-tracker-supported-node.test.cjs');
  assert.ok(gate > source.indexOf('uses: actions/setup-node@v4'));
  assert.ok(gate < source.indexOf('run: bash plugins/ruflo-cost-tracker/scripts/smoke.sh'));
  assert.ok(gate < source.indexOf('npm install --no-audit'));
});
test('both pull request and push path filters include regression file', () => {
  assert.equal((source.match(/- 'tests\/cost-tracker-supported-node\.test\.cjs'/g) || []).length, 2);
  assert.match(source, /pull_request:/);
  assert.match(source, /push:/);
});
