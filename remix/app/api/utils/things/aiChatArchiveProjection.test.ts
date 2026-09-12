import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAiChatArchive } from './aiChatArchiveProjection';
import { archiveAuthor } from '../../../utils/thingTransfer/chatArchive';
import type { LiveChatArchiveSnapshot } from './liveChatArchiveCore';

const at = '2026-09-01T00:00:00.000Z';
const source = { access: 'lopu', provider: 'lopu', sourceId: 'private-source', label: 'Lopu', connector: 'private-connector', readOnly: false };
const fixture = (): LiveChatArchiveSnapshot => ({
  chat: { id: 'chat', name: 'A conversation', topic: '', chatType: 'group', createdAt: at },
  participants: [{ id: 'member', userId: 'original', username: 'original', displayName: 'Original', nickname: '', joinedAt: at }],
  messages: [{ id: 'question', authorId: 'original', text: 'Question 🥰', createdAt: at, deleted: false },
    { id: 'answer', authorId: 'original', text: 'Exact\nanswer', createdAt: at, deleted: false, replyToId: 'question' }],
  reactions: [], files: [], links: []
});
const authors = () => new Map([
  ['question', { lopu: { role: 'user', requestId: 'private-request' } }],
  ['answer', { externalSource: { ...source, role: 'assistant', readOnly: true }, lopu: { role: 'assistant' } }]
]);

test('AI messages become distinct archived participants while human messages become the importer', () => {
  const input = fixture(), before = structuredClone(input);
  const { group } = projectAiChatArchive(input, 'original', source, authors());
  const assistant = group.participants.find(person => person.id !== group.self.id)!;
  assert.equal(group.messages[0].crystal.participantId, group.self.id);
  assert.equal(group.messages[1].crystal.participantId, assistant.id);
  assert.equal(group.messages[1].crystal.text, 'Exact\nanswer');
  assert.equal(group.messages[1].crystal.replyToId, 'question');
  const ids = new Map([[assistant.id, 'fresh-assistant']]);
  assert.deepEqual(archiveAuthor(group, group.self.id, 'importer', ids, new Map()), { archived: false, userId: 'importer' });
  assert.deepEqual(archiveAuthor(group, assistant.id, 'importer', ids, new Map()), {
    archived: true, participantId: 'fresh-assistant', username: 'lopu-assistant', displayName: 'Lopu'
  });
  assert.deepEqual(input, before);
  assert.doesNotMatch(JSON.stringify(group), /private-|connector|sessionId|requestId|capabilities/);
});

test('synthetic participants cannot collide with existing source identities', () => {
  const input = fixture(); input.messages[0].id = 'archive-ai-author:0'; input.messages[1].replyToId = input.messages[0].id;
  const metadata = authors(); metadata.set(input.messages[0].id, metadata.get('question')!); metadata.delete('question');
  const { group } = projectAiChatArchive(input, 'original', source, metadata);
  assert.equal(group.messages[1].crystal.participantId, 'archive-ai-author:1');
});

test('incomplete metadata and unpreserved tool history reject instead of producing a partial archive', () => {
  const missing = authors(); missing.delete('answer');
  assert.throws(() => projectAiChatArchive(fixture(), 'original', source, missing), /Complete AI author/);
  const tools = authors(); tools.set('answer', { ...tools.get('answer'), lopu: { role: 'assistant', toolCalls: [{ name: 'send' }] } } as any);
  assert.throws(() => projectAiChatArchive(fixture(), 'original', source, tools), /Historical tool presentation/);
  const live = { ...source, provider: 'claude', access: 'live', deviceId: 'd', connectorId: 'c', sessionId: 's', capabilities: ['read-history'] };
  for (const progress of [{}, { historyHasMore: true, historyCursor: 'next', historySyncedAt: at }])
    assert.throws(() => projectAiChatArchive(fixture(), 'original', { ...live, ...progress }, authors()), /Complete synchronized AI history/);
});
