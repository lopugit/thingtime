import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_ALLOWLIST_KIND, appAllowlistEntryId, deleteAppAllowlist, originPatternCandidates, readAppAllowlist, relationalAppAllowsNative, relationalAppAllowsOrigin, replaceAppAllowlist } from './appAllowlist';

const app = () => ({ shareId: 'app-root', ownerId: 'owner', thingtime: ['app'], updatedAt: new Date(),
  crystal: { clientId: 'client', origins: ['https://legacy.example.com'], nativeRedirectUris: ['com.example.legacy://oauth/callback'] } as any });
const valueAt = (doc: any, path: string) => path.split('.').reduce((value, key) => value?.[key], doc);
const matches = (doc: any, filter: any) => Object.entries(filter).every(([key, expected]: any) => {
  const actual = valueAt(doc, key);
  if (expected && typeof expected === 'object') {
    if (expected.$in) return expected.$in.some((item: any) => item === actual || (item === null && actual == null));
    if (expected.$gte !== undefined && actual < expected.$gte) return false;
    if (expected.$lt !== undefined && actual >= expected.$lt) return false;
    return true;
  }
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
});
const fixture = () => {
  const current = app(), rows: any[] = [], queries: any[] = [];
  let closed = 0;
  const collection = {
    async deleteMany(filter: any) { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], filter)) rows.splice(i, 1); },
    async insertMany(values: any[]) { rows.push(...values); },
    async findOne(filter: any) { queries.push(filter); return [current, ...rows].find(row => matches(row, filter)) || null; },
    find(filter: any) {
      queries.push(filter);
      return { batchSize() { return this; }, async *[Symbol.asyncIterator]() { yield* rows.filter(row => matches(row, filter)); }, async close() { closed++; } };
    }
  };
  return { current, rows, queries, collection, closed: () => closed };
};

test('app origins and native callbacks grow as private child rows with ordered compatible projections', async () => {
  const f = fixture(), origins = Array.from({ length: 10_000 }, (_, i) => `https://tenant${i}.example.com`),
    callbacks = Array.from({ length: 100 }, (_, i) => `com.example.app${i}://oauth/callback`);
  await replaceAppAllowlist(f.collection, f.current, origins, callbacks, {});
  assert.equal(f.current.crystal.origins, undefined);
  assert.equal(f.current.crystal.nativeRedirectUris, undefined);
  assert.equal(f.rows.length, 10_100);
  assert.ok(f.rows.every(row => row.thingtime[0] === APP_ALLOWLIST_KIND && row.ownerId === f.current.ownerId && row.storageClass === 'control'));
  assert.deepEqual(await readAppAllowlist(f.collection, f.current), { origins, nativeRedirectUris: callbacks });
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, origins[9999]), true);
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://unregistered.example.com'), false);
  assert.equal(await relationalAppAllowsNative(f.collection, f.current, callbacks[99]), true);
  assert.equal(await relationalAppAllowsNative(f.collection, f.current, 'com.example.unregistered://oauth/callback'), false);
});

test('wildcard authority uses indexed rule ids without broadening tenant, port or protocol boundaries', async () => {
  const f = fixture();
  await replaceAppAllowlist(f.collection, f.current, ['https://myapp-*-myteam.vercel.app', 'https://*.owned.example.com:8443'], [], {});
  for (const value of ['https://myapp-main-myteam.vercel.app', 'https://branch.owned.example.com:8443'])
    assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, value), true, value);
  for (const value of ['https://myapp-evil-otherteam.vercel.app', 'https://myapp-main-myteam.vercel.app.evil.com',
    'https://a.b.owned.example.com:8443', 'https://branch.owned.example.com', 'http://branch.owned.example.com:8443'])
    assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, value), false, value);
  assert.ok(f.queries.some(query => query.shareId?.$in?.length), 'wildcards query deterministic indexed ids');
  assert.ok(f.closed() > 0, 'a matching wildcard closes its partial cursor');
  assert.equal(originPatternCandidates(`https://${'a'.repeat(64)}.example.com`), null);
});

test('revoked, replaced, foreign or unknown-version allowlists never borrow legacy arrays', async () => {
  const f = fixture();
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://legacy.example.com'), true);
  await replaceAppAllowlist(f.collection, f.current, ['https://new.example.com'], ['com.example.app://oauth/callback'], {});
  const old = structuredClone(f.current);
  f.current.crystal.origins = ['https://legacy.example.com'];
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://legacy.example.com'), false);
  f.current.crystal.revokedAt = new Date();
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://new.example.com'), false);
  assert.equal(await relationalAppAllowsNative(f.collection, f.current, 'com.example.app://oauth/callback'), false);
  assert.equal((await readAppAllowlist(f.collection, f.current)).origins.length, 1, 'owners can still manage suspended apps');
  delete f.current.crystal.revokedAt;
  await replaceAppAllowlist(f.collection, f.current, ['https://replacement.example.com'], [], {});
  assert.equal(await relationalAppAllowsOrigin(f.collection, old, 'https://new.example.com'), false);
  await assert.rejects(readAppAllowlist(f.collection, old), /allowlist changed/);
  assert.equal(await relationalAppAllowsOrigin(f.collection, { ...f.current, ownerId: 'foreign' }, 'https://replacement.example.com'), false);
  assert.equal(await relationalAppAllowsOrigin(f.collection, { ...f.current, crystal: { ...f.current.crystal, allowlistVersion: 999 } }, 'https://replacement.example.com'), false);
});

test('app deletion and empty generations cannot revive old origins or remove another app’s rows', async () => {
  const f = fixture();
  await replaceAppAllowlist(f.collection, f.current, ['https://new.example.com'], [], {});
  const other = { ...app(), shareId: 'another-app' };
  await replaceAppAllowlist(f.collection, other, ['https://other.example.com'], [], {});
  const id = appAllowlistEntryId(other.shareId, other.crystal.allowlistGeneration, 'origin', 'https://other.example.com');
  await deleteAppAllowlist(f.collection, f.current, {});
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].shareId, id);
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://legacy.example.com'), false);
  assert.equal(await relationalAppAllowsOrigin(f.collection, f.current, 'https://new.example.com'), false);
});
