// ratchet-install-tree: ruflo/src/ruvocal
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('Ruvocal and Express resolve the patched proxy-addr', () => {
  assert.equal(require('proxy-addr/package.json').version, '2.0.8');
  const fromExpress = createRequire(require.resolve('express/package.json'));
  assert.equal(fromExpress('proxy-addr/package.json').version, '2.0.8');
});
test('ordinary loopback trust is preserved and non-loopback rejected', () => {
  const trust = require('proxy-addr').compile('loopback');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('192.0.2.1'), false);
});
