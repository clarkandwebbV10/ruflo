import { describe, expect, it } from 'vitest';
import {
  classifyNodeTestFile,
  discoverNodeTestFiles,
  evaluateTestReport,
  mergeNodeTestResults,
} from '../ci-test-ratchet.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = '/repo';

describe('CI test failure ratchet (#3030)', () => {
  it('permits only failures already named by the baseline', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [
        { name: '/repo/tests/known.test.ts', status: 'failed' },
        { name: '/repo/tests/green.test.ts', status: 'passed' },
      ],
    }, ['tests/known.test.ts'], root);

    expect(result.ok).toBe(true);
    expect(result.unexpected).toEqual([]);
  });

  it('fails when a new file starts failing even if the total count is unchanged', () => {
    const result = evaluateTestReport({
      success: false,
      testResults: [{ name: '/repo/tests/new-regression.test.ts', status: 'failed' }],
    }, ['tests/old-debt.test.ts'], root);

    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['tests/new-regression.test.ts']);
    expect(result.fixed).toEqual(['tests/old-debt.test.ts']);
  });

  it('fails closed when Vitest fails without a file-level result', () => {
    const result = evaluateTestReport({ success: false, testResults: [] }, [], root);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/without identifying/);
  });

  it('fails closed for an empty or malformed report', () => {
    expect(evaluateTestReport({ success: true, testResults: [] }, [], root).ok).toBe(false);
    expect(evaluateTestReport({}, [], root).ok).toBe(false);
  });
});

describe('node:test files in the ratchet', () => {
  it('recognizes every node:test import form and ignores Vitest files', () => {
    expect(classifyNodeTestFile("const test = require('node:test');")).toEqual({ installTree: null });
    expect(classifyNodeTestFile("import test from 'node:test';")).toEqual({ installTree: null });
    expect(classifyNodeTestFile("import { test } from \"node:test\";")).toEqual({ installTree: null });
    expect(classifyNodeTestFile("const t = await import('node:test');")).toEqual({ installTree: null });
    expect(classifyNodeTestFile("import { describe, it } from 'vitest';")).toBeNull();
  });

  it('does not misclassify Vitest files or string-literal mentions of node:test', () => {
    // Regression: this very test file mentions node:test inside strings.
    const vitestFile = "import { it } from 'vitest';\nit('x', () => classify(\"const t = require('node:test');\"));";
    expect(classifyNodeTestFile(vitestFile)).toBeNull();
    expect(classifyNodeTestFile("const doc = \"require('node:test')\";")).toBeNull();
    expect(classifyNodeTestFile("// import test from 'node:test';")).toBeNull();
  });

  it('reads a declared sub-package install tree', () => {
    const src = "// ratchet-install-tree: ruflo/src/ruvocal/\nimport test from 'node:test';";
    expect(classifyNodeTestFile(src)).toEqual({ installTree: 'ruflo/src/ruvocal' });
  });

  it('discovers only tracked test-named node:test files outside node_modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
    try {
      mkdirSync(join(dir, 'tests'));
      mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(dir, 'tests', 'a.test.cjs'), "const test = require('node:test');");
      writeFileSync(join(dir, 'tests', 'b.test.ts'), "import { it } from 'vitest'");
      writeFileSync(join(dir, 'tests', 'helper.cjs'), "const test = require('node:test');");
      writeFileSync(join(dir, 'node_modules', 'pkg', 'x.test.js'), "const test = require('node:test');");
      const files = ['tests/a.test.cjs', 'tests/b.test.ts', 'tests/helper.cjs', 'node_modules/pkg/x.test.js'];
      expect(discoverNodeTestFiles(dir, files)).toEqual([{ name: 'tests/a.test.cjs', installTree: null }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('folds node:test failures into the report so the ratchet sees them', () => {
    const merged = mergeNodeTestResults(
      { success: true, testResults: [{ name: 'tests/v.test.ts', status: 'passed' }] },
      [{ name: 'tests/new.test.cjs', passed: false }, { name: 'tests/ok.test.cjs', passed: true }],
    );
    expect(merged.success).toBe(false);
    const result = evaluateTestReport(merged, [], '/repo');
    expect(result.ok).toBe(false);
    expect(result.unexpected).toEqual(['tests/new.test.cjs']);
  });

  it('keeps a baselined node:test failure as known debt, not a new failure', () => {
    const merged = mergeNodeTestResults({ success: true, testResults: [] }, [{ name: 'tests/debt.test.cjs', passed: false }]);
    expect(evaluateTestReport(merged, ['tests/debt.test.cjs'], '/repo').ok).toBe(true);
  });
});
