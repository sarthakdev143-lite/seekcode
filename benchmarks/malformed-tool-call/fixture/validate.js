'use strict';

const assert = require('assert');
const { parseTranscript } = require('./repair');

const malformed = 'tool_call write_file path=src/app.js content={missing closing quote';
assert.deepStrictEqual(parseTranscript(malformed), { status: 'recovered' });
console.log('ok');
