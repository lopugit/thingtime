import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultEnvironmentMover } from './userVault';

test('moving secrets and providers only writes group metadata and never returns encryption', async () => {
	for (const recordKind of ['secret', 'provider']) {
		const writes: any[] = [];
		const doc = {
			shareId: 'entry-1234',
			ownerId: 'owner',
			crystal: { recordKind, name: 'Example', groupId: null, encryptedValue: { cipherText: 'sealed', iv: 'iv', tag: 'tag' }, createdAt: 'earlier' }
		};
		const move = createVaultEnvironmentMover({
			ownVaultDoc: async (owner, id) => {
				assert.equal(owner, 'owner');
				assert.equal(id, doc.shareId);
				return doc;
			},
			assertGroup: async (owner, group) => {
				assert.equal(owner, 'owner');
				return group || null;
			},
			updateThing: async (...args) => {
				writes.push(args);
				return { ok: true };
			}
		} as any);
		for (const groupId of ['production-group', null, '']) {
			const result = await move('owner', { id: doc.shareId, groupId });
			assert.equal(result.groupId, groupId || null);
			assert.equal(result.hasValue, true);
			assert.ok(!JSON.stringify(result).includes('sealed'));
			assert.deepEqual(Object.keys(writes[writes.length - 1][2].crystal).sort(), ['groupId', 'updatedAt']);
			assert.deepEqual(writes[writes.length - 1][0], { id: 'owner' });
		}
	}
});
test('missing/foreign entries and non-owned environments cannot be moved', async () => {
	let writes = 0;
	const base = {
		ownVaultDoc: async () => null,
		assertGroup: async () => null,
		updateThing: async () => {
			writes++;
			return { ok: true };
		}
	};
	await assert.rejects(createVaultEnvironmentMover(base as any)('owner', { id: 'foreign', groupId: '' }), /not found/);
	await assert.rejects(
		createVaultEnvironmentMover({ ...base, ownVaultDoc: async () => ({ crystal: { recordKind: 'group' } }) } as any)('owner', {
			id: 'group',
			groupId: ''
		}),
		/not found/
	);
	const valid = { ...base, ownVaultDoc: async () => ({ shareId: 'owned', crystal: { recordKind: 'secret' } }) };
	await assert.rejects(createVaultEnvironmentMover(valid as any)('owner', { id: 'owned' }), /Choose an environment/);
	await assert.rejects(
		createVaultEnvironmentMover({
			...valid,
			assertGroup: async () => {
				throw new Error('Vault environment was not found.');
			}
		} as any)('owner', { id: 'owned', groupId: 'foreign' }),
		/not found/
	);
	assert.equal(writes, 0);
});
