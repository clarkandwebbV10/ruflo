'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const advisory = {
  name: 'fixture-dependency',
  url: 'https://github.com/advisories/GHSA-2222-3333-4444',
  severity: 'high',
};
function report(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: Object.keys(vulnerabilities).length };
  for (const entry of Object.values(vulnerabilities)) counts[entry.severity]++;
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}
const malformed = [
  ['incomplete envelope', { metadata: {}, vulnerabilities: {} }],
  ['wrong schema version', { ...report(), auditReportVersion: 1 }],
  ['inconsistent counts', { ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, high: 1, total: 1 } } }],
  ['missing advisory', report({ parent: { severity: 'high', via: [] } })],
  ['unresolved pointer', report({ parent: { severity: 'high', via: ['absent'] } })],
  ['pointer cycle without evidence', report({ a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a'] } })],
  ['malformed advisory', report({ parent: { severity: 'high', via: [{}] } })],
  ['error envelope', { ...report(), error: { code: 'fixture' } }],
];
for (const [name, input] of malformed) {
  test('rejects ' + name, async () => {
    const { collectAdvisories } = await import('../scripts/audit-gate.mjs');
    assert.throws(() => collectAdvisories(input));
  });
}
test('a complete clean report still passes', async () => {
  const { collectAdvisories, evaluate } = await import('../scripts/audit-gate.mjs');
  const empty = collectAdvisories(report());
  assert.equal(empty.size, 0);
  assert.equal(evaluate({ full: empty, prod: empty, exceptions: [], today: '2026-11-26' }).ok, true);
});
test('a valid transitive report retains its blocking high advisory', async () => {
  const { collectAdvisories, evaluate } = await import('../scripts/audit-gate.mjs');
  const full = collectAdvisories(report({
    'fixture-dependency': { severity: 'high', via: [advisory] },
    parent: { severity: 'high', via: ['fixture-dependency'] },
  }));
  assert.equal(full.size, 1);
  assert.equal(evaluate({ full, prod: collectAdvisories(report()), exceptions: [], today: '2026-11-26' }).ok, false);
});
