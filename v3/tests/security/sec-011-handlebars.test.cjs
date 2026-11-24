const assert = require('node:assert/strict');
const h = require('handlebars');
assert.equal(h.VERSION, '4.7.10');
assert.equal(h.compile('Hello {{name}}')({name:'world'}), 'Hello world');
assert.equal(h.compile('{{name}}')({name:'<b>'}), '&lt;b&gt;');
assert.equal(h.compile('{{#each items}}{{this}} {{/each}}')({items:['a','b']}), 'a b ');
assert.equal(h.compile(h.parse('Hello {{name}}'))({name:'world'}), 'Hello world');
console.log('HANDLEBARS_COMPAT_PASS');
