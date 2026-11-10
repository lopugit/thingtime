import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { pageFromSourceRows } from './connections.ts';

// The connections feed pages MEMBERSHIP rows (one per post × sourcing
// account), not posts, so one post reachable through two of the viewer's own
// accounts occupies two rows. pageFromSourceRows is what turns a fetched row
// window back into a page of distinct posts plus the cursor that resumes after
// it — and it is the single point where a viewer's feed history can be cut
// short, because a null cursor is indistinguishable from "you reached the end".

const ROW_MS = 1_700_000_000_000;

// `count` rows, newest first, spread over distinct minutes; `perPost` rows
// share each post id (the overlapping-connections case).
const rowsFor = (count: number, perPost = 1) =>
  Array.from({ length: count }, (_, index) => ({
    shareId: `ext-source-${index}`,
    targetId: `ext-post-${Math.floor(index / perPost)}`,
    createdAt: new Date(ROW_MS - index * 60_000)
  }));

const rowLimitFor = (limit: number) => limit * 2 + 1;

test('a full page of distinct posts stops early and cursors from the last row consumed', () => {
  const limit = 20;
  const rows = rowsFor(rowLimitFor(limit));
  const { postIds, nextCursor } = pageFromSourceRows(rows, limit, rowLimitFor(limit));
  assert.equal(postIds.length, limit, 'a page must carry exactly `limit` distinct posts');
  assert.equal(nextCursor, `${rows[limit - 1].createdAt.getTime()}_${rows[limit - 1].shareId}`, 'the cursor resumes after the last consumed row');
});

test('a short final page ends the feed', () => {
  const limit = 20;
  const rows = rowsFor(5);
  const { postIds, nextCursor } = pageFromSourceRows(rows, limit, rowLimitFor(limit));
  assert.equal(postIds.length, 5);
  assert.equal(nextCursor, null, 'a fetch that came back short is genuinely the end');
});

// The regression this file exists for. With three of the viewer's accounts
// sourcing the same posts, the whole 2× over-fetch de-dupes to well under
// `limit` distinct posts, so the loop never breaks early and consumes every
// fetched row. Reading that as "reached the end" returns a null cursor while
// older rows are still sitting behind the fetch limit — the feed just stops,
// and nothing older is ever reachable again.
test('a fully-consumed but FULL fetch still pages on (overlapping connections)', () => {
  const limit = 20;
  const rowLimit = rowLimitFor(limit); // 41
  const rows = rowsFor(rowLimit, 3); // 41 rows → 14 distinct posts
  const { postIds, nextCursor } = pageFromSourceRows(rows, limit, rowLimit);
  assert.ok(postIds.length < limit, 'the de-dupe must have shrunk this page below the limit');
  assert.equal(postIds.length, new Set(postIds).size, 'a page never repeats a post');
  assert.ok(nextCursor, 'a fetch that came back FULL has more rows behind it — the feed must not end here');
  const lastRow = rows[rows.length - 1];
  assert.equal(nextCursor, `${lastRow.createdAt.getTime()}_${lastRow.shareId}`, 'the cursor resumes after the last row consumed');
});

test('paging over an overlapping feed reaches every post instead of truncating', () => {
  const limit = 4;
  const rowLimit = rowLimitFor(limit); // 9
  const all = rowsFor(30, 3); // 30 rows → 10 distinct posts
  const walked: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    // the same (createdAt desc, shareId asc) window the query applies
    const at: string | null = cursor;
    const remaining = at ? all.slice(all.findIndex((row) => `${row.createdAt.getTime()}_${row.shareId}` === at) + 1) : all;
    const { postIds, nextCursor } = pageFromSourceRows(remaining.slice(0, rowLimit), limit, rowLimit);
    walked.push(...postIds);
    cursor = nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null, 'paging must terminate');
  assert.deepEqual(
    walked,
    Array.from({ length: 10 }, (_, index) => `ext-post-${index}`),
    'every distinct post must be reached exactly once, in order'
  );
});

test('rows with no target are skipped without stranding the cursor', () => {
  const limit = 20;
  const rows: any[] = [{ shareId: 'ext-source-x', targetId: '', createdAt: new Date(ROW_MS) }, ...rowsFor(3)];
  const { postIds, nextCursor } = pageFromSourceRows(rows, limit, rowLimitFor(limit));
  assert.deepEqual(postIds, ['ext-post-0', 'ext-post-1', 'ext-post-2']);
  assert.equal(nextCursor, null, 'a short fetch is still the end, orphan rows or not');
});

test('an unusable row date never mints a cursor the parser would reject', () => {
  const limit = 1;
  const rows: any[] = [
    { shareId: 'ext-source-0', targetId: 'ext-post-0', createdAt: new Date(0) },
    { shareId: 'ext-source-1', targetId: 'ext-post-1', createdAt: new Date(ROW_MS) },
    { shareId: 'ext-source-2', targetId: 'ext-post-2', createdAt: new Date(ROW_MS) }
  ];
  const { postIds, nextCursor } = pageFromSourceRows(rows, limit, rowLimitFor(limit));
  assert.deepEqual(postIds, ['ext-post-0']);
  assert.equal(nextCursor, null, 'a zero/invalid timestamp must end the page rather than loop it');
});
