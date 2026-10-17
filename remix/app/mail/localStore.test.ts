import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLocalMail, readMailLocal, writeMailLocal, clearMailLocal } from './localStore';
Object.defineProperty(globalThis, 'location', { value: { origin: 'https://mail-test.example' } });
test('encrypted offline store survives reopen and is isolated by account', async () => {
	const value = emptyLocalMail();
	value.connectorToken = 'fixture-secret-that-must-not-be-plaintext';
	const saved = await writeMailLocal('owner_one', value);
	assert.deepEqual(await readMailLocal('owner_one'), saved);
	assert.equal((await readMailLocal('owner_two')).connectorToken, '');
	const db = await new Promise<IDBDatabase>((resolve) => {
		const request = indexedDB.open('thingtime-mail-v1');
		request.onsuccess = () => resolve(request.result);
	});
	const stored = await new Promise<any>((resolve) => {
		const request = db.transaction('records').objectStore('records').index('scope').getAll('https://mail-test.example:owner_one');
		request.onsuccess = () => resolve(request.result);
	});
	assert.equal(JSON.stringify(stored).includes(value.connectorToken), false);
	const key = await new Promise<CryptoKey>((resolve) => {
		const request = db.transaction('keys').objectStore('keys').get('https://mail-test.example:owner_one');
		request.onsuccess = () => resolve(request.result);
	});
	assert.equal(key.extractable, false);
	db.close();
	await clearMailLocal('owner_one');
	assert.equal((await readMailLocal('owner_one')).connectorToken, '');
});

test('stale device writers cannot erase another tab’s changes', async () => {
	const first = emptyLocalMail();
	first.connectorToken = 'first';
	const saved = await writeMailLocal('race_owner', first);
	await assert.rejects(writeMailLocal('race_owner', { ...first, connectorToken: 'stale' }), /another tab/);
	assert.equal((await readMailLocal('race_owner')).connectorToken, saved.connectorToken);
	await clearMailLocal('race_owner');
});
