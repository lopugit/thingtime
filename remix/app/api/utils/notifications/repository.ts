import { AsyncLocalStorage } from 'node:async_hooks';
import { currentUserIdentityRepository } from '../auth/userIdentityRepository';
import { assertSameHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import type { NormalizedNotificationPrefs, NotificationType } from '~/schemas/registry';
import { buildNotificationListFilters, resolveNotificationListQuery } from './listQuery';
import type { ResolvedNotificationListQuery } from './listQuery';

export type NotificationPageInput = {
 userId: string;
 prefs: NormalizedNotificationPrefs;
 query: ResolvedNotificationListQuery;
 cursor: { createdAt: Date; shareId: string } | null;
 from: Date | null;
 to: Date | null;
 withTotal: boolean;
};
export type NotificationPage = {
 documents: Record<string, any>[];
 unreadCount: number;
 total: number | null;
 historyUnreadCount?: number;
};
export type UnreadNotificationInput = {
 recipients: readonly { recipientId: string; type: NotificationType }[];
 actorId: string;
 targetId: string | null;
 preview: string | null;
};

/** Durable recipient history only. Delivery, canonical document construction,
 * preferences, projections and API authorization keep their existing owners. */
export interface NotificationRepository {
 readonly kind: 'mongo-home' | 'native-home';
 readonly homePlaneId: string;
 insertOne(document: Record<string, unknown>): Promise<void>;
 insertMany(documents: readonly Record<string, unknown>[]): Promise<void>;
 findUnreadDuplicates(input: UnreadNotificationInput): Promise<{ ownerId: string; type: NotificationType }[]>;
 readPage(input: NotificationPageInput): Promise<NotificationPage>;
 markRead(userId: string, ids: readonly string[] | null, readAt: Date, updatedAt: Date): Promise<number>;
}

export class NotificationRepositoryError extends Error {
 readonly status = 503;
 constructor(public readonly code: 'NOTIFICATION_REPOSITORY_SCOPE' | 'INVALID_NOTIFICATION' | 'NOTIFICATION_DELIVERY_UNAVAILABLE' | 'NOTIFICATION_TRANSACTION_UNSUPPORTED', message: string) {
  super(message); this.name = 'NotificationRepositoryError';
 }
}
const unavailable = (): never => { throw new NotificationRepositoryError('NOTIFICATION_REPOSITORY_SCOPE', 'Notification history does not match the active home request'); };
const scopes = new AsyncLocalStorage<{ repository: NotificationRepository; active: boolean }>();
const mongo: NotificationRepository = Object.freeze({
 kind: 'mongo-home', homePlaneId: 'mongodb:home',
 async insertOne(document) {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  await (await getHomeThingsCollection()).insertOne(document as any);
 },
 async insertMany(documents) {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  await (await getHomeThingsCollection()).insertMany([...documents] as any, { ordered: false });
 },
 async findUnreadDuplicates(input) {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  const rows = await (await getHomeThingsCollection()).find({
   thingtime: 'notification', ownerId: { $in: input.recipients.map(row => row.recipientId) }, readAt: null,
   targetId: input.targetId, 'crystal.actorId': input.actorId,
   'crystal.type': { $in: [...new Set(input.recipients.map(row => row.type))] },
   ...(input.preview ? { 'crystal.preview': input.preview } : {})
  } as any).project({ ownerId: 1, 'crystal.type': 1 }).toArray();
  return rows.map((row: any) => ({ ownerId: String(row.ownerId), type: row.crystal?.type }));
 },
 async readPage(input) {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  const { userId, prefs, query, cursor, from, to, withTotal } = input;
  const filters = buildNotificationListFilters(userId, prefs, query);
  if (!filters) return { documents: [], unreadCount: 0, total: withTotal ? 0 : null, ...(query.history ? { historyUnreadCount: 0 } : {}) };
  const unread = buildNotificationListFilters(userId, prefs, resolveNotificationListQuery({ unread: '1' }));
  const ranges: Record<string, any>[] = [];
  if (from || to) ranges.push({ createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } });
  const base = ranges.length ? { $and: [filters.base, ...ranges] } : filters.base;
  const pages: Record<string, any>[] = [filters.page, ...ranges];
  if (cursor) pages.push({ $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.shareId } }] });
  const page = pages.length === 1 ? filters.page : { $and: pages };
  const things = await getHomeThingsCollection();
  const [documents, unreadCount, total, historyUnreadCount] = await Promise.all([
   things.find(page as any).sort({ createdAt: -1, shareId: 1 }).limit(query.limit).toArray(),
   unread ? things.countDocuments(unread.base as any) : Promise.resolve(0),
   withTotal ? things.countDocuments(base as any) : Promise.resolve(null),
   query.history ? things.countDocuments({ thingtime: 'notification', ownerId: userId, readAt: null } as any) : Promise.resolve(undefined)
  ]);
  return { documents, unreadCount, total, ...(historyUnreadCount === undefined ? {} : { historyUnreadCount }) };
 },
 async markRead(userId, ids, readAt, updatedAt) {
  const { getHomeThingsCollection } = await import('../mongodb/collections');
  const filter = { thingtime: 'notification', ownerId: userId, readAt: null, ...(ids === null ? {} : { shareId: { $in: [...ids] } }) };
  return (await (await getHomeThingsCollection()).updateMany(filter as any, { $set: { readAt, updatedAt } })).modifiedCount || 0;
 }
});

export function currentNotificationRepository(): NotificationRepository {
 const scope = scopes.getStore();
 if (scope && !scope.active) return unavailable();
 const identities = currentUserIdentityRepository();
 if (!scope) return identities ? unavailable() : mongo;
 if (!identities || scope.repository.kind !== 'native-home' || scope.repository.homePlaneId !== identities.homePlaneId) return unavailable();
 assertSameHomeRepositoryProvider(identities, scope.repository);
 return scope.repository;
}
export function assertNotificationRepositoryScope(repository: NotificationRepository): void {
 if (currentNotificationRepository() !== repository) unavailable();
}
export async function withHomeNotificationRepository<T>(repository: NotificationRepository, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore() || typeof work !== 'function') return unavailable();
 const scope = { repository, active: true };
 return scopes.run(scope, async () => {
  try { assertNotificationRepositoryScope(repository); return await work(); }
  finally { scope.active = false; }
 });
}
