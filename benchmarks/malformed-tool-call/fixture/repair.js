'use strict';

function parseTranscript(text) {
  if (!text.includes('tool_call')) return { status: 'ignored' };
  return { status: 'failed' };
}

module.exports = { parseTranscript };
