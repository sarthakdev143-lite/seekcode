const path = require('path');
module.exports = {
  GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:8080',
  WORKING_DIR: process.cwd(),
  CACHE_DIR: path.join(process.cwd(), '.seekcode', 'cache'),
  SUPPORTED_EXTENSIONS: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  PARSE_CONCURRENCY: 4,
};
