import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Every external-post-source row for one post must carry the SAME createdAt —
// the post's own. The connections feed pages membership rows sorted by
// (createdAt desc, shareId asc) and de-dupes only WITHIN the window it fetched
// (pageFromSourceRows), which is only sound because a post's rows share a
// createdAt and are therefore adjacent in that order.
//
// Regression: the row's createdAt was recomputed per account as
// clampPublishedAt(item.publishedAt, now) instead of denormalized from the
// post. That agrees with the post only while the item carries a usable date.
// A dateless item — an RSS entry with no pubDate/dc:date, an HN item with no
// `time`; dateOrNull makes `null` a routine shape, not an error — falls through
// to `now`. The post's createdAt is stamped $setOnInsert at the FIRST account's
// sync, so a second account reaching the same post later minted a row stamped
// with its own wall clock: one post at two arbitrarily distant sort positions,
// ordered by sync time rather than the publish time every other surface shows.
//
// Mocks both collections (the unlinkRetirement.test.mts precedent), so no Mongo.

type Doc = Record<string, any>;

const POST_CREATED_AT = new Date('2026-03-01T09:00:00.000Z');

// posts that already exist, by shareId — the read-back the row stamp consults
let existingPosts: Doc[] = [];
// every bulkWrite the code under test issued, newest last
const bulkWrites: Doc[][] = [];

const things = {
  async bulkWrite(operations: Doc[], _options?: Doc) {
    bulkWrites.push(operations);
    return { upsertedCount: operations.length, modifiedCount: 0 };
  },
  find(query: Doc, _options?: Doc) {
    const wanted: string[] = query?.shareId?.$in || [];
    return { toArray: async () => existingPosts.filter((doc) => wanted.includes(String(doc.shareId))) };
  },
  async updateMany() {
    return { modifiedCount: 0 };
  }
};

mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getThingsCollection: async () => things,
    getHomeThingsCollection: async () => ({})
  }
});

const { upsertExternalPosts, externalPostShareId } = await import('./connections.ts');

const provider: any = { id: 'rss', name: 'RSS', icon: '📰', contentVisibility: 'public' };

// an item with NO publish date — the exact shape that used to fall through to `now`
const datelessItem = (externalId: string): any => ({
  externalId,
  url: 'https://example.com/a',
  title: 'A dateless entry',
  text: 'body',
  images: [],
  author: { name: 'Someone', handle: null, avatarUrl: null, url: null },
  publishedAt: null,
  stats: null
});

// the $setOnInsert.createdAt of the single source row in the last bulkWrite
const stampedRowCreatedAt = (): Date => {
  const rows = bulkWrites[bulkWrites.length - 1];
  const setOnInsert = rows[0]?.updateOne?.update?.$setOnInsert;
  assert.ok(setOnInsert, 'expected a membership row upsert with $setOnInsert');
  return setOnInsert.createdAt;
};

test('a second account syncing a dateless post reuses the post\'s createdAt', async () => {
  const postId = externalPostShareId('rss', 'entry-1');
  bulkWrites.length = 0;

  // Account A syncs first: the post does not exist yet, so nothing to read
  // back and the clamp fallback stamps the row.
  existingPosts = [];
  await upsertExternalPosts(provider, 'ext-account-A', [datelessItem('entry-1')]);
  const firstRowCreatedAt = stampedRowCreatedAt();
  assert.ok(firstRowCreatedAt instanceof Date, 'first row should still get a Date');

  // The post now exists, stamped at A's sync. Account B reaches the SAME post
  // later — a different wall clock, and still no date on the item.
  existingPosts = [{ shareId: postId, createdAt: POST_CREATED_AT }];
  await upsertExternalPosts(provider, 'ext-account-B', [datelessItem('entry-1')]);

  assert.equal(
    stampedRowCreatedAt().getTime(),
    POST_CREATED_AT.getTime(),
    'the second account\'s row must denormalize the POST\'s createdAt, not its own sync clock'
  );
});

test('a dated post still denormalizes the post stamp, so every row agrees', async () => {
  const postId = externalPostShareId('rss', 'entry-2');
  bulkWrites.length = 0;
  existingPosts = [{ shareId: postId, createdAt: POST_CREATED_AT }];

  const dated = { ...datelessItem('entry-2'), publishedAt: new Date('2026-03-01T09:00:00.000Z') };
  await upsertExternalPosts(provider, 'ext-account-B', [dated]);

  assert.equal(stampedRowCreatedAt().getTime(), POST_CREATED_AT.getTime());
});

test('an unreadable post falls back to the clamp rather than stamping nothing', async () => {
  bulkWrites.length = 0;
  existingPosts = []; // concurrent delete between the post write and the row stamp

  const published = new Date('2026-02-02T02:02:02.000Z');
  await upsertExternalPosts(provider, 'ext-account-A', [{ ...datelessItem('entry-3'), publishedAt: published }]);

  assert.equal(stampedRowCreatedAt().getTime(), published.getTime(), 'fallback should use the item date');
});
