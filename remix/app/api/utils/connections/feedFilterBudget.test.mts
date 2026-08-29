import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';

// applyFeedFilters classifies a page of feed posts against the viewer's AI
// filters, INLINE in the /api/v1/connections/feed response. The cost of that
// is filters × ceil(posts / CLASSIFY_BATCH) provider completions, and both
// factors are caller-chosen within their documented caps (20 filters, a
// 50-post page) — so without a shared per-request budget one ordinary feed
// read fans out to ~100 completions on a bucket that allows 120 reads/min.
// These tests pin the two properties that keep that bounded:
//
//   1. the AI budget is shared by ALL filters on the request, not per filter
//      (moving the counter into classifyFilter would silently restore an
//      n×budget fan-out and nothing else would notice);
//   2. work the budget could not pay for is NOT cached, so the next read
//      retries it for real and the page converges instead of degrading
//      permanently to the keyword heuristic.
//
// Module mocks (the test:lopu-streaming precedent) stand in for the provider
// and both collections, so this runs with no network and no Mongo.

const CLASSIFY_BATCH = 12; // mirrors filters.ts
const CLASSIFY_MAX_AI_CALLS = 12; // mirrors filters.ts

type Doc = Record<string, any>;

// Minimal in-memory stand-ins for the two collection handles filters.ts uses:
// `find(...).sort(...).toArray()` and `bulkWrite([$setOnInsert upserts])`.
const makeCollection = (docs: Doc[]) => ({
  docs,
  find(query: Doc = {}) {
    const matches = docs.filter((doc) =>
      Object.entries(query).every(([field, condition]) => {
        const value = doc[field];
        if (condition && typeof condition === 'object' && Array.isArray((condition as any).$in)) {
          return (condition as any).$in.includes(value);
        }
        // filters.ts matches `thingtime: '<kind>'` against the array field
        return Array.isArray(value) ? value.includes(condition) : value === condition;
      })
    );
    const cursor = { sort: () => cursor, toArray: async () => matches };
    return cursor;
  },
  async bulkWrite(operations: Doc[]) {
    for (const operation of operations) {
      const { filter, update } = operation.updateOne;
      // $setOnInsert only — an existing verdict is left exactly as it was
      if (docs.some((doc) => doc.shareId === filter.shareId)) continue;
      docs.push({ ...update.$setOnInsert });
    }
  }
});

// The mocks are installed once, before filters.ts is imported, and read these
// mutable handles — so each test swaps in a fresh world without needing a
// fresh module instance.
let home = makeCollection([]);
let things = makeCollection([]);
let aiCalls = 0;

mock.module(new URL('../lopu/musing.ts', import.meta.url).href, {
  namedExports: {
    hasLopuAiProviderConfigured: () => true,
    // Every mocked completion marks the whole batch matched, so a post
    // carrying a match is proof an AI call paid for it.
    generateAiCompletion: async ({ user }: { user: string }) => {
      aiCalls += 1;
      const ids = [...user.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]);
      return { text: JSON.stringify(ids.map((id) => ({ id, matched: true, reason: 'test' }))), source: 'claude' as const };
    }
  }
});
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getThingsCollection: async () => things,
    getHomeThingsCollection: async () => home
  }
});

const { applyFeedFilters } = await import('./filters.ts');

after(() => mock.restoreAll());

const filterDocs = (count: number): Doc[] =>
  Array.from({ length: count }, (_, index) => ({
    shareId: `ext-filter-${index}`,
    thingtime: ['feed-filter'],
    ownerId: 'user-1',
    // "zebra" shares no token with the post text below, so the keyword
    // heuristic never matches — every match in these tests is AI-sourced,
    // which is exactly what makes the budget observable.
    crystal: { name: `filter ${index}`, prompt: `zebra ${index}`, action: 'warn', enabled: true },
    createdAt: new Date(1_700_000_000_000 + index)
  }));

const postsFor = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `ext-post-${index}`, text: `widget update number ${index}` })) as any[];

const world = (filterCount: number) => {
  home = makeCollection(filterDocs(filterCount));
  things = makeCollection([]);
  aiCalls = 0;
};

beforeEach(() => world(0));

test('the AI budget is shared across every filter on the request', async () => {
  // 5 filters × 36 posts = 3 batches each = 15 batches of work, over the cap.
  world(5);
  await applyFeedFilters('user-1', postsFor(3 * CLASSIFY_BATCH));

  assert.equal(
    aiCalls,
    CLASSIFY_MAX_AI_CALLS,
    'the request must spend exactly its budget — a per-filter counter would have spent all 15'
  );
});

test('an unaffordable page converges across reads instead of degrading permanently', async () => {
  const filterCount = 5;
  world(filterCount);
  const posts = postsFor(3 * CLASSIFY_BATCH);
  const totalPairs = filterCount * posts.length;

  const first = await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, CLASSIFY_MAX_AI_CALLS, 'first read spends the whole budget');
  assert.equal(
    things.docs.length,
    CLASSIFY_MAX_AI_CALLS * CLASSIFY_BATCH,
    'ONLY AI-classified verdicts are cached — heuristic fallbacks must not poison the cache'
  );
  assert.ok(first.matchesByPostId.size > 0, 'the first read still returns the matches it did pay for');

  // Second read: the cached verdicts cost nothing, so the budget buys the
  // remainder. 15 batches of work total → 12 paid for, 3 left.
  const second = await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, CLASSIFY_MAX_AI_CALLS + 3, 'the second read pays only for what the first could not');
  assert.equal(things.docs.length, totalPairs, 'every (filter, post) pair is now cached');
  assert.equal(second.matchesByPostId.size, posts.length, 'every post is classified once the page has converged');

  // Third read: fully cached, so no provider spend at all.
  await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, CLASSIFY_MAX_AI_CALLS + 3, 'a fully cached page costs no AI calls');
});

test('a page that fits the budget is classified in one read', async () => {
  world(2);
  const posts = postsFor(CLASSIFY_BATCH);
  const result = await applyFeedFilters('user-1', posts);

  assert.equal(aiCalls, 2, 'two filters × one batch — well under the cap, so nothing is deferred');
  assert.equal(result.matchesByPostId.size, posts.length, 'the ordinary case is unchanged by the budget');
});
