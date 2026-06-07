const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class GitHubUploader {
  constructor(projectDir) {
    this.projectDir = path.resolve(projectDir);
    this.remoteUrl = null;
  }

  async createReadmeIfNeeded() {
    const readmePath = path.join(this.projectDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      logger.info('README.md already exists');
      return true;
    }

    logger.info('Creating README.md...');
    const defaultReadme = `# ${path.basename(this.projectDir)}

## Description
Auto-generated README for the project.

## Installation
\`\`\`bash
npm install
\`\`\`

## Usage
\`\`\`bash
npm start
\`\`\`
`;
    fs.writeFileSync(readmePath, defaultReadme, 'utf8');
    logger.success('README.md created');
    return true;
  }

  isGitRepo() {
    try {
      execSync('git rev-parse --git-dir', { cwd: this.projectDir, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  initGit() {
    if (this.isGitRepo()) {
      logger.info('Git repository already initialized');
      return true;
    }

    logger.info('Initializing Git repository...');
    try {
      execSync('git init', { cwd: this.projectDir, stdio: 'inherit' });
      logger.success('Git initialized');
      return true;
    } catch (err) {
      logger.error('Failed to initialize Git: ' + err.message);
      return false;
    }
  }

  createGitignoreIfNeeded() {
    const gitignorePath = path.join(this.projectDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      logger.info('.gitignore already exists');
      return true;
    }

    const defaultGitignore = `node_modules/
*.log
.env
.DS_Store
coverage/
dist/
build/
.seekcode/
`;
    fs.writeFileSync(gitignorePath, defaultGitignore, 'utf8');
    logger.success('.gitignore created');
    return true;
  }

  addAndCommit(message = 'Initial commit') {
    try {
      execSync('git add .', { cwd: this.projectDir, stdio: 'inherit' });
      execSync(`git commit -m "${message}"`, { cwd: this.projectDir, stdio: 'inherit' });
      logger.success('Changes committed');
      return true;
    } catch (err) {
      logger.error('Commit failed: ' + err.message);
      return false;
    }
  }

  setRemote(url) {
    try {
      // Remove existing origin if any
      try {
        execSync('git remote remove origin', { cwd: this.projectDir, stdio: 'ignore' });
      } catch {}
      
      execSync(`git remote add origin ${url}`, { cwd: this.projectDir, stdio: 'inherit' });
      this.remoteUrl = url;
      logger.success(`Remote added: ${url}`);
      return true;
    } catch (err) {
      logger.error('Failed to set remote: ' + err.message);
      return false;
    }
  }

  push(branch = 'master') {
    try {
      execSync(`git push -u origin ${branch}`, { cwd: this.projectDir, stdio: 'inherit' });
      logger.success(`Pushed to ${this.remoteUrl}`);
      return true;
    } catch (err) {
      logger.error('Push failed: ' + err.message);
      return false;
    }
  }

  async uploadToGitHub(repoUrl, commitMessage = 'Initial commit') {
    logger.header('GitHub Upload');
    
    await this.createReadmeIfNeeded();
    this.createGitignoreIfNeeded();
    
    if (!this.initGit()) return false;
    if (!this.addAndCommit(commitMessage)) return false;
    if (!this.setRemote(repoUrl)) return false;
    if (!this.push()) return false;
    
    logger.success('Project successfully uploaded to GitHub!');
    return true;
  }
}

async function githubCommand(projectPath, repoUrl, commitMessage) {
  const uploader = new GitHubUploader(projectPath || process.cwd());
  const success = await uploader.uploadToGitHub(repoUrl, commitMessage);
  if (!success) {
    console.error('\n❌ Upload failed. Please check the error messages above.');
    process.exit(1);
  }
}

module.exports = { GitHubUploader, githubCommand };
