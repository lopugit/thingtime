import assert from 'node:assert/strict';
import test from 'node:test';
import { managedArchiveAvatarId, readLiveChatArchiveTransfer } from './liveChatArchiveTransfer';

const at = new Date('2026-09-01T00:00:00.000Z');
const row = (shareId: string, ownerId: string, crystal: any = {}, targetId = 'chat') => ({ shareId, ownerId, crystal, targetId, createdAt: at, updatedAt: at });
const fixture = () => {
  const source: any = { chat: row('chat', 'self', { name: '', topic: '', chatType: 'dm' }),
    members: [row('member-self', 'self'), row('member-friend', 'friend')],
    messages: [row('message', 'friend', { text: 'History' })], reactions: [],
    attachments: [{ ...row('file', 'friend', {}, 'message'), attachmentSortIndex: 2 },
      { ...row('link', 'friend', {}, 'message'), attachmentLinked: true, attachmentSortIndex: 1 }] };
  const profiles = new Map<string, any>([['self', { id: 'self', username: 'original' }],
    ['friend', { id: 'friend', username: 'friend', avatarUrl: '/api/v1/attachments/content?id=avatar' }]]);
  const calls: string[] = [];
  const deps = { custom: () => false,
    async read(ownerId: string, id: string) { assert.equal(ownerId, 'self'); assert.equal(id, 'chat'); calls.push('read'); return source; },
    async profiles(ids: string[]) { assert.deepEqual(ids, ['self', 'friend']); calls.push('profiles'); return profiles; },
    async describe(viewer: any, id: string, options: any): Promise<any> {
      assert.equal(viewer.id, 'self'); assert.deepEqual(options, { includeFiles: true, includeLinks: true }); calls.push(id);
      return { ok: true, linked: id === 'link', attachment: { id, name: id, contentType: 'image/png', size: 68,
        ...(id === 'link' ? { url: 'https://example.test/image.png', mediaKind: 'image' } : {}) } };
    }
  };
  return { source, profiles, calls, deps };
};
const read = (f: ReturnType<typeof fixture>, signal?: AbortSignal) => readLiveChatArchiveTransfer({ id: 'self' } as any, 'chat', 'self', signal, f.deps);

test('adapter joins an authorized snapshot with canonical profiles and ordered media, without raw profile URLs', async () => {
  const f = fixture(); const archive = await read(f);
  assert.deepEqual(f.calls, ['read', 'profiles', 'link', 'file', 'avatar']);
  assert.equal(archive!.group.participants[1].crystal.avatarFileId, 'avatar');
  assert.equal(archive!.group.messages[0].crystal.text, 'History');
  assert.equal(archive!.updatedAt, at.toISOString());
  assert.deepEqual(archive!.attachmentTargets.map(row => row.id), ['link', 'file', 'avatar']);
  assert.equal(JSON.stringify(archive).includes('/api/v1/attachments'), false);
});

test('managed avatars accept only the exact canonical relative path, never arbitrary URLs or extra query fields', () => {
  assert.equal(managedArchiveAvatarId('/api/v1/attachments/content?id=avatar'), 'avatar');
  for (const url of ['https://evil.test/api/v1/attachments/content?id=avatar', '//evil.test/image', 'data:image/png;base64,AAAA',
    '/api/v1/attachments/content?id=avatar&key=secret', '/api/v1/attachments/content?id=avatar&id=other',
    '/api/v1/attachments/content?id=%61vatar', '/api/v1/attachments/content?id=../../secret']) assert.throws(() => managedArchiveAvatarId(url));
});

test('first-party scope and membership denial stop before profile or media lookup', async () => {
  for (const viewer of [null, { id: 'other' }, { id: 'self', pat: {} }]) {
    const f = fixture(); assert.equal(await readLiveChatArchiveTransfer(viewer as any, 'chat', 'self', undefined, f.deps), null);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.deps.read = async () => null;
  assert.equal(await read(f), null); assert.deepEqual(f.calls, []);
  const custom = fixture(); custom.deps.custom = () => true;
  assert.equal(await read(custom), null); assert.deepEqual(custom.calls, []);
});

test('unavailable, mismatched, excluded, oversized or non-image avatar media never produces a partial archive', async () => {
  for (const value of [
    { ok: false, status: 404, error: 'private provider detail' }, { ok: true, excluded: true },
    { ok: true, linked: false, attachment: { id: 'wrong', size: 68, contentType: 'image/png' } },
    { ok: true, linked: false, attachment: { id: 'avatar', size: 600 * 1024 * 1024, contentType: 'image/png' } },
    { ok: true, linked: false, attachment: { id: 'avatar', size: 68, contentType: 'text/plain' } }
  ]) {
    const f = fixture(); const describe = f.deps.describe;
    f.deps.describe = async (viewer, id, options) => id === 'avatar' ? value : describe(viewer, id, options);
    await assert.rejects(read(f), /Complete chat media is unavailable/);
  }
  const f = fixture(); f.profiles.get('friend').avatarUrl = 'https://external.test/avatar.png';
  await assert.rejects(read(f), /Complete chat media is unavailable/);
  assert.deepEqual(f.calls, ['read', 'profiles']);
});

test('cancellation prevents work and fences late profile results before any media lookup', async () => {
  const before = fixture(); const stopped = new AbortController(); stopped.abort();
  await assert.rejects(read(before, stopped.signal)); assert.deepEqual(before.calls, []);
  const f = fixture(); const controller = new AbortController();
  f.deps.profiles = async () => { controller.abort(); return f.profiles; };
  await assert.rejects(read(f, controller.signal)); assert.deepEqual(f.calls, ['read']);
});

test('only normalized authorized reaction IDs reach the shared emoji reader', async () => {
  const f = fixture(); f.source.reactions = [row('reaction', 'friend', { emoji: 'custom:emoji-friend' }, 'message')];
  const ids: string[][] = [];
  const emoji = { thing: { id: 'emoji-friend', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'pending' } }, attachmentId: 'emoji-image' };
  const deps = { ...f.deps, emojis: async (values: readonly string[]) => { ids.push([...values]); return [emoji]; } };
  const result = await readLiveChatArchiveTransfer({ id: 'self' }, 'chat', 'self', undefined, deps);
  assert.deepEqual(ids, [['emoji-friend']]); assert.deepEqual(result?.transferEmojis, [emoji]);
  deps.read = async () => null;
  assert.equal(await readLiveChatArchiveTransfer({ id: 'self' }, 'chat', 'self', undefined, deps), null);
  assert.equal(ids.length, 1);
});
