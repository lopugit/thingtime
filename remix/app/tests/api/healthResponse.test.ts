import assert from 'node:assert/strict';
import test from 'node:test';
import { nitroHealthResponseIsConsistent } from './healthResponse.ts';

test('Nitro smoke accepts honest readiness and migration-required contracts', () => {
	const ready = { service: 'nitro', runtime: 'nitro', ok: true, state: 'ready', storageAccounting: { state: 'ready', expectedVersion: 2, migrationId: 'backfill-user-storage-accounting' } };
	assert.equal(nitroHealthResponseIsConsistent(ready), true);
	const degraded = { ...ready, ok: false, state: 'degraded', storageAccounting: { ...ready.storageAccounting, state: 'migration-required' } };
	assert.equal(nitroHealthResponseIsConsistent(degraded), true);
	for (const invalid of [null, {}, { ...ready, ok: false }, { ...degraded, ok: true }, { ...ready, state: 'degraded' }, { ...ready, storageAccounting: null }, { ...ready, state: 'unavailable' }]) {
		assert.equal(nitroHealthResponseIsConsistent(invalid), false);
	}
});
