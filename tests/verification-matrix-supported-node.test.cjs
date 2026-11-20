// SEC-029: regression against EOL Node versions in verification test matrix.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'verification-pipeline.yml'), 'utf8');
const matrixLine = workflow.split(/\r?\n/).find(line => line.includes('echo "test-matrix='));
const expected = [
  { os: 'ubuntu-latest', node: '22.23.5' },
  { os: 'ubuntu-latest', node: '24.22.3' },
  { os: 'macos-latest', node: '22.23.5' },
  { os: 'windows-latest', node: '22.23.5' },
];

function verifyMatrix(line) {
  assert.ok(line, 'verification matrix emission must exist');
  const match = line.match(/echo "test-matrix=(.*)" >> \$GITHUB_OUTPUT/);
  assert.ok(match, 'matrix JSON must be written to GITHUB_OUTPUT');
  const matrix = JSON.parse(match[1].replace(/\\"/g, '"'));
  assert.deepEqual(matrix.include, expected, 'all four OS/version lanes must be explicitly patched and stable');
  return matrix;
}

test('all four verification matrix jobs use published security-patched Node releases', () => {
  verifyMatrix(matrixLine);
});

test('negative regression catches EOL Node 20 in a matrix lane', () => {
  assert.throws(() => verifyMatrix(matrixLine.replace('22.23.5', '20')));
});

test('negative regression catches EOL Node 18 in a matrix lane', () => {
  assert.throws(() => verifyMatrix(matrixLine.replace('24.22.3', '18')));
});

test('performance and coverage conditions continue targeting the supported Ubuntu Node 22 lane', () => {
  const good = [...workflow.matchAll(/matrix\.os == 'ubuntu-latest' && matrix\.node == '22\.23\.5'/g)];
  assert.equal(good.length, 2);
  assert.doesNotMatch(workflow, /matrix\.node == '(?:18|20)'/);
});

test('matrix regression runs after Node setup and before dependency installation', () => {
  const start = workflow.indexOf('  setup-verification:');
  const end = workflow.indexOf('  security-verification:');
  assert.ok(start >= 0 && end > start);
  const setupJob = workflow.slice(start, end);
  const nodeSetup = setupJob.indexOf('uses: actions/setup-node@v4');
  const gate = setupJob.indexOf('run: node --test tests/verification-matrix-supported-node.test.cjs');
  const install = setupJob.indexOf('uses: ./.github/actions/npm-ci-retry');
  assert.ok(nodeSetup >= 0 && gate > nodeSetup && install > gate);
});
