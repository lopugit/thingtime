import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { eligible, redundant, approved, tested, settle, selectPulls } from './lopu-pr-lifecycle.mjs';
const repo = 'lopugit/thingtime';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const pull = () => ({ number: 42, state: 'open', draft: false, labels: [], updated_at: 'now',
  head: { ref: 'promote/pr-41-test--to-main', sha: head, repo: { full_name: repo } },
  base: { ref: 'main', sha: base, repo: { full_name: repo } },
  body: '<!-- promotion-of: 41 -->', changed_files: 1, mergeable: true, mergeable_state: 'clean' });
const review = () => ({ id: 1, user: { login: 'github-actions[bot]' }, state: 'APPROVED', commit_id: head,
  body: `<!-- thingtime-lopu-merge-ready:v1 head=${head} base=${base} -->` });
const checks = () => ['Build + typecheck ratchet + unit tests', 'API suite (headless /tests runner)', 'Analyze (actions)', 'Analyze (javascript-typescript)']
  .map((name, i) => ({ id: i + 1, app: { id: 1, slug: 'github-actions' }, name, status: 'completed', conclusion: 'success' }));

test('manual selectors never settle unrelated PRs; exact PR takes precedence', () => {
  const pulls = [pull(), { ...pull(), number: 43, base: { ...pull().base, ref: 'develop' } }];
  assert.deepEqual(selectPulls(pulls, '42', 'develop').map(p => p.number), [42]);
  assert.deepEqual(selectPulls(pulls, '', 'develop').map(p => p.number), [43]);
  assert.deepEqual(selectPulls(pulls, '', 'missing'), []);
  assert.deepEqual(selectPulls(pulls), pulls);
  assert.throws(() => selectPulls(pulls, 'invalid'));
});

test('only same-repository non-draft unpaused feature heads qualify', () => {
  assert.ok(eligible(pull(), repo));
  for (const mutate of [p => p.draft = true, p => p.state = 'closed', p => p.head.ref = 'main',
    p => p.head.repo.full_name = 'other/fork', p => p.base.ref = 'foreign', p => p.head.sha = '',
    p => p.labels.push({ name: 'no-ai-merge' }), p => p.labels.push({ name: 'ai-merge-paused' })]) {
    const p = pull(); mutate(p); assert.equal(eligible(p, repo), false);
  }
});
test('redundancy requires complete graph-only managed diffs including rename sources', () => {
  const p = pull(); const files = [{ filename: 'graphify-out/snapshots/v1/test.json' }];
  assert.ok(redundant(p, files));
  assert.equal(redundant({ ...p, changed_files: 2 }, files), false);
  assert.equal(redundant(p, []), false);
  assert.equal(redundant({ ...p, body: '' }, files), false);
  assert.equal(redundant(p, [{ filename: 'graphify-out/x', previous_filename: 'src/security.ts' }]), false);
  assert.equal(redundant(p, [{ filename: 'src/security.ts' }]), false);
  assert.equal(redundant({ ...p, head: { ...p.head, ref: 'codex/graph-maintenance' } }, files), false);
  assert.ok(redundant({ ...p, head: { ...p.head, ref: 'lopu/feature-stack-a' }, body: 'Feature Stack id: a' }, files));
});
test('approval is exact-head/base, bot-owned, latest, and respects requested changes', () => {
  assert.ok(approved(pull(), [review()]));
  for (const r of [{ ...review(), commit_id: base }, { ...review(), body: '' },
    { ...review(), user: { login: 'outsider' } }, { ...review(), state: 'DISMISSED' }]) assert.equal(approved(pull(), [r]), false);
  const p = pull(); p.base.sha = 'c'.repeat(40); assert.equal(approved(p, [review()]), false);
  assert.equal(approved(pull(), [review(), { ...review(), id: 2, state: 'CHANGES_REQUESTED', user: { login: 'human' } }]), false);
  assert.equal(approved(pull(), [review(), { ...review(), id: 2, state: 'DISMISSED' }]), false);
});
test('missing, skipped-only, failed, cancelled, pending, spoofed and newer checks block merge', () => {
  assert.ok(tested(checks(), [], 'main'));
  assert.equal(tested([], [], 'main'), false);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral']) {
    const cs = checks(); cs[0].conclusion = conclusion; assert.equal(tested(cs, [], 'main'), false);
  }
  const pending = checks(); pending[0].status = 'queued'; assert.equal(tested(pending, [], 'main'), false);
  assert.equal(tested([...checks(), { ...checks()[0], id: 100, conclusion: 'failure' }], [], 'main'), false);
  assert.equal(tested(checks().map(c => ({ ...c, app: { slug: 'spoof' } })), [], 'main'), false);
  assert.equal(tested(checks(), [{ id: 1, context: 'security', state: 'failure' }], 'main'), false);
});
function fixture({ graph = false, changeAt = Infinity, unresolved = false, failRead = false, lostWrite = false,
  mergeable = true, mergeableState = 'clean', failChecks = false, extraChecks = [] } = {}) {
  const p = pull(), writes = []; let reads = 0;
  p.mergeable = mergeable; p.mergeable_state = mergeableState;
  const api = async (path, mode, body) => {
    if (mode === 'PATCH' || mode === 'PUT') {
      writes.push({ path, mode, body }); p.state = 'closed'; p.merged = mode === 'PUT';
      if (lostWrite) throw new Error('Lost response'); return p;
    }
    if (path === 'pulls/42') {
      reads++; if (reads === changeAt) p.head.sha = 'c'.repeat(40);
      return structuredClone(p);
    }
    if (failRead) throw new Error('API unavailable');
    if (path.startsWith('git/ref/heads/')) return { object: { sha: path.endsWith('/main') ? base : head } };
    if (path.includes('/files')) return [{ filename: graph ? 'graphify-out/test' : 'src/test' }];
    if (path.includes('/reviews')) return [review()];
    if (path.includes('/check-runs')) return [...(failChecks ? checks().map(c => ({ ...c, conclusion: 'failure' })) : checks()), ...extraChecks];
    if (path.includes('/statuses')) return [];
    throw new Error(`Unexpected ${path}`);
  };
  return { api, threads: async () => unresolved, writes };
}
test('dry run never mutates; cleanup and merge use separate exact writes', async () => {
  const f = fixture(); assert.equal(await settle({ repo, number: 42, ...f }), 'merge'); assert.deepEqual(f.writes, []);
  assert.equal(await settle({ repo, number: 42, ...f, apply: true }), 'merged');
  assert.deepEqual(f.writes, [{ path: 'pulls/42/merge', mode: 'PUT', body: { sha: head, merge_method: 'merge' } }]);
  const g = fixture({ graph: true }); assert.equal(await settle({ repo, number: 42, ...g, apply: true }), 'closed-redundant');
  assert.deepEqual(g.writes[0].body, { state: 'closed' });
});
test('mergeable_state is an allowlist of clean and unstable; real blockers still stop settlement', async () => {
  // Every pair below is a combination GitHub actually reports together: it sets
  // mergeable false for 'dirty' and null for 'unknown', and 'draft' only with
  // draft true -- which eligible() already rejects, so it is covered there.
  const f = fixture({ mergeableState: 'unstable' });
  assert.equal(await settle({ repo, number: 42, ...f, apply: true }), 'merged');
  for (const [mergeable, mergeableState] of [[true, 'blocked'], [true, 'behind'], [false, 'dirty'], [null, 'unknown']]) {
    const g = fixture({ mergeable, mergeableState });
    assert.equal(await settle({ repo, number: 42, ...g, apply: true }), 'not-current');
    assert.deepEqual(g.writes, []);
  }
  // Relaxing the state guard must not weaken tested(): an unstable PR whose
  // REQUIRED checks are red still cannot merge.
  const h = fixture({ mergeableState: 'unstable', failChecks: true });
  assert.equal(await settle({ repo, number: 42, ...h, apply: true }), 'checks-not-ready');
  assert.deepEqual(h.writes, []);
});
test('accepting unstable does not make a third-party check advisory', async () => {
  // The state guard is not what gates non-required checks -- checkDisposition()
  // inside tested() does, and it does not filter by app. These are the real
  // shapes: the GHAS aggregate that timed out on PR #832, a red third-party
  // scanner, and a third-party check still running. None may merge, and a
  // green third-party check must not block. Exempting third-party apps here
  // would make GitGuardian advisory, so this is the contract to preserve.
  const ghas = { id: 90, app: { id: 57789, slug: 'github-advanced-security' }, name: 'CodeQL', status: 'completed', conclusion: 'timed_out' };
  const scanner = { id: 91, app: { id: 12, slug: 'gitguardian' }, name: 'GitGuardian Security Checks', status: 'completed', conclusion: 'failure' };
  const running = { id: 92, app: { id: 13, slug: 'vercel' }, name: 'Vercel', status: 'in_progress', conclusion: null };
  for (const extra of [ghas, scanner, running]) {
    const f = fixture({ mergeableState: 'unstable', extraChecks: [extra] });
    assert.equal(await settle({ repo, number: 42, ...f, apply: true }), 'checks-not-ready');
    assert.deepEqual(f.writes, []);
  }
  const ok = fixture({ mergeableState: 'unstable', extraChecks: [{ ...scanner, conclusion: 'success' }] });
  assert.equal(await settle({ repo, number: 42, ...ok, apply: true }), 'merged');
  // A red non-required commit status is gated the same way.
  assert.equal(tested(checks(), [{ id: 1, context: 'ci/external', state: 'failure' }], 'main'), false);
});
test('head races at either snapshot or final fence cannot mutate', async () => {
  for (const changeAt of [2, 3, 4]) {
    const f = fixture({ changeAt }); assert.equal(await settle({ repo, number: 42, ...f, apply: true }), 'changed'); assert.deepEqual(f.writes, []);
  }
});
test('unresolved threads and failed API reads fail closed', async () => {
  const f = fixture({ unresolved: true }); assert.equal(await settle({ repo, number: 42, ...f, apply: true }), 'unresolved-review'); assert.deepEqual(f.writes, []);
  const g = fixture({ failRead: true }); await assert.rejects(settle({ repo, number: 42, ...g, apply: true })); assert.deepEqual(g.writes, []);
});
test('accepted-but-lost writes reconcile without a second mutation', async () => {
  for (const graph of [false, true]) {
    const f = fixture({ graph, lostWrite: true }); assert.equal(await settle({ repo, number: 42, ...f, apply: true }), graph ? 'closed-redundant' : 'merged'); assert.equal(f.writes.length, 1);
  }
});
test('controller writer is separate from models and source checkout', () => {
  const workflow = readFileSync(new URL('../workflows/resolve-pr-conflicts.yml', import.meta.url), 'utf8');
  const block = readFileSync(new URL('../workflows/lopu-pr-lifecycle.yml', import.meta.url), 'utf8');
  assert.match(block, /ref: github-actions/u); assert.match(block, /persist-credentials: false/u);
  assert.match(block, /lopu-pr-lifecycle.mjs --apply/u); assert.doesNotMatch(block, /lopu-agent|head\.sha|checkout.*pull/iu);
  assert.match(workflow, /thingtime-lopu-merge-ready:v1/u);
  assert.ok(Buffer.byteLength(workflow) < 510000, 'controller must stay below the GitHub admission size guard');
});
