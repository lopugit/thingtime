import assert from 'node:assert/strict';
import test from 'node:test';

import { appendPostsDeduped } from './feedTypes';
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
