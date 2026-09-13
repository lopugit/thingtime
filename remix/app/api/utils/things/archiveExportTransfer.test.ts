import assert from 'node:assert/strict';
import test from 'node:test';
import { exportTransferPlan } from './exportTransfer';
import { validateChatArchiveRecords } from '../../../utils/thingTransfer/chatArchive';
import type { TransferThing } from '../../../utils/thingTransfer/format';
import type { OwnedChatArchive } from './chatArchiveReadTransfer';
import { customEmojiIdForAttachment } from '../messenger/messengerMediaCore';

const at = '2026-09-01T00:00:00.000Z';
const fixture = (): OwnedChatArchive => {
  const rows: TransferThing[] = [
    { id: 'archive', thingtime: ['chat-archive'], folderId: 'outside', crystal: { name: 'History', topic: '', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
    { id: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'original', displayName: 'Original', nickname: '', joinedAt: at } },
    { id: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'friend', displayName: 'Friend', nickname: 'F', joinedAt: at } },
    { id: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'exact\n history 🥰', createdAt: at, deleted: false } },
    { id: 'reply', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'friend', text: 'Reply', createdAt: at, deleted: false, replyToId: 'message', threadRootId: 'message' } },
    { id: 'reaction', targetId: 'message', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'friend', emoji: '🥰', createdAt: at } }
  ];
  return { group: validateChatArchiveRecords({ things: rows, files: [] })[0], updatedAt: at, attachmentTargets: [], emojiIds: [] };
};
const harness = () => {
  const archive = fixture();
  let reads = 0;
  const deps = {
    read: async () => null,
    readTheme: async () => null, readAlgorithm: async () => null, readRecording: async () => null, readEmoji: async () => null,
    readArchive: async (owner: string | undefined, id: string) => { reads++; assert.equal(owner, 'owner'); return id === 'archive' ? archive : null; },
    bound: async () => []
  };
  const run = (options = {}) => exportTransferPlan({ id: 'owner' }, { ids: ['archive'], ...options }, undefined, deps, { archiveOwnerId: 'owner' });
  return { archive, deps, run, reads: () => reads };
};

test('archive exports are whole histories even when optional traversal is disabled', async () => {
  const { run, archive } = harness();
  const result = await run({ includeChildren: false, includeDependencies: false, includeFiles: false, includeLinks: false });
  assert.ok(result.ok); if (!result.ok) return;
  assert.deepEqual(result.plan.roots, ['archive']);
  assert.equal(result.plan.things.length, 6);
  const group = validateChatArchiveRecords(result.plan)[0];
  assert.equal(group.messages[0].crystal.text, 'exact\n history 🥰');
  assert.equal(group.messages[1].crystal.replyToId, 'message');
  assert.equal(group.reactions[0].crystal.participantId, 'friend');
  assert.equal(group.root.folderId, undefined);
  assert.equal(archive.group.root.folderId, 'outside');
  assert.doesNotMatch(JSON.stringify(result.plan), /ownerId|userId|archiveVersion|archived|updatedAt/);
});

test('ordinary live chats use the membership adapter only with explicit first-party scope', async () => {
  const { deps, archive } = harness(); let reads = 0;
  const live = { ...deps, readArchive: async () => null,
    readLiveArchive: async (viewer: any, id: string, owner: string | undefined) => {
      reads++; assert.equal(viewer.id, 'owner'); assert.equal(owner, 'owner'); assert.equal(id, 'archive'); return archive;
    } };
  for (const context of [{}, { archiveOwnerId: 'owner' }, { liveChatOwnerId: 'other' }])
    assert.equal((await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined, live, context)).ok, false);
  assert.equal(reads, 0);
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['archive'], includeDependencies: false,
    includeChildren: false }, undefined, live, { liveChatOwnerId: 'owner' });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(reads, 1); assert.equal(result.plan.things.length, 6);
  assert.equal(validateChatArchiveRecords(result.plan)[0].messages.length, 2);
  assert.equal((await exportTransferPlan({ id: 'owner', pat: { tokenId: 'token', onlyCreatedThings: false } },
    { ids: ['archive'] }, undefined, live, { liveChatOwnerId: 'owner' })).ok, false);
  assert.equal(reads, 1);
});

test('live chat source failures are recoverable errors without provider details or partial plans', async () => {
  const { deps } = harness();
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined,
    { ...deps, readLiveArchive: async () => { throw new Error('private Mongo provider details'); } }, { liveChatOwnerId: 'owner' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /private Mongo|"plan"/);
});

test('authorized live reaction emoji content exports without widening standalone owner reads', async () => {
  const { deps, archive } = harness();
  archive.group.reactions[0].crystal.emoji = 'custom:friend-emoji'; archive.emojiIds = ['friend-emoji'];
  let ownerReads = 0;
  const source = { thing: { id: 'friend-emoji', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'pending' } },
    inlineImage: { base64: 'AQID', mime: 'image/png', bytes: 3, name: 'party.png' } };
  const live = { ...deps, readArchive: async () => null,
    readEmoji: async () => { ownerReads++; return null; },
    readLiveArchive: async (_viewer: unknown, id: string) => id === 'archive' ? { ...archive, transferEmojis: [source] } : null };
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined, live, { liveChatOwnerId: 'owner' });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(ownerReads, 0);
  assert.ok(result.plan.things.some(row => row.id === 'friend-emoji'));
  assert.equal(result.plan.files[0].inlineBase64, 'AQID');
  const standalone = await exportTransferPlan({ id: 'owner' }, { ids: ['friend-emoji'] }, undefined, live, { liveChatOwnerId: 'owner' });
  assert.equal(standalone.ok, false); assert.ok(ownerReads > 0);
});

test('owner folder traversal carries archive scope and exports the complete nested group', async () => {
  const { archive, deps } = harness(); archive.group.root.folderId = 'folder';
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['folder'] }, undefined, {
    ...deps,
    read: async id => id === 'folder' ? { shareId: 'folder', ownerId: 'owner', thingtime: ['folder'], crystal: { name: 'History folder' }, acl: ['tt:user'] } as any : null,
    project: async () => [{ id: 'folder', thingtime: ['folder'], crystal: { name: 'History folder' }, author: { id: 'owner' }, acl: ['tt:user'] }] as any,
    list: async (viewer, query, app, context) => {
      assert.equal(typeof viewer === 'string' ? viewer : viewer?.id, 'owner'); assert.equal(query.folder, 'folder'); assert.equal(app, null); assert.equal(context?.archiveOwnerId, 'owner');
      return { ok: true, things: [{ id: 'archive' }] as any, nextCursor: null };
    }
  }, { archiveOwnerId: 'owner' });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.plan.things.length, 7);
  assert.equal(validateChatArchiveRecords(result.plan)[0].root.folderId, 'folder');
});

test('archive export requires explicit first-party owner context and refuses independent child roots', async () => {
  const { deps, reads, run } = harness();
  for (const [viewer, context] of [
    [null, {}], [{ id: 'owner' }, {}], [{ id: 'other' }, { archiveOwnerId: 'owner' }],
    [{ id: 'owner', pat: { tokenId: 'token', onlyCreatedThings: false } }, { archiveOwnerId: 'owner' }]
  ] as const) assert.equal((await exportTransferPlan(viewer, { ids: ['archive'] }, undefined, deps, context)).ok, false);
  assert.equal(reads(), 0);
  assert.equal((await run({ ids: ['message'] })).ok, false);
  assert.equal((await run({ ids: ['archive', 'message'] })).ok, false);
});

test('archive media and uploaded emoji definitions go through canonical readers and remain mandatory', async () => {
  const { archive, deps } = harness();
  const emojiId = customEmojiIdForAttachment('owner', 'upload');
  archive.group.participants[1].crystal.avatarFileId = 'avatar';
  archive.group.reactions[0].crystal.emoji = `custom:${emojiId}`;
  archive.emojiIds = [emojiId];
  archive.attachmentTargets = [{ id: 'avatar', targetId: 'friend' }, { id: 'photo', targetId: 'message' }, { id: 'link', targetId: 'reply' }];
  const descriptions: string[] = [];
  const media = { ...deps,
    readEmoji: async (owner: string | undefined, id: string) => {
      assert.equal(owner, 'owner'); assert.equal(id, emojiId);
      return { thing: { id, thingtime: ['custom-emoji'], crystal: { name: 'wave', emojiFileId: 'pending' } }, attachmentId: 'emoji-image' };
    },
    describe: async (viewer: any, id: unknown, options: any) => {
      assert.equal(viewer.id, 'owner'); assert.equal(viewer.sharedRoot, undefined);
      descriptions.push(String(id));
      if (id === 'link' ? options.includeLinks === false : options.includeFiles === false) return { ok: true as const, excluded: true as const };
      return { ok: true as const, linked: id === 'link', attachment: { id: String(id), name: 'image.png', contentType: 'image/png', size: id === 'link' ? 0 : 4, mediaKind: 'image' as const,
        ...(id === 'link' ? { url: 'https://example.com/image.png' } : {}) } };
    }
  };
  const run = (options = {}) => exportTransferPlan({ id: 'owner' }, { ids: ['archive'], includeDependencies: false, ...options }, undefined, media, { archiveOwnerId: 'owner' });
  const result = await run();
  assert.ok(result.ok); if (!result.ok) return;
  assert.deepEqual(descriptions, ['avatar', 'photo', 'link', 'emoji-image']);
  assert.equal(result.plan.things.length, 7); assert.equal(result.plan.files.length, 3);
  assert.equal(result.plan.things.find(row => row.id === emojiId)?.crystal.emojiFileId, 'emoji-image');
  assert.equal(validateChatArchiveRecords(result.plan)[0].participants[1].crystal.avatarFileId, 'avatar');
  assert.equal((await run({ includeFiles: false })).ok, false);
  assert.equal((await run({ includeLinks: false })).ok, false);
  assert.equal((await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined, { ...media, readEmoji: async () => null }, { archiveOwnerId: 'owner' })).ok, false);
  assert.equal((await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined, { ...media, describe: async () => ({ ok: false, status: 404, error: 'Attachment not found' }) }, { archiveOwnerId: 'owner' })).ok, false);
});

test('archive export fails closed on partial media, corrupt history, limits, aborts and unavailable snapshots', async () => {
  const { archive, deps, run } = harness();
  archive.attachmentTargets = [{ id: 'photo', targetId: 'message' }];
  assert.equal((await run({ includeFiles: false, includeLinks: false })).ok, false);
  archive.attachmentTargets = [];
  archive.group.messages[0].crystal.participantId = 'missing';
  assert.equal((await run()).ok, false);
  archive.group.messages[0].crystal.participantId = 'self';
  archive.group.messages.push(...Array.from({ length: 1000 }, (_, index) => ({ ...archive.group.messages[0], id: `extra-${index}` })));
  assert.equal((await run()).ok, false);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, aborted.signal, deps, { archiveOwnerId: 'owner' })).ok, false);
  const failure = await exportTransferPlan({ id: 'owner' }, { ids: ['archive'] }, undefined, { ...deps, readArchive: async () => { throw new Error('private database details'); } }, { archiveOwnerId: 'owner' });
  assert.equal(failure.ok, false); assert.doesNotMatch(JSON.stringify(failure), /private database details/);
});
