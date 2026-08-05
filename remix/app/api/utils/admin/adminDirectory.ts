import { findAppsByClientIds } from '../apps/apps';
import { escapeRegex, findUserById, searchUsersForAdmin, toPublicUser, type AdminUserRow } from '../auth/users';
import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { getSubscriptions, type SubscriptionInfo } from '../subscriptions/subscriptions';

// The admin directory — everything the /admin dashboard's Users and Apps tabs
// render. Read-only rollups: each list is one search plus a handful of $in
// aggregates over the ids on the page (never per-row queries against the
// whole collection). Admin-only surface; callers gate with requireAdmin.

const liveSessionClause = { revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] };

export type AdminUserOverviewRow = AdminUserRow & {
  accountKind: 'user' | 'service';
  createdAt: string | null;
  // Per-user storage: the (inert, admin-editable) allowance pair on the user
  // plus the live sum of their app-namespace ledgers.
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  appNamespaceBytes: number;
  subscription: SubscriptionInfo;
  counts: {
    apps: number; // registered by this user
    linkedApps: number; // co-managed via 'app' account-links
    ownedAccounts: number; // 'account' links they hold
    pats: number;
    connectedApps: number; // distinct apps with a live grant
  };
};

export const listAdminUsersOverview = async (query: string, limit = 20): Promise<AdminUserOverviewRow[]> => {
  const rows = await searchUsersForAdmin(query, limit);
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];

  const things = await getThingsCollection();
  const sessions = await getSessionsCollection();

  const [fullUsers, subs, appCounts, linkCounts, patCounts, grantPairs, nsBytes] = await Promise.all([
    Promise.all(ids.map((id) => findUserById(id))),
    getSubscriptions('user', ids),
    things
      .aggregate([
        { $match: { thingtime: 'app', ownerId: { $in: ids } } },
        { $group: { _id: '$ownerId', n: { $sum: 1 } } }
      ])
      .toArray(),
    things
      .aggregate([
        { $match: { thingtime: 'account-link', ownerId: { $in: ids } } },
        { $group: { _id: { userId: '$ownerId', linkKind: '$crystal.linkKind' }, n: { $sum: 1 } } }
      ])
      .toArray(),
    sessions
      .aggregate([
        { $match: { userId: { $in: ids }, purpose: 'pat' } },
        { $group: { _id: '$userId', n: { $sum: 1 } } }
      ])
      .toArray(),
    sessions
      .aggregate([
        { $match: { userId: { $in: ids }, purpose: 'app', ...liveSessionClause } },
        { $group: { _id: { userId: '$userId', clientId: '$meta.clientId' } } },
        { $group: { _id: '$_id.userId', n: { $sum: 1 } } }
      ])
      .toArray(),
    things
      .aggregate([
        { $match: { 'crystal.quotaKind': 'app-storage', ownerId: { $in: ids } } },
        { $group: { _id: '$ownerId', bytes: { $sum: { $ifNull: ['$crystal.usedBytes', 0] } } } }
      ])
      .toArray()
  ]);

  const byId = <T extends { _id: any }>(docs: T[]) => new Map(docs.map((doc) => [String(doc._id), doc]));
  const apps = byId(appCounts as any[]);
  const pats = byId(patCounts as any[]);
  const grants = byId(grantPairs as any[]);
  const ns = byId(nsBytes as any[]);
  const links = new Map<string, { app: number; account: number }>();
  for (const doc of linkCounts as any[]) {
    const userId = String(doc._id?.userId ?? '');
    const entry = links.get(userId) ?? { app: 0, account: 0 };
    if (doc._id?.linkKind === 'app') entry.app += doc.n;
    else entry.account += doc.n;
    links.set(userId, entry);
  }
  const publicUsers = new Map(
    fullUsers.filter(Boolean).map((doc: any) => {
      const pub = toPublicUser(doc);
      return [pub.id, pub] as const;
    })
  );

  return rows.map((row) => {
    const pub = publicUsers.get(row.id);
    return {
      ...row,
      accountKind: pub?.accountKind === 'service' ? 'service' : 'user',
      createdAt: pub?.createdAt ?? null,
      storageAllowanceBytes: typeof pub?.storageAllowanceBytes === 'number' ? pub.storageAllowanceBytes : null,
      storageUsedBytes: typeof pub?.storageUsedBytes === 'number' ? pub.storageUsedBytes : 0,
      appNamespaceBytes: (ns.get(row.id) as any)?.bytes ?? 0,
      subscription: subs.get(row.id)!,
      counts: {
        apps: (apps.get(row.id) as any)?.n ?? 0,
        linkedApps: links.get(row.id)?.app ?? 0,
        ownedAccounts: links.get(row.id)?.account ?? 0,
        pats: (pats.get(row.id) as any)?.n ?? 0,
        connectedApps: (grants.get(row.id) as any)?.n ?? 0
      }
    };
  });
};

export type AdminAppOverviewRow = {
  clientId: string;
  name: string;
  origins: string[];
  createdAt: string | null;
  revokedAt: string | null;
  owner: { id: string; username: string | null };
  managers: Array<{ id: string; username: string | null }>;
  // Distinct end users holding a live grant.
  userCount: number;
  // Sum of every (user, app) namespace ledger for this app.
  usedBytes: number;
  subscription: SubscriptionInfo;
};

export const listAdminAppsOverview = async (query: string, limit = 100): Promise<AdminAppOverviewRow[]> => {
  const q = (query || '').trim();
  const capped = Math.min(200, Math.max(1, limit));
  const things = await getThingsCollection();
  const sessions = await getSessionsCollection();

  const pattern = { $regex: escapeRegex(q), $options: 'i' };
  const filter = q
    ? { thingtime: 'app', $or: [{ 'crystal.name': pattern }, { 'crystal.clientId': pattern }] }
    : { thingtime: 'app' };
  const docs = await things.find(filter as any).sort({ createdAt: -1 }).limit(capped).toArray();
  const clientIds = docs.map((doc: any) => String(doc.crystal?.clientId ?? '')).filter(Boolean);
  if (!clientIds.length) return [];

  const [subs, userCounts, byteSums, linkDocs] = await Promise.all([
    getSubscriptions('app', clientIds),
    sessions
      .aggregate([
        { $match: { purpose: 'app', 'meta.clientId': { $in: clientIds }, ...liveSessionClause } },
        { $group: { _id: { clientId: '$meta.clientId', userId: '$userId' } } },
        { $group: { _id: '$_id.clientId', n: { $sum: 1 } } }
      ])
      .toArray(),
    things
      .aggregate([
        { $match: { 'crystal.quotaKind': 'app-storage', 'crystal.appId': { $in: clientIds } } },
        { $group: { _id: '$crystal.appId', bytes: { $sum: { $ifNull: ['$crystal.usedBytes', 0] } } } }
      ])
      .toArray(),
    things
      .find({ thingtime: 'account-link', 'crystal.linkKind': 'app', 'crystal.targetId': { $in: clientIds } })
      .toArray()
  ]);

  const users = new Map((userCounts as any[]).map((doc) => [String(doc._id), doc.n]));
  const bytes = new Map((byteSums as any[]).map((doc) => [String(doc._id), doc.bytes]));
  const managersByApp = new Map<string, string[]>();
  for (const doc of linkDocs as any[]) {
    const target = String(doc.crystal?.targetId ?? '');
    const list = managersByApp.get(target) ?? [];
    list.push(String(doc.crystal?.userId ?? doc.ownerId ?? ''));
    managersByApp.set(target, list);
  }

  // Usernames for owners + managers: one lookup per distinct id (bounded by
  // the page size, admin-only).
  const personIds = [
    ...new Set([...docs.map((doc: any) => String(doc.ownerId)), ...[...managersByApp.values()].flat()])
  ].filter(Boolean);
  const people = new Map(
    (await Promise.all(personIds.map((id) => findUserById(id)))).filter(Boolean).map((doc: any) => {
      const pub = toPublicUser(doc);
      return [pub.id, pub.username] as const;
    })
  );

  return docs.map((doc: any) => {
    const clientId = String(doc.crystal?.clientId ?? '');
    const ownerId = String(doc.ownerId ?? '');
    return {
      clientId,
      name: String(doc.crystal?.name ?? ''),
      origins: Array.isArray(doc.crystal?.origins) ? doc.crystal.origins : [],
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
      revokedAt: doc.crystal?.revokedAt instanceof Date ? doc.crystal.revokedAt.toISOString() : null,
      owner: { id: ownerId, username: people.get(ownerId) ?? null },
      managers: (managersByApp.get(clientId) ?? []).map((id) => ({ id, username: people.get(id) ?? null })),
      userCount: users.get(clientId) ?? 0,
      usedBytes: bytes.get(clientId) ?? 0,
      subscription: subs.get(clientId)!
    };
  });
};

// Ensure a set of clientIds exist (input validation for admin link writes).
export const appsExist = async (clientIds: string[]): Promise<Map<string, boolean>> => {
  const found = await findAppsByClientIds(clientIds);
  const present = new Set(found.map((doc: any) => String(doc.crystal?.clientId)));
  return new Map(clientIds.map((id) => [id, present.has(id)]));
};
