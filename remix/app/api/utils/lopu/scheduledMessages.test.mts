import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let row: any, calls: string[], notificationFails: boolean, relatedAvailable: boolean, quotaAvailable: boolean;
const things = { async updateOne(filter: any, update: any) {
	if (filter.lease !== row.lease || (filter['crystal.enabled'] && !row.crystal.enabled)) return { matchedCount: 0 };
	if (filter['crystal.activeOccurrence'] && row.crystal.activeOccurrence === filter['crystal.activeOccurrence'].$ne) return { matchedCount: 0 };
	for (const [key, value] of Object.entries(update.$set || {})) row.crystal[key.replace(/^crystal\./, '')] = value;
	return { matchedCount: 1 };
} };
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => things } });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: {
	getThing: async () => ({ ok: relatedAvailable, thing: { crystal: {} } }),
	createThing: async (owner: string, input: any) => {
		assert.equal(owner, 'owner'); assert.deepEqual(input.thingtime, ['scheduled-task-run']); assert.equal(input.targetId, 'task'); assert.deepEqual(input.acl, ['tt:user']);
		calls.push('run'); return quotaAvailable ? { ok: true, doc: { shareId: 'run' } } : { ok: false };
	},
	updateThing: async (_viewer: any, _id: string, input: any) => { calls.push(`status:${input.crystal.status || input.crystal.notificationStatus}`); return { ok: true }; }
} });
mock.module(new URL('../messenger/lopuChats.ts', import.meta.url).href, { namedExports: {
	getLopuChat: async (owner: string, id: string) => { assert.equal(owner, 'owner'); calls.push(`existing:${id}`); return { ok: true, chat: { id } }; },
	createLopuChat: async () => { calls.push('new-chat'); return { ok: true, chat: { id: 'new-chat' } }; },
	persistLopuAssistantTurn: async (owner: string, input: any) => { assert.equal(owner, 'owner'); assert.equal(input.unread, true); calls.push('message'); return { ok: true }; }
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { findUserById: async () => ({ id: 'owner' }), toPublicUserWithStorage: async (value: any) => value } });
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, { namedExports: { emitSystemNotificationOnce: async (input: any) => {
	assert.equal(input.type, 'lopu-message'); assert.equal(input.recipientId, 'owner'); calls.push('notification'); if (notificationFails) throw new Error('transport'); return true;
} } });
mock.module(new URL('../../../routes/api/v1/lopu/chats/reply/_reply.tsx', import.meta.url).href, { namedExports: { replyAsUser: async (request: Request, viewer: any, execution: any) => {
	assert.equal(viewer.id, 'owner'); assert.equal(execution.scheduled, true); assert.equal((await request.json()).chatId, 'existing'); calls.push('ai-update');
	return new Response('{"type":"delta","text":"Fresh update"}\n{"type":"done"}\n');
} } });
const { deliverScheduledLopuMessage } = await import('./scheduledMessages');
beforeEach(() => {
	row = { _id: 'control', shareId: 'schedule', ownerId: 'owner', lease: 'lease', nextRunAt: new Date('2026-09-10T09:00:00Z'), crystal: { enabled: true, title: 'Daily update', description: 'Saved reminder', mode: 'message', chatId: 'existing', relatedThingIds: ['todo'] } };
	calls = []; notificationFails = false; relatedAvailable = true; quotaAvailable = true;
});
const deliver = () => deliverScheduledLopuMessage(structuredClone(row), { shareId: 'task' }, 'lease');
test('saved messages target the owned chat, link a separate run and do not duplicate a completed occurrence', async () => {
	assert.equal(await deliver(), true);
	assert.deepEqual(calls, ['existing:existing', 'run', 'message', 'status:done', 'notification']);
	assert.equal(await deliver(), true); assert.equal(calls.filter(call => call === 'message').length, 1);
});
test('fresh updates use the scheduled read-only entry point', async () => {
	row.crystal.mode = 'assistant'; assert.equal(await deliver(), true); assert.ok(calls.includes('ai-update')); assert.ok(!calls.includes('message'));
});
test('new-conversation schedules and notification failures preserve the saved message', async () => {
	delete row.crystal.chatId; row.crystal.newChatEachRun = true; notificationFails = true;
	assert.equal(await deliver(), true); assert.ok(calls.includes('new-chat')); assert.ok(calls.includes('status:unavailable')); assert.equal(row.crystal.enabled, true);
});
test('unavailable context, quota failures and ambiguous claims stop without blind replay', async () => {
	relatedAvailable = false; assert.equal(await deliver(), false); assert.deepEqual(calls, []); assert.equal(row.crystal.enabled, false);
	relatedAvailable = true; row.crystal.enabled = true; delete row.crystal.activeOccurrence; quotaAvailable = false;
	assert.equal(await deliver(), false); assert.ok(!calls.includes('message'));
	row.crystal.enabled = true; row.crystal.runStatus = 'running'; calls = [];
	assert.equal(await deliver(), false); assert.deepEqual(calls, []); assert.equal(row.crystal.runStatus, 'needs-attention');
});
test('paused or lost-lease runs cannot start a message', async () => {
	row.crystal.enabled = false; assert.equal(await deliver(), false); assert.deepEqual(calls, []);
	row.crystal.enabled = true; row.lease = 'different'; assert.equal(await deliver(), false); assert.deepEqual(calls, []);
});
