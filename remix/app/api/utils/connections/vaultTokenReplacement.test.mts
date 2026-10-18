import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { createVaultDataKey, openVaultValue, sealVaultValue } from '../auth/vaultEnvelope';

// Exercise the real vault utility and HTTP action. Only persistence, session
// lookup and rate limiting are replaced; encryption stays owner/record-bound.
const ownerId = 'fixture-owner';
const key = createVaultDataKey();
let documents: any[] = [];
let writes = 0;
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: { getThingsCollection: async () => ({
    findOne: async ({ shareId, ownerId }: any) => documents.find(doc => doc.shareId === shareId && doc.ownerId === ownerId) ?? null,
  }) },
});
mock.module(new URL('../auth/vaultKeys.ts', import.meta.url).href, {
  namedExports: {
    encryptUserVaultValue: async (owner: string, id: string, purpose: 'secret', value: string) => sealVaultValue(owner, key, id, purpose, value),
    decryptUserVaultValue: async (owner: string, id: string, purpose: 'secret', value: any) => openVaultValue(owner, key, id, purpose, value),
  },
});
mock.module(new URL('../things/things.ts', import.meta.url).href, {
  namedExports: {
    isFail: (result: any) => result.ok === false,
    createThing: async (ownerId: string, input: any) => { writes++; documents.push({ ...input, ownerId }); return { ok: true }; },
    updateThing: async (_viewer: any, shareId: string, input: any) => {
      writes++;
      documents = documents.map(doc => doc.shareId === shareId ? { ...doc, crystal: structuredClone(input.crystal) } : doc);
      return { ok: true };
    },
    deletePost: async () => { throw new Error('Unexpected deletion'); },
  },
});
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, {
  namedExports: { getCurrentUser: async () => ({ id: ownerId }) },
});
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
  namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({}) },
});
const { saveUserVaultProvider, revealUserVaultValue } = await import('../lopu/userVault.ts');
const { action } = await import('../../../routes/api/v1/lopu/vault/_vault.tsx');
const input = { name: 'Original account', provider: 'openai', endpoint: 'https://api.openai.com/v1' };
const original = 'synthetic-original-credential';
const post = (body: unknown) => action({ request: new Request('https://fixture.test/api/v1/lopu/vault', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) });
beforeEach(() => { documents = []; writes = 0; });

test('invalid replacement tokens reject the HTTP write without changing any stored field', async () => {
  const entry = await saveUserVaultProvider(ownerId, { ...input, token: original });
  const before = structuredClone(documents);
  for (const token of [null, false, 42, {}, [], 'x'.repeat(32 * 1024 + 1), '🦊'.repeat(8193)]) {
    const response = await post({ action: 'save-provider', ...input, id: entry.id, name: 'Must not be saved', token });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /token.*invalid/i);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(documents, before);
    assert.equal(writes, 1);
    assert.equal(await revealUserVaultValue(ownerId, entry.id), original);
  }
});

test('omitting or leaving a replacement blank intentionally preserves the encrypted value', async () => {
  const entry = await saveUserVaultProvider(ownerId, { ...input, token: original });
  const encrypted = structuredClone(documents[0].crystal.encryptedValue);
  for (const token of [undefined, '']) {
    const result = await saveUserVaultProvider(ownerId, { ...input, id: entry.id, name: 'Renamed account', token });
    assert.equal(result.name, 'Renamed account');
    assert.deepEqual(documents[0].crystal.encryptedValue, encrypted);
    assert.equal(await revealUserVaultValue(ownerId, entry.id), original);
  }
});

test('a valid replacement is encrypted exactly and write responses contain metadata only', async () => {
  const entry = await saveUserVaultProvider(ownerId, { ...input, token: original });
  const token = ' synthetic-replacement-🦊 ';
  const response = await post({ action: 'save-provider', ...input, id: entry.id, token });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(await revealUserVaultValue(ownerId, entry.id), token);
  assert.equal('token' in body.entry, false);
  assert.equal('encryptedValue' in body.entry, false);
  assert.equal(JSON.stringify(documents).includes(token), false);
});

test('new accounts still require credentials and foreign record IDs cannot be updated', async () => {
  for (const token of [undefined, '']) {
    await assert.rejects(saveUserVaultProvider(ownerId, { ...input, token }), /token is required/);
  }
  const entry = await saveUserVaultProvider(ownerId, { ...input, token: original });
  await assert.rejects(saveUserVaultProvider('other-owner', { ...input, id: entry.id, token: 'replacement' }), /not found/);
  assert.equal(writes, 1);
  assert.equal(await revealUserVaultValue(ownerId, entry.id), original);
});
