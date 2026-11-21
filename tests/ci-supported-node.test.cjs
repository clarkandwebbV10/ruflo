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


// SEC-032: status aggregation must not report green when required CI jobs fail.
const { spawnSync } = require('node:child_process');
const ciStatus = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
const marker = '      - name: Check overall status\n';
assert.equal(ciStatus.split(marker).length, 2, 'expected exactly one CI status summary step');
const statusSection = ciStatus.split(marker)[1];
const runMarker = '        run: |\n';
assert.ok(statusSection.includes(runMarker), 'summary must have executable run block');
const statusScript = statusSection.split(runMarker)[1].split('\n')
  .filter(line => line.startsWith('          '))
  .map(line => line.slice(10)).join('\n');

test('SEC-032 status job runs even after upstream failures and passes all 3 results safely', () => {
  assert.match(ciStatus, /needs:\s*\[security,\s*test,\s*build\]/);
  assert.match(ciStatus, /if:\s*always\(\)/);
  for (const name of ['SECURITY', 'TEST', 'BUILD']) {
    assert.match(statusSection, new RegExp(name + '_RESULT: \\$\\{\\{ needs\\.' + name.toLowerCase() + '\\.result \\}\\}'));
  }
  assert.match(statusSection, /shell:\s*bash/);
  assert.match(statusScript, /exit 1/);
});

function runSummary(security, suite, build, script = statusScript) {
  // Use a real Bash script with controlled upstream-result fixtures. Git Bash
  // on Windows can lose env overrides in spawned child processes.
  const allowed = new Set(['success', 'failure', 'cancelled', 'skipped']);
  for (const outcome of [security, suite, build]) assert.ok(allowed.has(outcome));
  const os = require('node:os');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-sec032-'));
  try {
    const assignments = [
      'SECURITY_RESULT=' + security,
      'TEST_RESULT=' + suite,
      'BUILD_RESULT=' + build,
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(scratch, 'run.sh'), assignments + script, 'utf8');
    return spawnSync('bash', ['./' + path.basename(scratch) + '/run.sh'], {
      cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

for (const [label, security, suite, build, expected] of [
  ['all passed', 'success', 'success', 'success', 0],
  ['security failure', 'failure', 'success', 'skipped', 1],
  ['test failure', 'success', 'failure', 'skipped', 1],
  ['build failure', 'success', 'success', 'failure', 1],
  ['cancelled build', 'success', 'success', 'cancelled', 1],
  ['skipped security', 'skipped', 'success', 'success', 1],
]) {
  test('SEC-032 summary: ' + label + ' -> ' + (expected ? 'red' : 'green'), () => {
    const result = runSummary(security, suite, build);
    assert.equal(result.error, undefined, result.error && result.error.message);
    assert.equal(result.status, expected, result.stdout + '\n' + result.stderr);
  });
}

test('SEC-032 mutation proves removing fail-closed exit creates a false green', () => {
  const weakened = statusScript.replace('exit 1', ':');
  assert.notEqual(weakened, statusScript);
  assert.equal(runSummary('failure', 'success', 'skipped', statusScript).status, 1);
  assert.equal(runSummary('failure', 'success', 'skipped', weakened).status, 0);
});
