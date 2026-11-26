#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function normalizeTestPath(name, repoRoot) {
  const normalized = isAbsolute(name) ? relative(repoRoot, name) : name;
  return normalized.split(sep).join('/').replace(/^\.\//, '');
}

export function evaluateTestReport(report, baselineEntries, repoRoot = REPO_ROOT) {
  if (!report || !Array.isArray(report.testResults)) {
    return { ok: false, error: 'Vitest JSON report is missing testResults[]' };
  }
  if (report.testResults.length === 0 && report.success !== false) {
    return { ok: false, error: 'Vitest JSON report contains zero test files' };
  }

  const baseline = new Set(
    baselineEntries.map((entry) => entry.trim()).filter((entry) => entry && !entry.startsWith('#')),
  );
  const failed = new Set(
    report.testResults
      .filter((result) => result?.status === 'failed' && typeof result.name === 'string')
      .map((result) => normalizeTestPath(result.name, repoRoot)),
  );
  const unexpected = [...failed].filter((name) => !baseline.has(name)).sort();
  const fixed = [...baseline].filter((name) => !failed.has(name)).sort();

  if (report.success === false && failed.size === 0) {
    return {
      ok: false,
      error: 'Vitest failed without identifying a failing test file',
      failed: [],
      unexpected: [],
      fixed,
    };
  }

  return {
    ok: unexpected.length === 0,
    failed: [...failed].sort(),
    unexpected,
    fixed,
    baselineCount: baseline.size,
  };
}

// ── node:test files ──────────────────────────────────────────────────────────
// Vitest collects every *.test.{c,m}js file, but files written for the built-in
// `node:test` runner contain no Vitest suite, so Vitest reports them as failed
// ("No test suite found") regardless of whether their assertions hold. That
// silently turned every node:test file into baselined "known failing" debt.
// The ratchet therefore excludes node:test files from Vitest and runs each one
// with `node --test`, folding the per-file results into the same report shape.
//
// A file that asserts on a sub-package's own install tree declares it:
//   // ratchet-install-tree: ruflo/src/ruvocal
// When that tree has no node_modules in this job, the file is listed as
// deferred (it is run by the job that installs the tree), never as passed.
const TEST_FILE_RE = /\.(test|spec)\.(c|m)?[jt]sx?$/;
const TS_FILE_RE = /\.(c|m)?tsx?$/;
// Statement-level imports only (line start), so a test that merely mentions
// `require('node:test')` inside a string literal is not misclassified.
const NODE_TEST_RE = /^\s*(?:import\b[^\n;]*\bfrom\s*['"]node:test['"]|(?:const|let|var)\b[^\n;]*=\s*(?:await\s+import|require)\(\s*['"]node:test['"]\s*\))/m;
const VITEST_RE = /^\s*import\b[^\n;]*\bfrom\s*['"]vitest['"]/m;
const INSTALL_TREE_RE = /^\s*\/\/\s*ratchet-install-tree:\s*(\S+)\s*$/m;

export function classifyNodeTestFile(source) {
  // A file that imports Vitest is a Vitest file, whatever else it mentions.
  if (VITEST_RE.test(source) || !NODE_TEST_RE.test(source)) return null;
  const tree = source.match(INSTALL_TREE_RE);
  return { installTree: tree ? tree[1].replace(/\/+$/, '') : null };
}

export function discoverNodeTestFiles(repoRoot = REPO_ROOT, trackedFiles = null) {
  const files = trackedFiles ?? spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .stdout.split('\0').filter(Boolean);
  const found = [];
  for (const name of files) {
    if (!TEST_FILE_RE.test(name) || name.split('/').includes('node_modules')) continue;
    const full = resolve(repoRoot, name);
    if (!existsSync(full)) continue;
    const info = classifyNodeTestFile(readFileSync(full, 'utf8'));
    if (info) found.push({ name: normalizeTestPath(name, repoRoot), ...info });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Merge node:test outcomes into a Vitest-shaped report (pure, for tests). */
export function mergeNodeTestResults(report, nodeResults) {
  const testResults = [...(report?.testResults ?? [])];
  for (const r of nodeResults) testResults.push({ name: r.name, status: r.passed ? 'passed' : 'failed' });
  const anyNodeFailed = nodeResults.some((r) => !r.passed);
  return { ...report, testResults, success: report?.success !== false && !anyNodeFailed };
}

function runNodeTestFiles(entries, repoRoot) {
  const results = [];
  const deferred = [];
  for (const entry of entries) {
    if (entry.installTree && !existsSync(resolve(repoRoot, entry.installTree, 'node_modules'))) {
      deferred.push(entry);
      continue;
    }
    // TypeScript node:test files need a loader; use the repo's own tsx.
    const loader = TS_FILE_RE.test(entry.name) ? ['--import', 'tsx'] : [];
    const run = spawnSync(process.execPath, [...loader, '--test', entry.name], {
      cwd: repoRoot,
      env: { ...process.env, CI: '1' },
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });
    const passed = !run.error && !run.signal && run.status === 0;
    if (!passed) {
      process.stdout.write(`\n── node --test ${entry.name} (exit ${run.signal ?? run.status}) ──\n`);
      process.stdout.write(`${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n').slice(-40).join('\n') + '\n');
    }
    results.push({ name: entry.name, passed });
  }
  return { results, deferred };
}

function parseArgs(argv) {
  const args = { report: '', baseline: resolve(REPO_ROOT, 'scripts/ci-test-baseline.txt'), run: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report' && argv[i + 1]) {
      args.report = resolve(argv[++i]);
      args.run = false;
    } else if (argv[i] === '--baseline' && argv[i + 1]) {
      args.baseline = resolve(argv[++i]);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report || resolve(REPO_ROOT, '.test-results/vitest.json');
  const vitestBin = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

  const nodeTestFiles = args.run ? discoverNodeTestFiles(REPO_ROOT) : [];
  if (args.run) {
    mkdirSync(dirname(reportPath), { recursive: true });
    // A killed runner must not accidentally reuse a prior green-enough report.
    rmSync(reportPath, { force: true });
    const run = spawnSync(process.execPath, [
      vitestBin,
      'run',
      '--reporter=json',
      `--outputFile=${reportPath}`,
      // node:test files are run by `node --test` below, not by Vitest.
      ...nodeTestFiles.map((f) => `--exclude=${f.name}`),
    ], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      stdio: 'inherit',
    });
    if (run.error) throw run.error;
    if (run.signal || (run.status !== 0 && run.status !== 1)) {
      console.error(`CI test ratchet: Vitest terminated abnormally (${run.signal ?? run.status})`);
      process.exit(1);
    }
  }

  if (!existsSync(reportPath)) {
    console.error(`CI test ratchet: report was not produced: ${reportPath}`);
    process.exit(1);
  }
  if (!existsSync(args.baseline)) {
    console.error(`CI test ratchet: baseline is missing: ${args.baseline}`);
    process.exit(1);
  }

  let report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (args.run) {
    const { results, deferred } = runNodeTestFiles(nodeTestFiles, REPO_ROOT);
    report = mergeNodeTestResults(report, results);
    const failedNode = results.filter((r) => !r.passed).length;
    console.log(`CI test ratchet: node --test ran ${results.length} file(s), ${failedNode} failing; ${deferred.length} deferred`);
    for (const d of deferred) console.log(`  ~ ${d.name} (deferred: ${d.installTree}/node_modules not installed in this job)`);
  }
  const baselineEntries = readFileSync(args.baseline, 'utf8').split(/\r?\n/);
  const result = evaluateTestReport(report, baselineEntries);

  if (!result.ok) {
    console.error(`CI test ratchet: FAILED — ${result.unexpected?.length ?? 0} unexpected failing file(s)`);
    for (const name of result.unexpected ?? []) console.error(`  + ${name}`);
    if (result.error) console.error(`  ${result.error}`);
    process.exit(1);
  }

  console.log(
    `CI test ratchet: PASS — ${result.failed.length}/${result.baselineCount} known failing files remain; `
      + `${result.fixed.length} baseline file(s) are now green`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
