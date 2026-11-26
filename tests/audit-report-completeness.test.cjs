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

test('rejects a duplicated advisory with conflicting severity in either order', async () => {
  const { collectAdvisories } = await import('../scripts/audit-gate.mjs');
  const lower = { ...advisory, severity: 'low' };
  for (const via of [[advisory, lower], [lower, advisory]]) {
    assert.throws(() => collectAdvisories(report({
      'fixture-dependency': { severity: 'high', via },
    })), /conflicting npm audit advisory severities/);
  }
});
test('identical advisory repetitions remain blocking and are deduplicated', async () => {
  const { collectAdvisories, evaluate } = await import('../scripts/audit-gate.mjs');
  const full = collectAdvisories(report({
    'fixture-dependency': { severity: 'high', via: [advisory, { ...advisory }] },
  }));
  assert.equal(full.size, 1);
  assert.equal(evaluate({ full, prod: collectAdvisories(report()), exceptions: [], today: '2026-11-26' }).ok, false);
});

test('audit process termination and unexpected exit statuses fail closed', async () => {
  const { parseAuditRun } = await import('../scripts/audit-gate.mjs');
  const stdout = JSON.stringify(report());
  for (const result of [{ status: null, signal: 'SIGTERM', stdout }, { status: 2, signal: null, stdout }, { status: 127, signal: null, stdout }, { status: null, signal: null, stdout }]) {
    assert.throws(() => parseAuditRun(result), /did not complete/);
  }
  assert.throws(() => parseAuditRun({ error: new Error('fixture spawn failure'), stdout }), /fixture spawn failure/);
});
test('completed audit process reports remain subject to evidence validation', async () => {
  const { parseAuditRun, collectAdvisories, evaluate } = await import('../scripts/audit-gate.mjs');
  const full = collectAdvisories(parseAuditRun({ status: 1, signal: null, stdout: JSON.stringify(report({
    'fixture-dependency': { severity: 'high', via: [advisory] },
  })) }));
  const prod = collectAdvisories(parseAuditRun({ status: 0, signal: null, stdout: JSON.stringify(report()) }));
  assert.equal(evaluate({ full, prod, exceptions: [], today: '2026-11-26' }).ok, false);
  assert.equal(evaluate({ full: prod, prod, exceptions: [], today: '2026-11-26' }).ok, true);
});

test('impossible exception calendar dates cannot authorize a finding', async () => {
  const { collectAdvisories, evaluate, validateExceptions } = await import('../scripts/audit-gate.mjs');
  const full = collectAdvisories(report({ 'fixture-dependency': { severity: 'high', via: [advisory] } }));
  const base = { package: 'fixture-dependency', advisory: 'GHSA-2222-3333-4444',
    reason: 'Synthetic reviewed exception for testing.', remediation: 'Update dependency' };
  for (const expires of ['2026-99-99', '2026-02-29', '2026-04-31', '2026-00-01']) {
    const exceptions = [{ ...base, expires }];
    assert.equal(validateExceptions(exceptions).length, 1);
    assert.equal(evaluate({ full, prod: new Map(), exceptions, today: '2026-11-26' }).ok, false);
  }
  for (const expires of ['2026-12-01', '2028-02-29']) {
    const exceptions = [{ ...base, expires }];
    assert.equal(validateExceptions(exceptions).length, 0);
    assert.equal(evaluate({ full, prod: new Map(), exceptions, today: '2026-11-26' }).ok, true);
  }
});
