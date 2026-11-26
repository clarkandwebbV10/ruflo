// ratchet-install-tree: ruflo/src/ruvocal/mcp-bridge
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const proxyaddr = require('proxy-addr');
const expressRequire = createRequire(require.resolve('express'));
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url), 'utf8'));
test('bridge and Express resolve the patched proxy-addr', () => {
  assert.equal(manifest.overrides['proxy-addr'], '2.0.8');
  assert.equal(lock.packages['node_modules/proxy-addr'].version, '2.0.8');
  assert.equal(require('proxy-addr/package.json').version, '2.0.8');
  assert.equal(expressRequire('proxy-addr/package.json').version, '2.0.8');
});
test('ordinary loopback trust and non-loopback rejection are unchanged', () => {
  const trust = proxyaddr.compile('loopback');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('::1'), true);
  assert.equal(trust('192.0.2.5'), false);
});
test('untrusted direct connection ignores forwarded addresses', () => {
  const request = {socket:{remoteAddress:'192.0.2.10'}, headers:{'x-forwarded-for':'198.51.100.2'}};
  assert.equal(proxyaddr(request, () => false), '192.0.2.10');
});
