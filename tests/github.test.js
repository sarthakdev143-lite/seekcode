const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GitHubUploader } = require('../src/commands/github');

// Test helpers
const TEST_DIR = path.join(__dirname, 'test-repo');

describe('GitHubUploader', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('createReadmeIfNeeded creates README when missing', async () => {
    const uploader = new GitHubUploader(TEST_DIR);
    const readmePath = path.join(TEST_DIR, 'README.md');
    
    expect(fs.existsSync(readmePath)).toBe(false);
    await uploader.createReadmeIfNeeded();
    expect(fs.existsSync(readmePath)).toBe(true);
    
    const content = fs.readFileSync(readmePath, 'utf8');
    expect(content).toContain('# test-repo');
  });

  test('createReadmeIfNeeded does not overwrite existing README', async () => {
    const uploader = new GitHubUploader(TEST_DIR);
    const readmePath = path.join(TEST_DIR, 'README.md');
    const customContent = '# Custom README';
    fs.writeFileSync(readmePath, customContent);
    
    await uploader.createReadmeIfNeeded();
    const content = fs.readFileSync(readmePath, 'utf8');
    expect(content).toBe(customContent);
  });

  test('isGitRepo detects non-git directory', () => {
    const uploader = new GitHubUploader(TEST_DIR);
    expect(uploader.isGitRepo()).toBe(false);
  });

  test('initGit initializes repository', () => {
    const uploader = new GitHubUploader(TEST_DIR);
    expect(uploader.initGit()).toBe(true);
    expect(uploader.isGitRepo()).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.git'))).toBe(true);
  });

  test('createGitignoreIfNeeded creates .gitignore when missing', () => {
    const uploader = new GitHubUploader(TEST_DIR);
    const gitignorePath = path.join(TEST_DIR, '.gitignore');
    
    expect(fs.existsSync(gitignorePath)).toBe(false);
    uploader.createGitignoreIfNeeded();
    expect(fs.existsSync(gitignorePath)).toBe(true);
    
    const content = fs.readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('node_modules/');
  });

  test('addAndCommit commits changes', () => {
    const uploader = new GitHubUploader(TEST_DIR);
    uploader.initGit();
    
    // Create a test file
    const testFile = path.join(TEST_DIR, 'test.txt');
    fs.writeFileSync(testFile, 'test content');
    
    const result = uploader.addAndCommit('Test commit');
    expect(result).toBe(true);
    
    // Verify commit was created
    const log = execSync('git log --oneline', { cwd: TEST_DIR, encoding: 'utf8' });
    expect(log).toContain('Test commit');
  });

  test('setRemote configures remote URL', () => {
    const uploader = new GitHubUploader(TEST_DIR);
    uploader.initGit();
    
    const testUrl = 'https://github.com/testuser/testrepo.git';
    const result = uploader.setRemote(testUrl);
    expect(result).toBe(true);
    
    const remotes = execSync('git remote -v', { cwd: TEST_DIR, encoding: 'utf8' });
    expect(remotes).toContain(testUrl);
  });

  test('uploadToGitHub performs all steps (without actual push)', async () => {
    const uploader = new GitHubUploader(TEST_DIR);
    
    // Mock push to avoid actual network call
    const originalPush = uploader.push;
    uploader.push = jest.fn().mockReturnValue(true);
    
    const result = await uploader.uploadToGitHub('https://github.com/test/test.git', 'Test message');
    expect(result).toBe(true);
    
    // Verify files were created
    expect(fs.existsSync(path.join(TEST_DIR, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.git'))).toBe(true);
    
    uploader.push = originalPush;
  });

  test('uploadToGitHub handles missing remote gracefully', async () => {
    const uploader = new GitHubUploader(TEST_DIR);
    
    // This should fail because no remote is set, but the steps before should work
    // We're testing that it doesn't crash
    await expect(uploader.uploadToGitHub(null)).resolves.not.toThrow();
  });
});
