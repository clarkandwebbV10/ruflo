// SEC-034: CI type checking must execute a real manifest script and fail closed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const marker = '      - name: Type check\n';

function getTypecheckStep(yaml) {
  assert.equal(yaml.split(marker).length, 2, 'expected one Type check step');
  const rest = yaml.split(marker)[1];
  const end = rest.indexOf('\n      - name:');
  assert.ok(end > 0, 'type check step must be followed by another step');
  const step = rest.slice(0, end);
  const run = step.match(/^        run: (.+)$/m);
  assert.ok(run, 'type check step must contain a shell command');
  return { step, command: run[1] };
}

function execute(command, mode) {
  const disposition = mode === 'fail' ? 'return 17' : 'return 0';
  const shim = 'npm() { printf "mock-call:%s\\n" "$*"; ' +
    'if [ "$*" != "run build -- --noEmit" ]; then return 23; fi; ' +
    disposition + '; }\n' + command;
  const result = spawnSync('bash', ['-e', '-c', shim], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  return { status: result.status,
    calls: result.stdout.split('\n').filter(line => line.startsWith('mock-call:'))
      .map(line => line.slice('mock-call:'.length)) };
}

const { step, command } = getTypecheckStep(workflow);

test('actual root build script uses TypeScript compiler', () => {
  assert.equal(manifest.scripts.build, 'tsc');
  assert.equal(manifest.scripts.typecheck, undefined);
});

test('CI type check invokes compiler without emitting build artifacts', () => {
  assert.equal(command, 'npm run build -- --noEmit');
});

test('CI type checking is not allowed to continue on error', () => {
  assert.doesNotMatch(step, /continue-on-error\s*:\s*true/);
  assert.doesNotMatch(command, /\|\||;\s*(true|echo)\b/);
});

test('compiler success preserves a green status', () => {
  const result = execute(command, 'success');
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, ['run build -- --noEmit']);
});

test('compiler failure is propagated as a red status', () => {
  const result = execute(command, 'fail');
  assert.equal(result.status, 17);
  assert.deepEqual(result.calls, ['run build -- --noEmit']);
});

test('old nonexistent script and swallowed failure reproduce false-green behavior', () => {
  const result = execute('npm run typecheck || echo skipped', 'fail');
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, ['run typecheck']);
});

test('type check guard runs in pre-install regression suite', () => {
  const regression = workflow.indexOf('run: node --test tests/ci-supported-node.test.cjs tests/ci-security-audit-failclosed.test.cjs tests/ci-typecheck-failclosed.test.cjs');
  const install = workflow.indexOf('uses: ./.github/actions/npm-ci-retry');
  assert.ok(regression >= 0 && install > regression);
});
