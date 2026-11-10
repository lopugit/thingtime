const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getWorktreeName, resolveDevContext } = require('./worktree-ports.cjs');
test('managed task/repository worktrees have distinct PM2 identities without changing the primary ports', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thingtime-ports-'));
 const primary = path.join(root, 'primary', 'fixture'); fs.mkdirSync(primary, { recursive: true });
 const git = (...args) => execFileSync('git', args, { cwd: primary, stdio: 'ignore' });
 try {
  git('init'); git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-m','fixture');
  const a = path.join(root, 'alpha', 'fixture'), b = path.join(root, 'beta', 'fixture');
  git('worktree','add','--detach',a); git('worktree','add','--detach',b);
  assert.equal(getWorktreeName(primary), undefined);
  assert.equal(getWorktreeName(a), 'alpha-fixture'); assert.equal(getWorktreeName(b), 'beta-fixture');
  assert.notEqual(resolveDevContext(a).pm2NameBase, resolveDevContext(b).pm2NameBase);
  assert.notEqual(resolveDevContext(a).ports.web, resolveDevContext(b).ports.web);
  assert.equal(resolveDevContext(primary).ports.web, 9999);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
