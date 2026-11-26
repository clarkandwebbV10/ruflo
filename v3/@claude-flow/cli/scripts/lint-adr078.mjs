#!/usr/bin/env node
/**
 * ADR-078 lint gate: no new direct `child_process` importers in the CLI.
 *
 * Shelling out through `child_process` is the command-injection surface that
 * ADR-078 routes through SafeExecutor (@claude-flow/security) or shell-free
 * execFile*. The legacy `.eslintrc.json` expresses this rule, but no lint
 * script ever ran it and the root toolchain has no TypeScript ESLint parser,
 * so the rule was never enforced.
 *
 * This gate parses every `src/**\/*.ts` file with the TypeScript compiler API
 * (no regex: comments and strings cannot cause false hits) and finds every
 * form of import: `import ... from`, `export ... from`, `import x = require()`,
 * `require()`, and dynamic `import()`, with or without the `node:` prefix.
 *
 * Ratchet semantics, matching scripts/ci-test-ratchet.mjs:
 *   - files allowed by `.eslintrc.json` overrides are always permitted;
 *   - files listed in the committed baseline are known debt;
 *   - any other importer FAILS (exit 1);
 *   - a baseline entry that no longer imports child_process FAILS too, so the
 *     baseline can only shrink and cleaned-up files cannot silently regress.
 *
 * Usage: node scripts/lint-adr078.mjs [--root <cliDir>] [--baseline <file>]
 *        node scripts/lint-adr078.mjs --print   (list current importers)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = new Set(['child_process', 'node:child_process']);

function loadTypeScript(fromDir) {
  // Resolve from the CLI package first, then the repository root install.
  for (const base of [fromDir, resolve(fromDir, '../../..')]) {
    try {
      return createRequire(join(base, 'package.json'))('typescript');
    } catch { /* try next */ }
  }
  throw new Error('typescript is not installed; run npm ci first');
}

function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function isChildProcess(node, ts) {
  return node && ts.isStringLiteralLike(node) && MODULES.has(node.text);
}

/** Return the 1-based line numbers at which `source` imports child_process. */
export function findChildProcessImports(source, fileName, ts) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = [];
  const hit = (node) => lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isChildProcess(node.moduleSpecifier, ts)) {
      hit(node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && isChildProcess(node.moduleReference.expression, ts)) {
      hit(node);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && isChildProcess(node.arguments[0], ts)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) hit(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

function readAllowlist(cliDir) {
  const rcPath = join(cliDir, '.eslintrc.json');
  if (!existsSync(rcPath)) return new Set();
  const rc = JSON.parse(readFileSync(rcPath, 'utf8'));
  const allowed = new Set();
  for (const o of rc.overrides ?? []) {
    const off = o.rules?.['no-restricted-imports'] === 'off';
    if (off) for (const f of o.files ?? []) allowed.add(f.split(sep).join('/'));
  }
  return allowed;
}

function readBaseline(file) {
  if (!existsSync(file)) throw new Error(`ADR-078 baseline is missing: ${file}`);
  return new Set(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}

/** Pure evaluation, exported for tests. */
export function evaluate({ importers, allowlist, baseline }) {
  const unexpected = [...importers].filter((f) => !allowlist.has(f) && !baseline.has(f)).sort();
  const stale = [...baseline].filter((f) => !importers.has(f)).sort();
  return { ok: unexpected.length === 0 && stale.length === 0, unexpected, stale };
}

export function scan(cliDir, ts) {
  const importers = new Map();
  for (const file of listTsFiles(join(cliDir, 'src'))) {
    const lines = findChildProcessImports(readFileSync(file, 'utf8'), file, ts);
    if (lines.length) importers.set(relative(cliDir, file).split(sep).join('/'), lines);
  }
  return importers;
}

function main(argv) {
  let cliDir = resolve(HERE, '..');
  let baselinePath = null;
  let print = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) cliDir = resolve(argv[++i]);
    else if (argv[i] === '--baseline' && argv[i + 1]) baselinePath = resolve(argv[++i]);
    else if (argv[i] === '--print') print = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  baselinePath ??= join(cliDir, 'scripts', 'adr078-child-process-baseline.txt');
  const ts = loadTypeScript(cliDir);
  const found = scan(cliDir, ts);
  if (print) {
    for (const f of [...found.keys()].sort()) console.log(f);
    return 0;
  }
  const result = evaluate({ importers: new Set(found.keys()), allowlist: readAllowlist(cliDir), baseline: readBaseline(baselinePath) });
  if (!result.ok) {
    for (const f of result.unexpected) {
      console.error(`ADR-078: ${f}:${found.get(f).join(',')} imports child_process. Use SafeExecutor (@claude-flow/security) or shell-free execFile*; see ADR-078.`);
    }
    for (const f of result.stale) {
      console.error(`ADR-078: ${f} no longer imports child_process; remove it from ${relative(cliDir, baselinePath)} so it cannot regress.`);
    }
    console.error(`ADR-078 lint FAILED: ${result.unexpected.length} new importer(s), ${result.stale.length} stale baseline entr(y/ies).`);
    return 1;
  }
  console.log(`ADR-078 lint passed: ${found.size} importer(s) scanned, all allowlisted or baselined (debt may only shrink).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ADR-078 lint error: ${error.message}`);
    process.exitCode = 2;
  }
}
