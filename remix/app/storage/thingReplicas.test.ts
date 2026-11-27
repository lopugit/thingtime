import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import { sha256 } from '@noble/hashes/sha2.js';
import { checkGenericCloudThingUpdate, createBrowserThingReplicas, queueStoredThingUpdate } from './thingReplicas.client';
import { ThingReplicaStore, replicaJsonDigest, replicaScopeKey, type ReplicaRecord, type ReplicaChunk } from './thingReplicaStore';
import type { ThingStoragePolicyResponse } from '../utils/thingStoragePolicy';

class MemoryStore extends ThingReplicaStore {
  row: ReplicaRecord | null = null; chunks = new Map<string, ReplicaChunk>(); removed = false;
  constructor() { super(null as unknown as IDBFactory); }
  override async read() { return structuredClone(this.row); }
  override async assetEpoch() { return 'epoch'; }
  override async chunk(scope: string, asset: string, offset: number) { return structuredClone(this.chunks.get(JSON.stringify([scope, asset, offset])) ?? null); }
  override async putChunk(chunk: ReplicaChunk) { this.chunks.set(JSON.stringify([chunk.scope, chunk.asset, chunk.offset]), structuredClone(chunk)); }
  override async discardUnpublishedAsset(_scope: string, _id: string, asset: string) {
    if (!this.row?.assets.includes(asset)) for (const [key, value] of this.chunks) if (value.asset === asset) this.chunks.delete(key);
  }
  override async publish(row: ReplicaRecord, generation: string | null) {
    assert.equal(this.row?.generation ?? null, generation); assert.equal(!!this.row?.pendingMutation, false); this.row = structuredClone(row);
  }
  override async remove(_scope: string, _id: string, generation: string) {
    assert.equal(this.row?.generation, generation); assert.equal(!!this.row?.pendingMutation, false); this.row = null; this.chunks.clear(); this.removed = true;
  }
  override async acknowledge(_scope: string, _id: string, generation: string, response: unknown, policy: ThingStoragePolicyResponse) {
    assert.equal(this.row?.generation, generation);
    const measured = replicaJsonDigest(response);
    this.row = { ...this.row!, response, digest: measured.digest, jsonBytes: measured.bytes, policy, sourceHash: policy.source.sourceHash,
      sourceRevision: policy.source.revision, generation: crypto.randomUUID() }; delete this.row.pendingMutation;
  }
}
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
function fixture(bytes = new TextEncoder().encode('exact original bytes')) {
  const store = new MemoryStore();
  const scope = { apiOrigin: 'https://storage.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'browser-test' };
  const policy: ThingStoragePolicyResponse = { ok: true, canEdit: true, source: { id: 'thing', revision: 'revision1', sourceHash: 'a'.repeat(64) },
    policy: { revision: 'policy1', cloudSync: true, defaultLocalAvailability: 'inherit', automaticDownloadDeviceId: null },
    device: { id: scope.deviceId, kind: 'browser', revision: 'device1', localAvailability: 'keep' } };
  let response = { ok: true, thing: { id: 'thing', updatedAt: '2026-11-08T00:00:00.000Z', crystal: { name: 'Original' } } };
  let ranges = 0, corrupt = false, changed = false;
  const writes: Record<string, unknown>[] = [];
  const fingerprint = { algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8388608, partCount: bytes.length ? 1 : 0,
    sha256: hex(bytes.length ? sha256(sha256(bytes)) : sha256(new Uint8Array())) };
  const adapter = createBrowserThingReplicas({ scope, store, assertCurrent() { if (changed) throw Error('Account changed'); },
    readPolicy: async () => structuredClone(policy), readThing: async () => structuredClone(response), requireCapability: async () => undefined,
    writeThing: async (payload) => { writes.push(structuredClone(payload)); response = { ...response, thing: { ...response.thing, crystal: payload.crystal as any } }; return response; },
    fetch: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('storage-policy')) return Response.json({ ok: true, source: policy.source,
        attachments: { items: [{ id: 'attachment', version: 'b'.repeat(64), size: bytes.length, fingerprint }], nextCursor: null } });
      ranges++;
      const offset = Number(parsed.searchParams.get('offset')), length = Number(parsed.searchParams.get('length'));
      const body = bytes.slice(offset, offset + length); if (corrupt && body.length) body[0] ^= 1;
      return new Response(body, { status: 206, headers: { ETag: `"${'b'.repeat(64)}"`, 'Content-Range': `bytes ${offset}-${offset + length - 1}/${bytes.length}`, 'Content-Length': String(length) } });
    },
  });
  return { store, policy, adapter, bytes, writes, response: () => response, ranges: () => ranges, corrupt: (value = true) => { corrupt = value; }, changed: () => { changed = true; } };
}

test('keeps exact JSON and attachment bytes, reuses verified chunks, then evicts only after cloud verification', async () => {
  const f = fixture();
  const kept = await f.adapter.keep('thing'); assert.equal(kept.state, 'saved'); assert.equal(kept.fileBytes, f.bytes.length);
  assert.deepEqual(await f.adapter.readCached('thing'), f.response());
  await f.adapter.keep('thing'); assert.equal(f.ranges(), 1);
  await assert.rejects(f.adapter.evict('thing'), /Choose Cloud only/); assert.equal(f.store.removed, false);
  f.policy.device!.localAvailability = 'cloud-only'; f.policy.device!.revision = 'device2';
  assert.equal((await f.adapter.evict('thing')).state, 'evicted'); assert.equal(f.store.row, null); assert.equal(f.store.chunks.size, 0);
});
test('corrupt bytes never publish a successful local copy', async () => {
  const f = fixture(); f.corrupt(); await assert.rejects(f.adapter.keep('thing'), /fingerprint/); assert.equal(f.store.row, null);
  assert.equal(f.store.chunks.size, 0); f.corrupt(false); assert.equal((await f.adapter.keep('thing')).state, 'saved');
});
test('changed cloud source and pending local changes independently block eviction', async () => {
  const f = fixture(); await f.adapter.keep('thing'); f.policy.device!.localAvailability = 'cloud-only';
  f.policy.source.sourceHash = 'c'.repeat(64);
  await assert.rejects(f.adapter.evict('thing'), /different or unsynced/); assert.ok(f.store.row);
  f.policy.source.sourceHash = 'a'.repeat(64); f.store.row!.pendingMutation = { crystal: { name: 'Unsynced' } };
  await assert.rejects(f.adapter.evict('thing'), /different or unsynced/); assert.ok(f.store.row);
});
test('cloud synchronization reconciles immutable pending edits before allowing local cleanup', async () => {
  const f = fixture(); await f.adapter.keep('thing');
  const local = structuredClone(f.response()); local.thing.crystal.name = 'Local edit';
  f.store.row!.response = local; f.store.row!.digest = replicaJsonDigest(local).digest;
  f.store.row!.pendingMutation = { id: 'thing', expectedUpdatedAt: local.thing.updatedAt, crystal: local.thing.crystal, replaceCrystal: true };
  f.policy.policy.cloudSync = false; await assert.rejects(f.adapter.sync('thing'), /Turn on cloud sync/);
  f.policy.policy.cloudSync = true; f.policy.policy.revision = 'new-sync-policy'; await f.adapter.sync('thing');
  assert.equal(f.writes[0]?.expectedStoragePolicyRevision, 'new-sync-policy');
  assert.equal(f.writes[0]?.expectedUpdatedAt, local.thing.updatedAt);
  assert.equal(f.response().thing.crystal.name, 'Local edit'); assert.equal(f.store.row!.pendingMutation, undefined);
});
test('identity changes refuse reads and local deletion', async () => {
  const f = fixture(); await f.adapter.keep('thing'); f.changed();
  await assert.rejects(f.adapter.readCached('thing'), /Account changed/); await assert.rejects(f.adapter.evict('thing'), /Account changed/);
  assert.ok(f.store.row);
});
test('canonical local digest ignores object insertion order and keeps array order', () => {
  assert.equal(replicaJsonDigest({ b: '🌈', a: [1, 2] }).digest, replicaJsonDigest({ a: [1, 2], b: '🌈' }).digest);
  assert.notEqual(replicaJsonDigest([1, 2]).digest, replicaJsonDigest([2, 1]).digest);
});

test('IndexedDB publishes coverage and binding atomically, and stale eviction cannot drop pending edits', async () => {
  const store = new ThingReplicaStore(indexedDB, crypto.randomUUID());
  try {
    const f = fixture(), scope = { apiOrigin: 'https://storage.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'browser-test' };
    const key = replicaScopeKey(scope), asset = JSON.stringify(['thing', 'attachment', 'version']);
    const response = f.response(), measured = replicaJsonDigest(response);
    f.policy.policy.cloudSync = false;
    const row: ReplicaRecord = { scope: key, id: 'thing', generation: 'initial', response, digest: measured.digest, jsonBytes: measured.bytes,
      sourceHash: f.policy.source.sourceHash, sourceRevision: f.policy.source.revision, policy: f.policy, fileBytes: 1, assets: [asset] };
    const epoch = await store.assetEpoch(key, asset), coverage = new Map([[asset, { chunks: 1, epoch }]]);
    await assert.rejects(store.publish(row, null, coverage));
    assert.equal(await store.binding(scope), null);
    assert.equal(await store.read(key, 'thing'), null);
    const bytes = Uint8Array.of(3);
    await store.putChunk({ scope: key, asset, offset: 0, bytes, digest: hex(sha256(bytes)) }, epoch);
    await assert.rejects(store.putChunk({ scope: key, asset, offset: 0, bytes: Uint8Array.of(4), digest: 'different' }, epoch));
    await store.discardUnpublishedAsset(key, 'thing', asset, epoch);
    const newEpoch = await store.assetEpoch(key, asset);
    await store.putChunk({ scope: key, asset, offset: 0, bytes, digest: hex(sha256(bytes)) }, newEpoch);
    await assert.rejects(store.publish(row, null, coverage));
    await store.publish(row, null, new Map([[asset, { chunks: 1, epoch: newEpoch }]]));
    assert.equal(await store.binding(scope), scope.deviceId);
    await store.discardUnpublishedAsset(key, 'thing', asset, newEpoch);
    assert.deepEqual((await store.chunk(key, asset, 0))?.bytes, bytes);

    const base = response.thing.updatedAt;
    await assert.rejects(queueStoredThingUpdate(scope, { id: 'thing', crystal: { a: 1 }, expectedUpdatedAt: '2024-01-01' }, () => {}, store), /changed/);
    await queueStoredThingUpdate(scope, { id: 'thing', crystal: { a: 1 }, expectedUpdatedAt: base }, () => {}, store);
    await queueStoredThingUpdate(scope, { id: 'thing', crystal: { b: 2 }, expectedUpdatedAt: base }, () => {}, store);
    const queued = await store.read(key, 'thing');
    assert.equal(queued?.pendingMutation?.expectedUpdatedAt, base);
    assert.deepEqual(queued?.pendingMutation?.crystal, { name: 'Original', a: 1, b: 2 });
    await assert.rejects(store.remove(key, 'thing', row.generation));
    await assert.rejects(store.remove(key, 'thing', queued!.generation));
    assert.ok(await store.chunk(key, asset, 0));
    assert.equal((await store.next(key))?.id, 'thing');
    assert.equal(await store.next(key, 'thing'), null);
  } finally { store.close(); }
});

test('a paused owner policy blocks generic cloud PATCH fallback even without a local replica', async () => {
  const f = fixture(), scope = { apiOrigin: 'https://storage.test', ownerId: 'owner', dataPlane: 'home' };
  f.policy.policy.cloudSync = false;
  const fetchPolicy = async (url: RequestInfo | URL, init?: RequestInit) => {
    const requested = new URL(String(url), scope.apiOrigin);
    assert.equal(requested.pathname, '/api/v1/things/storage-policy');
    assert.equal(requested.searchParams.get('id'), 'thing');
    assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), scope.ownerId);
    return Response.json(f.policy);
  };
  const verify = () => checkGenericCloudThingUpdate(scope, 'thing', () => {}, () => {}, undefined,
    { fetch: fetchPolicy, requireCapability: async () => {} });
  await assert.rejects(verify(), /Cloud sync is paused/);
  f.policy.policy.cloudSync = true;
  assert.equal(await verify(), 'policy1');
  f.policy.policy.revision = null;
  assert.equal(await verify(), null);
  f.policy.canEdit = false;
  assert.equal(await verify(), undefined);
});

test('a storage-hidden app Thing still requires the server null-policy fence', async () => {
  const scope = { apiOrigin: 'https://storage.test', ownerId: 'owner', dataPlane: 'home' };
  const verify = (response: Response) => checkGenericCloudThingUpdate(scope, 'app-thing', () => {}, () => {}, undefined,
    { fetch: async () => response, requireCapability: async () => {} });
  assert.equal(await verify(Response.json({ ok: false, error: 'Thing not found' }, { status: 404 })), null);
  for (const status of [401, 403, 503]) {
    await assert.rejects(verify(Response.json({ ok: false, error: 'Thing not found' }, { status })), { status });
  }
  await assert.rejects(verify(new Response('<html>Not found</html>', { status: 404 })), { status: 404 });
  await assert.rejects(verify(Response.json({ ok: false, error: 'Storage device not found' }, { status: 404 })), { status: 404 });
  await assert.rejects(verify(Response.json({ ok: true })), /Storage policy did not match/);
});

test('IndexedDB checks identity at the actual removal and publication callback', async () => {
  const store = new ThingReplicaStore(indexedDB, crypto.randomUUID());
  try {
    const f = fixture(), scope = { apiOrigin: 'https://storage.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'browser-test' };
    const key = replicaScopeKey(scope), response = f.response(), measured = replicaJsonDigest(response);
    const row: ReplicaRecord = { scope: key, id: 'thing', generation: 'initial', response, digest: measured.digest, jsonBytes: measured.bytes,
      sourceHash: f.policy.source.sourceHash, sourceRevision: f.policy.source.revision, policy: f.policy, fileBytes: 0, assets: [] };
    const reject = () => { throw Error('Account changed'); };
    await assert.rejects(store.publish(row, null, new Map(), reject));
    assert.equal(await store.read(key, 'thing'), null);
    await store.publish(row, null, new Map());
    await assert.rejects(store.remove(key, 'thing', row.generation, reject));
    assert.equal((await store.read(key, 'thing'))?.generation, row.generation);
  } finally { store.close(); }
});
