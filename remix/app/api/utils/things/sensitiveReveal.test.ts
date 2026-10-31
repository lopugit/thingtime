import assert from 'node:assert/strict';
import test from 'node:test';

import { createSensitiveThingRevealer } from './sensitiveReveal';

const thingId = 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90';
const reference = 'mongodb-object-id-1';
const rawValue = '507f1f77bcf86cd799439011';

test('sensitive reveal provider pins migration lookup to the current admin owner', async () => {
	const calls: unknown[][] = [];
	const reveal = createSensitiveThingRevealer({
		getMigrationReveal: async (ownerId, requestedThingId, requestedReference) => {
			calls.push([ownerId, requestedThingId, requestedReference]);
			return { reference, kind: 'mongodb-object-id', label: 'MongoDB ObjectId #1', value: rawValue };
		}
	});

	assert.deepEqual(await reveal({ id: 'admin-1', isAdmin: true } as any, thingId, reference), {
		reference,
		kind: 'mongodb-object-id',
		label: 'MongoDB ObjectId #1',
		value: rawValue
	});
	assert.deepEqual(calls, [['admin-1', thingId, reference]]);
});

test('sensitive reveal provider rejects non-admin and arbitrary selectors before lookup', async () => {
	let calls = 0;
	const reveal = createSensitiveThingRevealer({
		getMigrationReveal: async () => {
			calls += 1;
			return null;
		}
	});

	assert.equal(await reveal({ id: 'user-1', isAdmin: false } as any, thingId, reference), null);
	assert.equal(await reveal({ id: 'admin-1', isAdmin: true } as any, 'ordinary-thing', reference), null);
	assert.equal(await reveal({ id: 'admin-1', isAdmin: true } as any, thingId, { path: 'secure.anything' }), null);
	assert.equal(calls, 0);
});
