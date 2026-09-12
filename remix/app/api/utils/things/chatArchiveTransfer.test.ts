import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferChatArchive, type ChatArchiveImportResources } from './chatArchiveTransfer';
import type { ThingTransfer } from '../../../utils/thingTransfer/format';

const at = '2026-09-01T00:00:00.000Z';
const fixture = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['chat'], files: [], things: [
  { id: 'chat', thingtime: ['chat-archive'], crystal: { name: 'Friends', topic: '', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
  { id: 'self', targetId: 'chat', thingtime: ['chat-archive-participant'], crystal: { username: 'exporter', displayName: 'Old self', nickname: '', joinedAt: at } },
  { id: 'friend', targetId: 'chat', thingtime: ['chat-archive-participant'], crystal: { username: 'friend', displayName: 'Old friend', nickname: 'F', joinedAt: at } },
  { id: 'first', targetId: 'chat', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Hello\n world', createdAt: at, deleted: false } },
  { id: 'reply', targetId: 'chat', thingtime: ['chat-archive-message'], crystal: { participantId: 'friend', text: '🥰', createdAt: at, deleted: false, replyToId: 'first', threadRootId: 'first' } },
  { id: 'reaction', targetId: 'reply', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'self', emoji: '🥰', createdAt: at } }
] });

// Dependency-level transaction probe, not an imitation MongoDB or live quota
// acceptance claim. Observe exactly what the canonical accounted writer and
// attachment binder receive, and only publish a completed transaction callback.
const harness = () => {
  let serial = 0;
  const state = { committed: [] as any[], bindings: [] as any[], reads: [] as any[], inserts: 0, attempts: 0,
    failInsert: 0, failBind: false, retry: false, lockMatches: 1, locks: [] as any[], records: new Map<string, any>() };
  let active: { session: object; rows: any[]; bindings: any[] };
  const collection = {
    findOne: async (filter: any, options: any) => {
      assert.equal(options.session, active.session); assert.equal(filter.ownerId, 'importer');
      state.reads.push(filter);
      const record = state.records.get(filter.shareId);
      return record?.ownerId === filter.ownerId ? record : null;
    },
    updateOne: async (filter: any, update: any, options: any) => {
      assert.equal(options.session, active.session); state.locks.push({ filter, update });
      return { matchedCount: state.lockMatches };
    }
  };
  const deps: any = {
    custom: () => false, uuid: () => `fresh-${++serial}`, now: () => new Date('2026-09-12T00:00:00.000Z'),
    collection: async () => collection,
    transaction: async (work: any) => {
      let result;
      for (let i = 0; i < (state.retry ? 2 : 1); i++) {
        state.attempts++; active = { session: {}, rows: [], bindings: [] };
        result = await work(active.session);
      }
      state.committed = active.rows; state.bindings = active.bindings; return result;
    },
    insert: async (things: any, doc: any, options: any) => {
      assert.equal(things, collection); assert.equal(options.session, active.session);
      assert.equal(options.accountedPlane, 'home'); assert.equal(doc._id, undefined);
      state.inserts++;
      if (state.inserts === state.failInsert) throw new Error('quota exhausted');
      active.rows.push(structuredClone(doc)); doc._id = 'driver mutation';
    },
    bind: async (ownerId: string, ids: string[], targetId: string, session: any) => {
      assert.equal(session, active.session); assert.equal(ownerId, 'importer');
      if (state.failBind) throw new Error('concurrent upload claim');
      active.bindings.push({ ids, targetId });
    }
  };
  return { state, deps };
};
const empty = (): ChatArchiveImportResources => ({ files: new Map() });
const withAvatar = () => {
  const manifest = fixture();
  manifest.things[2].crystal.avatarFileId = 'avatar';
  manifest.files.push({ id: 'avatar', targetId: 'friend', path: 'files/000000', name: 'friend.png', mime: 'image/png', bytes: 68, sha256: 'a'.repeat(64) });
  return { manifest, resources: { files: new Map([['avatar', 'uploaded-avatar']]) },
    upload: { shareId: 'uploaded-avatar', ownerId: 'importer', thingtime: ['attachment'], crystal: { size: 68, contentType: 'image/png' } } };
};

test('archive writer owns every historical row without minting live recipients or memberships', async () => {
  const { state, deps } = harness(); const manifest = fixture(); const before = JSON.stringify(manifest);
  const result = await createTransferChatArchive('importer', manifest, 'chat', empty(), deps);
  assert.equal(result.imported, 6); assert.equal(state.committed.length, 6);
  const [root, self, other, first, reply, reaction] = state.committed;
  for (const row of state.committed) {
    assert.equal(row.ownerId, 'importer'); assert.deepEqual(row.acl, ['tt:user']);
    assert.ok(row.thingtime[0].startsWith('chat-archive')); assert.equal(row.uniqueKeys, undefined);
    assert.equal(row.archiveRootId, result.rootId);
    assert.equal(row.archiveVersion, 1); assert.equal(row.createdAt.toISOString(), '2026-09-12T00:00:00.000Z');
  }
  assert.equal(root.crystal.selfParticipantId, self.shareId); assert.equal(self.crystal.userId, 'importer');
  assert.equal(self.crystal.archived, false); assert.equal(other.crystal.archived, true);
  assert.equal(other.crystal.userId, undefined); assert.equal(other.crystal.username, 'friend');
  assert.equal(other.crystal.nickname, 'F'); assert.equal(other.targetId, root.shareId);
  assert.equal(first.crystal.participantId, self.shareId); assert.equal(first.crystal.text, 'Hello\n world');
  assert.equal(first.crystal.createdAt, at); assert.equal(reply.crystal.participantId, other.shareId);
  assert.equal(reply.crystal.replyToId, first.shareId); assert.equal(reply.crystal.threadRootId, first.shareId);
  assert.equal(reaction.targetId, reply.shareId); assert.equal(reaction.crystal.participantId, self.shareId);
  assert.equal(state.reads.length, 0, 'historical usernames must never trigger account lookup');
  assert.equal(JSON.stringify(manifest), before);
});

test('archive avatars bind fresh uploads in the same accounted transaction', async () => {
  const { manifest, resources, upload } = withAvatar(); const { state, deps } = harness();
  state.records.set(upload.shareId, upload);
  const result = await createTransferChatArchive('importer', manifest, 'chat', resources, deps);
  assert.equal(state.committed[2].crystal.avatarFileId, upload.shareId);
  assert.deepEqual(state.bindings, [{ ids: [upload.shareId], targetId: result.ids.friend }]);
});

test('missing, foreign, changed or already bound avatar fails before any archive insertion', async () => {
  for (const patch of [null, { ownerId: 'someone-else' }, { targetId: 'existing-chat' }, { crystal: { size: 67, contentType: 'image/png' } },
    { crystal: { size: 68, contentType: 'image/jpeg' } }, { attachmentLinked: true }, { moderation: { status: 'blocked' } }, { appId: 'another-app' }]) {
    const { manifest, resources, upload } = withAvatar(); const { state, deps } = harness();
    if (patch !== null) state.records.set(upload.shareId, { ...upload, ...patch });
    await assert.rejects(createTransferChatArchive('importer', manifest, 'chat', resources, deps), /attachment does not match/);
    assert.equal(state.inserts, 0); assert.deepEqual(state.committed, []);
  }
});

test('quota and concurrent binding errors reject the complete archive transaction', async () => {
  for (const failure of ['quota', 'binding']) {
    const { manifest, resources, upload } = withAvatar(); const { state, deps } = harness();
    state.records.set(upload.shareId, upload);
    state.failInsert = failure === 'quota' ? 4 : 0; state.failBind = failure === 'binding';
    await assert.rejects(createTransferChatArchive('importer', manifest, 'chat', resources, deps), /quota exhausted|concurrent upload claim/);
    assert.deepEqual(state.committed, []); assert.deepEqual(state.bindings, []);
  }
});

test('transaction retries keep fresh IDs stable and do not reuse driver-mutated documents', async () => {
  const { state, deps } = harness(); state.retry = true;
  const result = await createTransferChatArchive('importer', fixture(), 'chat', empty(), deps);
  assert.equal(state.attempts, 2); assert.equal(state.inserts, 12); assert.equal(state.committed.length, 6);
  assert.deepEqual(state.committed.map(row => row.shareId), Object.values(result.ids));
});

test('invalid source authority and identity collisions fail before starting storage', async () => {
  for (const id of ['self', 'importer', 'same', 'invalid id']) {
    const { state, deps } = harness(); deps.uuid = () => id;
    await assert.rejects(createTransferChatArchive('importer', fixture(), 'chat', empty(), deps), /fresh identities/);
    assert.equal(state.attempts, 0);
  }
  const { state, deps } = harness(); const manifest = fixture(); manifest.things[1].crystal.userId = 'real-user';
  await assert.rejects(createTransferChatArchive('importer', manifest, 'chat', empty(), deps));
  assert.equal(state.attempts, 0);
  deps.custom = () => true;
  await assert.rejects(createTransferChatArchive('importer', fixture(), 'chat', empty(), deps), /home Thingtime library/);
  assert.equal(state.attempts, 0);
});

test('archive folder placement fences deletion and refuses foreign, missing and app folders', async () => {
  for (const mode of ['valid', 'missing', 'foreign', 'app', 'raced']) {
    const { state, deps } = harness(); const manifest = fixture();
    const folder = { shareId: 'destination', ownerId: mode === 'foreign' ? 'another-owner' : 'importer', thingtime: ['folder'], updatedAt: new Date(at), ...(mode === 'app' ? { appId: 'app' } : {}) };
    if (mode !== 'missing') state.records.set(folder.shareId, folder);
    if (mode === 'raced') state.lockMatches = 0;
    const run = createTransferChatArchive('importer', manifest, 'chat', { ...empty(), folderId: folder.shareId }, deps);
    if (mode === 'valid') {
      await run; assert.equal(state.committed[0].folderId, folder.shareId);
      assert.ok(state.locks[0].update.$set.updatedAt > folder.updatedAt);
    } else { await assert.rejects(run, /folder/); assert.equal(state.inserts, 0); }
  }
});

test('custom reactions remap only to an owned imported personal emoji', async () => {
  const manifest = fixture(); manifest.things[5].crystal.emoji = 'custom:source_emoji';
  manifest.things.push({ id: 'source_emoji', thingtime: ['custom-emoji'], crystal: { name: 'party' } });
  for (const scoped of [false, true]) {
    const { state, deps } = harness();
    state.records.set('fresh_emoji', { ownerId: 'importer', ...(scoped ? { targetId: 'community' } : {}) });
    const run = createTransferChatArchive('importer', manifest, 'chat', { ...empty(), emojis: new Map([['source_emoji', 'fresh_emoji']]) }, deps);
    if (scoped) { await assert.rejects(run, /reaction emoji/); assert.equal(state.inserts, 0); }
    else { await run; assert.equal(state.committed[5].crystal.emoji, 'custom:fresh_emoji'); }
  }
});

test('file mapping cannot reuse a source ID, account, Thing ID or missing upload', async () => {
  for (const id of [undefined, 'avatar', 'importer', 'fresh-1']) {
    const { manifest, resources } = withAvatar(); const { state, deps } = harness();
    if (id === undefined) resources.files.clear(); else resources.files.set('avatar', id);
    await assert.rejects(createTransferChatArchive('importer', manifest, 'chat', resources, deps), /fresh identities/);
    assert.equal(state.attempts, 0);
  }
});

test('message files and links preserve mixed gallery ordering without rebinding their sources', async () => {
  const { manifest, resources, upload } = withAvatar(); const { state, deps } = harness();
  delete manifest.things[2].crystal.avatarFileId;
  manifest.files[0].targetId = 'first';
  manifest.links = [{ id: 'source-link', targetId: 'first', url: 'https://example.com/image.png', mediaKind: 'image' }];
  manifest.attachmentOrder = ['source-link', 'avatar'];
  resources.files.set('source-link', 'imported-link');
  state.records.set(upload.shareId, upload);
  state.records.set('imported-link', { ownerId: 'importer', attachmentLinked: true, crystal: { url: manifest.links[0].url } });
  const result = await createTransferChatArchive('importer', manifest, 'chat', resources, deps);
  assert.deepEqual(state.bindings, [{ ids: ['imported-link', 'uploaded-avatar'], targetId: result.ids.first }]);
});

test('archive snapshots are detached from caller mutations during asynchronous storage work', async () => {
  const manifest = fixture(); const { state, deps } = harness();
  const transact = deps.transaction;
  deps.transaction = (work: any) => {
    manifest.things[3].crystal.text = 'changed while awaiting';
    manifest.things[1].crystal.userId = 'someone-else';
    return transact(work);
  };
  await createTransferChatArchive('importer', manifest, 'chat', empty(), deps);
  assert.equal(state.committed[3].crystal.text, 'Hello\n world');
  assert.equal(state.committed[1].crystal.userId, 'importer');
});
