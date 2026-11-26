'use strict';
// Shared helper for dependency-security regression tests in the v3 workspace.
//
// v3 is installed with pnpm (v3/pnpm-lock.yaml). pnpm does not hoist
// transitive packages, so a bare require('proxy-addr') from v3/ resolves
// nothing (or a stray copy) and says nothing about what the runtime loads.
// These helpers inspect the real install tree instead:
//   - pnpm: every node_modules/.pnpm/<name>@<version> store entry
//   - npm:  every node_modules/**/<name>/package.json (nested copies included)
const fs = require('node:fs');
const path = require('node:path');

const V3_ROOT = path.resolve(__dirname, '..', '..');

function storeName(name) {
  return name.replace('/', '+');
}

/** Every installed copy of `name`, as { version, dir }. */
function installedCopies(name, root = V3_ROOT) {
  const copies = [];
  const store = path.join(root, 'node_modules', '.pnpm');
  if (fs.existsSync(store)) {
    const prefix = storeName(name) + '@';
    for (const entry of fs.readdirSync(store)) {
      if (!entry.startsWith(prefix)) continue;
      const dir = path.join(store, entry, 'node_modules', name);
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg)) copies.push({ version: JSON.parse(fs.readFileSync(pkg, 'utf8')).version, dir });
    }
    return copies;
  }
  const walk = (nm) => {
    if (!fs.existsSync(nm)) return;
    for (const entry of fs.readdirSync(nm)) {
      if (entry.startsWith('.')) continue;
      const scoped = entry.startsWith('@');
      for (const sub of scoped ? fs.readdirSync(path.join(nm, entry)).map((s) => `${entry}/${s}`) : [entry]) {
        const dir = path.join(nm, sub);
        if (sub === name && fs.existsSync(path.join(dir, 'package.json'))) {
          copies.push({ version: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, dir });
        }
        walk(path.join(dir, 'node_modules'));
      }
    }
  };
  walk(path.join(root, 'node_modules'));
  return copies;
}

/** Compare dotted numeric versions (prerelease tags are not expected here). */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

module.exports = { V3_ROOT, installedCopies, compareVersions };
