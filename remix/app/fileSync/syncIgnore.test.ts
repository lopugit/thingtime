import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { canonicalIgnoreRules, createSyncIgnorePolicy, DEFAULT_SYNC_IGNORE_RULES } from './syncIgnore';

import fixtures from './syncIgnore.fixtures.json';

const cases = fixtures;
const git = process.platform === 'darwin' ? ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'].find(existsSync)! : 'git';
test('root-relative case-sensitive rules agree with git check-ignore, including UTF-8 byte wildcards', () => {
 const directory = mkdtempSync(join(tmpdir(), 'thingtime-ignore-'));
 try {
  assert.equal(spawnSync(git, ['init', '-q', directory]).status, 0);
  for (const { rules, paths } of cases) {
   writeFileSync(join(directory, '.gitignore'), rules);
   const policy = createSyncIgnorePolicy(rules);
   for (const { path, kind, ignored } of paths) {
    const target = path; mkdirSync(dirname(join(directory, path)), { recursive: true });
    if (kind === 'folder') mkdirSync(join(directory, path), { recursive: true }); else writeFileSync(join(directory, path), '');
    const result = spawnSync(git, ['-c', 'core.ignorecase=false', '-c', 'core.precomposeunicode=false', 'check-ignore', '--no-index', '-q', '--', target], { cwd: directory, env: { ...process.env, LC_ALL: 'C' } });
    assert.ok(result.status === 0 || result.status === 1, result.stderr.toString());
    assert.equal(result.status === 0, ignored, JSON.stringify({ rules, path, kind, stored: true }));
    assert.equal(policy.ignored(path, kind as 'file' | 'folder'), result.status === 0, JSON.stringify({ rules, path, kind }));
    rmSync(join(directory, path.split('/')[0]), { recursive: true, force: true });
   }
  }
 } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('rules keep escaped spaces and lines, bound input, explain ignored parents, and exact exclusions win', () => {
 assert.equal(canonicalIgnoreRules('a\r\nb\n'), 'a\nb\n');
 assert.equal(canonicalIgnoreRules('x'.repeat(16385)).length, 16385);
 for (const bad of [null, '\0']) assert.throws(() => canonicalIgnoreRules(bad));
 const p = createSyncIgnorePolicy('dir/\n!dir/keep\n!Private', ['Private']);
 assert.deepEqual(p.explain('dir/keep'), { ignored: true, source: 'rule', path: 'dir/keep', rule: 'dir/', line: 1, parent: 'dir' });
 assert.equal(p.explain('private/child').source, 'exact');
 const defaults = createSyncIgnorePolicy(DEFAULT_SYNC_IGNORE_RULES);
 for (const path of ['code/node_modules/pkg/x', 'python/.venv/lib/x', '.cargo/registry/src/x']) assert.equal(defaults.ignored(path), true);
 for (const path of ['vendor/x', 'build/x', 'dist/x', 'target/x', 'src/x']) assert.equal(defaults.ignored(path), false);
});
test('alternating star patterns use bounded NFA states rather than exponential backtracking', () => {
 const policy = createSyncIgnorePolicy('*a'.repeat(90) + 'z');
 assert.equal(policy.ignored('a'.repeat(200) + 'q'), false);
 assert.equal(policy.ignored('a'.repeat(200) + 'z'), true);
});

test('dependency defaults preserve Git history, worktree metadata and pointer files', () => {
 const policy = createSyncIgnorePolicy(DEFAULT_SYNC_IGNORE_RULES, ['Library', 'Applications', '.Trash']);
 for (const path of ['things/code/project/.git', 'things/code/project/.git/objects/pack/saved.pack',
  'things/code/project/.git/worktrees/feature/HEAD', 'things/code/project/.git/worktrees/feature/index',
  'things/code/project/.git/worktrees/feature/gitdir', 'things/code/project/.git/refs/stash',
  'things/code/project/.git/logs/HEAD', 'things/code/feature/.git']) {
  assert.equal(policy.ignored(path, 'file'), false, path);
 }
 assert.equal(policy.ignored('things/code/project/.git', 'folder'), false);
 assert.equal(policy.ignored('things/code/project/node_modules/dependency/index.js'), true);
});
