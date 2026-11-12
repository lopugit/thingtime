import { currentNativeSandboxNamespace } from '../apps/nativeSandboxNamespace';
import { BSON, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { createThingsPersistence, matchesThingVersion, normalizeThingsSelection, thingsPersistenceError, type StoredThing, type ThingsDriverReads, type ThingsPersistence, type ThingsScope, type ThingsSelection } from '../things/persistence';
import { withNativeHomeStorageTransaction, withNativeHomeDeletionStorageTransaction, withNativeStorageOperation, withNativeSandboxStorageTransaction } from './nativeUserStorage';
import { encodeCollectionDocument } from './collectionProvider';
import type { CollectionProvider, CollectionTransaction, CollectionFilter, CollectionUpdate } from './collectionContract';
const providerIdentities = new WeakMap<CollectionProvider, string>();
const namespace = physicalCollectionName('things');
const eq = (path: string[], value: any): CollectionFilter => ({ op: 'eq', path, value });
const and = (filters: CollectionFilter[]): CollectionFilter => ({ op: 'and', filters });
const compareShareIds = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const compare = (a: StoredThing, b: StoredThing) => +b.createdAt - +a.createdAt || compareShareIds(a.shareId, b.shareId);
function selectionFilter(selection: Omit<ThingsSelection, 'cursor'>): CollectionFilter | undefined {
 const filters: CollectionFilter[] = [];
 if (selection.ownerId !== undefined) filters.push(eq(['ownerId'], selection.ownerId));
 if (selection.kinds?.length) filters.push({ op: 'or', filters: selection.kinds.map(value => ({ op: 'contains', path: ['thingtime'], value })) });
 if (selection.folder) filters.push(selection.folder.kind === 'id' ? eq(['folderId'], selection.folder.id) : { op: 'or', filters: [eq(['folderId'], null), { op: 'exists', path: ['folderId'], value: false }] });
 if (selection.targetId !== undefined) filters.push(eq(['targetId'], selection.targetId));
 if (selection.schemaId !== undefined) filters.push(eq(['crystal', 'schemaId'], selection.schemaId));
 if (selection.parentId !== undefined) filters.push(eq(['crystal', 'parentId'], selection.parentId));
 return filters.length ? and(filters) : undefined;
}
function reads(collections: CollectionTransaction): ThingsDriverReads {
 const collection = () => collections.collection(namespace);
 return {
  async exact(id) { const rows = collection().find({ filter: eq(['shareId'], id), limit: 2 }).documents; if (rows.length > 1) return thingsPersistenceError('ambiguous identity'); return rows[0] ? BSON.deserialize(rows[0]) : null; },
  async batch(ids) {
   if (!ids.length) return []; const documents: StoredThing[] = []; let cursor: any = undefined;
   do { const page = collection().find({ filter: { op: 'or', filters: ids.map(id => eq(['shareId'], id)) }, after: cursor, limit: 128 }); documents.push(...page.documents.map(bytes => BSON.deserialize(bytes))); cursor = page.nextAfter; } while (cursor !== null);
   return documents;
  },
  async window(selection, after) {
   // Collection identity order is unrelated to content chronology. Scan every
   // internal batch, sort eligible rows, then select the requested window.
   const rows: StoredThing[] = [], excludedKinds = new Set(selection.excludedKinds); let cursor: any = undefined;
   do {
    const page = collection().find({ filter: selectionFilter(selection), after: cursor, limit: 128 });
    for (const bytes of page.documents) {
     const row = BSON.deserialize(bytes);
     // Exclusions are semantic selection predicates, applied during this one
     // scan before chronological pagination. Native filters intentionally have
     // no implicit Mongo-style array negation or missing/null coercion.
     if ((Array.isArray(row.thingtime) && row.thingtime.some((kind: unknown) => typeof kind === 'string' && excludedKinds.has(kind))) || (selection.excludeArchived && row.crystal?.archived === true)) continue;
     if (!(row.createdAt instanceof Date) || !Number.isFinite(+row.createdAt) || typeof row.shareId !== 'string') return thingsPersistenceError('invalid stored chronology');
     if (!after || +row.createdAt < +after.createdAt || (+row.createdAt === +after.createdAt && compareShareIds(row.shareId, after.id) > 0)) rows.push(row);
    }
    cursor = page.nextAfter;
   } while (cursor !== null);
   rows.sort(compare); return rows.slice(0, selection.limit + 1);
  }
 };
}
/** Protected-bootstrap input only. No HTTP/environment provider selection.
 * Read scopes require no ready ledger; writes reuse real account admission.
 * Closing this repository revokes its handles, without closing shared provider. */
export function createNativeContentRepository(provider: CollectionProvider, input: Omit<ThingsScope, 'providerId'> & { providerId?: string }): ThingsPersistence {
 let identity = providerIdentities.get(provider); if (!identity) { identity = `native-${randomUUID()}`; providerIdentities.set(provider, identity); }
 const scope: ThingsScope = { ...input, providerId: identity };
 if (scope.homePlaneId !== scope.contentPlaneId) return thingsPersistenceError('native content requires one home/content plane');
 return createThingsPersistence(scope, {
  exact: id => provider.transaction(collections => reads(collections).exact(id)),
  batch: ids => provider.transaction(collections => reads(collections).batch(ids)),
  window: (selection, after) => provider.transaction(collections => reads(collections).window(normalizeThingsSelection(selection), after)),
  transaction(mode, work) {
   if (!scope.ownerId) return thingsPersistenceError('writes require an authenticated owner');
   const ownerId = scope.ownerId;
   const run = mode === 'delete' ? withNativeHomeDeletionStorageTransaction : withNativeHomeStorageTransaction;
   const sandbox = currentNativeSandboxNamespace(ownerId);
   const selectedRun: typeof run = sandbox ? (provider, binding, work) => withNativeSandboxStorageTransaction(provider, binding, mode === 'delete', work) : run;
   return selectedRun(provider, { ...scope, ownerId }, (session, collections) => {
    const source = reads(collections), collection = collections.collection(namespace);
    const versionRow = async (expected: Parameters<typeof matchesThingVersion>[1]) => {
     const row = await source.exact(expected.id);
     if (row && row.ownerId !== scope.ownerId) return thingsPersistenceError('mutation owner mismatch');
     return row && matchesThingVersion(row, expected) ? row : null;
    };
    return work({ ...source, binding: { kind: 'native', collections, session },
     operation: callback => withNativeStorageOperation(ownerId, session, collections, callback),
     async insert(document) { const bytes = encodeCollectionDocument(document._id === undefined ? { ...document, _id: new ObjectId() } : document); collection.insert(bytes); return BSON.deserialize(bytes); },
     async swap(expected, document) {
      const before = await versionRow(expected); if (!before) return false;
      const updates: CollectionUpdate[] = Object.keys(document).filter(key => key !== '_id').map(key => ({ op: 'set', path: [key], value: document[key] }));
      for (const key of Object.keys(before)) if (key !== '_id' && !Object.prototype.hasOwnProperty.call(document, key)) updates.push({ op: 'unset', path: [key] });
      return collection.updateOne(and([eq(['_id'], before._id), eq(['ownerId'], scope.ownerId), eq(['updatedAt'], before.updatedAt)]), updates).matched;
     },
     async remove(expected) { const before = await versionRow(expected); if (!before) return null; return collection.deleteOne(and([eq(['_id'], before._id), eq(['ownerId'], scope.ownerId), eq(['updatedAt'], before.updatedAt)])) ? before : null; }
    });
   });
  }
 });
}
