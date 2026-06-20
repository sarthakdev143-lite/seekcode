#!/usr/bin/env node

/**
 * Automated npm publishing script for seekcode-cli
 * Usage: 
 *   node scripts/publish.js patch   (bug fixes)
 *   node scripts/publish.js minor   (new features)
 *   node scripts/publish.js major   (breaking changes)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const versionType = process.argv[2];

if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('❌ Please specify version type: patch, minor, or major');
  console.log('Usage: npm run release:patch | release:minor | release:major');
  process.exit(1);
}

console.log(`🚀 Starting ${versionType} release for seekcode-cli...\n`);

try {
  // Step 1: Check if git working directory is clean
  console.log('📋 Checking git status...');
  const gitStatus = execSync('git status --porcelain', { encoding: 'utf8' });
  if (gitStatus.trim()) {
    console.log('⚠️  Uncommitted changes detected:');
    console.log(gitStatus);
    console.log('\n📝 Committing changes...');
    execSync('git add .', { stdio: 'inherit' });
    execSync(`git commit -m "chore: pre-release updates for ${versionType} version"`, { stdio: 'inherit' });
  }

  // Step 2: Run tests (if any)
  console.log('\n🧪 Running pre-publish checks...');
  execSync('npm run prepublishOnly', { stdio: 'inherit' });

  // Step 3: Bump version (this creates a git tag automatically)
  console.log(`\n📦 Bumping ${versionType} version...`);
  execSync(`npm version ${versionType} -m "chore: release v%s"`, { stdio: 'inherit' });

  // Step 4: Publish to npm
  console.log('\n📤 Publishing to npm registry...');
  execSync('npm publish', { stdio: 'inherit' });

  // Step 5: Push changes and tags to remote
  console.log('\n⬆️  Pushing to git remote...');
  execSync('git push', { stdio: 'inherit' });
  execSync('git push --tags', { stdio: 'inherit' });

  // Read new version
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  
  console.log('\n✅ Release completed successfully!');
  console.log(`✨ New version: ${packageJson.version}`);
  console.log('\n📦 Users can now update with:');
  console.log('   npm update seekcode-cli');
  console.log('   or')
  console.log('   npm install seekcode-cli@latest');

} catch (error) {
  console.error('\n❌ Release failed:', error.message);
  process.exit(1);
}
