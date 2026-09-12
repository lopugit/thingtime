import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveAuthor, validateChatArchives } from './chatArchive';
import type { ThingTransfer } from './format';

const at = '2026-09-12T00:00:00.000Z';
const fixture = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['chat'], files: [], things: [
  { id: 'chat', thingtime: ['chat-archive'], crystal: { name: 'Our chat', topic: 'Preserved topic', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
  { id: 'self', targetId: 'chat', thingtime: ['chat-archive-participant'], crystal: { username: 'exporter', displayName: 'Original owner', nickname: '', joinedAt: at } },
  { id: 'other', targetId: 'chat', thingtime: ['chat-archive-participant'], crystal: { username: 'friend', displayName: 'Friend', nickname: 'F', joinedAt: at } },
  { id: 'first', targetId: 'chat', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Hello\n  world', createdAt: at, deleted: false } },
  { id: 'reply', targetId: 'chat', thingtime: ['chat-archive-message'], crystal: { participantId: 'other', text: '🥰', createdAt: at, deleted: false, replyToId: 'first', threadRootId: 'first' } },
  { id: 'reaction', targetId: 'first', thingtime: ['chat-archive-reaction'], crystal: { participantId: 'other', emoji: '🥰', createdAt: at } }
] });

test('archive validation preserves relational participants, exact text, replies, reactions and dates', () => {
  const manifest = fixture();
  const before = JSON.stringify(manifest);
  const [group] = validateChatArchives(manifest);
  assert.equal(group.self.id, 'self');
  assert.equal(group.messages.length, 2);
  assert.equal(group.messages[0].crystal.text, 'Hello\n  world');
  assert.equal(group.reactions.length, 1);
  assert.equal(JSON.stringify(manifest), before, 'validation must not mutate the source');
});

test('imported self becomes the importer; other authors remain explicit archived identities', () => {
  const [group] = validateChatArchives(fixture());
  const ids = new Map([['self', 'new-self'], ['other', 'new-other']]);
  assert.deepEqual(archiveAuthor(group, 'self', 'importer', ids, new Map()), { archived: false, userId: 'importer' });
  assert.deepEqual(archiveAuthor(group, 'other', 'importer', ids, new Map()),
    { archived: true, participantId: 'new-other', username: 'friend', displayName: 'Friend' });
  assert.throws(() => archiveAuthor(group, 'unknown-real-user', 'importer', ids, new Map()));
  for (const bad of ['', 'other', 'importer']) assert.throws(() => archiveAuthor(group, 'other', 'importer', new Map([['other', bad]]), new Map()));
  assert.throws(() => archiveAuthor(group, 'self', '', ids, new Map()));
});

test('avatar bytes use a bounded archive file reference and must be remapped on import', () => {
  const manifest = fixture();
  manifest.things[2].crystal.avatarFileId = 'avatar';
  manifest.files.push({ id: 'avatar', targetId: 'other', path: 'files/000000', name: 'avatar.png', mime: 'image/png', bytes: 68, sha256: 'a'.repeat(64) });
  const [group] = validateChatArchives(manifest);
  assert.throws(() => archiveAuthor(group, 'other', 'importer', new Map([['other', 'fresh-person']]), new Map()));
  assert.throws(() => archiveAuthor(group, 'other', 'importer', new Map([['other', 'fresh-person']]), new Map([['avatar', 'avatar']])));
  assert.equal((archiveAuthor(group, 'other', 'importer', new Map([['other', 'fresh-person']]), new Map([['avatar', 'fresh-image']])) as { avatarFileId: string }).avatarFileId, 'fresh-image');
  manifest.files[0].mime = 'image/svg+xml';
  assert.throws(() => validateChatArchives(manifest));
});

test('archive refuses restored authority, scope, fake account lookup fields and malformed topology', () => {
  const corruptions: Array<(m: ThingTransfer) => void> = [
    m => { m.things[0].crystal.ownerId = 'live-owner'; },
    m => { m.things[0].crystal.communityId = 'live-community'; },
    m => { m.things[0].crystal.members = ['real-recipient']; },
    m => { m.things[1].crystal.userId = 'real-user'; },
    m => { m.things[1].crystal.role = 'owner'; },
    m => { m.things[1].crystal.session = 'not-portable'; },
    m => { m.things[5].crystal.emoji = 'custom:missing_emoji'; },
    m => { m.things[5].crystal.emoji = '<script>'; },
    m => { m.things[2].crystal.avatarUrl = 'https://example.com/avatar'; },
    m => { m.things[1].extended = { acl: ['tt:public'] }; },
    m => { m.things[1].thingtime.push('user'); },
    m => { m.things[0].crystal.selfParticipantId = 'first'; },
    m => { m.things[3].crystal.participantId = 'live-user'; },
    m => { m.things[4].crystal.replyToId = 'reply'; },
    m => { m.things[4].crystal.replyToId = 'outside-chat'; },
    m => { m.things[3].crystal.threadRootId = 'reply'; },
    m => { m.things[3].crystal.replyToId = 'reply'; },
    m => { m.things[3].crystal.deleted = true; },
    m => { m.things[3].crystal.createdAt = '2026-02-30T00:00:00.000Z'; },
    m => { m.things[1].targetId = 'first'; },
    m => { m.things[3].targetId = 'other'; },
    m => { m.things.push({ ...m.things[5], id: 'duplicate-reaction' }); },
    m => { m.things.push({ id: 'unrelated', thingtime: ['data'], targetId: 'chat', crystal: {} }); },
    m => { m.things[1].folderId = 'chat'; }
  ];
  for (const corrupt of corruptions) { const manifest = fixture(); corrupt(manifest); assert.throws(() => validateChatArchives(manifest)); }
});

test('distinct archived participants cannot collapse onto one imported identity', () => {
  const manifest = fixture();
  manifest.things.push({ ...manifest.things[2], id: 'third' });
  const [group] = validateChatArchives(manifest);
  assert.throws(() => archiveAuthor(group, 'other', 'importer', new Map([['other', 'same'], ['third', 'same']]), new Map()));
});

test('archive reactions use the canonical grapheme limits rather than a shorter UTF-16 cap', () => {
  const manifest = fixture();
  manifest.things[5].crystal.emoji = '👨‍👩‍👧‍👦'.repeat(11);
  assert.doesNotThrow(() => validateChatArchives(manifest));
});

test('deleted messages retain tombstones but never deleted text or media', () => {
  const manifest = fixture();
  manifest.things[3].crystal.deleted = true;
  manifest.things[3].crystal.text = '';
  assert.doesNotThrow(() => validateChatArchives(manifest));
  manifest.links = [{ id: 'link', targetId: 'first', url: 'https://example.com/photo.png', mediaKind: 'image' }];
  assert.throws(() => validateChatArchives(manifest));
});

test('a second import changes only the self mapping, never resolves archived usernames to live users', () => {
  const [group] = validateChatArchives(fixture());
  for (const importer of ['first-importer', 'second-importer']) {
    const ids = new Map([['other', `${importer}-archived-person`]]);
    assert.deepEqual(archiveAuthor(group, 'self', importer, ids, new Map()), { archived: false, userId: importer });
    const other = archiveAuthor(group, 'other', importer, ids, new Map());
    assert.equal(other.archived, true);
    assert.equal('userId' in other, false);
  }
});
