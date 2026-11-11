import { randomUUID } from 'node:crypto';
import { createThingsPersistence, thingsPersistenceError, type ThingsDriverReads, type ThingsPersistence, type ThingsScope, type ThingsSelection, type ThingVersion } from './persistence';
const collectionIdentities = new WeakMap<object, string>();
/** Injected collection and transaction runner must resolve the same selected
 * plane. Production defaults retain canonical Mongo lifecycle and sessions. */
export async function createMongoThingsPersistence(scope: Omit<ThingsScope, 'providerId'> & { providerId?: string }, dependencies?: {
 collection: () => Promise<any>; transaction: <T>(work: (session: any) => Promise<T>) => Promise<T>;
}): Promise<ThingsPersistence> {
 if (scope.homePlaneId !== scope.contentPlaneId) return thingsPersistenceError('content writes require one home/content plane');
 const deps = dependencies ?? await import('../mongodb/collections').then(module => ({ collection: module.getThingsCollection, transaction: module.withMongoTransaction }));
 const reads = (collection: any, session?: any): ThingsDriverReads => ({
  exact: id => collection.findOne({ shareId: id }, session ? { session } : {}),
  batch: ids => ids.length ? collection.find({ shareId: { $in: [...ids] } }, session ? { session } : {}).toArray() : Promise.resolve([]),
  async window(selection: Omit<ThingsSelection, 'cursor'>, after) {
   const filters: any[] = [];
   if (selection.ownerId !== undefined) filters.push({ ownerId: selection.ownerId });
   if (selection.kinds?.length) filters.push({ thingtime: { $in: selection.kinds } });
   if (selection.excludedKinds?.length) filters.push({ thingtime: { $nin: selection.excludedKinds } });
   if (selection.excludeArchived) filters.push({ 'crystal.archived': { $ne: true } });
   if (selection.folder) filters.push(selection.folder.kind === 'id' ? { folderId: selection.folder.id } : { folderId: null });
   if (selection.targetId !== undefined) filters.push({ targetId: selection.targetId });
   if (selection.schemaId !== undefined) filters.push({ 'crystal.schemaId': selection.schemaId });
   if (selection.parentId !== undefined) filters.push({ 'crystal.parentId': selection.parentId });
   if (after) filters.push({ $or: [{ createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, shareId: { $gt: after.id } }] });
   return collection.find(filters.length ? { $and: filters } : {}, session ? { session } : {}).sort({ createdAt: -1, shareId: 1 }).limit(selection.limit + 1).toArray();
  }
 });
 const selected = await deps.collection();
 const client = selected.client ?? selected;
 let identity = collectionIdentities.get(client); if (!identity) { identity = `mongo-${randomUUID()}`; collectionIdentities.set(client, identity); }
 const namespace = selected.namespace ?? ''; identity = `${identity}:${namespace}`;
 const selectedCollection = async () => { const value = await deps.collection(); if ((value.client ?? value) !== client || (value.namespace ?? '') !== namespace) return thingsPersistenceError('selected Mongo provider changed'); return value; };
 return createThingsPersistence({ ...scope, providerId: identity }, {
  exact: async id => reads(await selectedCollection()).exact(id),
  batch: async ids => reads(await selectedCollection()).batch(ids),
  window: async (selection, after) => reads(await selectedCollection()).window(selection, after),
  transaction: (mode, work) => deps.transaction(async session => {
   if (!session?.inTransaction?.()) return thingsPersistenceError('Mongo content transaction is unavailable');
   const collection = await selectedCollection();
   const filter = (expected: ThingVersion) => ({ shareId: expected.id, _id: expected.identity, ownerId: scope.ownerId, updatedAt: expected.updatedAt,
    ...(expected.headId !== undefined ? { timelineHeadId: expected.headId } : {}),
    ...(expected.sizeBytes !== undefined ? { sizeBytes: expected.sizeBytes } : {}),
    ...(expected.folderId !== undefined ? { folderId: expected.folderId } : {}) });
   return work({ ...reads(collection, session), binding: { kind: 'mongo', collection, session }, operation: operation => operation(),
    async insert(document) { const result = await collection.insertOne(document, { session }); return { ...document, _id: document._id ?? result.insertedId }; },
    async swap(expected, document) { return (await collection.replaceOne(filter(expected), document, { session })).matchedCount === 1; },
    async remove(expected) { return collection.findOneAndDelete(filter(expected), { session }); }
   });
  })
 });
}
