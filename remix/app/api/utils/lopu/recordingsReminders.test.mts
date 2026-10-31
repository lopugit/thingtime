import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { DEFAULT_RECORDING_SETTINGS, RECORDING_REMINDER_KIND } from './recordingsCore';

// In-memory transaction collaborators. No real account, database or push writes.
let settings: any;
let reminder: any;
let todo: any;
let available: boolean;
let beforeCommit: () => void;
let emitted: any[];
let uniqueIds: Set<string>;
const things = {
	async findOneAndUpdate() {
		if (!available || !reminder.crystal.enabled) return null;
		available = false;
		return structuredClone(reminder);
	},
	async findOne(filter: any) {
		return filter.thingtime === 'data' ? structuredClone(todo) : { _id: 'settings', crystal: structuredClone(settings) };
	},
	async deleteOne() { todo = null; },
	async updateOne(filter: any, update: any) {
		if (filter._id === 'settings') return { matchedCount: 1 };
		if (filter._id === 'todo') return { matchedCount: todo && !todo.crystal.completed && !todo.appId && JSON.stringify(todo.acl) === '["tt:user"]' ? 1 : 0 };
		if (filter['crystal.enabled']) {
			if (!reminder.crystal.enabled || reminder.crystal.lastDay === filter['crystal.lastDay'].$ne) return { matchedCount: 0 };
			reminder.crystal.lastDay = update.$set['crystal.lastDay'];
		}
		return { matchedCount: 1 };
	}
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => things } });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: { updateThing: async () => ({ ok: true }) } });
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, {
	namedExports: { getRecordingSettings: async () => structuredClone(settings), recordingId: (...parts: string[]) => parts.join(':') }
});
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, {
	namedExports: {
		emitSystemNotificationOnce: async (input: any, id: string, checkpoint: (session: any) => Promise<boolean>) => {
			beforeCommit();
			if (uniqueIds.has(id) || !await checkpoint({ transaction: true })) return false;
			uniqueIds.add(id);
			emitted.push(input);
			return true;
		}
	}
});
const { sendRecordingReminders } = await import('./recordingsReminders');
beforeEach(() => {
	settings = { ...DEFAULT_RECORDING_SETTINGS, enabled: true, reminderHour: 0 };
	reminder = { _id: 'reminder', ownerId: 'owner', targetId: 'todo', thingtime: RECORDING_REMINDER_KIND, lease: 'lease', crystal: { enabled: true } };
	todo = { _id: 'todo', shareId: 'todo', ownerId: 'owner', acl: ['tt:user'], updatedAt: new Date(), crystal: { title: 'Buy bike tubes', completed: false } };
	available = true;
	beforeCommit = () => {};
	emitted = [];
	uniqueIds = new Set();
});
test('an unfinished private todo emits once per local day, including overlapping retry', async () => {
	assert.deepEqual(await sendRecordingReminders(), { sent: 1, failed: 0 });
	assert.equal(emitted[0].type, 'recording-reminder');
	assert.equal(emitted[0].href, '/lopu/recordings');
	available = true;
	assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
	delete reminder.crystal.lastDay; // A retry also encounters the durable notification id.
	available = true;
	assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
	assert.equal(emitted.length, 1);
});
test('completed, public, deleted and app-owned todos do not emit', async () => {
	for (const change of [() => { todo.crystal.completed = true; }, () => { todo.crystal.completed = false; todo.acl = ['tt:public']; }, () => { todo.acl = ['tt:user']; todo.appId = 'app'; }, () => { todo = null; }]) {
		change(); available = true;
		assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
	}
	assert.equal(emitted.length, 0);
});
test('completion racing emission is checked inside the transaction', async () => {
	beforeCommit = () => { todo.crystal.completed = true; };
	assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
	assert.equal(reminder.crystal.lastDay, undefined);
});
test('global opt-out and daily-reminder opt-out racing emission prevent notification', async () => {
	for (const key of ['enabled', 'dailyReminders']) {
		settings.enabled = true; settings.dailyReminders = true; available = true;
		beforeCommit = () => { settings[key] = false; };
		assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
	}
	assert.equal(emitted.length, 0);
});
test('pausing one todo while emission is in flight prevents its notification', async () => {
	beforeCommit = () => { reminder.crystal.enabled = false; };
	assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 0 });
});
test('a transaction failure is reported and remains retryable', async () => {
	beforeCommit = () => { throw new Error('Storage unavailable'); };
	assert.deepEqual(await sendRecordingReminders(), { sent: 0, failed: 1 });
	assert.equal(reminder.crystal.lastDay, undefined);
	beforeCommit = () => {}; available = true;
	assert.deepEqual(await sendRecordingReminders(), { sent: 1, failed: 0 });
});
