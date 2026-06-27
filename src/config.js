const path = require('path');
module.exports = {
  GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:8080',
  GATEWAY_CREATE_TIMEOUT_MS: Number(process.env.GATEWAY_CREATE_TIMEOUT_MS || 120000),
  GATEWAY_REQUEST_TIMEOUT_MS: Number(process.env.GATEWAY_REQUEST_TIMEOUT_MS || 35 * 60 * 1000),
  WORKING_DIR: process.cwd(),
  CACHE_DIR: path.join(process.cwd(), '.seekcode', 'cache'),
  SUPPORTED_EXTENSIONS: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  PARSE_CONCURRENCY: 4,
  MAX_CONTEXT_TOKENS: 1000000,
  RUN_BUDGET_MS: Number(process.env.SEEKCODE_RUN_BUDGET_MS || 60 * 60 * 1000),
  SECURITY_POLICY: {
    approvalRequired: { delete: true, writeOutsideProject: true, network: true, shell: true, install: true },
    allowNetwork: false,
  },
  DOCKER_IMAGE: 'node:20-alpine',
  DOCKER_MEMORY: '512m',
  ALLOW_NETWORK: false,
  COMMAND_TIMEOUT: 60000,
};
