import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectRemoteThings,
  contentKey,
  modeForProfile,
  modeForThing,
  orderOps,
  putBodyFor,
  syncBudgetSpent
} from './sync';
import type { NormalizedThing, SyncOp } from './sync';
import type { RemoteThing } from './remote';
import type { DeploymentLinkPathRule, DeploymentSyncMode, SavedDeploymentLink } from '../auth/users';

// The sync engine decides what crosses between two deployments. Three of its
// rules are load bearing and none of them are obvious from a call site:
//   • modeForThing — a per-path 'off' rule is the ONLY way a user keeps a kind
//     of thing off another deployment, so a precedence slip leaks data
//   • contentKey  — identical content must compare equal REGARDLESS of
//     timestamps, or every two-way pass bounces the same thing back and forth
//   • orderOps    — a comment must land after its post, and nothing may be
//     silently dropped when a target can't be resolved
// These are pure functions, so they are cheap to pin down exactly.

const link = (over: Partial<SavedDeploymentLink> = {}): SavedDeploymentLink => ({
  id: 'link-1',
  name: 'other deployment',
  baseUrl: 'https://other.example.com',
  token: 'unused-in-pure-tests',
  tokenExpiresAt: null,
  remoteUserId: 'remote-user',
  remoteUsername: 'remote',
  syncMode: 'two-way',
  pathRules: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSyncAt: null,
  lastSyncSummary: null,
  ...over
});

const rules = (...entries: [string, DeploymentSyncMode][]): DeploymentLinkPathRule[] =>
  entries.map(([path, mode]) => ({ path, mode }));

const thing = (over: Partial<NormalizedThing> = {}): NormalizedThing => ({
  id: 'thing-1',
  thingtime: ['post'],
  crystal: { body: 'hello' },
  extended: null,
  acl: ['tt:all'],
  targetId: null,
  tags: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

const op = (over: Partial<SyncOp> & { source: NormalizedThing }): SyncOp => ({
  direction: 'push',
  conflict: false,
  ...over
});

// ── modeForThing: per-path precedence ───────────────────────────────────────

test('a things/<kind> rule outranks the things catch-all', () => {
  const l = link({ syncMode: 'two-way', pathRules: rules(['things', 'push'], ['things/post', 'pull']) });
  // rule ORDER in the list must not decide it — specificity does
  assert.equal(modeForThing(l, ['post']), 'pull');
  assert.equal(modeForThing(l, ['comment']), 'push');
});

test('the first matching kind rule wins when a thing carries several kinds', () => {
  const l = link({ pathRules: rules(['things/comment', 'pull'], ['things/post', 'off']) });
  // documented as first-match-wins over the rule list, not over the thing's ids
  assert.equal(modeForThing(l, ['post', 'comment']), 'pull');
});

test('an off rule genuinely suppresses exactly its kind', () => {
  // the privacy-relevant case: 'things/data: off' must keep data things home
  // while everything else still syncs
  const l = link({ syncMode: 'two-way', pathRules: rules(['things/data', 'off']) });
  assert.equal(modeForThing(l, ['data']), 'off');
  assert.equal(modeForThing(l, ['post']), 'two-way');
});

test('with no matching rule the link-wide mode applies', () => {
  assert.equal(modeForThing(link({ syncMode: 'push', pathRules: [] }), ['post']), 'push');
  // a rule for a kind this thing does not carry must not match it
  const l = link({ syncMode: 'push', pathRules: rules(['things/reaction', 'off']) });
  assert.equal(modeForThing(l, ['post']), 'push');
});

test('a profile rule overrides the link mode, and profile ignores things rules', () => {
  assert.equal(modeForProfile(link({ syncMode: 'push', pathRules: rules(['profile', 'off']) })), 'off');
  assert.equal(modeForProfile(link({ syncMode: 'pull', pathRules: rules(['things', 'off']) })), 'pull');
});

// ── contentKey: the ping-pong guard ─────────────────────────────────────────

test('identical content compares equal despite different timestamps and ids', () => {
  // THE anti-ping-pong invariant: a copy lands with a fresh updatedAt on the
  // destination, so if updatedAt leaked into this key every two-way pass would
  // push the same thing straight back
  const local = thing({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' });
  const remote = thing({ id: 'b', updatedAt: '2026-06-30T12:00:00.000Z' });
  assert.equal(contentKey(local), contentKey(remote));
});

test('content comparison does not depend on key or list order', () => {
  const a = thing({ thingtime: ['post', 'data'], tags: ['x', 'y'], crystal: { a: 1, b: 2 } });
  const b = thing({ thingtime: ['data', 'post'], tags: ['y', 'x'], crystal: { b: 2, a: 1 } });
  assert.equal(contentKey(a), contentKey(b));
});

test('a real content difference is detected', () => {
  const base = thing();
  assert.notEqual(contentKey(base), contentKey(thing({ crystal: { body: 'changed' } })));
  assert.notEqual(contentKey(base), contentKey(thing({ tags: ['new'] })));
  assert.notEqual(contentKey(base), contentKey(thing({ targetId: 'post-1' })));
  assert.notEqual(contentKey(base), contentKey(thing({ extended: { more: true } })));
});

test('audience (acl) is NOT part of the content key', () => {
  // Deliberately pinned: putBodyFor SENDS acl, so a thing's audience is carried
  // on the first copy, but an acl-only change afterwards compares equal here and
  // therefore never propagates. Flip this test the day the comparison changes —
  // it is the difference between "audience syncs" and "audience is set once".
  assert.equal(contentKey(thing({ acl: ['tt:all'] })), contentKey(thing({ acl: ['tt:owner'] })));
});

// ── putBodyFor: what actually goes over the wire ────────────────────────────

test('the write body carries both id spellings', () => {
  // the remote HTTP route maps id → shareId; the local upsertThing util takes
  // shareId directly, so one body has to satisfy both
  const body = putBodyFor(thing({ id: 'share-1' }));
  assert.equal(body.id, 'share-1');
  assert.equal(body.shareId, 'share-1');
});

test('an explicit audience is sent, an inherited one is omitted', () => {
  assert.deepEqual(putBodyFor(thing({ acl: ['tt:all'] })).acl, ['tt:all']);
  // target-attached things inherit their target's audience; both createThing
  // and updateThing reject an explicit acl for them
  assert.ok(!('acl' in putBodyFor(thing({ acl: ['tt:inherit'], targetId: 'post-1' }))));
  assert.ok(!('acl' in putBodyFor(thing({ acl: [] }))));
});

test('targetId is sent only when the thing is attached', () => {
  assert.equal(putBodyFor(thing({ targetId: 'post-1' })).targetId, 'post-1');
  assert.ok(!('targetId' in putBodyFor(thing({ targetId: null }))));
});

// ── orderOps: dependency ordering ───────────────────────────────────────────

const never = () => false;

test('a post lands before its comment, and the comment before its reaction', () => {
  const post = op({ source: thing({ id: 'post', targetId: null }) });
  const comment = op({ source: thing({ id: 'comment', targetId: 'post' }) });
  const reaction = op({ source: thing({ id: 'reaction', targetId: 'comment' }) });
  // deliberately fed in the WRONG order — the ordering is what must fix it
  const ordered = orderOps([reaction, comment, post], never);
  assert.deepEqual(ordered.map((entry) => entry.source.id), ['post', 'comment', 'reaction']);
});

test('schema things are written before the data things that may cite them', () => {
  const data = op({ source: thing({ id: 'data-1', thingtime: ['data'] }) });
  const schema = op({ source: thing({ id: 'schema-1', thingtime: ['schema'] }) });
  const ordered = orderOps([data, schema], never);
  assert.deepEqual(ordered.map((entry) => entry.source.id), ['schema-1', 'data-1']);
});

test('an attached thing is emitted when its target already exists on the destination', () => {
  const comment = op({ source: thing({ id: 'comment', targetId: 'post-elsewhere' }) });
  // the target is not in this run's ops at all — it is already over there
  const ordered = orderOps([comment], (direction, id) => direction === 'push' && id === 'post-elsewhere');
  assert.deepEqual(ordered.map((entry) => entry.source.id), ['comment']);
});

test('destination lookups are direction-aware', () => {
  // a target present on the PULL side must not satisfy a PUSH op
  const comment = op({ direction: 'push', source: thing({ id: 'comment', targetId: 'post-x' }) });
  const ordered = orderOps([comment], (direction, id) => direction === 'pull' && id === 'post-x');
  // still emitted (see below), but as an unresolved leftover rather than a hit
  assert.deepEqual(ordered.map((entry) => entry.source.id), ['comment']);
});

test('an unresolvable target is still emitted, never silently dropped', () => {
  // its target may simply be beyond the scan cap — the destination decides and
  // a 404 is reported, which is strictly better than losing the write
  const orphan = op({ source: thing({ id: 'orphan', targetId: 'missing' }) });
  const post = op({ source: thing({ id: 'post', targetId: null }) });
  const ordered = orderOps([orphan, post], never);
  assert.equal(ordered.length, 2);
  assert.deepEqual(ordered.map((entry) => entry.source.id), ['post', 'orphan']);
});

// ── collectRemoteThings: the pager runs on a cursor the remote controls ─────

const remoteThing = (id: string): RemoteThing => ({
  id,
  thingtime: ['post'],
  targetId: null,
  crystal: { body: id },
  extended: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
});

// A stub pager that refuses to run away: if the loop under test ever stops
// terminating, this throws on call `budget + 1` instead of hanging the suite.
const pager = (
  answer: (call: number) => { things: RemoteThing[]; nextCursor: string | null },
  budget = 64
) => {
  const calls: (string | null | undefined)[] = [];
  const lister = (async (_baseUrl: string, _token: string, query: { cursor?: string | null }) => {
    calls.push(query.cursor);
    if (calls.length > budget) throw new Error(`collectRemoteThings made more than ${budget} remote calls`);
    return answer(calls.length);
  }) as unknown as Parameters<typeof collectRemoteThings>[1];
  return { lister, calls };
};

test('a remote that answers empty pages with a cursor cannot spin the scan', () => {
  // Regression: the only bounds used to be "1000 things collected" or "no
  // cursor". A remote answering { things: [], nextCursor } satisfies neither, so
  // the pager looped forever — one outbound request per turn — until the
  // function timed out. The linked deployment is arbitrary user-supplied
  // infrastructure, so this has to hold against a hostile answer, not just a
  // buggy one.
  const { lister, calls } = pager(() => ({ things: [], nextCursor: 'always-more' }));
  return collectRemoteThings(link(), lister).then((result) => {
    assert.ok(!('ok' in result && result.ok === false), 'expected a scan result, not a failure');
    const scan = result as { things: NormalizedThing[]; truncated: boolean };
    assert.deepEqual(scan.things, []);
    // a page that collected nothing ends the scan, and says so
    assert.equal(scan.truncated, true);
    assert.equal(calls.length, 1);
  });
});

test('a well-behaved remote is paged to completion', async () => {
  const { lister, calls } = pager((call) =>
    call === 1
      ? { things: [remoteThing('a'), remoteThing('b')], nextCursor: 'page-2' }
      : { things: [remoteThing('c')], nextCursor: null }
  );
  const result = await collectRemoteThings(link(), lister);
  const scan = result as { things: NormalizedThing[]; truncated: boolean };
  assert.deepEqual(scan.things.map((entry) => entry.id), ['a', 'b', 'c']);
  assert.equal(scan.truncated, false);
  // the second call must carry the cursor the first page handed back
  assert.deepEqual(calls, [null, 'page-2']);
});

test('an endless remote is still bounded by the scan cap', async () => {
  // things DO arrive here, so the progress guard never fires — the
  // MAX_SYNC_THINGS bound is what has to stop it
  let issued = 0;
  const { lister } = pager(
    () => ({ things: Array.from({ length: 50 }, () => remoteThing(`t-${issued++}`)), nextCursor: 'more' }),
    64
  );
  const result = await collectRemoteThings(link(), lister);
  const scan = result as { things: NormalizedThing[]; truncated: boolean };
  assert.equal(scan.things.length, 1000);
  assert.equal(scan.truncated, true);
});

test('a failing remote page aborts the scan', async () => {
  const { lister } = pager(() => ({ ok: false, status: 502, error: 'nope' }) as any);
  const result = await collectRemoteThings(link(), lister);
  assert.equal((result as any).ok, false);
  assert.equal((result as any).status, 502);
});

// ── syncBudgetSpent: the wall-clock fence on a pass ─────────────────────────

test('a pass under its time budget keeps scheduling ops', () => {
  assert.equal(syncBudgetSpent(5, 1_000, 45_000), false);
  // exhausting the budget is what stops it, not merely approaching it
  assert.equal(syncBudgetSpent(5, 44_999, 45_000), false);
});

test('a pass over its time budget stops scheduling ops', () => {
  // MAX_SYNC_OPS_PER_RUN bounds how many remote calls a pass makes, not how
  // long they take: 40 ops × a 15s remoteFetch timeout outlives any serverless
  // function limit, and a killed pass loses the report for writes that already
  // landed. The leftovers are reported as `remaining` and resume next pass.
  assert.equal(syncBudgetSpent(1, 45_000, 45_000), true);
  assert.equal(syncBudgetSpent(40, 600_000, 45_000), true);
});

test('every pass settles at least one op, however long the scans took', () => {
  // THE anti-livelock invariant. The scans run before the op loop and can eat
  // the whole budget on their own; a pure elapsed-time check would then return
  // "0 done, N remaining" on every re-run and never make progress. Nothing
  // settled yet ⇒ the fence cannot fire, whatever the clock says.
  assert.equal(syncBudgetSpent(0, 45_000, 45_000), false);
  assert.equal(syncBudgetSpent(0, 10_000_000, 45_000), false);
});

test('ordering preserves every op exactly once', () => {
  const ops = [
    op({ source: thing({ id: 'a', targetId: null }) }),
    op({ source: thing({ id: 'b', targetId: 'a' }) }),
    op({ direction: 'pull', source: thing({ id: 'c', targetId: null }) }),
    op({ source: thing({ id: 'd', targetId: 'unknown' }) })
  ];
  const ordered = orderOps(ops, never);
  assert.equal(ordered.length, ops.length);
  assert.deepEqual([...ordered.map((entry) => entry.source.id)].sort(), ['a', 'b', 'c', 'd']);
});
