'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'oia-audit-weekly.yml'), 'utf8');
const driftStep = workflow.split('      - name: Compute structural drift vs prior week (iter 69)')[1]?.split('\n      - name: Upload drift trend artifact')[0];

function driftShell() {
  assert.ok(driftStep, 'drift step must exist');
  const part = driftStep.split('        run: |\n')[1];
  assert.ok(part, 'drift step must have runnable shell');
  const script = part.split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
  return script
    .replace(/\$\{\{\s*inputs\.threshold\s*\|\|\s*'0\.85'\s*\}\}/g, '0.85')
    .replace(/\$\{\{\s*inputs\.alert_on_new_severity\s*\|\|\s*'high'\s*\}\}/g, 'high');
}
function simulate({ exit = 0, alert = false, pathLabel = 'file', jsonValid = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc2-oia-regression-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const wrapper = path.join(bin, 'node');
    fs.writeFileSync(wrapper, '#!/usr/bin/env bash\nif [[ "$1" == *"drift-from-history.mjs" ]]; then\n  cat "$MC2_FAKE_JSON"; exit "$MC2_FAKE_EXIT"\nfi\nexec "$MC2_REAL_NODE" "$@"\n', { mode: 0o755 });
    const source = path.join(dir, 'source.json');
    const payload = { drift: { structuralDistance: { verdict: 'similar', overall: 0.98 } }, timing: { path: pathLabel, parallelWallMs: 1 }, alert: { triggered: alert } };
    fs.writeFileSync(source, jsonValid ? JSON.stringify(payload) : 'not-json');
    let script = driftShell().replaceAll('/tmp/drift-trend.json', 'drift-trend.json');
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', timeout: 10000, cwd: dir,
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
        MC2_FAKE_JSON: source, MC2_FAKE_EXIT: String(exit), MC2_REAL_NODE: process.execPath,
        GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') }
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('uses Node 22.23.5 for audited runtime', () => {
  assert.match(workflow, /node-version:\s*['"]22\.23\.5['"]/);
  assert.doesNotMatch(workflow, /node-version:\s*['"]?20(?:['"]|\s|$)/m);
});
test('grants only required checkout and Actions-history read permissions', () => {
  assert.match(workflow, /^permissions:\s*\n\s+contents: read\s*\n\s+actions: read\s*$/m);
  assert.doesNotMatch(workflow, /^\s+permissions:\s*write-all\s*$/m);
});
test('review source and regression changes trigger independent PR test', () => {
  assert.match(workflow, /\bpull_request:\s*\n\s+paths:/);
  assert.match(workflow, /tests\/oia-weekly-ci-security\.test\.cjs/);
  assert.match(workflow, /node --test tests\/oia-weekly-ci-security\.test\.cjs/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
});
test('prior audit history, drift artifacts and fast baseline path remain intact', () => {
  assert.match(workflow, /gh run download/);
  assert.match(workflow, /--baseline-file \/tmp\/prior\/oia-audit\.json/);
  assert.match(workflow, /if: always\(\) && steps\.prior-artifact\.outputs\.has_prior == 'true'/);
  assert.match(workflow, /drift-trend-\$\{\{ github\.run_id \}\}/);
});
test('drift command exit status is retained rather than swallowed', () => {
  assert.doesNotMatch(driftStep, /--format json\s*\\?\s*\n\s*> \/tmp\/drift-trend\.json \|\| true/);
  assert.match(driftStep, /DRIFT_EXIT=\$\?/);
  assert.match(driftStep, /if \[ "\$DRIFT_EXIT" -ne 0 \]; then/);
  assert.match(driftStep, /exit "\$DRIFT_EXIT"/);
});
test('no finding, script success, fast file baseline => pass', () => {
  const r = simulate({});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('script exit 1 (new high or structural drift) => fail', () => {
  const r = simulate({ exit: 1, alert: true });
  assert.equal(r.status, 1, r.stdout + r.stderr);
});
test('script exit 2 (configuration/input failure) => fail', () => {
  const r = simulate({ exit: 2 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});
test('alert true must fail even if upstream exits 0', () => {
  const r = simulate({ exit: 0, alert: true });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
});
test('unexpected slow baseline path => fail', () => {
  const r = simulate({ pathLabel: 'slow' });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
});
test('invalid JSON cannot yield green drift gate', () => {
  const r = simulate({ jsonValid: false });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
});
