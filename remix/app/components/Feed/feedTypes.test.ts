import assert from 'node:assert/strict';
import test from 'node:test';

import { appendPostsDeduped, FEED_SCOPE_CACHE_KEY, feedScopeOf, isCommentSort, isPendingComment, mergeCommentPage, sortCommentPage, windowCommentPage } from './feedTypes';
import type { PublicPost } from './feedTypes';

// Minimal PublicPost stand-in: appendPostsDeduped only ever reads `id`, so the
// rest of the projection is filled from one shared skeleton and the tests stay
// readable when the post shape grows.
const post = (id: string): PublicPost =>
  ({
    id,
    type: 'text',
    thingtime: ['post'],
    acl: [],
    author: null,
    visibility: 'public',
    text: id,
    images: [],
    attachments: [],
    mediaLayout: null,
    listing: null,
    thing: null,
    tags: [],
    reactionCounts: {},
    viewerReactions: [],
    commentCount: 0,
    comments: [],
    shareCount: 0,
    isShare: false,
    shareOf: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }) satisfies PublicPost;

const ids = (posts: PublicPost[]) => posts.map((entry) => entry.id);

test('appends a page whose ids are all new, preserving page order', () => {
  const prev = [post('a'), post('b')];
  assert.deepEqual(ids(appendPostsDeduped(prev, [post('c'), post('d')])), ['a', 'b', 'c', 'd']);
});

test('drops page entries already rendered — ranked re-scoring re-serves ids', () => {
  // The TODO 11 regression: ranked pagination re-scores a moving candidate
  // window, so page 2 can repeat a post from page 1. Duplicate ids collide as
  // React keys in PostList.
  const prev = [post('a'), post('b')];
  const next = appendPostsDeduped(prev, [post('b'), post('c'), post('a'), post('d')]);
  assert.deepEqual(ids(next), ['a', 'b', 'c', 'd']);
  assert.equal(new Set(ids(next)).size, ids(next).length, 'rendered ids stay unique');
});

test('dedupes duplicates that arrive within a single page', () => {
  assert.deepEqual(ids(appendPostsDeduped([post('a')], [post('b'), post('b')])), ['a', 'b']);
});

test('keeps the first-rendered instance rather than the re-served one', () => {
  const original = post('a');
  const reserved = { ...post('a'), text: 're-scored copy' };
  const next = appendPostsDeduped([original], [reserved]);
  assert.equal(next.length, 1);
  assert.equal(next[0].text, 'a', 'the already-rendered post is not swapped out mid-scroll');
});

test('an all-duplicate page returns the SAME array reference (no wasted repaint)', () => {
  const prev = [post('a'), post('b')];
  assert.equal(appendPostsDeduped(prev, [post('a'), post('b')]), prev);
});

test('an empty page returns the same array reference', () => {
  const prev = [post('a')];
  assert.equal(appendPostsDeduped(prev, []), prev);
});

test('appending onto an empty list yields the page itself', () => {
  assert.deepEqual(ids(appendPostsDeduped([], [post('a'), post('b')])), ['a', 'b']);
});

// The reset/first-page callers pass an empty `prev` rather than assigning the
// raw page, so a first page that repeats an id is still collapsed and an empty
// first page still clears the list.
test('a reset page is deduped, not trusted verbatim', () => {
  assert.deepEqual(ids(appendPostsDeduped([], [post('a'), post('b'), post('a')])), ['a', 'b']);
});

test('a reset with an empty page clears the list', () => {
  assert.deepEqual(appendPostsDeduped([], []), []);
});

// S6 — the "🪐 My subspaces" chip's persisted choice: only a logged-in viewer
// can be scoped (a guest has nothing to scope to), anything else reads all
test('feedScopeOf reads a cached subspaces scope only for a logged-in viewer', () => {
  assert.equal(FEED_SCOPE_CACHE_KEY, 'tt-feed-scope');
  assert.equal(feedScopeOf('subspaces', true), 'subspaces');
  assert.equal(feedScopeOf('subspaces', false), 'all');
  assert.equal(feedScopeOf('all', true), 'all');
  for (const junk of [null, undefined, '', 'mine', 42, { scope: 'subspaces' }]) {
    assert.equal(feedScopeOf(junk, true), 'all', JSON.stringify(junk));
  }
});

// The card's optimistic comment order must agree with the server page
// (things/updownCore.ts orderCommentPage) so the reconcile never reshuffles.
test('sortCommentPage mirrors the server comparator: top = score desc then older first, new = newest first, old = oldest first, null = untouched', () => {
  const row = (id: string, createdAt: string, score?: number) =>
    ({ id, createdAt, ...(score === undefined ? {} : { votes: { up: Math.max(score, 0), down: Math.max(-score, 0), score, viewerVote: null } }) }) as any;
  const page = [row('c1', '2026-09-01T00:00:00.000Z', 5), row('c2', '2026-09-02T00:00:00.000Z', -1), row('c3', '2026-09-03T00:00:00.000Z', 2), row('c4', '2026-09-04T00:00:00.000Z', 2), row('c5', '2026-09-05T00:00:00.000Z')];
  const ids = (rows: { id: string }[]) => rows.map((entry) => entry.id);
  assert.deepEqual(ids(sortCommentPage(page, 'top')), ['c1', 'c3', 'c4', 'c5', 'c2'], 'a comment with no votes field counts as score 0');
  assert.deepEqual(ids(sortCommentPage(page, 'new')), ['c5', 'c4', 'c3', 'c2', 'c1']);
  assert.deepEqual(ids(sortCommentPage(page, 'old')), ['c1', 'c2', 'c3', 'c4', 'c5']);
  const shuffled = [page[4], page[1], page[3], page[0], page[2]];
  assert.deepEqual(ids(sortCommentPage(shuffled, null)), ['c5', 'c2', 'c4', 'c1', 'c3'], 'null keeps the page as the server shipped it');
  assert.deepEqual(ids(sortCommentPage(shuffled, 'top')), ['c1', 'c3', 'c4', 'c5', 'c2'], 'order never depends on arrival order');
  assert.deepEqual(ids(shuffled), ['c5', 'c2', 'c4', 'c1', 'c3'], 'never mutates the input');
  assert.deepEqual(ids(sortCommentPage([row('bad', 'not-a-date', 0), row('ok', '2026-09-01T00:00:00.000Z', 0)], 'old')), ['bad', 'ok'], 'a malformed createdAt sorts as the epoch instead of throwing');
});

test('isCommentSort accepts exactly top / new / old', () => {
  for (const sort of ['top', 'new', 'old']) assert.equal(isCommentSort(sort), true, sort);
  for (const bad of ['best', 'TOP', '', null, undefined, 3]) assert.equal(isCommentSort(bad), false, String(bad));
});

test('isPendingComment recognises the optimistic provisional id only', () => {
  assert.equal(isPendingComment({ id: 'pending-ab12' }), true);
  assert.equal(isPendingComment({ id: 'c1' }), false);
  assert.equal(isPendingComment({ id: 'notpending-1' }), false);
});

// S7 review: under Top / Old a comment the viewer just posted (score 0, the
// newest) sorts below the window — it must still paint, pinned after it.
test('windowCommentPage: the default page reveals the LAST n, a sort the FIRST n, and pins the viewer’s own fresh comments that fall below the window', () => {
  const rows = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((id) => ({ id }));
  const ids = (list: { id: string }[]) => list.map((entry) => entry.id);
  assert.deepEqual(ids(windowCommentPage(rows, null, 5)), ['c3', 'c4', 'c5', 'c6', 'c7'], 'default: newest at the bottom, revealed upwards');
  assert.deepEqual(ids(windowCommentPage(rows, null, 5, ['c1'])), ['c3', 'c4', 'c5', 'c6', 'c7'], 'the default page never pins (a fresh comment is always the last one)');
  assert.deepEqual(ids(windowCommentPage(rows, 'old', 5)), ['c1', 'c2', 'c3', 'c4', 'c5'], 'a sort reads top-down');
  assert.deepEqual(ids(windowCommentPage(rows, 'old', 5, ['c7'])), ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], 'a fresh comment below the window is appended after it');
  assert.deepEqual(ids(windowCommentPage(rows, 'top', 5, ['pending-x', 'c6', 'c7'])), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 'several pinned rows keep the level’s order; unknown ids are ignored');
  assert.deepEqual(ids(windowCommentPage(rows, 'top', 5, ['c2'])), ['c1', 'c2', 'c3', 'c4', 'c5'], 'a fresh comment already inside the window is not duplicated');
  assert.deepEqual(ids(windowCommentPage(rows, 'new', 10, ['c7'])), ids(rows), 'nothing to pin when the whole level is shown');
  assert.deepEqual(ids(windowCommentPage([], 'old', 5, ['c1'])), []);
});

// S7 review: a sorted page landing over the card must never drop a comment
// the viewer sent — pending (its ack still has to find the row) or saved.
test('mergeCommentPage: the page wins the order, the viewer’s pending / kept comments survive after it, and unseen counts what the page could not include', () => {
  const at = (iso: string) => new Date(iso).getTime();
  const row = (id: string, createdAt: string) => ({ id, createdAt });
  const readStartedAt = at('2026-09-06T12:00:00.000Z');
  const page = [row('c9', '2026-09-01T00:00:00.000Z'), row('c3', '2026-09-02T00:00:00.000Z')];
  const held = [
    row('c1', '2026-08-30T00:00:00.000Z'), // an older comment the sorted page left out — gives way
    row('c3', '2026-09-02T00:00:00.000Z'), // on the page — not duplicated
    row('pending-a', '2026-09-06T12:00:01.000Z'), // in flight — kept, unseen
    row('c50', '2026-09-06T12:00:02.000Z'), // acked after the read — kept, unseen
    row('c40', '2026-09-05T00:00:00.000Z') // the viewer’s, saved before the read but off the page — kept, already counted
  ];
  const merged = mergeCommentPage(page, held, ['c50', 'c40', 'c3'], readStartedAt);
  assert.deepEqual(merged.comments.map((entry) => entry.id), ['c9', 'c3', 'pending-a', 'c50', 'c40']);
  assert.equal(merged.unseen, 2, 'the pending row and the post-read save are not in the page’s count yet');
  assert.notStrictEqual(merged.comments, page, 'always a fresh array');
  const plain = mergeCommentPage(page, [row('c1', '2026-08-30T00:00:00.000Z')], [], readStartedAt);
  assert.deepEqual(plain.comments.map((entry) => entry.id), ['c9', 'c3'], 'nothing to keep → the page as read');
  assert.equal(plain.unseen, 0);
  const pendingOnly = mergeCommentPage([], [row('pending-b', '2026-09-06T11:00:00.000Z')], [], readStartedAt);
  assert.deepEqual(pendingOnly.comments.map((entry) => entry.id), ['pending-b'], 'a pending row is kept whatever its timestamp');
  assert.equal(pendingOnly.unseen, 1);
});
