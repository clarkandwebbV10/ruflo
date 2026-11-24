// SEC-010: run after a clean v3 dependency install with node --test.
const test = require('node:test');
const a = require('node:assert/strict');
const p = require('proxy-addr');
test('patched proxy-addr keeps ordinary IPv4, IPv6 and mapped-address trust behavior', () => {
  a.equal(require('proxy-addr/package.json').version, '2.0.8');
  const trust = p.compile('192.0.2.0/24');
  a.equal(trust('192.0.2.12'), true);
  a.equal(trust('198.51.100.12'), false);
  a.equal(trust('::ffff:192.0.2.12'), true);
  const trust6 = p.compile('2001:db8::/32');
  a.equal(trust6('2001:db8::1'), true);
  a.equal(trust6('198.51.100.12'), false);
  a.equal(p.compile('loopback')('127.0.0.1'), true);
});
