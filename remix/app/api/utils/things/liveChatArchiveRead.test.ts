import assert from 'node:assert/strict';
import test from 'node:test';
import { readLiveChatArchiveSource } from './liveChatArchiveRead';

const row = (kind: string, shareId: string, ownerId = 'self', targetId = 'chat', crystal: any = {}) =>
  ({ thingtime: [kind], shareId, ownerId, targetId, crystal });
const fixture = () => {
  const chat = row('chat', 'chat');
  const member = row('chat-member', 'membership', 'self', 'chat', { state: 'active', memberKey: 'chat:self' });
  const rows: Record<string, any[]> = {
    'chat-member': [member, row('chat-member', 'former-membership', 'former', 'chat', { state: 'left' })],
    'chat-message': [row('chat-message', 'message'), row('chat-message', 'thread', 'former', 'chat', { threadRootId: 'message' })],
    reaction: [row('reaction', 'reaction', 'former', 'thread', { emoji: '🥰' })],
    attachment: [{ ...row('attachment', 'file', 'former', 'thread'), attachmentState: 'ready', attachmentPurpose: 'message' }]
  };
  const calls: any[] = [];
  const session = {};
  let active = false;
  const collection = {
    async findOne(filter: any, options: any) {
      assert.equal(active, true); assert.equal(options.session, session);
      calls.push({ filter, options });
      return filter.thingtime === 'chat' ? chat : member;
    },
    find(filter: any, options: any) {
      assert.equal(active, true); assert.equal(options.session, session);
      const call: any = { filter, options }; calls.push(call);
      return { sort(order: any) { call.order = order; return this; },
        limit(count: number) { assert.ok(count > 0); call.limit = count; return this; },
        async toArray() { return rows[filter.thingtime].slice(0, call.limit); } };
    }
  };
  const deps = {
    custom: () => false,
    async collection() { return collection; },
    async membershipFilter(field: string, value: string, options: any) {
      assert.equal(active, false); assert.equal(field, 'memberKey'); assert.equal(value, 'chat:self');
      assert.deepEqual(options, { home: true }); return { 'crystal.memberKey': value };
    },
    async transaction(work: (session: any) => Promise<any>) {
      assert.equal(active, false); active = true;
      try { return await work(session); } finally { active = false; }
    }
  };
  return { chat, member, rows, calls, deps };
};
const read = (f: ReturnType<typeof fixture>) => readLiveChatArchiveSource('self', 'chat', f.deps as any);

test('one authorized snapshot includes former members and thread history with explicit projections', async () => {
  const f = fixture(); const result = await read(f);
  assert.equal(result!.members.length, 2); assert.equal(result!.messages.length, 2);
  assert.equal(result!.attachments.length, 1);
  for (const call of f.calls) {
    assert.equal(call.options.maxTimeMS, 5000);
    assert.equal(call.options.projection._id, 0);
    for (const key of ['secure', 'acl', 'crystal', 'storageKey', 'uniqueKeys']) assert.equal(call.options.projection[key], undefined);
  }
  const history = f.calls.find(c => c.filter.thingtime === 'chat-message');
  assert.deepEqual(history.filter, { thingtime: 'chat-message', targetId: 'chat' });
  assert.deepEqual(history.order, { createdAt: 1, shareId: 1 });
});

test('denied membership never reads history; pending members retain read access', async () => {
  for (const state of ['left', 'declined', 'unknown', undefined]) {
    const f = fixture(); f.member.crystal.state = state;
    assert.equal(await read(f), null); assert.equal(f.calls.length, 2);
  }
  for (const alter of [
    (f: ReturnType<typeof fixture>) => { f.member.ownerId = 'stranger'; },
    (f: ReturnType<typeof fixture>) => { f.member.targetId = 'other-chat'; },
    (f: ReturnType<typeof fixture>) => { f.member.crystal.memberKey = 'other:self'; },
    (f: ReturnType<typeof fixture>) => { Object.assign(f.chat, { sandbox: 'other' }); }
  ]) { const f = fixture(); alter(f); assert.equal(await read(f), null); assert.ok(f.calls.length <= 2); }
  const pending = fixture(); pending.member.crystal.state = 'pending'; assert.ok(await read(pending));
  const custom = fixture(); custom.deps.custom = () => true; assert.equal(await read(custom), null); assert.equal(custom.calls.length, 0);
});

test('inconsistent, foreign, duplicate and oversized history fails closed', async () => {
  for (const alter of [
    (f: ReturnType<typeof fixture>) => { f.rows['chat-member'].pop(); f.rows['chat-member'].push({ ...f.member, shareId: 'duplicate' }); },
    (f: ReturnType<typeof fixture>) => { f.rows['chat-message'][0].targetId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.rows['chat-message'][0].appId = 'other'; },
    (f: ReturnType<typeof fixture>) => { f.rows['chat-message'][0].thingtime.push('private'); },
    (f: ReturnType<typeof fixture>) => { f.rows.reaction[0].targetId = 'absent'; },
    (f: ReturnType<typeof fixture>) => { f.rows.attachment[0].ownerId = 'not-author'; },
    (f: ReturnType<typeof fixture>) => { f.rows.attachment[0].shareId = 'message'; },
    (f: ReturnType<typeof fixture>) => { f.rows['chat-message'] = Array.from({ length: 1000 }, (_, i) => row('chat-message', `m-${i}`)); },
    (f: ReturnType<typeof fixture>) => { f.rows['chat-message'][0].crystal.text = 'x'.repeat(16 * 1024 * 1024); }
  ]) { const f = fixture(); alter(f); await assert.rejects(read(f), /Complete chat history is unavailable/); }
});

test('exactly exhausted row budget uses a bounded overflow sentinel, never limit zero', async () => {
  const f = fixture();
  f.rows['chat-member'] = [f.member, ...Array.from({ length: 998 }, (_, i) => row('chat-member', `member-${i}`, `user-${i}`))];
  f.rows['chat-message'] = []; f.rows.reaction = []; f.rows.attachment = [];
  assert.ok(await read(f));
  assert.equal(f.calls.find(c => c.filter.thingtime === 'chat-message').limit, 1);
  f.rows['chat-message'].push(row('chat-message', 'overflow'));
  await assert.rejects(read(f), /Complete chat history is unavailable/);
});
