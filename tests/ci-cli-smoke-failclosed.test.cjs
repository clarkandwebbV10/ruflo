'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

function step(name, source = workflow) {
  const marker = `- name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing CI step: ${name}`);
  const next = source.indexOf('\n      - name:', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function requireFailClosed(s) {
  assert.doesNotMatch(s, /continue-on-error\s*:\s*true/);
  assert.doesNotMatch(s, /\|\|\s*(true|echo|exit\s+0)\b/);
  assert.doesNotMatch(s, /if\s*:\s*always\(\)/);
}

function verifySmokeGate(name, expectedPlatform) {
  const s = step(name);
  assert.match(s, /node\s+\.\/v3\/@claude-flow\/cli\/bin\/cli\.js\s+--version/);
  assert.match(s, new RegExp(expectedPlatform));
  requireFailClosed(s);
  return s;
}

test('Unix CLI smoke is required to succeed', () => {
  verifySmokeGate('Test CLI binary (Unix)', "runner.os != 'Windows'");
});

test('Windows CLI smoke is required to succeed', () => {
  verifySmokeGate('Test CLI binary (Windows)', "runner.os == 'Windows'");
});

for (const name of ['Test CLI binary (Unix)', 'Test CLI binary (Windows)']) {
  test(`regression: old nonblocking ${name} is rejected`, () => {
    const s = step(name);
    requireFailClosed(s);
    const broken = s + '\n        continue-on-error: true';
    assert.throws(() => requireFailClosed(broken), /continue-on-error/);
  });
}

test('Both smoke steps remain inside the build job', () => {
  const start = workflow.indexOf('  build:\n');
  assert.notEqual(start, -1);
  const stop = workflow.indexOf('\n  status:\n', start);
  assert.ok(stop > start, 'expected status job after build');
  const buildSection = workflow.slice(start, stop);
  for (const name of ['Test CLI binary (Unix)', 'Test CLI binary (Windows)']) {
    assert.ok(buildSection.includes(`- name: ${name}`));
  }
});

test('Smoke checks use the source CLI without npm publication', () => {
  for (const name of ['Test CLI binary (Unix)', 'Test CLI binary (Windows)']) {
    const s = step(name);
    assert.doesNotMatch(s, /npm\s+publish|npx\s+.*@latest|curl\s+.*\|\s*sh/i);
  }
});
