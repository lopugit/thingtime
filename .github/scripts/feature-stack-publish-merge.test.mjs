import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { publishMerge, checkDisposition } from './feature-stack-publish-merge.mjs';
import { progressSnapshot } from './feature-stack-progress.mjs';

const head = 'a'.repeat(40), baseSha = 'b'.repeat(40);
const success = { id: 1, app: { id: 1 }, name: 'build', status: 'completed', conclusion: 'success' };
function fixture(options = {}) {
  const pull = { number: 42, state: 'open', draft: false, merged: false, auto_merge: null,
    head: { sha: head, repo: { full_name: 'owner/repo' } },
    base: { ref: 'develop', sha: baseSha, repo: { full_name: 'owner/repo' } }, mergeable: true, mergeable_state: 'clean' };
  const calls = [];
  let polls = 0;
  const run = (args) => {
    calls.push(args);
    if (args[0] === 'pr') {
      assert.ok(args.includes('--match-head-commit'));
      assert.equal(args.at(-1), head);
      assert.ok(!args.includes('--admin'));
      if (args.includes('--auto')) {
        if (options.autoAccepted) { pull.auto_merge = {}; return ''; }
        if (options.lostAutoResponse) pull.auto_merge = {};
        throw Object.assign(new Error('auto request failed'), { stderr: options.autoError ?? 'Protected branch rules not configured for this branch' });
      }
      if (options.rejectMerge) throw new Error('merge rejected by policy');
      pull.merged = true;
      if (options.lostMergeResponse) throw new Error('response lost');
      return '';
    }
    const path = args.at(-1);
    if (path.includes('/pulls/')) return JSON.stringify(pull);
    assert.ok(args.includes('--paginate') && args.includes('--slurp'));
    if (path.includes('/check-runs')) { polls++; return JSON.stringify(options.checkPages ?? [{ check_runs: [success] }]); }
    if (path.includes('/statuses')) return JSON.stringify(options.statusPages ?? [[]]);
    throw new Error(`Unexpected call ${args}`);
  };
  return { pull, calls, get polls() { return polls; }, invoke: () => publishMerge({ repository: 'owner/repo', pullNumber: 42, head, base: 'develop', baseSha,
    run, attempts: 3, pause: async () => { options.onPause?.(pull); } }) };
}
test('unsupported auto-merge waits for two complete passing snapshots and confirms a normal exact-head merge', async () => {
  const f = fixture(); assert.equal(await f.invoke(), 'merged'); assert.equal(f.polls, 2);
  assert.equal(f.calls.filter((a) => a[0] === 'pr').length, 2);
});
test('protected auto-merge stays with GitHub', async () => {
  const f = fixture({ autoAccepted: true }); assert.equal(await f.invoke(), 'auto-merge'); assert.equal(f.polls, 0);
});
test('uncertain successful writes are reconciled before any retry', async () => {
  for (const option of ['lostAutoResponse', 'lostMergeResponse']) {
    const f = fixture({ [option]: true }); assert.equal(await f.invoke(), option === 'lostAutoResponse' ? 'auto-merge' : 'merged');
  }
});
test('unrelated authorization errors never trigger direct merge', async () => {
  const f = fixture({ autoError: 'Resource not accessible by integration' });
  await assert.rejects(f.invoke(), /auto request failed/); assert.equal(f.polls, 0);
});
test('failed checks on later pages prevent merging', async () => {
  const f = fixture({ checkPages: [{ check_runs: [success] }, { check_runs: [{ ...success, id: 2, name: 'security', conclusion: 'failure' }] }] });
  await assert.rejects(f.invoke(), /failed checks/); assert.equal(f.calls.filter((a) => a[0] === 'pr').length, 1);
});
test('pending or empty checks time out without merging', async () => {
  for (const checks of [[], [{ ...success, status: 'queued', conclusion: null }]]) {
    const f = fixture({ checkPages: [{ check_runs: checks }] });
    await assert.rejects(f.invoke(), /within 15 minutes/); assert.equal(f.polls, 3);
  }
});
test('head, base, and draft changes during checks fail closed', async () => {
  for (const change of [(p) => { p.head.sha = 'c'.repeat(40); }, (p) => { p.base.sha = 'c'.repeat(40); }, (p) => { p.draft = true; }]) {
    const f = fixture({ onPause: change }); await assert.rejects(f.invoke());
    assert.equal(f.calls.filter((a) => a[0] === 'pr').length, 1);
  }
});
test('normal merge rejections remain failures', async () => {
  await assert.rejects(fixture({ rejectMerge: true }).invoke(), /merge rejected/);
});
test('latest check rerun and legacy status supersede old results, app identities stay distinct', () => {
  assert.equal(checkDisposition([{ ...success, conclusion: 'failure' }, { ...success, id: 2 }], []), 'ready');
  assert.equal(checkDisposition([success, { ...success, app: { id: 2 }, conclusion: 'failure' }], []), 'failure');
  assert.equal(checkDisposition([success], [{ id: 1, context: 'ci', state: 'failure' }, { id: 2, context: 'ci', state: 'success' }]), 'ready');
  assert.equal(checkDisposition([success], [{ id: 2, context: 'ci', state: 'pending' }]), 'pending');
});
test('failed publishers terminate a stale 99 percent snapshot despite still-running gates', () => {
  const targets = ['main', 'develop', 'github-actions'];
  const jobs = targets.flatMap((target) => [
    { name: `control-plane / Merge Feature Stack into ${target}`, status: 'completed', conclusion: target === 'github-actions' ? 'success' : 'failure', steps: [{ name: 'Publish an auto-merge PR to the target', conclusion: 'failure' }] },
    { name: `control-plane / Confirm Feature Stack merged into ${target}`, status: target === 'develop' ? 'in_progress' : 'completed', conclusion: target === 'main' ? 'failure' : 'success' }
  ]);
  const result = progressSnapshot({ targets, jobs, startedAt: Date.now() });
  assert.equal(result.status, 'failure'); assert.equal(result.terminal, true);
  assert.match(result.targets[1].phase, /Publish an auto-merge PR/);
  assert.equal(result.targets[2].status, 'success');
});

test('publication uses the admitted source SHA when the live PR advances or merges', () => {
  const filter = new URL('./feature-stack-source-publication.jq', import.meta.url).pathname;
  const pull = { state: 'open', draft: false, labels: [], merged: false,
    head: { ref: 'feature', sha: 'c'.repeat(40), repo: { full_name: 'owner/repo' } },
    base: { ref: 'develop', repo: { full_name: 'owner/repo' } } };
  const accepts = (value) => execFileSync('jq', ['--arg', 'repo', 'owner/repo', '--arg', 'head', 'feature',
    '--arg', 'sha', head, '--arg', 'base', 'develop', '-f', filter], { input: JSON.stringify(value), encoding: 'utf8' }).trim() === 'true';
  assert.equal(accepts(pull), true);
  assert.equal(accepts({ ...pull, state: 'closed', merged: true }), true);
  assert.equal(accepts({ ...pull, state: 'closed' }), false);
  assert.equal(accepts({ ...pull, draft: true }), false);
  for (const name of ['no-ai-merge', 'ai-merge-paused']) assert.equal(accepts({ ...pull, labels: [{ name }] }), false);
  assert.equal(accepts({ ...pull, head: { ...pull.head, ref: 'different' } }), false);
  assert.equal(accepts({ ...pull, head: { ...pull.head, repo: { full_name: 'foreign/repo' } } }), false);
  const workflow = readFileSync(new URL('../workflows/resolve-pr-conflicts.yml', import.meta.url), 'utf8');
  const publication = workflow.split('      - name: Publish an auto-merge PR to the target')[1].split('  feature_stack_progress:')[0];
  assert.match(publication, /feature-stack-source-publication\.jq/);
  assert.doesNotMatch(publication, /\.head\.sha == \$sha/);
  assert.match(workflow.split('  feature_stack_merge:')[0], /\.head\.sha == \$sha/);
  assert.match(workflow, /feature-stack-plan\.mjs.*verify/);
});
