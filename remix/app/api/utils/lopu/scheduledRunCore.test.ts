import assert from 'node:assert/strict';
import test from 'node:test';
import { CASCADE_CHILD_THINGTIME, validateThingtimeCrystal } from '~/schemas/registry';
import { isBillableStorageThing } from '../storage/storageCore';

const run = { title: 'Daily update', chatId: 'chat-example', scheduledAt: '2026-09-10T09:00:00Z', status: 'done' };

test('run notes are quota-billed relational children with a closed crystal', () => {
	const result = validateThingtimeCrystal(['scheduled-task-run'], { ...run, ownerId: 'intruder', acl: ['tt:all'], token: 'not-a-field' });
	assert.deepEqual(result, { ok: true, thingtime: ['scheduled-task-run'], requiresTarget: true, crystal: run });
	assert.ok(CASCADE_CHILD_THINGTIME.includes('scheduled-task-run'));
	assert.equal(isBillableStorageThing({ ownerId: 'owner', thingtime: ['scheduled-task-run'] }), true);
});

test('run notes refuse mixed schemas and invalid destination or occurrence', () => {
	for (const patch of [{ title: '' }, { title: 'x'.repeat(241) }, { chatId: '../chat' }, { scheduledAt: 'never' }, { status: 'forged' }]) {
		assert.equal(validateThingtimeCrystal(['scheduled-task-run'], { ...run, ...patch }).ok, false);
	}
	assert.equal(validateThingtimeCrystal(['scheduled-task-run', 'post'], run).ok, false);
});
