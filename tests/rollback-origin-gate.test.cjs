'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/rollback-manager.yml'), 'utf8');
const job = workflow.match(/^  failure-detection:\s*\n([\s\S]*?)(?=^  pre-rollback-validation:)/m);
assert.ok(job, 'failure-detection job exists');
const condition = job[1].match(/^    if: (.+)$/m)?.[1];
const required = "github.event_name == 'push' || (github.event_name == 'workflow_run' && github.event.workflow_run.head_branch == github.ref_name && github.event.workflow_run.head_sha == github.sha)";

test('SEC-022: automatic rollback detection requires matching upstream branch and exact SHA', () => {
  assert.equal(condition, required, 'do not accept failed develop or stale CI as authorization to rollback main');
});

test('SEC-022: event/reference matrix rejects wrong-branch and stale upstream runs', () => {
  const cases = [
    ['failed latest main CI', 'workflow_run', 'main', 'main', 'a1', 'a1', true],
    ['failed develop CI may not roll back main', 'workflow_run', 'develop', 'main', 'a1', 'a1', false],
    ['stale main CI may not roll back newer main', 'workflow_run', 'main', 'main', 'a1', 'b2', false],
    ['unrelated PR CI may not roll back main', 'workflow_run', 'patch', 'main', 'a1', 'a1', false],
    ['ordinary push still runs harmless detection', 'push', '', 'main', '', 'a1', true],
    ['manual dispatch handled separately', 'workflow_dispatch', '', 'main', '', 'a1', false],
  ];
  for (const [name, event, headBranch, ref, headSha, sha, expected] of cases) {
    const eligible = event === 'push' ||
      (event === 'workflow_run' && headBranch === ref && headSha === sha);
    assert.equal(eligible, expected, name);
  }
});
