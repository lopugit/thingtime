import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let reads = 0, writes = 0, transactions = 0;
let loseOwnership = false;
let collision: Error & { code?: number };
const observedOptions: any[] = [];
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
	getHomeThingsCollection: async () => ({
		findOne: async (query: any, options: any) => {
			reads++; observedOptions.push(options);
			return query.thingtime === 'device' && !(loseOwnership && writes) ? { shareId: 'device', ownerId: 'owner' } : null;
		},
		find: (_query: any, options: any) => { observedOptions.push(options); return { toArray: async () => [] }; }
	}),
	getSessionsCollection: async () => ({}),
	withHomeMongoTransaction: async (work: any) => { transactions++; return work({}); }
} });
mock.module(new URL('../storage/accountedThings.ts', import.meta.url).href, { namedExports: {
	insertAccountedThing: async (_collection: any, _doc: any, options: any) => { observedOptions.push(options); writes++; throw collision; },
	updateAccountedThing: async () => { throw Error('Unexpected update'); },
	deleteAccountedThings: async () => { throw Error('Unexpected delete'); }
} });
const { updateDeviceState } = await import('./devices');
const snapshot = { revision: 1, state: { locked: false }, connectors: [] };
beforeEach(() => {
	reads = 0; writes = 0; transactions = 0; loseOwnership = false; observedOptions.length = 0;
	collision = Object.assign(new Error('duplicate snapshot'), { code: 11000 });
});
test('real snapshot path returns conflict after three persistent transaction collisions', async () => {
	const controller = new AbortController();
	const result = await updateDeviceState('owner', 'device', snapshot, { signal: controller.signal });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.status, 409);
	assert.equal(writes, 3); assert.equal(transactions, 3);
	assert.ok(observedOptions.every(options => options.signal === controller.signal && options.timeoutMS > 0 && options.timeoutMS <= 5000));
});
test('collision retries reauthorize ownership and stop immediately after revocation', async () => {
	loseOwnership = true;
	const result = await updateDeviceState('owner', 'device', snapshot);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.status, 404);
	assert.equal(writes, 1); assert.equal(transactions, 1);
});
test('aborted snapshots never read or write; unrelated storage failures are not retried', async () => {
	const controller = new AbortController(); controller.abort();
	await assert.rejects(updateDeviceState('owner', 'device', snapshot, { signal: controller.signal }), { name: 'AbortError' });
	assert.equal(reads, 0); assert.equal(writes, 0);
	collision = new Error('storage unavailable');
	await assert.rejects(updateDeviceState('owner', 'device', snapshot), /storage unavailable/);
	assert.equal(writes, 1);
});
