import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLiveChatArchive, type LiveChatArchiveSnapshot } from './liveChatArchiveCore';
import { archiveAuthor } from '../../../utils/thingTransfer/chatArchive';

const at = '2026-09-01T00:00:00.000Z';
const fixture = (): LiveChatArchiveSnapshot => ({
  chat: { id: 'chat', name: 'History', topic: 'Preserved', chatType: 'group', createdAt: at },
  participants: [
    { id: 'self', userId: 'source-user', username: 'original', displayName: 'Original', nickname: '', joinedAt: at },
    { id: 'friend', userId: 'former-user', username: 'friend', displayName: 'Friend', nickname: 'F', joinedAt: at, avatarFileId: 'avatar' }
  ], messages: [
    { id: 'message', authorId: 'source-user', text: 'First\nmessage 🥰', createdAt: at, deleted: false },
    { id: 'reply', authorId: 'former-user', text: 'Thread reply', createdAt: at, editedAt: at, deleted: false, replyToId: 'message', threadRootId: 'message' },
    { id: 'deleted', authorId: 'former-user', text: 'Do not restore deleted text', createdAt: at, deleted: true }
  ], reactions: [{ id: 'reaction', messageId: 'reply', userId: 'former-user', emoji: 'custom:emoji-source', createdAt: at }],
  files: [{ id: 'avatar', targetId: 'friend', mime: 'image/png', bytes: 68 }], links: []
});

test('live history becomes relational private history without source-account authority', () => {
  const source = fixture();
  Object.assign(source.chat, { acl: ['tt:all'], createdBy: 'source-user' });
  Object.assign(source.participants[1], { role: 'admin', state: 'active', muted: true, lastReadMessageId: 'reply', email: 'private@example.test' });
  const result = projectLiveChatArchive(source, 'source-user');
  assert.equal(result.group.messages[0].crystal.text, 'First\nmessage 🥰');
  assert.equal(result.group.messages[1].crystal.threadRootId, 'message');
  assert.equal(result.group.messages[1].crystal.editedAt, at);
  assert.equal(result.group.messages[2].crystal.text, '');
  assert.deepEqual(result.emojiIds, ['emoji-source']);
  const encoded = JSON.stringify(result);
  for (const value of ['source-user', 'former-user', 'tt:all', 'admin', 'private@example.test', 'lastReadMessageId']) assert.equal(encoded.includes(value), false);
  const people = new Map([['self', 'new-self'], ['friend', 'new-friend']]);
  const files = new Map([['avatar', 'new-avatar']]);
  assert.deepEqual(archiveAuthor(result.group, 'self', 'importer', people, files), { archived: false, userId: 'importer' });
  assert.deepEqual(archiveAuthor(result.group, 'friend', 'importer', people, files), {
    archived: true, participantId: 'new-friend', username: 'friend', displayName: 'Friend', avatarFileId: 'new-avatar'
  });
  source.messages[0].text = 'Changed later';
  assert.equal(result.group.messages[0].crystal.text, 'First\nmessage 🥰');
});

test('projection rejects missing self, missing history, ambiguous identities and invalid topology', () => {
  assert.throws(() => projectLiveChatArchive(fixture(), 'stranger'));
  for (const change of [
    (s: LiveChatArchiveSnapshot) => { s.participants.pop(); },
    (s: LiveChatArchiveSnapshot) => { s.participants[1].userId = s.participants[0].userId; },
    (s: LiveChatArchiveSnapshot) => { s.messages[1].replyToId = 'absent'; },
    (s: LiveChatArchiveSnapshot) => { s.messages[0].replyToId = 'reply'; },
    (s: LiveChatArchiveSnapshot) => { s.reactions[0].userId = 'absent'; },
    (s: LiveChatArchiveSnapshot) => { s.reactions[0].id = 'reply'; },
    (s: LiveChatArchiveSnapshot) => { s.files[0].targetId = 'deleted'; },
    (s: LiveChatArchiveSnapshot) => { s.chat.createdAt = 'invalid'; }
  ]) { const source = fixture(); change(source); assert.throws(() => projectLiveChatArchive(source, 'source-user')); }
});

test('oversized history is rejected rather than truncated', () => {
  const source = fixture();
  source.messages = Array.from({ length: 1000 }, (_, i) => ({ ...source.messages[0], id: `message-${i}` }));
  assert.throws(() => projectLiveChatArchive(source, 'source-user'));
});
