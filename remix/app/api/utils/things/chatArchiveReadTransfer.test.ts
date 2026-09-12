import assert from 'node:assert/strict';
import test from 'node:test';
import { readOwnedChatArchive } from './chatArchiveReadTransfer';
import { customEmojiIdForAttachment } from '../messenger/messengerMediaCore';

const at = '2026-09-01T00:00:00.000Z';
const fixture = () => [
  { shareId: 'archive', thingtime: ['chat-archive'], crystal: { name: 'History', topic: '', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
  { shareId: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'original', displayName: 'Original', nickname: '', joinedAt: at, archived: false, userId: 'owner' } },
  { shareId: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'friend', displayName: 'Friend', nickname: 'F', joinedAt: at, archived: true } },
  { shareId: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'exact\n history 🥰', createdAt: at, deleted: false } },
  { shareId: 'reply', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'friend', text: 'Reply', createdAt: at, deleted: false, replyToId: 'message', threadRootId: 'message' } },
  { shareId: 'reaction', targetId: 'message', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'friend', emoji: '🥰', createdAt: at } }
].map(row => ({ ...row, ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1, updatedAt: new Date(at), createdAt: new Date(at), acl: ['tt:user'] }));

const harness = () => {
  const state = { rows: fixture() as any[], attachments: [] as any[], reads: 0, transactions: 0 };
  const session = {};
  const deps: any = {
    custom: () => false,
    transaction: async (work: any) => { state.transactions++; return work(session); },
    collection: async () => ({
      findOne: async (filter: any, options: any) => {
        state.reads++; assert.equal(options.session, session); assert.equal(options.maxTimeMS, 5000);
        assert.deepEqual(filter, { ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1, shareId: 'archive', thingtime: ['chat-archive'] });
        return state.rows.find(row => row.shareId === 'archive') || null;
      },
      find: (filter: any, options: any) => {
        state.reads++; assert.equal(options.session, session); assert.equal(options.maxTimeMS, 5000); assert.equal(filter.ownerId, 'owner');
        const attachments = !!filter.targetId;
        if (attachments) {
          assert.deepEqual(filter.thingtime, ['attachment']); assert.deepEqual(filter.targetId.$in, state.rows.map(row => row.shareId));
          assert.equal(options.projection['crystal.contentType'], 1); assert.equal(options.projection.crystal, undefined);
        } else assert.deepEqual(filter, { ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1 });
        const cursor = { sort: () => cursor, limit: (limit: number) => {
          assert.equal(limit, attachments ? 2001 : 1001);
          return { toArray: async () => (attachments ? state.attachments : state.rows).slice(0, limit) };
        } };
        return cursor;
      }
    })
  };
  return { state, deps };
};

test('reads full owner history in one snapshot and projects no live account or storage authority', async () => {
  const { state, deps } = harness();
  state.rows[0].crystal.secret = 'not-exportable'; state.rows[2].crystal.role = 'administrator';
  state.rows[3].tokenAcl = ['private-token'];
  const result = await readOwnedChatArchive('owner', 'archive', deps);
  assert.ok(result); assert.equal(state.transactions, 1); assert.equal(state.reads, 3);
  assert.equal(result.group.self.id, 'self'); assert.equal(result.group.messages.length, 2);
  assert.equal(result.group.messages[0].crystal.text, 'exact\n history 🥰');
  assert.equal(result.group.messages[1].crystal.replyToId, 'message');
  assert.equal(result.group.participants[1].crystal.username, 'friend');
  assert.equal(result.updatedAt, at);
  assert.doesNotMatch(JSON.stringify(result), /not-exportable|administrator|private-token|ownerId|userId|archiveVersion|archived/);
  state.rows[3].crystal.text = 'mutated'; assert.equal(result.group.messages[0].crystal.text, 'exact\n history 🥰');
});

test('archive reads preserve canonical uploaded-emoji reactions and discover their IDs', async () => {
  const { state, deps } = harness();
  const emojiId = customEmojiIdForAttachment('owner', 'upload');
  state.rows[5].crystal.emoji = `custom:${emojiId}`;
  const result = await readOwnedChatArchive('owner', 'archive', deps);
  assert.ok(result);
  assert.deepEqual(result.emojiIds, [emojiId]);
  assert.equal(result.group.reactions[0].crystal.emoji, `custom:${emojiId}`);
});

test('missing, foreign, deleting and namespaced roots never expose history', async () => {
  for (const change of [{ ownerId: 'other' }, { archiveDeleting: true }, { appId: 'app' }, { sandbox: false }, { sandboxSpace: '' }]) {
    const { state, deps } = harness(); Object.assign(state.rows[0], change);
    assert.equal(await readOwnedChatArchive('owner', 'archive', deps), null); assert.equal(state.reads, 1);
  }
  const { state, deps } = harness(); state.rows = [];
  assert.equal(await readOwnedChatArchive('owner', 'archive', deps), null);
  deps.custom = () => true; state.reads = 0;
  assert.equal(await readOwnedChatArchive('owner', 'archive', deps), null); assert.equal(state.reads, 0);
  assert.equal(await readOwnedChatArchive(undefined, 'archive', deps), null);
});

test('foreign rows, forged self identity, live counterpart identity and broken reply topology fail closed', async () => {
  for (const mutate of [
    (rows: any[]) => { rows[1].crystal.userId = 'other'; },
    (rows: any[]) => { rows[2].crystal.userId = 'live-friend'; },
    (rows: any[]) => { rows[3].ownerId = 'other'; },
    (rows: any[]) => { rows[4].crystal.replyToId = 'missing'; },
    (rows: any[]) => { rows[4].thingtime = ['chat-archive-message', 'message']; },
    (rows: any[]) => { rows.push(rows[1]); }
  ]) {
    const { state, deps } = harness(); mutate(state.rows);
    await assert.rejects(readOwnedChatArchive('owner', 'archive', deps));
  }
});

test('avatars and ordered galleries expose only attachment identities and require valid own bindings', async () => {
  const { state, deps } = harness(); state.rows[2].crystal.avatarFileId = 'avatar';
  state.attachments = [
    { shareId: 'avatar', targetId: 'friend', crystal: { contentType: 'image/png', size: 68 }, attachmentSortIndex: 0 },
    { shareId: 'last', targetId: 'message', attachmentLinked: true, attachmentSortIndex: 1 },
    { shareId: 'first', targetId: 'message', crystal: { contentType: 'image/png', size: 68 }, attachmentSortIndex: 0 }
  ].map(row => ({ ...row, ownerId: 'owner', attachmentState: 'ready', attachmentPurpose: 'post', createdAt: new Date(at) }));
  const result = await readOwnedChatArchive('owner', 'archive', deps); assert.ok(result);
  assert.deepEqual(result.attachmentTargets.filter(row => row.targetId === 'message').map(row => row.id), ['first', 'last']);
  assert.deepEqual(Object.keys(result.attachmentTargets[0]).sort(), ['id', 'targetId']);
  state.attachments[0].ownerId = 'other'; await assert.rejects(readOwnedChatArchive('owner', 'archive', deps));
  state.attachments[0].ownerId = 'owner'; state.attachments = []; await assert.rejects(readOwnedChatArchive('owner', 'archive', deps));
});

test('history and attachment limits reject incomplete snapshots instead of silently truncating', async () => {
  for (const attachments of [false, true]) {
    const { state, deps } = harness();
    if (attachments) state.attachments = Array.from({ length: 2001 }, (_, i) => ({ shareId: `file-${i}` }));
    else state.rows.push(...Array.from({ length: 1001 }, (_, i) => ({ ...state.rows[3], shareId: `message-${i}` })));
    await assert.rejects(readOwnedChatArchive('owner', 'archive', deps));
  }
});

test('archive gallery metadata is batched, whitelisted, ordered and moderation-aware', async () => {
  const { state, deps } = harness();
  state.attachments = ['clear', 'pending', 'nsfw', 'blocked'].map((status, index) => ({
    shareId: status, targetId: 'message', ownerId: 'owner', attachmentState: 'ready', attachmentPurpose: 'post',
    attachmentSortIndex: 4 - index, createdAt: new Date(at), objectKey: 'private-storage-key', uploadId: 'private-upload-id',
    moderation: { status, reason: 'private-moderation-reason', provider: 'private-provider' },
    crystal: { name: `${status}.png`, contentType: 'image/png', size: 68, mediaKind: 'image', title: 'Historical picture',
      description: 'Original caption', filenamePreview: 'Picture' }
  }));
  const result = await readOwnedChatArchive('owner', 'archive', deps); assert.ok(result);
  assert.equal(state.reads, 3, 'Media projection must not add a query per message or file');
  assert.deepEqual(result.attachments?.map(file => file.id), ['nsfw', 'pending', 'clear']);
  assert.equal(result.attachments?.[0].nsfw, true); assert.equal(result.attachments?.[1].pending, true);
  assert.equal(result.attachments?.[2].title, 'Historical picture');
  assert.equal(result.attachments?.[2].description, 'Original caption');
  assert.ok(result.attachments?.every(file => file.targetId === 'message'));
  assert.equal(result.attachmentTargets.length, 4, 'Blocked files must still prevent incomplete re-export');
  assert.doesNotMatch(JSON.stringify(result), /private-storage-key|private-upload-id|private-moderation-reason|private-provider|private-crystal-value/);
  state.attachments[0].crystal.secret = 'private-crystal-value';
  const malformed = await readOwnedChatArchive('owner', 'archive', deps);
  assert.ok(!malformed?.attachments?.some(file => file.id === 'clear'), 'Noncanonical metadata must not render');
});
