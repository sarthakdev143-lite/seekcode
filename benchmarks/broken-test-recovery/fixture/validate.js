'use strict';

const assert = require('assert');
const { subtract } = require('./calculator');

assert.strictEqual(subtract(10, 3), 7);
assert.strictEqual(subtract(0, 4), -4);
console.log('ok');
