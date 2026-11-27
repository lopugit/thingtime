import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AUTOMATION_SWITCHES } from '../../../automation/automationSwitches';
import { AUTOMATION_SWITCHES_KEY, createAutomationSwitchesStore, idToStoredKey, storedKeyToId } from './automationSwitchesStore';

test('switch ids round-trip through their stored keys', () => {
	for (const id of ['web.timeline', 'desktop.fileSync', 'scheduled.email-weekly-summary']) assert.equal(storedKeyToId(idToStoredKey(id)), id);
	assert.equal(idToStoredKey('scheduled.invites-expire'), 'scheduled_invites-expire');
});

test('a save sets only the changed switches in one update and reads back the result', async () => {
	let row: Record<string, any> | null = null;
	const writes: Record<string, unknown>[] = [];
	const store = createAutomationSwitchesStore({
		read: async () => row,
		write: async (set) => {
			writes.push(set);
			const switches = { ...(row?.switches ?? {}) };
			for (const [path, value] of Object.entries(set)) if (path.startsWith('switches.')) switches[path.slice(9)] = value;
			row = { switches, updatedAt: set.updatedAt, updatedBy: set.updatedBy };
		},
		now: () => new Date('2026-11-25T12:00:00Z')
	});
	const saved = await store.change({ 'web.timeline': true, 'scheduled.invites-expire': false }, 'admin-1');
	assert.deepEqual(writes, [{ key: AUTOMATION_SWITCHES_KEY, updatedAt: new Date('2026-11-25T12:00:00Z'), updatedBy: 'admin-1',
		'switches.web_timeline': true, 'switches.scheduled_invites-expire': false }]);
	assert.equal(saved.switches['web.timeline'], true);
	assert.equal(saved.switches['scheduled.invites-expire'], false);
	assert.equal(saved.switches['mac.node'], false);
	assert.equal(saved.updatedBy, 'admin-1');
	assert.equal(saved.updatedAt, '2026-11-25T12:00:00.000Z');
	await assert.rejects(store.change({ 'web.nope': true }, 'admin-1'), TypeError);
	assert.equal(writes.length, 1);
});

test('enforcement reads fail to last-known-good, and to all-off when nothing was read yet', async () => {
	let fail = true;
	const store = createAutomationSwitchesStore({
		read: async () => { if (fail) throw new Error('mongo down'); return { switches: { web_lopu: true } }; },
		write: async () => {}
	});
	assert.deepEqual((await store.read()).switches, DEFAULT_AUTOMATION_SWITCHES);
	await assert.rejects(store.readStrict());
	fail = false;
	assert.equal((await store.read()).switches['web.lopu'], true);
	fail = true;
	assert.equal((await store.read()).switches['web.lopu'], true);
});
