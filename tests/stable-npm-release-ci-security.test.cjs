'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'stable-npm-release.yml'), 'utf8');

function verify(src) {
  assert.match(src, /^name: Stable npm Release$/m);
  assert.match(src, /^on:\n  workflow_dispatch:\n    inputs:/m);
  assert.doesNotMatch(src, /^\s{2}(push|pull_request|schedule):/m);
  assert.match(src, /^permissions:\n  contents: read$/m);
  assert.match(src, /group: stable-npm-release\n  cancel-in-progress: false/);
  assert.match(src, /if: github\.actor == 'ruvnet'/);
  assert.match(src, /tag must be a stable v-prefixed semantic version/);
  assert.ok(src.includes('ref: ' + '$' + '{{ inputs.tag }}'));
  assert.match(src, /git rev-parse --verify "refs\/tags/);
  assert.match(src, /node-version: 22\.23\.5/);
  assert.doesNotMatch(src, /node-version:\s*['"]?20['"]?/);
  assert.match(src, /Assert patched release Node\.js runtime[\s\S]*?process\.versions\.node !== "22\.23\.5"/);
  const assertIndex = src.indexOf('- name: Assert patched release Node.js runtime');
  const installIndex = src.indexOf('- name: Install root release-audit dependencies');
  assert.ok(assertIndex > 0 && assertIndex < installIndex, 'runtime guard before installs');
  assert.match(src, /node scripts\/audit-umbrella-version-lockstep\.mjs/);
  assert.match(src, /pnpm install --frozen-lockfile/);
  assert.match(src, /Run release test gates/);
  assert.match(src, /Verify signed helper manifest/);
  assert.match(src, /Verify policy release artifacts/);
  assert.match(src, /Build and smoke-test immutable package archives/);
  assert.match(src, /expected_sha="[$][(]git rev-parse --short=8 HEAD[)]"/);
  assert.match(src, /dist\.integrity/);
  assert.ok(src.includes('NODE_AUTH_TOKEN: ' + '$' + '{{ secrets.NPM_TOKEN }}'));
  assert.match(src, /npm publish "[$]archive" --ignore-scripts/);
  assert.match(src, /Verify registry deployment/);
}
test('stable release remains manual, actor-restricted, tag-pinned, least-privileged and patched', () => verify(workflow));
const mutations = [
  ['Node 20 downgrade', s => s.replace('node-version: 22.23.5', 'node-version: 20')],
  ['runtime-guard removed', s => s.replace('Assert patched release Node.js runtime', 'Runtime verification removed')],
  ['workflow-write escalation', s => s.replace('contents: read', 'contents: write')],
  ['unapproved PR trigger', s => s.replace('on:\n  workflow_dispatch:', 'on:\n  pull_request:\n  workflow_dispatch:')],
  ['actor restriction removed', s => s.replace("if: github.actor == 'ruvnet'", "if: true")],
  ['immutable tag checkout changed', s => s.replace('ref: ' + '$' + '{{ inputs.tag }}', 'ref: main')],
  ['tag rev verification removed', s => s.replace('git rev-parse --verify "refs/tags/', 'git rev-parse --no-verify "refs/tags/')],
  ['frozen lock install removed', s => s.replace('pnpm install --frozen-lockfile', 'pnpm install')],
  ['signed helper verification removed', s => s.replace('Verify signed helper manifest', 'Skip signed helper manifest')],
  ['archive integrity check removed', s => s.replace('dist.integrity', 'dist.not_checked')],
  ['release test gates removed', s => s.replace('Run release test gates', 'Release tests skipped')],
  ['registry deployment verification removed', s => s.replace('Verify registry deployment', 'Registry verification skipped')],
];
for (const [name, mutate] of mutations) test('rejects '+name, () => {
  const bad=mutate(workflow);
  assert.notEqual(bad, workflow, 'mutation must change the fixture');
  assert.throws(() => verify(bad), assert.AssertionError);
});