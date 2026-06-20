const fg = require('fast-glob');
const config = require('../config');
async function findSourceFiles(rootDir) {
  const patterns = ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.mjs', '**/*.cjs'];
  const files = await fg(patterns, {
    cwd: rootDir, absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**'],
    dot: false, onlyFiles: true, stats: true,
  });
  return files.filter(e => e.stats.size <= config.MAX_FILE_SIZE_BYTES).map(e => e.path);
}
module.exports = { findSourceFiles };
