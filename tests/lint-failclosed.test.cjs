'use strict';
// SEC-036: CI lint must never silently pass after a failed or nonexistent CLI lint script.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const cli = JSON.parse(readFileSync(join(root, 'v3', '@claude-flow', 'cli', 'package.json'), 'utf8'));
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const command = manifest.scripts.lint;

function simulate(commandToRun, exitCode, workspaceExists = true) {
  const scratch = mkdtempSync(join(tmpdir(), 'mc2-lint-failclosed-'));
  try {
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    if (workspaceExists) mkdirSync(join(scratch, 'v3', '@claude-flow', 'cli'), { recursive: true });
    const isWindows = process.platform === 'win32';
    writeFileSync(join(bin, isWindows ? 'npm.cmd' : 'npm'),
      isWindows ? '@echo off\r\nexit /b %MC2_TEST_LINT_EXIT%\r\n'
        : '#!/bin/sh\nexit "$MC2_TEST_LINT_EXIT"\n', { mode: 0o755 });
    const env = { ...process.env, MC2_TEST_LINT_EXIT: String(exitCode),
      PATH: bin + (isWindows ? ';' : ':') + (process.env.PATH || '') };
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const args = isWindows ? ['/d', '/s', '/c', commandToRun] : ['-c', commandToRun];
    const result = spawnSync(shell, args, { cwd: scratch, env, encoding: 'utf8', timeout: 10000 });
    if (result.error) throw result.error;
    return result.status;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('root lint alias directly calls the nested CLI without a success fallback', () => {
  assert.equal(command, 'cd v3/@claude-flow/cli && npm run lint');
  assert.doesNotMatch(command, /\|\|\s*true|;\s*exit\s+0/);
});
test('CI invokes root lint as a blocking security job step', () => {
  assert.match(workflow, /- name: Lint code\s+run: npm run lint/);
  assert.doesNotMatch(workflow, /- name: Lint code\s+run: npm run lint\s+continue-on-error:\s*true/);
});
// Previously pinned the absent nested lint target as an open CI blocker. The
// CLI now has a real, enforcing ADR-078 lint gate (scripts/lint-adr078.mjs,
// covered by tests/lint-adr078.test.cjs); it must not mask its own failures.
test('nested CLI lint target is a real enforcing gate, not a no-op', () => {
  assert.equal(cli.scripts.lint, 'node scripts/lint-adr078.mjs');
  assert.doesNotMatch(cli.scripts.lint, /\|\|\s*true|;\s*exit\s+0|^\s*(true|echo\b)/);
});
test('a successful nested CLI invocation returns zero', () => assert.equal(simulate(command, 0), 0));
test('a failed nested CLI invocation propagates nonzero', () => assert.equal(simulate(command, 17), 17));
test('a missing nested CLI workspace cannot falsely pass', () => assert.notEqual(simulate(command, 0, false), 0));
test('negative mutation: previous failure suppression falsely reported success', () => {
  assert.equal(simulate(command + ' || true', 17), 0);
  assert.equal(simulate(command, 17), 17);
});
