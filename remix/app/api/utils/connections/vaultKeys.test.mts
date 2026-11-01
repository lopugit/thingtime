import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { fromBin } from '../auth/binary';
import { unwrapVaultKeyWithPassword, openVaultValue } from '../auth/vaultEnvelope';
import { withVaultRequest } from '../auth/vaultRequest';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
let registries: Record<string, any>, hashes: Record<string, string>, sessions: Record<string, any>;
let serial = Promise.resolve();
mock.module(new URL('../auth/users.ts', import.meta.url).href, {
  namedExports: {
    readUserVaultKey: async (id: string) => registries[id] ?? null,
    mutateUserVaultKey: (id: string, mutate: any) => {
      const result = serial.then(async () => {
        const next = await mutate(registries[id] ?? null, hashes[id] || 'original-hash');
        registries[id] = next.registry;
        if (next.passwordHash !== undefined) hashes[id] = next.passwordHash;
        return next.registry;
      });
      serial = result.then(
        () => {},
        () => {}
      );
      return result;
    }
  }
});
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getSessionsCollection: async () => ({
      findOne: async ({ jti }: any) => sessions[jti] ?? null,
      updateOne: async (query: any, update: any) => {
        const session = sessions[query.jti];
        if (!session || session.revokedAt || session.userId !== query.userId) return { matchedCount: 0 };
        Object.assign(session, update.$set);
        return { matchedCount: 1 };
      }
    })
  }
});
const {
  encryptUserVaultValue: encrypt,
  decryptUserVaultValue: decrypt,
  bindVaultPassword,
  resetVaultPassword,
  ensureUserVaultKey
} = await import('../auth/vaultKeys.ts');
const { signJwt } = await import('../auth/jwt.ts');
const password = 'A long exact password 🥰';
const requestFor = async (owner: string, jti: string) => {
  sessions[jti] = { jti, userId: owner, purpose: 'browser', revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) };
  const token = await signJwt({ sub: owner, jti });
  return new Request('http://localhost/api/v1/connections/request', { headers: { Authorization: `Bearer ${token}` } });
};
beforeEach(() => {
  registries = {};
  hashes = {};
  sessions = {};
  serial = Promise.resolve();
});

test('password, session and background access unlock the same owner key without storing plaintext credentials', async () => {
  await bindVaultPassword('a', password, 'original-hash');
  const request = await requestFor('a', 'session-a');
  const sealed = await withVaultRequest(request, () => encrypt('a', 'google-one', 'oauth', 'private-token'));
  assert.equal(await withVaultRequest(request, () => decrypt('a', 'google-one', 'oauth', sealed)), 'private-token');
  assert.equal(await decrypt('a', 'google-one', 'oauth', sealed), 'private-token');
  const key = await unwrapVaultKeyWithPassword('a', password, registries.a.password);
  try {
    assert.equal(openVaultValue('a', key, 'google-one', 'oauth', sealed), 'private-token');
  } finally {
    key.bytes.fill(0);
  }
  const persisted = JSON.stringify(registries) + fromBin(sessions['session-a'].secureVaultKey);
  assert.ok(!persisted.includes(password) && !persisted.includes('private-token'));
  assert.ok(!persisted.includes(request.headers.get('Authorization')!.slice(7)));
});

test('password recovery rewraps the stable key atomically and old passwords cannot unlock it', async () => {
  await bindVaultPassword('a', password, 'original-hash');
  const sealed = await encrypt('a', 'first', 'secret', 'saved-api-key');
  const previous = registries.a.keyId;
  await resetVaultPassword('a', 'replacement password', 'replacement-hash');
  assert.equal(registries.a.keyId, previous);
  assert.equal(hashes.a, 'replacement-hash');
  await assert.rejects(unwrapVaultKeyWithPassword('a', password, registries.a.password));
  await bindVaultPassword('a', 'replacement password', 'replacement-hash');
  assert.equal(await decrypt('a', 'first', 'secret', sealed), 'saved-api-key');
  await assert.rejects(bindVaultPassword('a', password, 'original-hash'));
  assert.equal(registries.a.keyId, previous);
});

test('concurrent first-use writers share one key and separate users cannot open each other’s values', async () => {
  const values = await Promise.all(Array.from({ length: 8 }, (_, i) => encrypt('a', `record-${i}`, 'oauth', `value-${i}`)));
  assert.equal(new Set(values.map((v) => v.keyId)).size, 1);
  for (const [i, value] of values.entries()) assert.equal(await decrypt('a', `record-${i}`, 'oauth', value), `value-${i}`);
  await assert.rejects(decrypt('b', 'record-0', 'oauth', values[0]));
  await assert.rejects(decrypt('a', 'wrong-record', 'oauth', values[0]));
});

test('revoked, expired, forged, foreign and scoped sessions fail without falling back to recovery', async () => {
  const request = await requestFor('a', 'session-a');
  const sealed = await withVaultRequest(request, () => encrypt('a', 'first', 'secret', 'secret'));
  sessions['session-a'].revokedAt = new Date();
  await assert.rejects(withVaultRequest(request, () => decrypt('a', 'first', 'secret', sealed)));
  sessions['session-a'].revokedAt = null;
  sessions['session-a'].expiresAt = new Date(0);
  await assert.rejects(withVaultRequest(request, () => decrypt('a', 'first', 'secret', sealed)));
  const foreign = await requestFor('b', 'session-b');
  await assert.rejects(withVaultRequest(foreign, () => decrypt('a', 'first', 'secret', sealed)));
  sessions['session-b'].purpose = 'app';
  await assert.rejects(withVaultRequest(foreign, () => encrypt('b', 'first', 'secret', 'forbidden')));
  const forged = new Request('http://localhost', { headers: { Authorization: 'Bearer forged' } });
  await assert.rejects(withVaultRequest(forged, () => decrypt('a', 'first', 'secret', sealed)));
});

test('passkey and switched sessions lazily receive independent grants; parallel requests retain their owners', async () => {
  const a = await requestFor('a', 'passkey-a'),
    b = await requestFor('b', 'passkey-b');
  const [first, second] = await Promise.all([
    withVaultRequest(a, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return encrypt('a', 'one', 'secret', 'a');
    }),
    withVaultRequest(b, () => encrypt('b', 'one', 'secret', 'b'))
  ]);
  assert.ok(sessions['passkey-a'].secureVaultKey && sessions['passkey-b'].secureVaultKey);
  const switched = await requestFor('a', 'switch-a');
  assert.equal(await withVaultRequest(switched, () => decrypt('a', 'one', 'secret', first)), 'a');
  assert.equal(await withVaultRequest(b, () => decrypt('b', 'one', 'secret', second)), 'b');
  await assert.rejects(withVaultRequest(a, () => decrypt('b', 'one', 'secret', second)));
});

test('wrong exact password and corrupted recovery never replace the only saved key', async () => {
  await bindVaultPassword('a', password, 'original-hash');
  const original = JSON.stringify(registries.a);
  await assert.rejects(bindVaultPassword('a', password + ' ', 'original-hash'));
  assert.equal(JSON.stringify(registries.a), original);
  registries.a.recovery.tag = 'corrupted';
  const broken = JSON.stringify(registries.a);
  await assert.rejects(resetVaultPassword('a', 'new password', 'new hash'));
  await assert.rejects(encrypt('a', 'one', 'secret', 'value'));
  assert.equal(JSON.stringify(registries.a), broken);
  assert.equal((await ensureUserVaultKey('a')).keyId, registries.a.keyId);
});
