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
//   3. the per-request budget is NOT the whole story — a per-request cap only
//      bounds one read, and the caller chooses how many reads to make (and can
//      reap the cache by editing a filter prompt), so every AI call also spends
//      an account allowance that a new request does not reset.
//
// and the last property, which makes the cache CORRECT rather than merely
// cheap:
//
//   4. a verdict is bound to the text it was reached on. External posts are
//      current-state upserts, so one post id carries different text over time;
//      a verdict cached under the id alone would outlive the content it judged.
//
// Module mocks (the test:lopu-streaming precedent) stand in for the provider
// and both collections, so this runs with no network and no Mongo.

const CLASSIFY_BATCH = 12; // mirrors filters.ts
const CLASSIFY_MAX_AI_CALLS = 12; // mirrors filters.ts
const CLASSIFY_HOURLY_AI_CALLS = 600; // mirrors filters.ts
const CLASSIFY_CONCURRENCY = 4; // mirrors filters.ts

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
// The account allowance, as seen by filters.ts. Left effectively unbounded for
// the per-request tests so they keep measuring only the per-request budget; the
// account tests lower it deliberately.
let accountBudget = Number.MAX_SAFE_INTEGER;
let accountQuotaCalls: Array<{ name: string; userId: string; limit: number }> = [];

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
// The real one is an atomic sliding window over the shared `rateLimits`
// collection; here it is just a counter, so the tests can observe both what
// filters.ts asks for and what it does when the answer is no.
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
  namedExports: {
    enforceQuotaRateLimit: async (name: string, userId: string, limit: number) => {
      accountQuotaCalls.push({ name, userId, limit });
      const allowed = accountBudget > 0;
      if (allowed) accountBudget -= 1;
      return { allowed, limit, remaining: Math.max(0, accountBudget), resetAt: new Date(0).toISOString() };
    }
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
  accountBudget = Number.MAX_SAFE_INTEGER;
  accountQuotaCalls = [];
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

// CLASSIFY_MAX_AI_CALLS bounds ONE read. The caller picks how many reads to
// make — `connections.read` allows 120/min — and can force every one of them to
// miss the cache by editing a filter prompt (saveFeedFilter reaps that filter's
// verdicts). So the per-request cap alone multiplies out to 120 × 12 = 1,440
// completions a minute per account on the shared provider key. The account
// allowance is the bound that a new request does not reset.
test('the account allowance bounds AI spend across requests, not just within one', async () => {
  world(5);
  const posts = postsFor(3 * CLASSIFY_BATCH); // 15 batches of work, 3× the per-request cap
  accountBudget = 5;

  await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, 5, 'the account allowance cuts the read short well before the per-request cap');
  assert.deepEqual(
    accountQuotaCalls[0],
    { name: 'connections.classify', userId: 'user-1', limit: CLASSIFY_HOURLY_AI_CALLS },
    'every AI call spends the ACCOUNT allowance, keyed on the user id alone so a new session cannot reset it'
  );
  // A denial is sticky, so the 10 unaffordable batches do NOT each take their
  // own round-trip to the limiter. It cannot be exactly one extra: up to
  // CLASSIFY_CONCURRENCY filters are interleaved, so that many can already be
  // past the check when the first denial lands. Bounded by the concurrency
  // window is the honest invariant — and the one that matters at the
  // documented caps, where a page is ~100 batches rather than 15.
  const firstRead = accountQuotaCalls.length;
  assert.ok(
    firstRead <= 5 + CLASSIFY_CONCURRENCY,
    `a denial must stop the rest of the page, not be re-asked per batch (${firstRead} round-trips for 15 batches)`
  );

  // The decisive one: a second request is a fresh per-request budget, and must
  // still buy nothing. Without the account allowance this read alone would
  // spend another 10 completions (15 batches of work, 5 of them now cached).
  await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, 5, 'a new request does not hand the caller a fresh provider budget');
  assert.ok(
    accountQuotaCalls.length - firstRead <= CLASSIFY_CONCURRENCY,
    'and it re-asks once per in-flight filter before degrading again, not once per batch'
  );
});

// Exhausting the allowance is not an error — it is the same degradation as
// overflowing the per-request cap, and it must leave the page recoverable
// rather than permanently heuristic.
test('a spent allowance degrades to the heuristic without poisoning the cache', async () => {
  world(1);
  const posts = postsFor(CLASSIFY_BATCH);
  accountBudget = 0;

  const denied = await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, 0, 'no provider call is made once the account allowance is gone');
  assert.equal(denied.matchesByPostId.size, 0, 'the keyword heuristic finds nothing here, so the page simply reads unfiltered');
  assert.equal(things.docs.length, 0, 'and nothing it could not pay for is cached');

  // Window rolls: the work the previous read deferred is bought for real.
  accountBudget = 10;
  const paid = await applyFeedFilters('user-1', posts);
  assert.equal(aiCalls, 1, 'the deferred classification is retried once the allowance is back');
  assert.equal(paid.matchesByPostId.size, posts.length, 'and the viewer gets the real verdicts');
  assert.equal(things.docs.length, CLASSIFY_BATCH, 'which are now cached, so the page stays converged');
});

// A synced external post is a CURRENT-STATE upsert: connections.ts $sets
// `crystal.text` on every sync, so the same post id carries the provider's
// latest text. A verdict keyed on the id alone would be minted once from
// whatever the first sync happened to fetch and then served forever, because
// the verdict doc is written $setOnInsert. Two consequences, one of them
// adversarial: an edited post keeps a stale verdict (a `hide` rule silently
// stops applying), and a hostile feed can serve benign text on the sync that
// gets classified and its real content afterwards — evading the viewer's own
// filter without touching the classifier prompt at all.
test('an edited post is re-classified rather than served its stale verdict', async () => {
  world(1);
  const original = [{ id: 'ext-post-0', text: 'widget update number 0' }] as any[];

  await applyFeedFilters('user-1', original);
  assert.equal(aiCalls, 1, 'the first read classifies the post for real');

  // Same id, same text: this is the ordinary re-read the cache exists for, and
  // it must still cost nothing. (If the verdict key were content-derived in a
  // way that shifted per sync — a timestamp or a like count in the hash — the
  // cache would be silently dead and only this assertion would notice.)
  await applyFeedFilters('user-1', original);
  assert.equal(aiCalls, 1, 'unchanged content stays fully cached — the fix must not disable the cache');

  // Same id, the provider now serves different text.
  const edited = [{ id: 'ext-post-0', text: 'this is the content the viewer asked to hide' }] as any[];
  const result = await applyFeedFilters('user-1', edited);

  assert.equal(aiCalls, 2, 'new content is judged on its own merits, not on the verdict for text it replaced');
  assert.equal(result.matchesByPostId.get('ext-post-0')?.length, 1, 'and the fresh verdict is what the viewer is served');

  // Both verdicts coexist: the edit mints a new cache entry rather than
  // mutating the old one, so reverting to the original text is free too.
  assert.equal(things.docs.length, 2, 'each classified revision keeps its own verdict doc');
  await applyFeedFilters('user-1', original);
  assert.equal(aiCalls, 2, 'a revert re-uses the verdict already reached for that exact text');
});
