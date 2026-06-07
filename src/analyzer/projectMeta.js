const fs = require('fs');
const path = require('path');
function detectProjectMeta(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  const meta = { type: 'unknown', framework: null, language: 'javascript', testing: null };
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) meta.framework = 'Next.js';
    else if (deps.react) meta.framework = 'React';
    else if (deps.vue) meta.framework = 'Vue';
    else if (deps.express) meta.framework = 'Express';
    if (fs.existsSync(path.join(rootDir, 'tsconfig.json'))) meta.language = 'typescript';
    if (deps.jest || deps['@jest/globals']) meta.testing = 'Jest';
    else if (deps.mocha) meta.testing = 'Mocha';
    else if (deps.vitest) meta.testing = 'Vitest';
  }
  return meta;
}
module.exports = { detectProjectMeta };
