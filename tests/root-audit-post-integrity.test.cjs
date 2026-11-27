const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(process.env.MC2_TEST_WORKFLOW || path.join(__dirname, '../.github/workflows/cve-audit.yml'), 'utf8');
const gate = workflow.match(/- name: npm audit — critical gate \(must be 0\)\n        run: (.+)\n(?:        #[^\n]*\n)*\n      - name: Verify root dependency inputs after critical audit\n        run: (.+)/);
assert.ok(gate, 'post-audit verification must immediately follow the root critical gate');
for (const [mode, expected] of Object.entries({ clean: 0, mutate: 1, staged: 1, manifest: 1, advisory: 1, error: 2 })) {
  test(`root post-audit: ${mode}`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'root-audit-'));
    const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
    try {
      const git = (...args) => assert.equal(run('git', args).status, 0);
      git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'test@example.invalid');
      for (const f of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(cwd, f), '{}\n');
      git('add', '.'); git('commit', '-qm', 'fixture');
      fs.mkdirSync(path.join(cwd, 'bin'));
      fs.writeFileSync(path.join(cwd, 'bin/npm'), '#!/bin/sh\ncase "$MODE" in\n mutate) echo changed >> package-lock.json;;\n staged) echo changed >> package-lock.json; git add package-lock.json;;\n manifest) echo changed >> package.json;;\n advisory) exit 1;;\n error) exit 2;;\nesac\nexit 0\n', { mode: 0o755 });
      const result = run('bash', ['-eo', 'pipefail', '-c', `${gate[1]}\n${gate[2]}`], { ...process.env, PATH: `${cwd}/bin:${process.env.PATH}`, MODE: mode });
      assert.equal(result.status, expected, result.stderr);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
}
