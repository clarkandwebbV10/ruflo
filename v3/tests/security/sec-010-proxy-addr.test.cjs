// ratchet-install-tree: v3
// SEC-010 (GHSA-jqcg-44mw-7w3h): proxy-addr must be >= 2.0.8 in the real v3
// install tree. Run after `pnpm install --frozen-lockfile` in v3/:
//   node --test tests/security/sec-010-proxy-addr.test.cjs
const test = require('node:test');
const a = require('node:assert/strict');
const { installedCopies, compareVersions } = require('./installed-copies.cjs');

const PATCHED = '2.0.8';
const copies = installedCopies('proxy-addr');

test('proxy-addr is installed and no vulnerable (< 2.0.8) copy remains', () => {
  a.ok(copies.length > 0, 'proxy-addr not found in the v3 install tree; install v3 dependencies first');
  const vulnerable = copies.filter((c) => compareVersions(c.version, PATCHED) < 0);
  a.deepEqual(vulnerable, [], `vulnerable proxy-addr copies: ${vulnerable.map((c) => c.version).join(', ')}`);
});

for (const copy of copies) {
  test(`proxy-addr ${copy.version} keeps ordinary IPv4, IPv6 and mapped-address trust behavior`, () => {
    const p = require(copy.dir);
    const trust = p.compile('192.0.2.0/24');
    a.equal(trust('192.0.2.12'), true);
    a.equal(trust('198.51.100.12'), false);
    a.equal(trust('::ffff:192.0.2.12'), true);
    const trust6 = p.compile('2001:db8::/32');
    a.equal(trust6('2001:db8::1'), true);
    a.equal(trust6('198.51.100.12'), false);
    a.equal(p.compile('loopback')('127.0.0.1'), true);
  });
}
