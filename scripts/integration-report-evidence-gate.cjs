'use strict';

// A successful simulated exercise means required fixtures were produced by
// successful upstream jobs. It does NOT establish live-agent integration.
const REQUIRED_JOBS = Object.freeze(['setup', 'coordination', 'memory', 'faultTolerance', 'performance']);

function fixtureEvidenceGate(summary, upstream) {
  if (!summary || !upstream) return false;
  if (summary.totalTests !== 4 || summary.passedTests !== 4 || summary.failedTests !== 0) return false;
  return REQUIRED_JOBS.every(name => upstream[name] === 'success');
}

module.exports = { fixtureEvidenceGate, REQUIRED_JOBS };
