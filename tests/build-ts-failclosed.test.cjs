'use strict';
// SEC-018 follow-on: assert the shared CLI TypeScript build alias preserves failures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
const buildCommand = manifest.scripts['build:ts'];

function simulateBuild(command, exitCode, withCliDir = true) {
  const scratch = mkdtempSync(join(tmpdir(), 'mc2-build-failclosed-'));
  try {
    const bin = join(scratch, 'bin');
    mkdirSync(bin);
    if (withCliDir) mkdirSync(join(scratch, 'v3', '@claude-flow', 'cli'), { recursive: true });
    const windows = process.platform === 'win32';
    writeFileSync(join(bin, windows ? 'npm.cmd' : 'npm'),
      windows ? '@echo off\r\nexit /b %MC2_TEST_BUILD_EXIT%\r\n'
        : '#!/bin/sh\nexit "$MC2_TEST_BUILD_EXIT"\n', { mode: 0o755 });
    const env = { ...process.env, MC2_TEST_BUILD_EXIT: String(exitCode), PATH: bin + (windows ? ';' : ':') + process.env.PATH };
    const shell = windows ? 'cmd.exe' : '/bin/sh';
    const args = windows ? ['/d', '/s', '/c', command] : ['-c', command];
    const run = spawnSync(shell, args, { cwd: scratch, env, encoding: 'utf8', timeout: 10000 });
    if (run.error) throw run.error;
    return run.status;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('build:ts exactly invokes the CLI compiler without swallowing status', () => {
  assert.equal(buildCommand, 'cd v3/@claude-flow/cli && npm run build');
  assert.doesNotMatch(buildCommand, /\|\|\s*true|;\s*exit\s+0/);
});
test('successful compiler returns success', () => assert.equal(simulateBuild(buildCommand, 0), 0));
test('compiler failure returns the original nonzero status', () => assert.equal(simulateBuild(buildCommand, 9), 9));
test('timeout-style failure stays visible', () => assert.equal(simulateBuild(buildCommand, 124), 124));
test('missing CLI workspace is not reported as successful', () => assert.notEqual(simulateBuild(buildCommand, 0, false), 0));
test('negative mutation: the old || true command masks a failing compiler', () => {
  assert.equal(simulateBuild(buildCommand + ' || true', 9), 0);
  assert.notEqual(simulateBuild(buildCommand, 9), 0);
});
