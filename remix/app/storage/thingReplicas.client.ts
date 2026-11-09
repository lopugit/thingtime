import { sha256 } from '@noble/hashes/sha2.js';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from '../api/utils/capabilities/capabilityContract';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { readExactRange, MAX_ATTACHMENT_RANGE_BYTES } from '../api/utils/attachments/attachmentRanges';
import type { ContentFingerprint } from '../fileSync/contentFingerprint';
import { validContentFingerprint } from '../fileSync/contentFingerprint';
import type { CloudFile } from '../fileSync/cloudFile';
import { THING_STORAGE_POLICY_PATH, THING_STORAGE_POLICY_REQUIREMENTS, type ThingStoragePolicyResponse } from '../utils/thingStoragePolicy';
import { ThingReplicaStore, replicaJsonDigest, replicaScopeKey, type ReplicaAssetProof, type ReplicaRecord, type ReplicaScope } from './thingReplicaStore';
import { canonicalJsonBytes } from '../utils/canonicalJsonStream';
import { builderThingUpdateKinds } from '../schemas/builderThing';
import { isProtectedThingtime, validateThingtimeCrystal } from '../schemas/registry';
import { createThingStorageClient } from '../components/Things/thingStorageClient';
import { ThingtimeApiError } from '../hooks/apiFailure';

export type ThingReplicaStatus = {
  state: 'missing' | 'present' | 'saved' | 'evicted' | 'error'; jsonBytes?: number; fileBytes?: number;
  sourceHash?: string; sourceRevision?: string; pendingChanges?: boolean; detail?: string;
};
type Asset = { id: string; version: string | null; size: number | null; fingerprint: ContentFingerprint | null };
type ReplicaInput = {
  scope: ReplicaScope; assertCurrent(): void; readThing(id: string): Promise<unknown>;
  readPolicy(id: string): Promise<ThingStoragePolicyResponse>; readFile?(id: string): Promise<CloudFile>;
  writeThing?(payload: Record<string, unknown>): Promise<unknown>;
  signal?: AbortSignal; onProgress?(bytes: number, total: number): void; store?: ThingReplicaStore;
  fetch?: typeof fetch;
  requireCapability?: typeof requireThingtimeCapability;
  /** The negotiated native adapter owns File bytes; JSON is still kept here. */
  manageFileBytes?: boolean;
};
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const stores = new WeakMap<IDBFactory, ThingReplicaStore>();
export const getDefaultThingReplicaStore = () => {
  let store = stores.get(window.indexedDB);
  if (!store) { store = new ThingReplicaStore(window.indexedDB); stores.set(window.indexedDB, store); }
  return store;
};
const describe = (row: ReplicaRecord | null, state: ThingReplicaStatus['state'] = 'present'): ThingReplicaStatus => row
  ? { state, jsonBytes: row.jsonBytes, fileBytes: row.fileBytes, sourceHash: row.sourceHash,
    sourceRevision: row.assetSourceHash && row.assetSourceHash !== row.sourceHash && !row.nativeFileBytes ? undefined : row.sourceRevision,
    pendingChanges: !!row.pendingMutation }
  : { state: 'missing' };
const samePolicy = (a: ThingStoragePolicyResponse, b: ThingStoragePolicyResponse) => a.canEdit && b.canEdit &&
  a.source.id === b.source.id && a.source.revision === b.source.revision && a.source.sourceHash === b.source.sourceHash &&
  a.policy.revision === b.policy.revision && a.device?.id === b.device?.id && a.device?.revision === b.device?.revision;
const thingIn = (response: any): Record<string, any> | null =>
  response?.ok === true && response.thing && typeof response.thing === 'object' && !Array.isArray(response.thing) ? response.thing : null;

export async function readStoredThing(scope: Omit<ReplicaScope, 'deviceId'>, id: string, check: () => void, store = getDefaultThingReplicaStore()) {
  check(); const deviceId = await store.binding(scope); check();
  if (!deviceId) return null;
  const key = replicaScopeKey({ ...scope, deviceId }), row = await store.read(key, id); check();
  return row && replicaJsonDigest(row.response).digest === row.digest ? row : null;
}

/** Only explicit Keep-on-device copies intercept edits. No existing Thing or
 * unrelated draft is enrolled by merely visiting a page. The queued mutation
 * retains the original server revision through every local edit and retry. */
export class ReplicaLookupUnavailable extends Error {}

export async function queueStoredThingUpdate(scope: Omit<ReplicaScope, 'deviceId'>, input: Record<string, any>, check: () => void, store = getDefaultThingReplicaStore()) {
  if (typeof input.id !== 'string') return null;
  let row: ReplicaRecord | null;
  try { row = await readStoredThing(scope, input.id, check, store); }
  catch { check(); throw new ReplicaLookupUnavailable('This device could not open its saved Things.'); }
  if (!row || row.policy.policy.cloudSync) return null;
  const previous = thingIn(row.response);
  if (!previous || previous.id !== row.id || typeof previous.updatedAt !== 'string' || !Number.isFinite(Date.parse(previous.updatedAt)))
    throw Error('This Thing cannot safely save offline edits yet. Its cloud copy is unchanged.');
  const patch = structuredClone(input), next = structuredClone(previous);
  const inputFields = new Set(['thingtime', 'id', 'crystal', 'replaceCrystal', 'expectedUpdatedAt', 'expectedActor']);
  if (Object.keys(patch).some(k => patch[k] !== undefined && !inputFields.has(k)))
    throw Error('This edit needs cloud sync. The existing device and cloud copies are unchanged.');
  const base = row.pendingMutation?.expectedUpdatedAt ?? previous.updatedAt;
  if (patch.expectedUpdatedAt != null && (typeof patch.expectedUpdatedAt !== 'string' || typeof base !== 'string' ||
      !Number.isFinite(Date.parse(base)) || Date.parse(patch.expectedUpdatedAt) !== Date.parse(base)))
    throw Error('The Thing changed after the preview. Refresh the device copy before editing.');
  if (patch.crystal === undefined && patch.thingtime === undefined) return structuredClone(row.response);
  const kinds = builderThingUpdateKinds(Array.isArray(previous.thingtime) ? previous.thingtime : ['data'], patch.thingtime);
  if (!kinds || isProtectedThingtime(kinds)) throw Error('This edit needs the Thing’s cloud workflow.');
  if (patch.crystal !== undefined) {
    if (!patch.crystal || typeof patch.crystal !== 'object' || Array.isArray(patch.crystal))
      throw Error('Offline edits require an ordinary Thing data object.');
    next.crystal = patch.replaceCrystal === true ? patch.crystal : { ...next.crystal, ...patch.crystal };
    if (kinds.includes('post') &&
        Object.prototype.hasOwnProperty.call(patch.crystal, 'text') &&
        !Object.prototype.hasOwnProperty.call(patch.crystal, 'richText')) next.crystal.richText = null;
  }
  const validated = validateThingtimeCrystal(kinds, next.crystal);
  if (validated.ok === false) throw Error(validated.error);
  next.crystal = validated.crystal;
  next.thingtime = validated.thingtime;
  const mutation: Record<string, unknown> = { ...row.pendingMutation, id: input.id,
    expectedUpdatedAt: base,
    thingtime: next.thingtime,
    ...(patch.crystal === undefined ? {} : { crystal: next.crystal, replaceCrystal: true }) };
  const response = { ...(row.response as object), thing: next, localOnly: true };
  check(); await store.queueMutation(row.scope, row.id, response, mutation, row.generation, check); check();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('thingtime:replica-changed', {
    detail: { id: row.id, ownerId: scope.ownerId, dataPlane: scope.dataPlane, apiOrigin: scope.apiOrigin },
  }));
  return response;
}

/** The usual owner edit must not fall through to cloud when a new or
 * missing device copy has no locally cached copy of a paused policy. */
export async function checkGenericCloudThingUpdate(scope: Omit<ReplicaScope, 'deviceId'>, id: string,
  check: () => void, onIdentityChange: () => void, signal?: AbortSignal,
  transport = { fetch, requireCapability: requireThingtimeCapability }): Promise<string | null | undefined> {
  if (scope.dataPlane !== 'home') return;
  const lifetime = signal ?? AbortSignal.timeout(20_000);
  check();
  try { await transport.requireCapability('api.things-storage-policy', THING_STORAGE_POLICY_REQUIREMENTS['api.things-storage-policy'], scope.apiOrigin); }
  catch (error) {
    check();
    if (!(error instanceof Error) || error.message !== 'Thingtime capability api.things-storage-policy is incompatible') throw error;
    // A valid legacy origin without this feature has no stored placement
    // policy. A malformed or breaking manifest cannot authorize a cloud write.
    const response = await transport.fetch(new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, scope.apiOrigin),
      { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: lifetime });
    if (!response.ok) throw error;
    const manifest = await response.json();
    check();
    if (manifest?.schemaVersion === 1 && manifest.origin === scope.apiOrigin &&
        typeof manifest.features?.['api.things']?.version === 'string' &&
        !Object.prototype.hasOwnProperty.call(manifest.features, 'api.things-storage-policy')) return;
    throw error;
  }
  const client = createThingStorageClient({ origin: scope.apiOrigin, ownerId: scope.ownerId, dataPlane: 'home' },
    { signal: lifetime, assertCurrent: check, onIdentityChange }, transport);
  let current: ThingStoragePolicyResponse;
  try { current = await client.read(id); }
  catch (error) {
    check();
    // App-owned content can be editable through the canonical Things API
    // while excluded from storage metadata. The null precondition still
    // requires the server transaction to prove that no placement policy exists.
    if (error instanceof ThingtimeApiError && error.reason === 'storage-source-not-found') return null;
    throw error;
  }
  check();
  if (!current.canEdit) return undefined;
  if (!current.policy.cloudSync)
    throw Error('Cloud sync is paused for this Thing. Keep a copy on this device to save edits locally.');
  return current.policy.revision;
}

/** Bounded, resumable browser-owned storage. It never requests filesystem
 * access, deletes cloud Things, or claims that another device saved a copy. */
export function createBrowserThingReplicas(input: ReplicaInput) {
  const scope = { ...input.scope }, key = replicaScopeKey(scope), store = input.store ?? getDefaultThingReplicaStore();
  const request = input.fetch ?? fetch;
  const guard = () => { input.signal?.throwIfAborted(); input.assertCurrent(); };
  const lock = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    guard();
    if (typeof navigator === 'undefined' || !navigator.locks) return operation();
    return navigator.locks.request(`thingtime-managed-replica:${JSON.stringify([key, id])}`,
      { mode: 'exclusive', signal: input.signal }, () => { guard(); return operation(); });
  };
  const headers = { [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane };
  const json = async (path: string) => {
    guard(); const response = await request(new URL(path, scope.apiOrigin), {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal: input.signal,
    }); guard();
    if (!response.ok) { await response.body?.cancel(); throw Error(`Device storage request failed (${response.status}).`); }
    const body = await response.json(); guard(); return body;
  };
  const policy = async (id: string) => {
    guard(); const value = await input.readPolicy(id); guard();
    if (!value.canEdit || value.source.id !== id || value.device?.id !== scope.deviceId) throw Error('Storage identity or access changed.');
    return value;
  };
  const manifest = async function* (id: string, initial: ThingStoragePolicyResponse): AsyncGenerator<Asset> {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ id, attachments: '1', ...(initial.device?.kind === 'paired' ? { deviceId: scope.deviceId } : {}) });
      if (cursor) query.set('cursor', cursor);
      const page = await json(`${THING_STORAGE_POLICY_PATH}?${query}`);
      if (page.source?.sourceHash !== initial.source.sourceHash || page.source?.revision !== initial.source.revision ||
        !Array.isArray(page.attachments?.items)) throw Error('The Thing changed while preparing its offline copy.');
      for (const asset of page.attachments.items) yield asset;
      const next = page.attachments.nextCursor;
      if (next !== null && (typeof next !== 'string' || next === cursor)) throw Error('Invalid attachment cursor.');
      cursor = next;
    } while (cursor !== null);
  };
  const download = async (id: string, asset: Asset, initial: ThingStoragePolicyResponse) => {
    if (!asset.version || asset.size === null || !validContentFingerprint(asset.fingerprint, asset.size)) throw Error('An attached file is unavailable. The previous local copy has been kept.');
    const assetKey = JSON.stringify([id, asset.id, asset.version]);
    const epoch = await store.assetEpoch(key, assetKey, guard); guard();
    const aggregate = sha256.create();
    const chunkSize = Math.min(4 * 1024 * 1024, MAX_ATTACHMENT_RANGE_BYTES);
    let part = sha256.create(), partBytes = 0, chunks = 0;
    for (let offset = 0; offset < asset.size;) {
      guard();
      const length = Math.min(chunkSize, asset.size - offset, asset.fingerprint.partSizeBytes - partBytes);
      const cached = await store.chunk(key, assetKey, offset); guard();
      let bytes = cached?.bytes;
      if (!bytes || bytes.byteLength !== length || hex(sha256(bytes)) !== cached?.digest) {
        const query = new URLSearchParams({ id: asset.id, range: '1', version: asset.version, offset: String(offset), length: String(length) });
        const response = await request(new URL(`/api/v1/attachments/content?${query}`, scope.apiOrigin), {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal: input.signal,
        });
        try { guard(); } catch (error) { await response.body?.cancel(); throw error; }
        if (!response.ok || response.headers.get('ETag') !== `"${asset.version}"`) { await response.body?.cancel(); throw Error('The exact cloud file is unavailable. Retry keeps your existing local copy.'); }
        bytes = await readExactRange(response, { version: asset.version, offset, length }, asset.size, guard);
        guard(); await store.putChunk({ scope: key, asset: assetKey, offset, bytes, digest: hex(sha256(bytes)) }, epoch, guard);
      }
      guard(); part.update(bytes); partBytes += length; offset += length; chunks++;
      if (partBytes === asset.fingerprint.partSizeBytes || offset === asset.size) { aggregate.update(part.digest()); part = sha256.create(); partBytes = 0; }
      input.onProgress?.(offset, asset.size);
    }
    if (hex(aggregate.digest()) !== asset.fingerprint.sha256) {
      await store.discardUnpublishedAsset(key, id, assetKey, epoch, guard);
      throw Error('Downloaded bytes did not match the cloud fingerprint. Your existing copy has been kept.');
    }
    if (!samePolicy(initial, await policy(id))) throw Error('The Thing or storage choice changed during download. Retry with the current choice.');
    return { key: assetKey, size: asset.size, proof: { chunks, epoch } };
  };
  return {
    async status(id: string): Promise<ThingReplicaStatus> { guard(); const row = await store.read(key, id); guard(); return describe(row); },
    async readCached(id: string): Promise<unknown | null> {
      guard(); const row = await store.read(key, id); guard();
      if (!row || replicaJsonDigest(row.response).digest !== row.digest) return null;
      return structuredClone(row.response);
    },
    keep: (id: string) => lock(id, async (): Promise<ThingReplicaStatus> => {
      const initial = await policy(id);
      if (initial.device?.localAvailability === 'cloud-only') throw Error('Choose Keep on this device before saving an offline copy.');
      const previous = await store.read(key, id); guard();
      if (previous?.pendingMutation) throw Error('This device has unsynced changes. Sync or keep those changes before replacing its copy.');
      if (previous && previous.assetSourceHash === initial.source.sourceHash &&
          previous.nativeFileBytes === (input.manageFileBytes === false) && samePolicy(initial, previous.policy) &&
          replicaJsonDigest(previous.response).digest === previous.digest) return describe(previous, 'saved');
      await (input.requireCapability ?? requireThingtimeCapability)('api.attachment-content', '1.14.0', scope.apiOrigin); guard();
      const response = await input.readThing(id); guard();
      if (thingIn(response)?.id !== id) throw Error('The cloud response did not identify the selected Thing.');
      const measured = replicaJsonDigest(response), coverage = new Map<string, ReplicaAssetProof>(); let fileBytes = 0;
      if (input.manageFileBytes !== false) {
        for await (const item of manifest(id, initial)) {
          const downloaded = await download(id, item, initial);
          if (coverage.has(downloaded.key)) throw Error('The attachment manifest repeated a file.');
          coverage.set(downloaded.key, downloaded.proof); fileBytes += downloaded.size;
        }
      }
      if (!samePolicy(initial, await policy(id))) throw Error('The Thing or storage choice changed. Your previous offline copy is unchanged.');
      guard();
      const record: ReplicaRecord = { scope: key, id, generation: crypto.randomUUID(), response, digest: measured.digest,
        jsonBytes: measured.bytes, sourceHash: initial.source.sourceHash, sourceRevision: initial.source.revision,
        policy: initial, fileBytes, assets: [...coverage.keys()], assetSourceHash: initial.source.sourceHash,
        nativeFileBytes: input.manageFileBytes === false };
      await store.publish(record, previous?.generation ?? null, coverage, guard); guard();
      return describe(record, 'saved');
    }),
    sync: (id: string) => lock(id, async (): Promise<ThingReplicaStatus> => {
      const initial = await policy(id), row = await store.read(key, id); guard();
      if (!row?.pendingMutation) return describe(row);
      if (!initial.policy.cloudSync) throw Error('Turn on cloud sync before uploading this device’s changes.');
      if (!input.writeThing) throw Error('Cloud writes are unavailable on this device. Local changes are retained.');
      const expected = thingIn(row.response), payload = structuredClone(row.pendingMutation);
      const matches = (response: unknown) => {
        const thing = thingIn(response);
        if (!thing || thing.id !== id || !expected) return false;
        return Object.keys(payload).filter(k => !['id', 'expectedUpdatedAt', 'replaceCrystal'].includes(k))
          .every(k => replicaJsonDigest(thing[k] ?? null).digest === replicaJsonDigest(expected[k] ?? null).digest);
      };
      // Accepted-response loss is reconciled against the same immutable
      // payload. A conflicting write is never retried without its original CAS.
      let cloud = await input.readThing(id); guard();
      if (!matches(cloud)) {
        if (!samePolicy(initial, await policy(id))) throw Error('Storage choice changed before synchronization. Local changes remain available.');
        guard();
        try { await input.writeThing({ ...payload, expectedStoragePolicyRevision: initial.policy.revision }); }
        catch (error) { cloud = await input.readThing(id); guard(); if (!matches(cloud)) throw error; }
        cloud = await input.readThing(id); guard();
      }
      if (!matches(cloud)) throw Error('Cloud verification did not match the pending changes. The local copy has been kept.');
      const verified = await policy(id);
      if (!verified.policy.cloudSync || verified.policy.revision !== initial.policy.revision || verified.device?.revision !== initial.device?.revision)
        throw Error('Storage choice changed while syncing. Local changes remain available for reconciliation.');
      const confirmed = await input.readThing(id); guard();
      if (replicaJsonDigest(confirmed).digest !== replicaJsonDigest(cloud).digest || !samePolicy(verified, await policy(id)))
        throw Error('Cloud content changed while confirming the sync. Local changes remain available.');
      await store.acknowledge(key, id, row.generation, confirmed, verified, guard); guard();
      const saved = await store.read(key, id); guard();
      return describe(saved, 'saved');
    }),
    evict: (id: string) => lock(id, async (): Promise<ThingReplicaStatus> => {
      const initial = await policy(id), row = await store.read(key, id); guard();
      if (initial.device?.localAvailability !== 'cloud-only' || !initial.policy.cloudSync) throw Error('Choose Cloud only before releasing this device’s copy.');
      if (!row) return { state: 'evicted', jsonBytes: 0, fileBytes: 0 };
      if (row.pendingMutation || row.sourceHash !== initial.source.sourceHash || replicaJsonDigest(row.response).digest !== row.digest)
        throw Error('This device has different or unsynced content. Its copy has been kept.');
      // Re-read the actual authorized cloud Thing, not just its saved policy.
      const cloud = await input.readThing(id); guard();
      if (replicaJsonDigest(cloud).digest !== row.digest) throw Error('Cloud content differs from this device. Its copy has been kept.');
      if (input.manageFileBytes !== false) {
        const assets: string[] = []; let size = 0;
        for await (const asset of manifest(id, initial)) {
          if (!asset.version || asset.size === null || !validContentFingerprint(asset.fingerprint, asset.size))
            throw Error('A cloud attachment is unverified. This device’s copy has been kept.');
          assets.push(JSON.stringify([id, asset.id, asset.version])); size += asset.size;
        }
        if (size !== row.fileBytes || assets.length !== row.assets.length || assets.some(asset => !row.assets.includes(asset)))
          throw Error('Cloud attachment versions changed. This device’s copy has been kept.');
      }
      if (!samePolicy(initial, await policy(id))) throw Error('Storage choice changed. Its local copy has been kept.');
      guard(); await store.remove(key, id, row.generation, guard); guard();
      return { state: 'evicted', jsonBytes: 0, fileBytes: 0, sourceHash: initial.source.sourceHash, sourceRevision: initial.source.revision };
    }),
    async download(id: string): Promise<void> {
      guard(); const row = await store.read(key, id); guard();
      if (!row || replicaJsonDigest(row.response).digest !== row.digest) throw Error('No verified local copy is available.');
      const thing = thingIn(row.response), file = thing?.crystal?.content?.attachmentId && row.assets.length === 1;
      const filename = file && typeof thing?.crystal?.name === 'string' ? thing.crystal.name : `${id}.json`;
      const picker = (window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<WritableStream & { write(bytes: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }> }).showSaveFilePicker;
      if (!picker) throw Error('This browser cannot export stored bytes directly. Open this Thing in a browser with Save File support or the native app.');
      const handle = await picker({ suggestedName: filename.replace(/[\\/\u0000]/g, '_') }); guard();
      const target = await handle.createWritable();
      try {
        if (file) {
          let offset = 0;
          while (offset < row.fileBytes) {
            guard(); const chunk = await store.nextChunk(key, row.assets[0], offset); guard();
            if (!chunk || chunk.offset !== offset || !chunk.bytes.byteLength ||
                offset + chunk.bytes.byteLength > row.fileBytes || hex(sha256(chunk.bytes)) !== chunk.digest)
              throw Error('The local file is incomplete.');
            await target.write(chunk.bytes); offset += chunk.bytes.byteLength;
          }
        } else for (const bytes of canonicalJsonBytes(row.response, guard)) await target.write(bytes);
        guard();
        if ((await store.read(key, id))?.generation !== row.generation) throw Error('The local copy changed during export.');
        guard();
        await target.close();
      } catch (error) { await target.abort().catch(() => {}); throw error; }
    },
  };
}
