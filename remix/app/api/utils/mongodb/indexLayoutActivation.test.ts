import assert from 'node:assert/strict';
import test from 'node:test';
import { activateIndexLayout, INDEX_LAYOUT_DRAIN_MS } from './indexLayoutActivation';

test('activation preserves a stable drain deadline across retries and only then permits retirement', async () => {
	let marker: any = null;
	let writes = 0;
	const settings = { findOne: async () => marker, updateOne: async (_filter: any, update: any) => { marker = update.$set; writes++; } };
	const lease = async () => {};
	assert.equal((await activateIndexLayout(settings, 'test', lease, 1000)).retirementReady, false);
	assert.equal((await activateIndexLayout(settings, 'test', lease, 1001)).remainingMs, INDEX_LAYOUT_DRAIN_MS - 1);
	assert.equal((await activateIndexLayout(settings, 'test', lease, 1000 + INDEX_LAYOUT_DRAIN_MS)).retirementReady, true);
	assert.equal(writes, 1);
	assert.equal(marker.activatedAt.getTime(), 1000);
});

test('old, malformed, future and revoked markers require a fresh drain; lease loss cannot activate', async () => {
	for (const initial of [{ ready: true }, { ready: true, activatedAt: 'invalid' }, { ready: true, activatedAt: new Date(9999) }, { ready: false, activatedAt: new Date(0) }]) {
		let marker: any = initial;
		const settings = { findOne: async () => marker, updateOne: async (_filter: any, update: any) => { marker = update.$set; } };
		await assert.rejects(activateIndexLayout(settings, 'test', async () => { throw new Error('lease lost'); }, 1000), /lease lost/);
		assert.equal(marker, initial);
		assert.equal((await activateIndexLayout(settings, 'test', async () => {}, 1000)).retirementReady, false);
		assert.ok(marker.activatedAt instanceof Date);
		assert.equal(marker.activatedAt.getTime(), 1000);
	}
});
