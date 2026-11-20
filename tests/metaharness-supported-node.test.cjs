'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '.github/workflows/metaharness-pin-drift.yml'), 'utf8');
const supported = text => /node-version:\s*['"]22\.23\.5['"]/.test(text)
  && !/node-version:\s*['"]?20['"]?/.test(text);

test('pin-drift watcher uses patched Node 22.23.5 for its only setup-node job', () => {
  assert.equal((source.match(/uses:\s*actions\/setup-node@v4/g) || []).length, 1);
  assert.equal((source.match(/node-version:\s*['"]22\.23\.5['"]/g) || []).length, 1);
  assert.ok(supported(source));
});
test('downgrade to end-of-life Node 20 fails the version gate', () => {
  assert.equal(supported(source.replace("node-version: '22.23.5'", "node-version: '20'")), false);
});
test('local regression runs after Node setup and before network-dependent pin check', () => {
  const setup = source.indexOf('uses: actions/setup-node@v4');
  const gate = source.indexOf('run: node --test tests/metaharness-supported-node.test.cjs');
  const drift = source.indexOf('node scripts/check-metaharness-pins.mjs --format json');
  assert.ok(setup >= 0 && gate > setup && drift > gate);
});
test('PR trigger includes changed workflow and regression paths', () => {
  assert.match(source, /pull_request:\s*\n\s+paths:/);
  assert.match(source, /- '.github\/workflows\/metaharness-pin-drift\.yml'/);
  assert.match(source, /- 'tests\/metaharness-supported-node\.test\.cjs'/);
});
