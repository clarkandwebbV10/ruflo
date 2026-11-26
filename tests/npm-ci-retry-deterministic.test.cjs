'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'actions', 'npm-ci-retry', 'action.yml'), 'utf8');
const marker = '      run: |\n';
assert.equal(source.split(marker).length, 2, 'expected a single composite bash run block');
const script = source.split(marker)[1].split('\n')
  .filter(s => s.startsWith('        '))
  .map(s => s.slice(8)).join('\n')
  .replaceAll('${{ inputs.attempts }}', '3')
  .replaceAll('${{ inputs.args }}', '--legacy-peer-deps')
  .replaceAll('sleep 15', 'sleep 0');

function scenario(which, override) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-npm-ci-'));
  try {
    const stub = path.join(dir, 'npm');
    const calls = path.join(dir, 'calls');
    fs.writeFileSync(stub, `#!/usr/bin/env bash\necho called >> "$TEST_CALLS"\nn=$(wc -l < "$TEST_CALLS")\ncase "$TEST_SCENARIO" in\n eus) echo 'npm error code EUSAGE' >&2; echo 'npm ci can only install packages when package.json and package-lock.json are in sync' >&2; exit 1;;\n old-eus) echo 'npm ERR! code EUSAGE' >&2; exit 1;;\n transient) if [ "$n" -lt 2 ]; then echo 'npm error network 503' >&2; exit 1; fi;;\n perpetual) echo 'npm error network 503' >&2; exit 1;;\n success) ;;\nesac\nexit 0\n`);
    fs.chmodSync(stub, 0o755);
    const out = spawnSync('bash', ['-c', override ?? script], { encoding: 'utf8', env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, TEST_CALLS: calls, TEST_SCENARIO: which }, timeout: 10000 });
    return { code: out.status, output: out.stdout + out.stderr, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0, error: out.error };
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
}

test('EUSAGE npm lockfile mismatch stops after exactly one failed attempt', () => {
  const x = scenario('eus');
  assert.equal(x.code, 1, x.output);
  assert.equal(x.calls, 1);
  assert.match(x.output, /deterministic EUSAGE/);
});
test('legacy npm ERR! EUSAGE also stops after one attempt', () => {
  const x = scenario('old-eus');
  assert.equal(x.code, 1, x.output);
  assert.equal(x.calls, 1);
});
test('transient network failure is retried and later succeeds', () => {
  const x = scenario('transient');
  assert.equal(x.code, 0, x.output);
  assert.equal(x.calls, 2);
});
test('clean install succeeds on the first attempt', () => {
  const x = scenario('success');
  assert.equal(x.code, 0, x.output);
  assert.equal(x.calls, 1);
});
test('persistent non-EUSAGE fails after the bounded 3 attempts', () => {
  const x = scenario('perpetual');
  assert.equal(x.code, 1, x.output);
  assert.equal(x.calls, 3);
});
test('negative mutation reproduces old three-attempt EUSAGE failure', () => {
  const weakened = script.replace("if grep -Eq 'npm (ERR!|error) code EUSAGE|npm ci can only install packages when' \"$log\"; then", "if false; then");
  assert.notEqual(weakened, script);
  assert.equal(scenario('eus', script).calls, 1);
  assert.equal(scenario('eus', weakened).calls, 3);
});
test('workflow uses bounded retries and cleans up temporary log', () => {
  assert.match(script, /max=3/);
  assert.match(script, /trap 'rm -f "\$log"' EXIT/);
  assert.match(source, /working-directory: \$\{\{ inputs\.working-directory \}\}/);
});
