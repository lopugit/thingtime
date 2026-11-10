import assert from 'node:assert/strict';
import test from 'node:test';

import { appendFeedPage } from './shared';

// The connections feed appends pages that can legitimately overlap what is
// already rendered. The list keys on post id, so an un-deduped append renders
// the post twice and trips React's duplicate-key warning.

const post = (id: string) => ({ id, createdAt: '2026-01-01T00:00:00.000Z' });

test('appends a disjoint page in order', () => {
  const merged = appendFeedPage([post('a'), post('b')], [post('c'), post('d')]);
  assert.deepEqual(
    merged.map((entry) => entry.id),
    ['a', 'b', 'c', 'd']
  );
});

test('drops posts the reader already holds', () => {
  // the deepen path re-reads the boundary timestamp, so the page it returns
  // starts with the post the cursor was derived from
  const merged = appendFeedPage([post('a'), post('b')], [post('b'), post('c')]);
  assert.deepEqual(
    merged.map((entry) => entry.id),
    ['a', 'b', 'c'],
    'the boundary post must not repeat'
  );
});

test('de-dupes repeats inside a single incoming page', () => {
  const merged = appendFeedPage([post('a')], [post('b'), post('b'), post('c')]);
  assert.deepEqual(
    merged.map((entry) => entry.id),
    ['a', 'b', 'c']
  );
});

test('a fully overlapping page leaves the rendered list untouched', () => {
  const current = [post('a'), post('b')];
  const merged = appendFeedPage(current, [post('a'), post('b')]);
  assert.equal(merged, current, 'no fresh posts should not churn the list identity');
});

test('keeps the already-rendered copy rather than the incoming one', () => {
  // the rendered copy may carry optimistic reaction overlays the refetched
  // one has not caught up with, so the list only ever grows forward
  const current = [{ id: 'a', createdAt: 'x', marker: 'rendered' }];
  const merged = appendFeedPage(current, [{ id: 'a', createdAt: 'x', marker: 'refetched' }]);
  assert.deepEqual(merged, [{ id: 'a', createdAt: 'x', marker: 'rendered' }]);
});

test('handles an empty page and an empty list', () => {
  assert.deepEqual(appendFeedPage([post('a')], []).map((entry) => entry.id), ['a']);
  assert.deepEqual(appendFeedPage([], [post('a')]).map((entry) => entry.id), ['a']);
});

// The reason the overlap exists at all: the client can only mint a cursor from
// a POST id, while the server's cursors ride external-post-source ROW ids, and
// the chrono tiebreak is `shareId > cursorId` at an equal createdAt. This
// ordering fact is what makes the deepen cursor re-read (never skip) the
// boundary — pin it so a future id-prefix rename cannot silently invert it
// into skipped posts, which no amount of de-duplication would surface.
test('membership row ids sort after post ids, so the deepen cursor re-reads rather than skips', () => {
  const lowestRowId = `ext-source-${'0'.repeat(48)}`;
  const highestPostId = `ext-post-${'f'.repeat(48)}`;
  assert.ok(lowestRowId > highestPostId, 'ext-source-… must sort after every ext-post-… for the cursor to be safe');
});
