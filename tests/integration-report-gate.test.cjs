'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureEvidenceGate, REQUIRED_JOBS } = require('../scripts/integration-report-evidence-gate.cjs');

const ok = Object.fromEntries(REQUIRED_JOBS.map(name => [name, 'success']));
const full = { totalTests: 4, passedTests: 4, failedTests: 0 };

test('zero executed tests must not report success (observed 0/0 regression)', () => {
  assert.equal(fixtureEvidenceGate({ totalTests: 0, passedTests: 0, failedTests: 0 }, ok), false);
});
test('missing, failed, or skipped upstream jobs make aggregate report fail', () => {
  for (const name of REQUIRED_JOBS) {
    for (const state of [undefined, 'failure', 'skipped', 'cancelled', 'in_progress']) {
      assert.equal(fixtureEvidenceGate(full, { ...ok, [name]: state }), false, name + ': ' + state);
    }
  }
});
test('partial fixture availability and inconsistent totals must fail', () => {
  assert.equal(fixtureEvidenceGate({ totalTests: 4, passedTests: 3, failedTests: 1 }, ok), false);
  assert.equal(fixtureEvidenceGate({ totalTests: 3, passedTests: 3, failedTests: 0 }, ok), false);
  assert.equal(fixtureEvidenceGate({ totalTests: 4, passedTests: 4, failedTests: 1 }, ok), false);
});
test('all four fixture groups with all five jobs successful pass ONLY the fixture gate', () => {
  assert.equal(fixtureEvidenceGate(full, ok), true);
});
test('malformed or missing summary/job metadata fail closed', () => {
  assert.equal(fixtureEvidenceGate(null, ok), false);
  assert.equal(fixtureEvidenceGate(full, null), false);
  assert.equal(fixtureEvidenceGate({}, {}), false);
});
