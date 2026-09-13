import assert from 'node:assert/strict';
import test from 'node:test';
import { readLiveChatArchiveEmojis } from './liveChatArchiveEmojiTransfer';

const fixture = () => {
  const rows: any[] = [{ shareId: 'emoji-friend', thingtime: ['custom-emoji'], ownerId: 'friend', targetId: 'private-community',
    folderId: 'private-folder', secure: 'secret', crystal: { name: 'party', image: 'data:image/png;base64,AQID', emojiKey: 'private-key' } }];
  const calls: any[] = [];
  const deps: any = { custom: () => false, collection: async () => ({ find(query: any, options: any) {
    calls.push({ query, options }); return { limit(n: number) { calls.push(n); return { toArray: async () => rows }; } };
  } }) };
  return { rows, calls, deps };
};

test('authorized history emoji lookup is one bounded batch and strips all source authority', async () => {
  const f = fixture();
  const result = await readLiveChatArchiveEmojis(['emoji-friend'], f.deps);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1], 2);
  assert.equal(f.calls[0].options.maxTimeMS, 5000);
  assert.deepEqual(f.calls[0].query.shareId, { $in: ['emoji-friend'] });
  assert.equal(f.calls[0].options.projection.ownerId, undefined);
  assert.deepEqual(result, [{ thing: { id: 'emoji-friend', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'pending' } },
    inlineImage: { base64: 'AQID', mime: 'image/png', bytes: 3, name: 'party.png' } }]);
});

test('invalid scope and identifier batches stop before reading', async () => {
  for (const ids of [['duplicate', 'duplicate'], ['../../invalid'], Array.from({ length: 1001 }, (_, i) => `emoji-${i}`)]) {
    const f = fixture(); await assert.rejects(readLiveChatArchiveEmojis(ids, f.deps)); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.deps.custom = () => true;
  await assert.rejects(readLiveChatArchiveEmojis(['emoji-friend'], f.deps)); assert.equal(f.calls.length, 0);
  assert.deepEqual(await readLiveChatArchiveEmojis([], f.deps), []);
});

test('hidden, foreign, malformed or incomplete emoji batches never yield a partial export', async () => {
  for (const change of [{ moderation: { status: 'blocked' } }, { moderation: { status: 'pending' } }, { moderation: { status: 'nsfw' } },
    { appId: 'app' }, { sandbox: true }, { sandboxSpace: 'space' }, { thingtime: ['custom-emoji', 'user'] },
    { shareId: 'other' }, { crystal: { name: 'party', image: 'https://external.test/image' } }]) {
    const f = fixture(); Object.assign(f.rows[0], change);
    await assert.rejects(readLiveChatArchiveEmojis(['emoji-friend'], f.deps));
  }
  const missing = fixture(); missing.rows.length = 0;
  await assert.rejects(readLiveChatArchiveEmojis(['emoji-friend'], missing.deps));
  const duplicate = fixture(); duplicate.rows.push({ ...duplicate.rows[0] });
  await assert.rejects(readLiveChatArchiveEmojis(['emoji-friend', 'second'], duplicate.deps));
});

test('stored images retain only their attachment reference for the canonical byte gate', async () => {
  const f = fixture(); f.rows[0].emojiAttachmentId = 'stored-image';
  assert.deepEqual(await readLiveChatArchiveEmojis(['emoji-friend'], f.deps), [{
    thing: { id: 'emoji-friend', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'pending' } }, attachmentId: 'stored-image'
  }]);
});
