// ratchet-install-tree: v3
// SEC-011 (GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f): handlebars must be
// >= 4.7.10 in the real v3 install tree. Run after
// `pnpm install --frozen-lockfile` in v3/:
//   node --test tests/security/sec-011-handlebars.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { installedCopies, compareVersions } = require('./installed-copies.cjs');

const PATCHED = '4.7.10';
const copies = installedCopies('handlebars');

test('handlebars is installed and no vulnerable (< 4.7.10) copy remains', () => {
  assert.ok(copies.length > 0, 'handlebars not found in the v3 install tree; install v3 dependencies first');
  const vulnerable = copies.filter((c) => compareVersions(c.version, PATCHED) < 0);
  assert.deepEqual(vulnerable, [], `vulnerable handlebars copies: ${vulnerable.map((c) => c.version).join(', ')}`);
});

for (const copy of copies) {
  test(`handlebars ${copy.version} keeps ordinary template behavior`, () => {
    const h = require(copy.dir);
    assert.equal(h.VERSION, copy.version);
    assert.equal(h.compile('Hello {{name}}')({ name: 'world' }), 'Hello world');
    assert.equal(h.compile('{{name}}')({ name: '<b>' }), '&lt;b&gt;');
    assert.equal(h.compile('{{#each items}}{{this}} {{/each}}')({ items: ['a', 'b'] }), 'a b ');
    assert.equal(h.compile(h.parse('Hello {{name}}'))({ name: 'world' }), 'Hello world');
  });
}
