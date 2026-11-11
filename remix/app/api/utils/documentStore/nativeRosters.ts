import { BSON } from 'mongodb';
import type { RosterDoc } from '../auth/accounts';
import { assertRosterRepositoryScope, RosterRepositoryError, type RosterRepository } from '../auth/rosterRepository';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import type { CollectionFilter, CollectionProvider, CollectionTransaction } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';

const invalid = (): never => { throw new RosterRepositoryError('INVALID_ROSTER', 'Invalid account roster persistence input'); };
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(Date.prototype.getTime.call(value));
const validate = (document: RosterDoc): RosterDoc => {
 if (!identity(document.rosterId) || document.type !== 'tt.roster' || !identity(document.version) ||
  !date(document.createdAt) || !date(document.updatedAt) || (document.expiresAt !== null && !date(document.expiresAt)) ||
  !Array.isArray(document.entries) || document.entries.some(entry => !entry || !identity(entry.userId) || !identity(entry.jti) || !date(entry.addedAt))) invalid();
 return document;
};

/** Account-switcher references live in the selected profile's home store. This
 * adapter issues no sessions/JWTs and supplies no independent account access. */
export async function createNativeRosterRepository(provider: CollectionProvider, homePlaneId: string): Promise<RosterRepository> {
 if (!identity(homePlaneId)) throw new RosterRepositoryError('ROSTER_REPOSITORY_SCOPE', 'A native home-plane identity is required');
 const namespace = physicalCollectionName('rosters');
 await provider.transaction(s => s.defineCollection(namespace, { unique: [{ name: 'roster-id', path: ['rosterId'], sparse: false, multikey: false }] }));
 const filter = (rosterId: string, expectedVersion?: string | null): CollectionFilter => {
  if (!identity(rosterId) || (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== 'string')) invalid();
  const byId: CollectionFilter = { op: 'eq', path: ['rosterId'], value: rosterId };
  return expectedVersion ? { op: 'and', filters: [byId, { op: 'eq', path: ['version'], value: expectedVersion }] } : byId;
 };
 let repository: RosterRepository;
 const transaction = <T>(work: (s: CollectionTransaction) => T): Promise<T> => {
  assertRosterRepositoryScope(repository);
  return provider.transaction(async s => {
   assertRosterRepositoryScope(repository);
   const result = await work(s);
   assertRosterRepositoryScope(repository);
   return result;
  });
 };
 repository = Object.freeze({
  kind: 'native-home', homePlaneId,
  async findById(rosterId: string) {
   const query = filter(rosterId);
   return transaction(s => {
    const rows = s.collection(namespace).find({ filter: query, limit: 2 }).documents;
    if (rows.length > 1) return invalid();
    return rows[0] ? validate(BSON.deserialize(rows[0]) as RosterDoc) : null;
   });
  },
  async insert(document: RosterDoc) {
   assertRosterRepositoryScope(repository);
   // Admit BSON before reading fields: hostile getters/toBSON never execute.
   const bytes = encodeCollectionDocument(document, 'rosterId');
   validate(BSON.deserialize(bytes) as RosterDoc);
   await transaction(s => s.collection(namespace).insert(bytes));
  },
  async replace(rosterId: string, update: Pick<RosterDoc, 'entries' | 'updatedAt' | 'expiresAt' | 'version'>, expectedVersion?: string | null) {
   assertRosterRepositoryScope(repository);
   const query = filter(rosterId, expectedVersion);
   // Freeze validated input before queued work; no caller mutation can change
   // which entries/version this operation commits while awaiting another writer.
   const bytes = encodeCollectionDocument({ _id: rosterId, update });
   const frozen = BSON.deserialize(bytes).update as typeof update;
   validate({ ...frozen, rosterId, type: 'tt.roster', createdAt: frozen.updatedAt });
   return transaction(s => s.collection(namespace).updateOne(query, [
    { op: 'set', path: ['entries'], value: frozen.entries },
    { op: 'set', path: ['updatedAt'], value: frozen.updatedAt },
    { op: 'set', path: ['expiresAt'], value: frozen.expiresAt },
    { op: 'set', path: ['version'], value: frozen.version }
   ]).matched);
  },
  async remove(rosterId: string, expectedVersion?: string | null) {
   const query = filter(rosterId, expectedVersion);
   return transaction(s => {
    const collection = s.collection(namespace), deleted = collection.deleteOne(query);
    return { deleted, exists: !deleted && !!expectedVersion && collection.find({ filter: filter(rosterId), limit: 1 }).documents.length > 0 };
   });
  }
 });
 registerHomeRepositoryProvider(repository, provider);
 return repository;
}
