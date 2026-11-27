import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticStorageMutationAllowed, automaticStoragePathAllowed, createAutomaticStoragePlacement } from './automaticStoragePlacement';
import { AutomaticStoragePlacementExcluded, type AutomaticThingStorageRule } from '../utils/thingStoragePolicy';
import { executeSyncOperation } from './execute';
import type { SyncEntry, SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://storage.test', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'connection' };
const remote: SyncEntry = { path: 'sample.bin', kind: 'file', id: 'remote-file', version: 'r1', size: 1, sha256: 'a'.repeat(64) };
const local: SyncEntry = { ...remote, id: 'local-file', version: 'l1' };
const copyDown = { kind: 'copy' as const, path: remote.path, from: 'remote' as const, source: remote, expectedTarget: null };
const copyUp = { kind: 'copy' as const, path: local.path, from: 'local' as const, source: local, expectedTarget: remote };
const rule = (patch: Partial<AutomaticThingStorageRule> = {}): AutomaticThingStorageRule => ({ id: remote.id, cloudSync: true,
  defaultLocalAvailability: 'inherit', automaticDownloadDeviceId: null, localAvailability: 'inherit', ...patch });
const rules = (patch: Partial<AutomaticThingStorageRule>) => new Map([[remote.id, rule(patch)]]);

test('automatic file placement separates uploads, downloads, and intentionally missing local replicas', () => {
  assert.equal(automaticStorageMutationAllowed(copyUp, scope, new Map()), true);
  assert.equal(automaticStorageMutationAllowed(copyDown, scope, new Map()), true);
  assert.equal(automaticStorageMutationAllowed(copyUp, scope, rules({ cloudSync: false })), false);
  assert.equal(automaticStorageMutationAllowed(copyDown, scope, rules({ cloudSync: false })), true);
  assert.equal(automaticStorageMutationAllowed(copyDown, scope, rules({ automaticDownloadDeviceId: 'other' })), false);
  assert.equal(automaticStorageMutationAllowed(copyDown, scope, rules({ localAvailability: 'cloud-only' })), false);
  assert.equal(automaticStorageMutationAllowed(copyDown, scope, rules({ automaticDownloadDeviceId: scope.deviceId, localAvailability: 'keep' })), true);
  const missingLocal = { path: remote.path, local: null, remote, beforeLocal: local, beforeRemote: remote };
  const policy = { mode: 'two-way' as const, propagateDeletes: true };
  assert.equal(automaticStoragePathAllowed(missingLocal, policy, scope, rules({ localAvailability: 'cloud-only' })), false);
  assert.equal(automaticStoragePathAllowed({ ...missingLocal, remote: { ...remote, version: 'r2' } }, policy, scope, rules({ automaticDownloadDeviceId: 'other' })), false);
  assert.equal(automaticStoragePathAllowed(missingLocal, policy, scope, new Map()), true);
});

test('unchanged worker roots revalidate a sparse revision without per-file policy requests', async () => {
  let clock = 0, requests = 0, selected = rule(), revision = 'a'.repeat(32);
  const fetcher: typeof fetch = async (target, init) => {
    const url = new URL(String(target)); requests++;
    if (url.pathname === '/api/v1/capabilities') {
      assert.equal(init?.credentials, 'same-origin');
      return Response.json({ ok: true, schemaVersion: 1, features: {
        'api.things-storage-policy': '1.0.0', 'api.files': '1.12.2', 'api.file-sync-transfer-admissions': '1.3.1'
      } });
    }
    assert.equal(url.searchParams.get('deviceId'), scope.deviceId);
    assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), scope.ownerId);
    const unchanged = url.searchParams.get('revision') === revision;
    return Response.json({ ok: true, revision, rules: unchanged ? [] : [selected], nextCursor: null, ...(unchanged ? { unchanged: true } : {}) });
  };
  const placement = createAutomaticStoragePlacement({ currentScope: () => scope, origin: () => scope.origin,
    fetch: fetcher, requireCapability: async () => {} }, scope, new AbortController().signal, () => clock);
  await Promise.all(Array.from({ length: 100 }, () => placement.admit(copyDown)));
  assert.equal(requests, 2);
  clock = 6000;
  await placement.admit(copyDown);
  assert.equal(requests, 3);
  clock = 12000; revision = 'b'.repeat(32); selected = rule({ localAvailability: 'cloud-only' });
  await assert.rejects(placement.admit(copyDown), AutomaticStoragePlacementExcluded);
  assert.equal(requests, 4);
});

test('policy refusal precedes observation or dispatch and does not discard a known prior receipt', async () => {
  const operation = { id: 'original', mutation: copyDown, confirmed: false };
  const receipt = { operationId: operation.id, scope, entry: local };
  const port = { currentScope: () => scope, lookup: async () => ({ status: 'missing' as const }),
    admit: async () => { throw new AutomaticStoragePlacementExcluded(); },
    read: async () => { throw Error('a denied operation must not start reads'); }, apply: async () => { throw Error('a denied operation must not dispatch'); } };
  await assert.rejects(executeSyncOperation(operation, scope, port), AutomaticStoragePlacementExcluded);
  assert.deepEqual(await executeSyncOperation(operation, scope, { ...port, lookup: async () => ({ status: 'complete' as const, receipt }) }), receipt);
});
