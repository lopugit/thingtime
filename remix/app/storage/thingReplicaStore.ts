import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalJsonBytes } from '../utils/canonicalJsonStream';
import type { ThingStoragePolicyResponse } from '../utils/thingStoragePolicy';

export type ReplicaScope = { apiOrigin: string; ownerId: string; dataPlane: string; deviceId: string };
export type ReplicaRecord = {
  scope: string; id: string; generation: string; response: unknown; digest: string; jsonBytes: number;
  sourceHash: string; sourceRevision: string; policy: ThingStoragePolicyResponse;
  fileBytes: number; assets: string[]; assetSourceHash?: string; nativeFileBytes?: boolean; pendingMutation?: Record<string, unknown>;
};
export type ReplicaChunk = { scope: string; asset: string; offset: number; bytes: Uint8Array; digest: string };
export type ReplicaAssetProof = { epoch: string; chunks: number };
export const replicaScopeKey = (scope: ReplicaScope) => {
  if (new URL(scope.apiOrigin).origin !== scope.apiOrigin || !scope.ownerId || !scope.dataPlane || !scope.deviceId) throw Error('Invalid device storage identity.');
  return JSON.stringify([scope.apiOrigin, scope.ownerId, scope.dataPlane, scope.deviceId]);
};
export function replicaJsonDigest(value: unknown) {
  const hash = sha256.create(); let bytes = 0;
  for (const part of canonicalJsonBytes(value)) { hash.update(part); bytes += part.byteLength; }
  return { digest: hash.digest().reduce((s, byte) => s + byte.toString(16).padStart(2, '0'), ''), bytes };
}
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
const completion = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? Error('Device storage transaction failed.'));
});
const checkWrite = (tx: IDBTransaction, check: () => void) => {
  try { check(); return true; } catch { tx.abort(); return false; }
};
const assetRange = (scope: string, asset: string) => IDBKeyRange.bound([scope, asset, 0], [scope, asset, Number.MAX_SAFE_INTEGER]);
const epochKey = (scope: string, asset: string) => ['asset-epoch', scope, asset];

/** App-owned copies only. Ordinary filesystem/folder-sync entries never enter
 * this database, so eviction cannot become a propagated file deletion. */
export class ThingReplicaStore {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private factory: IDBFactory, private name = 'thingtime-managed-replicas-v1') {}
  private open() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('copies', { keyPath: ['scope', 'id'] });
        req.result.createObjectStore('chunks', { keyPath: ['scope', 'asset', 'offset'] });
        req.result.createObjectStore('bindings');
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); this.database = null; }; resolve(db); };
      req.onerror = () => { this.database = null; reject(req.error); };
      req.onblocked = () => { this.database = null; reject(Error('Close older Thingtime tabs to update device storage.')); };
    });
  }
  async binding(scope: Omit<ReplicaScope, 'deviceId'>): Promise<string | null> {
    const db = await this.open(); return (await request(db.transaction('bindings').objectStore('bindings').get(JSON.stringify([scope.apiOrigin, scope.ownerId, scope.dataPlane])))) ?? null;
  }
  async read(scope: string, id: string): Promise<ReplicaRecord | null> {
    const db = await this.open(); return (await request(db.transaction('copies').objectStore('copies').get([scope, id]))) ?? null;
  }
  async next(scope: string, afterId?: string): Promise<ReplicaRecord | null> {
    const db = await this.open();
    const cursor = await request(db.transaction('copies').objectStore('copies').openCursor(
      IDBKeyRange.bound(afterId === undefined ? [scope] : [scope, afterId], [scope, []], afterId !== undefined, true)));
    return cursor?.value ?? null;
  }
  async chunk(scope: string, asset: string, offset: number): Promise<ReplicaChunk | null> {
    const db = await this.open(); return (await request(db.transaction('chunks').objectStore('chunks').get([scope, asset, offset]))) ?? null;
  }
  async assetEpoch(scope: string, asset: string, check = () => {}): Promise<string> {
    const db = await this.open(), tx = db.transaction('bindings', 'readwrite'), done = completion(tx);
    const bindings = tx.objectStore('bindings'), key = epochKey(scope, asset), req = bindings.get(key);
    let epoch = '';
    req.onsuccess = () => {
      if (!checkWrite(tx, check)) return;
      if (typeof req.result === 'string') { epoch = req.result; return; }
      epoch = crypto.randomUUID(); bindings.put(epoch, key);
    };
    await done; return epoch;
  }
  async putChunk(chunk: ReplicaChunk, epoch: string, check = () => {}) {
    const db = await this.open(), tx = db.transaction(['chunks', 'bindings'], 'readwrite'), done = completion(tx);
    const chunks = tx.objectStore('chunks'), current = tx.objectStore('bindings').get(epochKey(chunk.scope, chunk.asset));
    current.onsuccess = () => {
      if (current.result !== epoch) { tx.abort(); return; }
      const req = chunks.get([chunk.scope, chunk.asset, chunk.offset]);
      req.onsuccess = () => {
        if (!checkWrite(tx, check)) return;
        const existing = req.result as ReplicaChunk | undefined;
        if (!existing) chunks.add(chunk);
        else if (existing.digest !== chunk.digest || existing.bytes.byteLength !== chunk.bytes.byteLength) tx.abort();
      };
    };
    await done;
  }
  async nextChunk(scope: string, asset: string, offset: number): Promise<ReplicaChunk | null> {
    const db = await this.open();
    const cursor = await request(db.transaction('chunks').objectStore('chunks').openCursor(
      IDBKeyRange.bound([scope, asset, offset], [scope, asset, Number.MAX_SAFE_INTEGER])));
    return cursor?.value ?? null;
  }
  async discardUnpublishedAsset(scope: string, id: string, asset: string, epoch: string, check = () => {}) {
    const db = await this.open(), tx = db.transaction(['copies', 'chunks', 'bindings'], 'readwrite'), done = completion(tx);
    const req = tx.objectStore('copies').get([scope, id]);
    req.onsuccess = () => {
      if ((req.result as ReplicaRecord | undefined)?.assets.includes(asset)) return;
      const bindings = tx.objectStore('bindings'), key = epochKey(scope, asset), current = bindings.get(key);
      current.onsuccess = () => {
        if (checkWrite(tx, check) && current.result === epoch) {
          tx.objectStore('chunks').delete(assetRange(scope, asset)); bindings.delete(key);
        }
      };
    };
    await done;
  }
  async publish(record: ReplicaRecord, expectedGeneration: string | null, coverage: ReadonlyMap<string, ReplicaAssetProof>, check = () => {}) {
    const [origin, owner, plane, device] = JSON.parse(record.scope) as string[];
    const db = await this.open(), tx = db.transaction(['copies', 'chunks', 'bindings'], 'readwrite'), done = completion(tx), store = tx.objectStore('copies');
    const req = store.get([record.scope, record.id]);
    req.onsuccess = () => {
      if (!checkWrite(tx, check)) return;
      const previous = req.result as ReplicaRecord | undefined;
      if ((previous?.generation ?? null) !== expectedGeneration || previous?.pendingMutation ||
          coverage.size !== record.assets.length || record.assets.some(asset => !coverage.has(asset))) { tx.abort(); return; }
      const chunks = tx.objectStore('chunks'), bindings = tx.objectStore('bindings');
      const save = () => {
        if (!checkWrite(tx, check)) return;
        store.put(record);
        bindings.put(device, JSON.stringify([origin, owner, plane]));
        for (const asset of previous?.assets ?? []) if (!coverage.has(asset)) {
          chunks.delete(assetRange(record.scope, asset)); bindings.delete(epochKey(record.scope, asset));
        }
      };
      let remaining = coverage.size;
      if (!remaining) save();
      // Prevent another tab's failed stage cleanup from publishing a copy
      // whose verified chunks disappeared or were replaced between hash and commit.
      for (const [asset, expected] of coverage) {
        const current = bindings.get(epochKey(record.scope, asset));
        current.onsuccess = () => {
          if (current.result !== expected.epoch) { tx.abort(); return; }
          const count = chunks.count(assetRange(record.scope, asset));
          count.onsuccess = () => {
            if (count.result !== expected.chunks) { tx.abort(); return; }
            if (--remaining === 0) save();
          };
        };
      }
    };
    await done;
  }
  async acknowledge(scope: string, id: string, expectedGeneration: string, response: unknown, policy: ThingStoragePolicyResponse, check = () => {}) {
    const measured = replicaJsonDigest(response);
    const db = await this.open(), tx = db.transaction('copies', 'readwrite'), done = completion(tx), store = tx.objectStore('copies');
    const req = store.get([scope, id]);
    req.onsuccess = () => {
      const row = req.result as ReplicaRecord | undefined;
      if (!checkWrite(tx, check)) return;
      if (!row || row.generation !== expectedGeneration || !row.pendingMutation) { tx.abort(); return; }
      const next = { ...row, response, digest: measured.digest, jsonBytes: measured.bytes, policy,
        sourceHash: policy.source.sourceHash, sourceRevision: policy.source.revision, generation: crypto.randomUUID() };
      delete next.pendingMutation; store.put(next);
    };
    await done;
  }
  async remove(scope: string, id: string, expectedGeneration: string, check = () => {}) {
    const db = await this.open(), tx = db.transaction(['copies', 'chunks', 'bindings'], 'readwrite'), done = completion(tx), copies = tx.objectStore('copies');
    const req = copies.get([scope, id]);
    req.onsuccess = () => {
      const previous = req.result as ReplicaRecord | undefined;
      if (!checkWrite(tx, check)) return;
      if (!previous || previous.generation !== expectedGeneration || previous.pendingMutation) { tx.abort(); return; }
      // Asset keys include the owning Thing ID. A different Thing's local copy
      // cannot lose bytes when this copy is released.
      for (const asset of previous.assets) {
        tx.objectStore('chunks').delete(assetRange(scope, asset));
        tx.objectStore('bindings').delete(epochKey(scope, asset));
      }
      copies.delete([scope, id]);
    };
    await done;
  }
  async queueMutation(scope: string, id: string, response: unknown, mutation: Record<string, unknown>, expectedGeneration: string, check = () => {}) {
    const [origin, owner, plane, device] = JSON.parse(scope) as string[];
    const measured = replicaJsonDigest(response);
    const db = await this.open(), tx = db.transaction(['copies', 'bindings'], 'readwrite'), done = completion(tx), store = tx.objectStore('copies');
    const req = tx.objectStore('bindings').get(JSON.stringify([origin, owner, plane]));
    req.onsuccess = () => {
      if (!checkWrite(tx, check)) return;
      if (req.result !== device) { tx.abort(); return; }
      const copy = store.get([scope, id]);
      copy.onsuccess = () => {
        if (!checkWrite(tx, check)) return;
        const row = copy.result as ReplicaRecord | undefined;
        if (!row || row.generation !== expectedGeneration || row.policy.policy.cloudSync) { tx.abort(); return; }
        store.put({ ...row, response, digest: measured.digest, jsonBytes: measured.bytes, generation: crypto.randomUUID(), pendingMutation: mutation });
      };
    };
    await done;
  }
  close() { void this.database?.then(db => db.close(), () => {}); this.database = null; }
}
