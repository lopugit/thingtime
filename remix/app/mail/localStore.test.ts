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

test('Gmail compose drafts retain all fields and operation identity in encrypted owner-scoped rows', async () => {
	const value = emptyLocalMail();
	value.composeDrafts.push({
		id: 'draft_one',
		accountId: 'gmail_one',
		localRevision: 1,
		to: 'reader@example.test',
		cc: '',
		bcc: 'private@example.test',
		subject: 'Saved 🌈',
		text: 'Private draft body',
		sendWriteId: 'attempt_one'
	});
	const saved = await writeMailLocal('compose_owner', value);
	assert.deepEqual((await readMailLocal('compose_owner')).composeDrafts, saved.composeDrafts);
	assert.deepEqual((await readMailLocal('different_compose_owner')).composeDrafts, []);
	await assert.rejects(writeMailLocal('compose_owner', value), /another tab/);
	await clearMailLocal('compose_owner');
});
