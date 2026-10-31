import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createDiscussionCommentPager, mergeDiscussionComments, discussionCommentSearchText } from './discussionCommentPages';
import { collectionWindow } from '../Collections/collectionWindow';
import type { PostComment } from './feedTypes';

const comment = (id: string, text = id): PostComment => ({ id, text, createdAt: '2026-01-01T00:00:00.000Z', author: { username: 'writer' }, repliesLoaded: false, comments: [], richText: null, attachments: [] } as unknown as PostComment);
// Mock page labels deliberately are not valid server cursors or credentials.
const response = (comments: PostComment[], nextCursor: string | null) => ({ ok: true, comments, nextCursor });

test('older cursor pages remain searchable and reachable beyond the first 20 without duplicate rows', async () => {
  const pager = createDiscussionCommentPager();
  const calls: Array<string | undefined> = [];
  const first = Array.from({ length: 20 }, (_, i) => comment(`comment-${i}`));
  const old = Array.from({ length: 5 }, (_, i) => comment(`old-${i}`, i === 4 ? 'Older unique needle' : `Older ${i}`));
  const fetch = async (cursor?: string) => { calls.push(cursor); return cursor ? response([first[19], ...old], null) : response(first, 'test-page.first_boundary'); };
  let rows = (await pager.load(fetch))!.comments;
  assert.equal(pager.hasMore, true);
  rows = mergeDiscussionComments(rows, (await pager.load(fetch))!.comments);
  assert.equal(rows.length, 25);
  assert.deepEqual(calls, [undefined, 'test-page.first_boundary']);
  assert.equal(pager.hasMore, false);
  const third = collectionWindow(rows.length, 10, 3, 10);
  assert.deepEqual(rows.slice(third.start, third.end).map(row => row.id), old.map(row => row.id));
  assert.deepEqual(rows.filter(row => discussionCommentSearchText(row).includes('Older unique needle')).map(row => row.id), ['old-4']);
  assert.equal(await pager.load(fetch), null);
  assert.equal(calls.length, 2, 'an exhausted page chain never starts another read');
});

test('empty authorized pages advance to later matching comments', async () => {
  const pager = createDiscussionCommentPager();
  const pages = [response([], 'test-page.a_boundary'), response([], 'test-page.b_boundary'), response([comment('needle')], null)];
  const seen: Array<string | undefined> = [];
  const fetch = async (cursor?: string) => { seen.push(cursor); return pages.shift(); };
  let rows: PostComment[] = [];
  while (pager.hasMore) rows = mergeDiscussionComments(rows, (await pager.load(fetch))!.comments);
  assert.deepEqual(seen, [undefined, 'test-page.a_boundary', 'test-page.b_boundary']);
  assert.equal(rows[0]?.id, 'needle');
});

for (const cycle of [['test-page.a_boundary', 'test-page.a_boundary'], ['test-page.c_boundary', 'test-page.d_boundary', 'test-page.c_boundary']]) {
  test(`a stalled/cyclic cursor stops auto-loading: ${cycle.join(' -> ')}`, async () => {
    const pager = createDiscussionCommentPager();
    let calls = 0;
    const fetch = async () => response([], cycle[calls++]);
    for (let index = 0; index < cycle.length - 1; index++) await pager.load(fetch);
    await assert.rejects(pager.load(fetch), /did not advance/);
    assert.equal(pager.hasMore, false);
    assert.equal(await pager.load(fetch), null);
    assert.equal(calls, cycle.length);
  });
}

test('transport failures retry the same cursor without skipping an older page', async () => {
  const pager = createDiscussionCommentPager();
  await pager.load(async () => response([], 'test-page.e_boundary'));
  await assert.rejects(pager.load(async () => { throw new Error('Offline'); }), /Offline/);
  assert.equal(pager.hasMore, true);
  const page = await pager.load(async cursor => { assert.equal(cursor, 'test-page.e_boundary'); return response([comment('older')], null); });
  assert.equal(page?.comments[0].id, 'older');
});

test('concurrent requests coalesce and unmounted/account-switched discussions discard late pages', async () => {
  const pager = createDiscussionCommentPager();
  let accept!: (value: unknown) => void;
  let calls = 0;
  const fetch = () => { calls++; return new Promise(resolve => { accept = resolve; }); };
  const loading = pager.load(fetch);
  assert.equal(await pager.load(fetch), null);
  assert.equal(calls, 1);
  pager.dispose();
  accept(response([comment('private-stale')], null));
  assert.equal(await loading, null);
  assert.equal(pager.hasMore, false);
});

test('canonical rich rows use cursor replies without widening ordinary feed behavior', () => {
  const card = readFileSync(new URL('./PostCard.tsx', import.meta.url), 'utf8');
  const discussion = readFileSync(new URL('../Things/ThingComments.tsx', import.meta.url), 'utf8');
  assert.match(card, /if \(prefetchedPostRef.current \|\| commentCollection\) return/);
  assert.match(card, /cursorReplies \? null : getCachedThread/);
  assert.match(card, /if \(!cursorReplies\) setCachedThread/);
  assert.match(card, /cursorReplies \? 'View replies'/);
  assert.match(card, /target: comment.id, thingtime: 'comment', commentProjection: true, cursor, limit: 20/);
  assert.match(discussion, /get\(\{ id: thingId, key: linkKey, commentProjection: true \}/);
  assert.match(discussion, /request.controller.signal.aborted/);
  assert.match(discussion, /setPost\(null\)/);
});

test('opaque tokens retain punctuation and are forwarded unchanged without interpreting their order', async () => {
  const pager = createDiscussionCommentPager();
  const tokens = ['test-page.z_boundary', 'test-page.a_boundary'];
  await pager.load(async () => response([], tokens[0]));
  await pager.load(async cursor => { assert.equal(cursor, tokens[0]); return response([], tokens[1]); });
  const last = await pager.load(async cursor => { assert.equal(cursor, tokens[1]); return response([comment('older')], null); });
  assert.equal(last?.comments[0].id, 'older');
  assert.equal(pager.hasMore, false);
});

test('revocation stops the page chain and cannot be retried as an authorized empty result', async () => {
  const pager = createDiscussionCommentPager();
  await pager.load(async () => response([comment('permitted')], 'test-page.e_boundary'));
  await assert.rejects(pager.load(async () => ({ ok: false, status: 403, error: 'Revoked' })), /Revoked/);
  assert.equal(pager.hasMore, false);
  assert.equal(await pager.load(async () => { throw new Error('must not run'); }), null);
});

test('generic Thing discussions enable styled collection controls without changing rich child controls', () => {
  const route = readFileSync(new URL('../../routes/thing.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('./PostCard.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../Collections/collectionStyles.ts', import.meta.url), 'utf8');
  assert.match(route, /<ThingComments collectionControls thingId=/);
  assert.match(card, /!commentCollection \|\| typeof post.viewCount === 'number'/);
  assert.doesNotMatch(styles, /\.tt-collection\s+(?:button|input|select)\b/);
  assert.match(styles, /\.tt-collection-pagination button/);
  assert.match(styles, /\.tt-collection-controls input/);
});
