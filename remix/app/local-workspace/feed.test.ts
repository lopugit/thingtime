import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicPost } from '../components/Feed/feedTypes';
import { deviceFeedPage } from './feed';

const post = (id: string, changes: Record<string, unknown> = {}) => ({ id, thingtime: ['post'], type: 'text', visibility: 'private', tags: ['art'], createdAt: '2026-10-20T12:00:00.000Z', ...changes } as PublicPost);

test('device feed pages all matching roots with canonical filters and stable chronology', async () => {
 const rows = Array.from({ length: 65 }, (_, index) => post(`post-${String(index).padStart(3, '0')}`));
 rows.push(post('comment', { thingtime: ['post', 'comment'] }), post('other-tag', { tags: ['science'] }), post('public', { visibility: 'public' }), post('older', { createdAt: '2026-10-19T12:00:00.000Z' }), post('image', { type: 'image' }));
 const query = { algorithm: 'new', types: ['text'], circles: ['private'], tag: '#ART', from: '2026-10-20', to: '2026-10-21', limit: 13 };
 const found: string[] = []; let cursor: string | null = null;
 do {
  const result = await deviceFeedPage(rows, { ...query, cursor }, 'owner/origin/plane');
  assert.equal(result.source, 'device'); assert.equal(result.incomplete, true); assert.ok(result.posts.length <= 13);
  found.push(...result.posts.map(row => row.id)); cursor = result.nextCursor;
 } while (cursor);
 assert.equal(found.length, 65); assert.equal(new Set(found).size, 65); assert.equal(found[0], 'post-064'); assert.equal(found.at(-1), 'post-000');
});

test('device cursors bind workspace, source, filters and selected profile', async () => {
 const rows = [post('a'), post('b'), post('c')], query = { algorithm: 'local-brain', limit: 1 };
 const first = await deviceFeedPage(rows, query, 'alice/home', 'local-brain');
 assert.ok(first.nextCursor?.startsWith('device-feed:'));
 for (const [args, scope, brain] of [
  [{ ...query, tag: 'art' }, 'alice/home', 'local-brain'], [query, 'bob/home', 'local-brain'], [query, 'alice/custom', 'local-brain'],
  [{ ...query, algorithm: 'new' }, 'alice/home', null]
 ] as const) await assert.rejects(deviceFeedPage(rows, { ...args, cursor: first.nextCursor }, scope, brain), /changed|new search/i);
 await assert.rejects(deviceFeedPage(rows, { cursor: 'server-cursor' }, 'alice/home'), /online cursor/);
 await assert.rejects(deviceFeedPage(rows.filter(row => row.id !== first.posts[0].id), { ...query, cursor: first.nextCursor }, 'alice/home', 'local-brain'), /results changed/i);
});

test('device feed never infers live membership, community ranks, or unknown filters', async () => {
 for (const args of [{ scope: 'subspaces' }, { algorithm: 'hot' }, { algorithm: 'global' }, { algorithm: 'local', lat: 1, lng: 2 }])
  await assert.rejects(deviceFeedPage([post('private')], args, 'owner/home'), { code: 'DEVICE_FEED_ONLINE_REQUIRED' });
 for (const args of [{ conditions: [] }, { types: ['unknown'] }, { circles: ['public', 'anyone'] }, { from: 'invalid' }, { from: '2026-10-21', to: '2026-10-20' }])
  await assert.rejects(deviceFeedPage([post('private')], args, 'owner/home'), { code: 'INVALID_DEVICE_FEED' });
});
