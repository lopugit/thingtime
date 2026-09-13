import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLiveChatArchive } from './liveChatArchiveNormalize';

const at = new Date('2026-09-01T00:00:00.000Z');
const row = (shareId: string, ownerId: string, crystal: any = {}, targetId = 'chat') => ({ shareId, ownerId, crystal, targetId, createdAt: at });
const fixture = () => ({
  source: { chat: row('chat', 'self', { name: 'Friends', topic: '', chatType: 'group' }),
    members: [row('member-self', 'self'), row('member-friend', 'friend', { nickname: 'Old friend', state: 'left' })],
    messages: [row('message', 'self', { text: 'Original\ntext 🥰' }),
      row('thread', 'friend', { text: 'Reply', replyToId: 'message', threadRootId: 'message', editedAt: at }),
      row('system', 'self', { systemType: 'member-added', systemMeta: { subjectIds: ['friend'], hidden: 'do-not-copy' } }),
      row('deleted', 'friend', { text: 'deleted-private-text', deletedAt: at })],
    reactions: [row('reaction', 'friend', { emoji: '🥰' }, 'message')],
    attachments: [{ ...row('file', 'friend', {}, 'thread'), attachmentLinked: false }] } as any,
  profiles: new Map<string, any>([
    ['self', { id: 'self', username: 'original', displayName: 'Original', avatarUrl: null }],
    ['friend', { id: 'friend', username: 'friend-name', displayName: 'Friend Name', avatarUrl: '/public/avatar', email: 'not-public@example.test' }]
  ]),
  media: { files: [{ id: 'file', targetId: 'thread', mime: 'image/png', bytes: 68 },
    { id: 'avatar', targetId: 'member-friend', mime: 'image/png', bytes: 68 }], links: [], avatars: new Map([['friend', 'avatar']]) }
});
const normalize = (f: ReturnType<typeof fixture>) => normalizeLiveChatArchive(f.source, 'self', f.profiles, f.media);

test('normalization preserves public historical identities, system text, dates, threads and complete media', () => {
  const result = normalize(fixture());
  assert.equal(result.group.messages[0].crystal.text, 'Original\ntext 🥰');
  assert.equal(result.group.messages[1].crystal.threadRootId, 'message');
  assert.equal(result.group.messages[1].crystal.editedAt, at.toISOString());
  assert.equal(result.group.messages[2].crystal.systemText, 'Original added Old friend');
  assert.equal(result.group.messages[3].crystal.text, '');
  assert.equal(result.group.participants[1].crystal.username, 'friend-name');
  assert.equal(result.group.participants[1].crystal.avatarFileId, 'avatar');
  for (const secret of ['do-not-copy', 'deleted-private-text', 'not-public@example.test', '/public/avatar', 'ownerId', 'subjectIds'])
    assert.equal(JSON.stringify(result).includes(secret), false);
});

test('normalization rejects missing profiles, incomplete or misbound avatars/media, and invalid timestamps', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.profiles.delete('friend'); },
    (f: ReturnType<typeof fixture>) => { f.profiles.get('friend').id = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.media.avatars.clear(); },
    (f: ReturnType<typeof fixture>) => { f.media.files.pop(); },
    (f: ReturnType<typeof fixture>) => { f.media.files[0].targetId = 'message'; },
    (f: ReturnType<typeof fixture>) => { f.media.files[0].id = 'avatar'; },
    (f: ReturnType<typeof fixture>) => { f.source.messages[0].createdAt = 'invalid'; },
    (f: ReturnType<typeof fixture>) => { f.source.messages[0].crystal.text = 123; },
    (f: ReturnType<typeof fixture>) => { f.source.messages[1].crystal.replyToId = 'absent'; }
  ]) { const f = fixture(); change(f); assert.throws(() => normalize(f)); }
});

test('AI source rows cannot silently inherit the human owner attribution or live authority', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.source.chat.crystal.externalSource = { provider: 'claude' }; },
    (f: ReturnType<typeof fixture>) => { f.source.messages[0].crystal.externalSource = { role: 'assistant', sessionId: 'live-session' }; },
    (f: ReturnType<typeof fixture>) => { f.source.messages[0].crystal.lopu = { role: 'assistant', toolCalls: [{ name: 'send' }] }; }
  ]) { const f = fixture(); change(f); assert.throws(() => normalize(f), /Complete chat presentation is unavailable/); }
});

test('canonical Messenger ISO edit/delete timestamps survive normalization without restoring deleted text', () => {
  const f = fixture();
  f.source.messages[1].crystal.editedAt = at.toISOString();
  f.source.messages[3].crystal.deletedAt = at.toISOString();
  const result = normalize(f);
  assert.equal(result.group.messages[1].crystal.editedAt, at.toISOString());
  assert.equal(result.group.messages[3].crystal.deleted, true);
  assert.equal(result.group.messages[3].crystal.text, '');
  for (const value of ['2026-02-30T00:00:00.000Z', '2026-09-01', '2026-09-01T00:00:00+00:00', '0', 0]) {
    for (const key of ['editedAt', 'deletedAt']) {
      const malformed = fixture(); malformed.source.messages[0].crystal[key] = value;
      assert.throws(() => normalize(malformed), /Complete chat presentation is unavailable/);
    }
  }
});

test('internal AI normalization preserves source metadata boundaries and does not enable route callers', () => {
  const f = fixture();
  const ai = { access: 'lopu', provider: 'lopu', sourceId: 'source-private', label: 'Lopu', connector: 'connector-private', readOnly: false };
  f.source.chat.crystal.externalSource = ai;
  f.source.messages = [row('question', 'self', { text: 'Question', lopu: { role: 'user', requestId: 'request-private', segmentIndex: 0, segmentCount: 1 } }),
    row('answer', 'self', { text: 'Exact assistant answer 🥰', replyToId: 'question',
      externalSource: { ...ai, readOnly: true, role: 'assistant', messageId: 'request-private', segmentIndex: 0, segmentCount: 1 },
      lopu: { role: 'assistant', requestId: 'request-private', segmentIndex: 0, segmentCount: 1 } })];
  f.source.attachments = []; f.source.reactions = [];
  f.media.files = f.media.files.filter(file => file.id === 'avatar');
  assert.throws(() => normalize(f), /Complete chat presentation/);
  const result = normalizeLiveChatArchive(f.source, 'self', f.profiles, f.media, { aiHistory: true });
  const assistant = result.group.participants.find(person => person.crystal.username === 'lopu-assistant')!;
  assert.ok(assistant);
  assert.equal(result.group.messages[0].crystal.participantId, result.group.self.id);
  assert.equal(result.group.messages[1].crystal.participantId, assistant.id);
  assert.equal(result.group.messages[1].crystal.replyToId, 'question');
  assert.equal(result.group.messages[1].crystal.text, 'Exact assistant answer 🥰');
  assert.equal(result.group.participants.find(person => person.id === 'member-friend')!.crystal.avatarFileId, 'avatar');
  assert.doesNotMatch(JSON.stringify(result), /source-private|connector-private|request-private/);
});
