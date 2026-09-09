import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let existing = false;
let committed = false;
let allowed = true;
let pushFails = false;
let pushes: any[] = [];
const things = {
	findOne: async () => existing ? { shareId: 'daily-id' } : null,
	insertOne: async () => { existing = true; },
	countDocuments: async () => 1
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
	getHomeThingsCollection: async () => things, getUsersCollection: async () => ({}),
	withHomeMongoTransaction: async (fn: any) => { const result = await fn({}); committed = true; return result; }
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
	getUserNotificationPrefs: async () => ({ masters: { push: allowed } })
} });
mock.module(new URL('./emails.ts', import.meta.url).href, { namedExports: {
	emailNotificationsBulk: async () => {}, maybeEmailNotification: async () => {}
} });
mock.module(new URL('./apns.ts', import.meta.url).href, { namedExports: {
	sendNotificationPush: async (input: any) => {
		assert.equal(committed, true);
		pushes.push(input);
		if (pushFails) throw new Error('Synthetic transport failure');
	}
} });
const { emitSystemNotificationOnce } = await import('./notifications');
const input = { recipientId: 'owner', type: 'recording-reminder' as const, title: 'Daily reminder', href: '/lopu/recordings' };
beforeEach(() => { existing = false; committed = false; allowed = true; pushFails = false; pushes = []; });
test('one committed daily row fans out once with the same notification identity', async () => {
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => true), true);
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => true), false);
	assert.equal(pushes.length, 1);
	assert.equal(pushes[0].notificationId, 'daily-id');
});
test('preferences and a rejected private-todo checkpoint prevent native push', async () => {
	allowed = false;
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => true), false);
	allowed = true;
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => false), false);
	assert.equal(pushes.length, 0);
});
test('best-effort push failure cannot duplicate the durable daily notification', async () => {
	pushFails = true;
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => true), true);
	assert.equal(await emitSystemNotificationOnce(input, 'daily-id', async () => true), false);
	assert.equal(pushes.length, 1);
});
