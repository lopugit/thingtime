import { BSON } from 'mongodb';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, isNotificationType } from '~/schemas/registry';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { buildNotificationListFilters, escapeRegex, NOTIFICATION_SEARCH_FIELDS, resolveNotificationListQuery } from '../notifications/listQuery';
import type { ResolvedNotificationListQuery } from '../notifications/listQuery';
import { assertNotificationRepositoryScope, NotificationRepositoryError } from '../notifications/repository';
import type { NotificationPageInput, NotificationRepository } from '../notifications/repository';
import type { CollectionIdentity, CollectionProvider, CollectionTransaction, NativeCollection } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';
import { defineNativeThingsCollection } from './nativeThingsCollection';

const invalid = (): never => { throw new NotificationRepositoryError('INVALID_NOTIFICATION', 'Invalid protected notification history'); };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const validate = (row: Record<string, any>) => {
 if (!text(row.shareId) || !text(row.ownerId) || row.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things ||
  !Array.isArray(row.thingtime) || row.thingtime.length !== 1 || row.thingtime[0] !== 'notification' ||
  !Array.isArray(row.acl) || row.acl.length !== 1 || row.acl[0] !== ACL_OWNER ||
  !isNotificationType(row.crystal?.type) || !text(row.crystal.actorId) ||
  !date(row.createdAt) || !date(row.updatedAt) || (row.readAt != null && !date(row.readAt))) invalid();
 return row;
};
const compareIds = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const order = (left: Record<string, any>, right: Record<string, any>) => right.createdAt.getTime() - left.createdAt.getTime() || compareIds(left.shareId, right.shareId);

// The native selector consumes the canonical normalized grammar, never caller
// regex or Mongo expressions. Literal search uses the same escaped pattern.
const matches = (row: Record<string, any>, input: NotificationPageInput, query: ResolvedNotificationListQuery, page: boolean) => {
 const { prefs, from, to, cursor } = input;
 if (!query.history && (!prefs.masters.push || row.historyOnly === true || prefs.push[row.crystal.type as keyof typeof prefs.push] === false)) return false;
 if (query.types !== null && !query.types.includes(row.crystal.type)) return false;
 if (query.unread && row.readAt != null) return false;
 const created = row.createdAt.getTime();
 if ((query.since && created < query.since.getTime()) || (query.until && created > query.until.getTime())) return false;
 if (query.q) {
  const pattern = new RegExp(escapeRegex(query.q), 'i');
  if (!NOTIFICATION_SEARCH_FIELDS.some(field => {
   const value = row.crystal[field.slice('crystal.'.length)];
   return typeof value === 'string' && pattern.test(value);
  })) return false;
 }
 if ((from && created < from.getTime()) || (to && created >= to.getTime())) return false;
 if (page && ((query.before && created >= query.before.getTime()) ||
  (cursor && (created > cursor.createdAt.getTime() || (created === cursor.createdAt.getTime() && compareIds(row.shareId, cursor.shareId) <= 0))))) return false;
 return true;
};

/** Durable recipient history in the selected home provider. Scans use bounded
 * processing pages and keep only the requested result page in memory; there is
 * no maximum stored-history size. This does not claim APNs/email delivery. */
export async function createNativeNotificationRepository(provider: CollectionProvider, homePlaneId: string): Promise<NotificationRepository> {
 if (!text(homePlaneId)) invalid();
 await provider.transaction(defineNativeThingsCollection);
 const namespace = physicalCollectionName('things');
 let repository: NotificationRepository;
 const transaction = <T>(work: (s: CollectionTransaction) => T): Promise<T> => {
  assertNotificationRepositoryScope(repository);
  return provider.transaction(async s => {
   assertNotificationRepositoryScope(repository);
   const result = await work(s);
   assertNotificationRepositoryScope(repository);
   return result;
  });
 };
 const frozen = <T extends Record<string, any>>(value: T): T => BSON.deserialize(encodeCollectionDocument({ _id: 'notification-operation', value })).value;
 const scan = (collection: NativeCollection, userId: string | null, visit: (row: Record<string, any>) => void) => {
  let after: CollectionIdentity | undefined;
  for (;;) {
   const page = collection.find({ after, limit: 128, filter: { op: 'and', filters: [
    { op: 'contains', path: ['thingtime'], value: 'notification' },
    ...(userId === null ? [] : [{ op: 'eq' as const, path: ['ownerId'], value: userId }])
   ] } });
   for (const bytes of page.documents) visit(validate(BSON.deserialize(bytes)));
   if (page.nextAfter === null) break;
   after = page.nextAfter;
  }
 };
 const insert = async (documents: readonly Record<string, unknown>[]) => {
  assertNotificationRepositoryScope(repository);
  const bytes = documents.map(document => {
   const encoded = encodeCollectionDocument(document, 'shareId');
   validate(BSON.deserialize(encoded)); return encoded;
  });
  await transaction(s => { for (const document of bytes) s.collection(namespace).insert(document); });
 };
 repository = Object.freeze({
  kind: 'native-home', homePlaneId,
  insertOne: async document => insert([document]),
  insertMany: insert,
  async findUnreadDuplicates(input) {
   assertNotificationRepositoryScope(repository);
   const copy = frozen(input);
   const owners = new Set(copy.recipients.map(row => row.recipientId)), types = new Set(copy.recipients.map(row => row.type));
   const held = new Map<string, { ownerId: string; type: typeof copy.recipients[number]['type'] }>();
   return transaction(s => {
    scan(s.collection(namespace), null, row => {
     if (owners.has(row.ownerId) && types.has(row.crystal.type) && row.readAt == null &&
      (row.targetId ?? null) === copy.targetId && row.crystal.actorId === copy.actorId && (!copy.preview || row.crystal.preview === copy.preview))
      held.set(`${row.ownerId} ${row.crystal.type}`, { ownerId: row.ownerId, type: row.crystal.type });
    });
    return [...held.values()];
   });
  },
  async readPage(input) {
   assertNotificationRepositoryScope(repository);
   const copy = frozen(input), { userId, prefs, query, withTotal } = copy;
   if (!text(userId) || !Number.isInteger(query.limit) || query.limit < 1) invalid();
   const filters = buildNotificationListFilters(userId, prefs, query);
   if (!filters) return { documents: [], unreadCount: 0, total: withTotal ? 0 : null, ...(query.history ? { historyUnreadCount: 0 } : {}) };
   const unreadQuery = resolveNotificationListQuery({ unread: '1' });
   return transaction(s => {
    const documents: Record<string, any>[] = [];
    let unreadCount = 0, total = 0, historyUnreadCount = 0;
    scan(s.collection(namespace), userId, row => {
     if (row.readAt == null) historyUnreadCount++;
     // Badge ignores the requested history/search/time/cursor filters.
     if (matches(row, { ...copy, from: null, to: null, cursor: null }, unreadQuery, false)) unreadCount++;
     if (!matches(row, copy, query, false)) return;
     total++;
     if (!matches(row, copy, query, true)) return;
     documents.push(row); documents.sort(order);
     if (documents.length > query.limit) documents.pop();
    });
    return { documents, unreadCount, total: withTotal ? total : null, ...(query.history ? { historyUnreadCount } : {}) };
   });
  },
  async markRead(userId, ids, readAt, updatedAt) {
   assertNotificationRepositoryScope(repository);
   const copy = frozen({ userId, ids, readAt, updatedAt });
   if (!text(copy.userId) || !date(copy.readAt) || !date(copy.updatedAt) ||
    (copy.ids !== null && (!Array.isArray(copy.ids) || copy.ids.some(id => !text(id))))) invalid();
   const wanted = copy.ids === null ? null : new Set(copy.ids);
   return transaction(s => {
    const collection = s.collection(namespace);
    let updated = 0;
    scan(collection, copy.userId, row => {
     if (row.readAt != null || (wanted && !wanted.has(row.shareId))) return;
     const result = collection.updateOne({ op: 'and', filters: [
      { op: 'eq', path: ['shareId'], value: row.shareId }, { op: 'eq', path: ['ownerId'], value: copy.userId },
      { op: 'contains', path: ['thingtime'], value: 'notification' }
     ] }, [{ op: 'set', path: ['readAt'], value: copy.readAt }, { op: 'set', path: ['updatedAt'], value: copy.updatedAt }]);
     if (result.modified) updated++;
    });
    return updated;
   });
  }
 });
 registerHomeRepositoryProvider(repository, provider);
 return repository;
}
