#!/usr/bin/env node
/**
 * Fail-closed npm audit gate with reviewed, expiring exceptions (SEC-033).
 *
 * Runs the same two scans the CI security job always required:
 *   - full tree       (`npm audit`)             blocks on high and critical
 *   - production tree (`npm audit --omit=dev`)  blocks on moderate and above
 * and evaluates every advisory (package + GHSA id) against
 * config/audit-exceptions.json.
 *
 * The gate FAILS when:
 *   - an advisory at or above a scan's level is not excepted,
 *   - an exception has expired,
 *   - an exception is malformed, or
 *   - an exception names an advisory npm no longer reports (stale entries
 *     must be removed, so the list can only shrink).
 * A scan that does not produce a valid audit report also fails (exit 2).
 *
 * Usage: node scripts/audit-gate.mjs
 *        node scripts/audit-gate.mjs --input-all a.json --input-prod p.json \
 *          [--exceptions file] [--today YYYY-MM-DD]      (offline / tests)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const GHSA_RE = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Advisories in a complete npm audit v2 report, keyed by `package GHSA`. */
export function collectAdvisories(report) {
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const severities = Object.keys(RANK);
  const counts = report?.metadata?.vulnerabilities;
  if (!isRecord(report) || report.auditReportVersion !== 2 || report.error ||
      !isRecord(report.vulnerabilities) || !isRecord(counts)) {
    throw new Error('not a valid npm audit --json v2 report');
  }
  const actual = Object.fromEntries(severities.map((s) => [s, 0]));
  const entries = Object.entries(report.vulnerabilities);
  const found = new Map();
  const links = new Map();
  const direct = new Set();
  for (const [name, entry] of entries) {
    if (!isRecord(entry) || !Object.hasOwn(RANK, entry.severity) ||
        !Array.isArray(entry.via) || entry.via.length === 0) {
      throw new Error('malformed npm audit vulnerability entry');
    }
    actual[entry.severity] += 1;
    links.set(name, []);
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!Object.hasOwn(report.vulnerabilities, via)) throw new Error('unresolved npm audit transitive pointer');
        links.get(name).push(via);
        continue;
      }
      if (!isRecord(via) || typeof via.url !== 'string' ||
          !Object.hasOwn(RANK, via.severity)) {
        throw new Error('malformed npm audit advisory');
      }
      const advisory = via.url.split('/').pop();
      const pkg = via.name ?? via.dependency;
      if (typeof pkg !== 'string' || !pkg.trim() || !advisory) throw new Error('incomplete npm audit advisory');
      direct.add(name);
      const key = `${pkg} ${advisory}`;
      const previous = found.get(key);
      if (previous && previous.severity !== via.severity) {
        throw new Error('conflicting npm audit advisory severities');
      }
      found.set(key, { package: pkg, advisory, severity: via.severity, title: via.title ?? '' });
    }
  }
  for (const severity of severities) {
    if (counts[severity] !== actual[severity]) throw new Error('npm audit severity counts do not match entries');
  }
  if (counts.total !== entries.length) throw new Error('npm audit total does not match entries');
  // A transitive-only component without any concrete advisory is not evidence.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, dependencies] of links) {
      if (!direct.has(name) && dependencies.some((dependency) => direct.has(dependency))) {
        direct.add(name);
        changed = true;
      }
    }
  }
  if (direct.size !== entries.length) throw new Error('npm audit entry has no concrete advisory');
  return found;
}

export function validateExceptions(list) {
  const problems = [];
  const seen = new Set();
  for (const [i, e] of (Array.isArray(list) ? list : []).entries()) {
    const where = `exceptions[${i}]`;
    if (!e || typeof e.package !== 'string' || !e.package) problems.push(`${where}: package is required`);
    if (!e || !GHSA_RE.test(e.advisory ?? '')) problems.push(`${where}: advisory must be a GHSA id`);
    if (!e || typeof e.reason !== 'string' || e.reason.trim().length < 20) problems.push(`${where}: a substantive reason is required`);
    if (!e || typeof e.remediation !== 'string' || !e.remediation.trim()) problems.push(`${where}: remediation is required`);
    if (!e || !DATE_RE.test(e.expires ?? '')) problems.push(`${where}: expires must be YYYY-MM-DD`);
    const key = e && `${e.package} ${e.advisory}`;
    if (key && seen.has(key)) problems.push(`${where}: duplicate exception ${key}`);
    if (key) seen.add(key);
  }
  if (!Array.isArray(list)) problems.push('exceptions must be an array');
  return problems;
}

/** Pure evaluation of both scans against the exception list. */
export function evaluate({ full, prod, exceptions, today }) {
  const problems = validateExceptions(exceptions);
  const excepted = new Map((Array.isArray(exceptions) ? exceptions : []).map((e) => [`${e.package} ${e.advisory}`, e]));
  const blocking = [];
  for (const [scan, advisories, level] of [['full', full, 'high'], ['production', prod, 'moderate']]) {
    for (const [key, a] of advisories) {
      if ((RANK[a.severity] ?? RANK.critical) < RANK[level]) continue; // unknown severity fails closed
      if (!excepted.has(key)) blocking.push({ scan, ...a });
    }
  }
  const expired = [...excepted.values()].filter((e) => DATE_RE.test(e.expires ?? '') && e.expires < today);
  const reported = new Set([...full.keys(), ...prod.keys()]);
  const stale = [...excepted.keys()].filter((key) => !reported.has(key));
  return { ok: !problems.length && !blocking.length && !expired.length && !stale.length, problems, blocking, expired, stale };
}

function runAudit(omitDev) {
  const args = ['audit', '--json', ...(omitDev ? ['--omit=dev'] : [])];
  const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32',
  });
  return parseAuditRun(run);
}

/** A terminated or failed subprocess is not a completed audit. */
export function parseAuditRun(run) {
  if (run.error) throw run.error;
  if (run.signal || (run.status !== 0 && run.status !== 1)) {
    throw new Error('npm audit did not complete with an expected exit status');
  }
  // npm audit exits 1 when it finds advisories; still validate the JSON report.
  return JSON.parse(run.stdout);
}

function main(argv) {
  const opt = { exceptions: resolve(REPO_ROOT, 'config/audit-exceptions.json'), today: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--input-all', '--input-prod', '--exceptions', '--today'].includes(flag) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    opt[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = flag === '--today' ? value : resolve(value);
    i += 1;
  }
  const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const full = collectAdvisories(opt.inputAll ? load(opt.inputAll) : runAudit(false));
  const prod = collectAdvisories(opt.inputProd ? load(opt.inputProd) : runAudit(true));
  const result = evaluate({ full, prod, exceptions: load(opt.exceptions).exceptions, today: opt.today });

  for (const p of result.problems) console.error(`audit-gate: invalid exception: ${p}`);
  for (const b of result.blocking) console.error(`audit-gate: BLOCKING (${b.scan} scan) ${b.severity} ${b.package} ${b.advisory}: ${b.title}`);
  for (const e of result.expired) console.error(`audit-gate: EXPIRED exception ${e.package} ${e.advisory} (expired ${e.expires}); fix it or re-review it`);
  for (const s of result.stale) console.error(`audit-gate: STALE exception ${s} is no longer reported; remove it`);
  if (!result.ok) {
    console.error('audit-gate: FAILED');
    return 1;
  }
  console.log(`audit-gate: PASS (${full.size} full-tree and ${prod.size} production advisories reported; all at blocking levels are excepted, none expired or stale)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`audit-gate: error: ${error.message}`);
    process.exitCode = 2;
  }
}
