import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let enabled: boolean, privateSource: boolean, row: any, chats: number, calls: number, fail: boolean;
const things = {
  find(filter: any) { const rows = filter.thingtime === 'comment' ? [{ shareId: 'comment', crystal: { text: 'Create a note about the garden.' } }] : row.crystal.handoffStatus === 'queued' ? [structuredClone(row)] : []; return { sort() { return this; }, limit() { return this; }, toArray: async () => rows }; },
  async updateMany() { if (!row.crystal.handoffStatus) row.crystal.handoffStatus = 'queued'; },
  async updateOne(filter: any, update: any) { if (filter['crystal.handoffStatus'] && row.crystal.handoffStatus !== filter['crystal.handoffStatus']) return { matchedCount: 0 }; for (const [key, value] of Object.entries(update.$set || {})) { if (key.startsWith('crystal.')) row.crystal[key.slice(8)] = value; } return { matchedCount: 1 }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => things } });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { findUserById: async () => ({ id: 'owner' }), toPublicUserWithStorage: async (user: any) => user } });
mock.module(new URL('../messenger/lopuChats.ts', import.meta.url).href, { namedExports: { createLopuChat: async () => { chats++; return { ok: true, chat: { id: 'chat-receipt' } }; } } });
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, { namedExports: { getRecordingSettings: async () => ({ enabled }), queueRecordingPost: async () => privateSource ? 1 : 0, recordingJobState: () => ({ commentIds: ['comment'] }), recordingSource: async () => privateSource ? {} : null } });
mock.module(new URL('../../../routes/api/v1/lopu/chats/reply/_reply.tsx', import.meta.url).href, { namedExports: { replyAsUser: async (request: Request, user: any) => { calls++; assert.equal(user.id, 'owner'); assert.equal(row.crystal.handoffStatus, 'started'); assert.equal(row.crystal.handoffChatId, 'chat-receipt'); const body = await request.json(); assert.match(body.text, /Create a note about the garden/); if (fail) throw new Error('Ambiguous interruption'); return new Response('{"type":"done"}\n'); } } });
const { requestRecordingHandoff, runRecordingHandoffs } = await import('./recordingHandoff');
beforeEach(() => { enabled = true; privateSource = true; chats = 0; calls = 0; fail = false; row = { _id: 'job', shareId: 'job', ownerId: 'owner', targetId: 'post', crystal: { filename: 'Recording.m4a' } }; });
test('handoff requires explicit recording opt-in and private owned source', async () => {
  enabled = false; assert.equal((await requestRecordingHandoff('owner', 'post')).ok, false);
  enabled = true; privateSource = false; assert.equal((await requestRecordingHandoff('owner', 'post')).ok, false);
  assert.equal(calls, 0);
});
test('repeated Send to Lopu requests dispatch only once into a persisted conversation', async () => {
  await requestRecordingHandoff('owner', 'post'); await requestRecordingHandoff('owner', 'post');
  assert.deepEqual(await runRecordingHandoffs(), { sent: 1 });
  await requestRecordingHandoff('owner', 'post'); assert.deepEqual(await runRecordingHandoffs(), { sent: 0 });
  assert.equal(chats, 1); assert.equal(calls, 1); assert.equal(row.crystal.handoffStatus, 'sent');
});
test('an ambiguous action dispatch never silently repeats side effects', async () => {
  await requestRecordingHandoff('owner', 'post'); fail = true;
  assert.deepEqual(await runRecordingHandoffs(), { sent: 0 }); assert.equal(row.crystal.handoffStatus, 'needs-attention');
  await requestRecordingHandoff('owner', 'post'); await runRecordingHandoffs(); assert.equal(calls, 1);
});
test('revoking consent or source privacy before dispatch prevents all tool calls', async () => {
  await requestRecordingHandoff('owner', 'post'); enabled = false; await runRecordingHandoffs();
  enabled = true; privateSource = false; await runRecordingHandoffs(); assert.equal(calls, 0); assert.equal(chats, 0);
});
