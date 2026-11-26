import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const locations = ['node_modules/express/package.json', 'node_modules/@claude-flow/cli/node_modules/express/package.json', 'node_modules/@modelcontextprotocol/sdk/node_modules/express/package.json'];
test('graph and all locked Express consumers resolve patched proxy-addr', () => {
  assert.equal(require('proxy-addr/package.json').version, '2.0.8');
  for (const location of locations) {
    const fromExpress = createRequire(resolve(location));
    assert.equal(fromExpress('proxy-addr/package.json').version, '2.0.8', location);
  }
});
test('ordinary loopback trust remains scoped', () => {
  const trust = require('proxy-addr').compile('loopback');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('192.0.2.1'), false);
});
