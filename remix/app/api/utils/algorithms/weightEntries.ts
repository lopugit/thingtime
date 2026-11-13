import { createHash, randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { deleteAccountedThings, insertAccountedThings } from '../storage/accountedThings';
import { StorageMutationError } from '../storage/storageCore';
import { emptyWeights, type AlgorithmWeights } from '../things/feedRanking';

export const ALGORITHM_WEIGHT_KIND = 'feed-algorithm-weight';
const buckets = ['types', 'tags', 'authors'] as const;
const batchSize = 100;
export const algorithmWeightCounts = (weights: AlgorithmWeights) => Object.fromEntries(buckets.map(bucket => [bucket, Object.keys(weights[bucket]).length])) as Record<typeof buckets[number], number>;
const incomplete = () => new StorageMutationError(409, 'storage_conflict', 'Algorithm weights changed or are incomplete; reload the profile');

/** Complete private compatibility view. Persisted rows stay individually bounded;
 * page sizes control database work without limiting the learned profile. */
export async function hydrateAlgorithmWeights(things: any, docs: any[], session?: any): Promise<any[]> {
  const result = docs.map(doc => doc.crystal?.weightsGeneration
    ? { ...doc, crystal: { ...doc.crystal, weights: emptyWeights() } } : doc);
  const roots = result.filter(doc => doc.crystal?.weightsGeneration);
  const byId = new Map(roots.map(doc => [doc.shareId, doc]));
  const seen = new Map(roots.map(doc => [doc.shareId, new Set<string>()]));
  for (const doc of roots) if (!doc.crystal.weightsCounts || buckets.some(bucket =>
    !Number.isSafeInteger(doc.crystal.weightsCounts[bucket]) || doc.crystal.weightsCounts[bucket] < 0)) throw incomplete();
  for (let offset = 0; offset < roots.length; offset += batchSize) {
    const cursor = things.find({ thingtime: ALGORITHM_WEIGHT_KIND, $or: roots.slice(offset, offset + batchSize).map(doc => ({
      targetId: doc.shareId, ownerId: doc.ownerId, 'crystal.generation': doc.crystal.weightsGeneration
    })) }, { ...(session ? { session } : {}), projection: { targetId: 1, ownerId: 1, crystal: 1 } }).batchSize(batchSize);
    for await (const row of cursor) {
      const root = byId.get(row.targetId);
      if (!root || row.ownerId !== root.ownerId || row.crystal.generation !== root.crystal.weightsGeneration) continue;
      if (!buckets.includes(row.crystal.bucket) || typeof row.crystal.key !== 'string' || !row.crystal.key || !Number.isFinite(row.crystal.weight)) throw incomplete();
      const identity = JSON.stringify([row.crystal.bucket, row.crystal.key]);
      if (seen.get(root.shareId)!.has(identity)) throw incomplete();
      seen.get(root.shareId)!.add(identity);
      Object.defineProperty(root.crystal.weights[row.crystal.bucket], row.crystal.key, {
        value: row.crystal.weight, enumerable: true, configurable: true, writable: true
      });
    }
  }
  for (const root of roots) {
    const counts = algorithmWeightCounts(root.crystal.weights);
    if (buckets.some(bucket => counts[bucket] !== root.crystal.weightsCounts[bucket])) throw incomplete();
    const current = await things.findOne({ shareId: root.shareId, ownerId: root.ownerId, thingtime: 'feed-algorithm' },
      { ...(session ? { session } : {}), projection: { 'crystal.weightsGeneration': 1 } });
    if (current?.crystal?.weightsGeneration !== root.crystal.weightsGeneration) throw incomplete();
  }
  return result;
}

/** Caller owns the root CAS and enclosing home transaction. Accounting, child
 * replacement and the authoritative generation commit or roll back together. */
export async function replaceAlgorithmWeights(things: any, doc: any, weights: AlgorithmWeights, session: any): Promise<ReturnType<typeof randomUUID>> {
  const generation = randomUUID(), now = new Date();
  await deleteAlgorithmWeights(things, doc.shareId, doc.ownerId, session);
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await insertAccountedThings(things, batch, { session, accountedPlane: 'home' });
    batch = [];
  };
  for (const bucket of buckets) for (const [key, weight] of Object.entries(weights[bucket])) {
    batch.push({
      shareId: 'feed-algorithm-weight-' + createHash('sha256').update(JSON.stringify([doc.shareId, generation, bucket, key])).digest('hex'),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [ALGORITHM_WEIGHT_KIND],
      ownerId: doc.ownerId, targetId: doc.shareId, parentId: doc.shareId, acl: ['tt:user'], tags: [], extended: null,
      crystal: { generation, bucket, key, weight }, createdAt: now, updatedAt: now
    });
    if (batch.length === batchSize) await flush();
  }
  await flush();
  return generation;
}

export const deleteAlgorithmWeights = (things: any, id: string, ownerId: string, session: any) =>
  deleteAccountedThings(things, { thingtime: ALGORITHM_WEIGHT_KIND, targetId: id, ownerId }, { session, accountedPlane: 'home' });
