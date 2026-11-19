'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'integration-tests.yml'), 'utf8');

test('every randomized output generator declares synthetic provenance', () => {
  const allGenerators = (workflow.match(/const results = \{/g) || []).length;
  const classifiedGenerators = (workflow.match(/const results = \{\s*evidenceType: 'synthetic_fixture',\s*verifiedRuntime: false,/g) || []).length;
  assert.equal(allGenerators, 8, 'review newly added fixture generators before accepting their evidence');
  assert.equal(classifiedGenerators, allGenerators, 'no fixture output may masquerade as measured live-agent data');
});

test('JSON summary states the exact limited verification scope', () => {
  assert.match(workflow, /evidenceType: 'synthetic_fixture_report'/);
  assert.match(workflow, /verifiedRuntimeIntegration: false/);
  assert.match(workflow, /report\.summary\.validationScope = 'artifact_presence_only'/);
  assert.match(workflow, /fixtureEvidenceGate\(report\.summary, report\.upstreamJobResults\)/);
  assert.match(workflow, /setup: '\$\{\{ needs\.integration-setup\.result \}\}'/);
});

test('human-readable and PR-facing reports cannot claim live acceptance', () => {
  assert.match(workflow, /SYNTHETIC Cross-Agent Exercise Report \(NOT Live Acceptance\)/);
  assert.match(workflow, /\*\*Live integration verified:\*\* NO/);
  assert.match(workflow, /Simulated Integration Fixtures \(NOT live acceptance\)/);
  assert.match(workflow, /Synthetic fixture artifacts produced; live integration NOT verified/);
  assert.doesNotMatch(workflow, /\*\*Overall Status:\*\*/);
});

test('randomized fixture sources remain observable and explicitly disclaimed', () => {
  assert.ok((workflow.match(/Math\.random/g) || []).length > 0, 'this regression guard applies while the workflow still generates mock data');
  assert.match(workflow, /Random output values are not live-agent measurements/);
});
