import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mock, test } from 'node:test';

// Real vault encryption/decryption and ownership selection over an in-memory
// persistence seam. No provider, database, personal account or real secret.
const docs = new Map<string, any>();
mock.module('../mongodb/collections.ts', { namedExports: {
 getThingsCollection: async () => ({ findOne: async (query: any) => {
  const row = docs.get(query.shareId);
  return row?.ownerId === query.ownerId ? row : null;
 } })
} });
mock.module('../things/things.ts', { namedExports: {
 isFail: (result: any) => result?.ok === false,
 createThing: async (ownerId: string, input: any) => { docs.set(input.shareId, { ...input, ownerId }); return { ok: true }; },
 updateThing: async (owner: any, id: string, patch: any) => { assert.equal(docs.get(id)?.ownerId, owner.id); docs.set(id, { ...docs.get(id), ...patch }); return { ok: true }; },
 deletePost: async (owner: any, id: string) => { assert.equal(docs.get(id)?.ownerId, owner.id); docs.delete(id); return { ok: true }; }
} });
const { saveUserVaultProvider, getUserVaultProvider, deleteUserVaultRecord } = await import('./userVault.ts');

test('Console vault mode encrypts two independent credentials, retains mode, denies foreign owners and removes only the selected record', async () => {
 const prior = process.env.THINGTIME_USER_VAULT_KEY;
 process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
 try {
  const base = { name: 'Console', provider: 'anthropic-api-key', endpoint: 'https://api.anthropic.com', model: 'claude-synthetic' };
  const first = await saveUserVaultProvider('owner-one', { ...base, token: 'synthetic-first-key' });
  const second = await saveUserVaultProvider('owner-one', { ...base, token: 'synthetic-second-key' });
  assert.doesNotMatch(JSON.stringify([...docs.values()]), /synthetic-first-key|synthetic-second-key/);
  assert.doesNotMatch(JSON.stringify([first, second]), /encryptedValue|cipherText|synthetic-first-key|synthetic-second-key/);
  assert.equal(first.provider, 'anthropic-api-key');
  assert.equal((await getUserVaultProvider('owner-one', first.id)).token, 'synthetic-first-key');
  assert.equal((await getUserVaultProvider('owner-one', second.id)).token, 'synthetic-second-key');
  await assert.rejects(getUserVaultProvider('owner-two', first.id), /not found/);
  await assert.rejects(saveUserVaultProvider('owner-two', { ...base, id: first.id, token: 'foreign-key' }), /not found/);
  await assert.rejects(deleteUserVaultRecord('owner-two', first.id), /not found/);
  const renamed = await saveUserVaultProvider('owner-one', { ...base, id: second.id, name: 'Renamed' });
  assert.equal(renamed.name, 'Renamed');assert.equal((await getUserVaultProvider('owner-one', second.id)).token, 'synthetic-second-key');
  await deleteUserVaultRecord('owner-one', first.id);
  await assert.rejects(getUserVaultProvider('owner-one', first.id), /not found/);
  assert.equal((await getUserVaultProvider('owner-one', second.id)).token, 'synthetic-second-key');
  const legacy = await saveUserVaultProvider('owner-one', { ...base, provider: 'anthropic', token: 'sk-ant-oat-synthetic' });
  await assert.rejects(saveUserVaultProvider('owner-one', { ...base, id: legacy.id }), /Supply a Console API key/);
  await assert.rejects(saveUserVaultProvider('owner-one', { ...base, token: 'sk-ant-oat-synthetic' }), /Console API key/);
  await assert.rejects(saveUserVaultProvider('owner-one', { ...base, endpoint: 'https://another.example', token: 'synthetic-key' }), /require https/);
  assert.equal((await getUserVaultProvider('owner-one', legacy.id)).provider, 'anthropic');
 } finally { if (prior === undefined) delete process.env.THINGTIME_USER_VAULT_KEY; else process.env.THINGTIME_USER_VAULT_KEY = prior; }
});
