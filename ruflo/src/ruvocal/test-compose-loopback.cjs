// Static regression for the development-only unauthenticated MongoDB publish policy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'docker-compose.yml'), 'utf8');
const portBlocks = [...source.matchAll(/^    ports:[ \t]*\r?\n((?:^      -[^\r\n]*\r?\n)+)/gm)];
assert.equal(portBlocks.length, 1, 'expected exactly one published ports block');
const mappings = portBlocks[0][1].trim().split(/\r?\n/).map(line => line.trim());
assert.deepEqual(mappings, ['- "127.0.0.1:${LOCAL_MONGO_PORT:-27017}:27017"']);
console.log('Development MongoDB loopback publishing regression passed');
