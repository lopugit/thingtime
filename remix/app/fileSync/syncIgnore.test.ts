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

test('cached folder explanations preserve negation, ancestor barriers, case, kinds and caller isolation', () => {
 const rules = 'dir/\n!dir/\ndir/*.tmp\n!dir/keep.tmp\n**/blocked/\n!**/blocked/keep\ncache/\nParent/\n!parent/';
 const excluded = ['Private']; const policy = createSyncIgnorePolicy(rules, excluded);
 const paths: [string, 'file' | 'folder'][] = [
  ['dir', 'folder'], ['dir/plain', 'file'], ['dir/drop.tmp', 'file'], ['dir/keep.tmp', 'file'],
  ['dir/blocked', 'folder'], ['dir/blocked/keep', 'file'], ['cache', 'file'], ['cache', 'folder'], ['cache/keep', 'file'],
  ['Parent/x', 'file'], ['parent/x', 'file'], ['Private', 'folder'], ['private/child', 'file'],
  ['unicode/é/name', 'file'], ['unicode/é/name', 'file']
 ];
 for (const [path, kind] of [...paths, ...[...paths].reverse(), ...paths]) {
  const expected = createSyncIgnorePolicy(rules, ['Private']).explain(path, kind);
  const observed = policy.explain(path, kind); assert.deepEqual(observed, expected);
  observed.ignored = !observed.ignored; observed.rule = 'caller mutation';
  assert.deepEqual(policy.explain(path, kind), expected);
 }
 excluded[0] = 'Changed'; assert.equal(policy.explain('private/child').rule, 'Private');
 assert.equal(createSyncIgnorePolicy('!cache/').ignored('cache/x'), false);
});

test('bounded folder cache eviction preserves the same rule and explanation results', () => {
 const rules = '**/drop/\n!**/drop/keep\n*.tmp\n!keep.tmp', policy = createSyncIgnorePolicy(rules);
 const samples: [string, 'file' | 'folder'][] = [['saved/drop/keep', 'file'], ['saved/keep.tmp', 'file'], ['saved/plain', 'file']];
 const expected = samples.map(([path, kind]) => createSyncIgnorePolicy(rules).explain(path, kind));
 samples.forEach(([path, kind], i) => assert.deepEqual(policy.explain(path, kind), expected[i]));
 // More unique folder prefixes and UTF-8 payload than either cache budget.
 for (let i = 0; i < 3500; i++) assert.equal(policy.ignored('bulk/' + i + '-é'.repeat(110) + '/plain'), false);
 [...samples].reverse().forEach(([path, kind]) => assert.deepEqual(policy.explain(path, kind), createSyncIgnorePolicy(rules).explain(path, kind)));
});
