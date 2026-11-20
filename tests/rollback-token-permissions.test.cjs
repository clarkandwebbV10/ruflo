'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/rollback-manager.yml'),
  'utf8'
).replace(/\r\n/g, '\n');
const lines = workflow.split('\n');
const jobs = [
  'failure-detection', 'pre-rollback-validation', 'execute-rollback',
  'post-rollback-verification', 'rollback-monitoring', 'manual-rollback-approval'
];

function jobBlock(name) {
  const start = lines.indexOf('  ' + name + ':');
  assert.ok(start >= 0, 'missing job: ' + name);
  const end = lines.findIndex((line, index) =>
    index > start && /^  [a-z][a-z0-9-]*:$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function permissions(block, indentation) {
  const lead = ' '.repeat(indentation);
  const match = block.match(new RegExp(
    '^' + lead + 'permissions:\\n((?:^' + lead + '  [a-z-]+: (?:read|write|none)\\n?)+)',
    'm'
  ));
  assert.ok(match, 'missing explicit permissions block');
  return Object.fromEntries(match[1].trim().split('\n')
    .map(line => line.trim().split(': ')));
}

test('default GitHub token cannot write to code or issues', () => {
  const header = workflow.split(/^jobs:\s*$/m)[0];
  assert.deepEqual(permissions(header, 0), { contents: 'read' });
  assert.doesNotMatch(header, /permissions:\s*(?:write-all|read-all)/);
});

test('only rollback execution can write repository contents', () => {
  const execute = jobBlock('execute-rollback');
  assert.deepEqual(permissions(execute, 4), { contents: 'write' });
  assert.match(execute, /environment:\s*\n\s+name: rollback-approval/);
  for (const name of jobs.filter(item =>
    !['execute-rollback', 'rollback-monitoring'].includes(item))) {
    assert.doesNotMatch(jobBlock(name), /^    permissions:/m,
      name + ' must inherit the read-only default');
  }
});

test('monitoring can create incident issues but cannot write repository contents', () => {
  const monitor = jobBlock('rollback-monitoring');
  assert.deepEqual(permissions(monitor, 4),
    { contents: 'read', issues: 'write' });
  assert.match(monitor, /github\.rest\.issues\.create/);
});

test('no broad or duplicated write grants', () => {
  assert.doesNotMatch(workflow, /permissions:\s*(?:write-all|read-all)/);
  assert.equal((workflow.match(/^\s+contents: write$/gm) || []).length, 1);
  assert.equal((workflow.match(/^\s+issues: write$/gm) || []).length, 1);
});
