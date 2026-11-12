import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertBackupObjectKey } from './backupObjectKey';
import { openLocalBackupStore } from './localBackupStore';

test('shared provider allowlist permits only generated immutable restore review keys', async () => {
	const id = randomUUID(), root = `restore-plans/${id}`;
	for (const key of [`${root}/header.json`, `${root}/sealed.json`, `${root}/pages/0.json`, `${root}/pages/128.json`, `${root}/references/nodes/${"a".repeat(64)}`, `${root}/references/bundles/${"b".repeat(64)}/0.json`, `${root}/references/blobs/${"c".repeat(64)}/0`]) assert.doesNotThrow(() => assertBackupObjectKey(key));
	for (const suffix of ['complete.json', '../header.json', 'pages/-1.json', 'pages/01.json', 'pages/0.json/extra', 'pages/0/bytes', 'credentials.json', 'references/nodes/not-a-hash', 'references/bundles/'+ 'a'.repeat(64)+'/../0.json', 'references/blobs/'+ 'a'.repeat(64)+'/01'])
		assert.throws(() => assertBackupObjectKey(`${root}/${suffix}`));
	assert.throws(() => assertBackupObjectKey('restore-plans/------------------------------------/header.json'));
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-restore-key-'));
	try {
		const store = await openLocalBackupStore(join(directory, 'plans')), key = `${root}/pages/0.json`, bytes = Buffer.from('immutable reviewed page');
		await store.put(key, bytes); await store.put(key, bytes);
		await assert.rejects(store.put(key, Buffer.from('changed review')));
		assert.deepEqual(Buffer.from((await store.read(key, 1024))!), bytes);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
