import { findAppsByClientIds } from '../apps/apps';
import { appStorageCounterCrystalIsReady, appStorageCounterEnvelopeIsTrusted } from '../apps/namespace';
import { escapeRegex, findUsersByIds, searchUsersForAdminOverviewPage, toPublicUser, type AdminUserRow } from '../auth/users';
import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { getSubscriptions, type SubscriptionInfo } from '../subscriptions/subscriptions';
import { APP_STORAGE_RESERVED_ID_PREFIX } from '~/schemas/registry';
import {
  InvalidAdminSnapshotCursorError,
  adminSnapshotAfterFilter,
  adminSnapshotCursorKey,
  createLiveSessionClause,
  decodeAdminSnapshotCursor,
  encodeAdminSnapshotCursor,
  normalizeAdminSnapshotLimit,
  normalizeAdminSnapshotQuery,
  requireAdminSnapshotCursorKey,
  type AdminSnapshotCursorKey
} from './adminSnapshot';

// The admin directory — everything the /admin dashboard's Users and Apps tabs
// render. Read-only rollups: each list is one search plus a handful of $in
// aggregates over the ids on the page (never per-row queries against the
// whole collection). Admin-only surface; callers gate with requireAdmin.

export type AdminStorageOverview = {
	usedBytes: number | null;
	allowanceBytes: number | null;
	remainingBytes: number | null;
	overageBytes: number | null;
	status: 'ready' | 'reconciling' | 'unavailable';
	accountingVersion: number | null;
	reconciledAt: string | null;
};

const unavailableStorage = (): AdminStorageOverview => ({
	usedBytes: null,
	allowanceBytes: null,
	remainingBytes: null,
	overageBytes: null,
	status: 'unavailable',
	accountingVersion: null,
	reconciledAt: null
});

const serializeStorage = (source: SubscriptionInfo['storage']): AdminStorageOverview | null =>
	source
		? {
				...source,
				reconciledAt: source.reconciledAt ? source.reconciledAt.toISOString() : null
			}
		: null;

export type AdminUserOverviewRow = AdminUserRow & {
  accountKind: 'user' | 'service';
  createdAt: string | null;
	// Canonical account-wide storage comes from the subscription ledger. The
	// flat fields remain wire-compatible aliases; appNamespaceBytes is a
	// labelled subset of the account total, not an additional allowance.
	storage: AdminStorageOverview;
  storageAllowanceBytes: number | null;
	storageUsedBytes: number | null;
	appNamespaceBytes: number | null;
  subscription: SubscriptionInfo;
  counts: {
    apps: number; // registered by this user
    linkedApps: number; // co-managed via 'app' account-links
    ownedAccounts: number; // 'account' links they hold
    pats: number;
    connectedApps: number; // distinct apps with a live grant
  };
};

export type AdminUserOverviewSnapshot = {
  users: AdminUserOverviewRow[];
  limit: number;
  totalCapped: boolean;
  nextCursor: string | null;
};

export const listAdminUsersOverview = async (query: string, limit = 20, cursor?: string | null): Promise<AdminUserOverviewSnapshot> => {
  const capped = normalizeAdminSnapshotLimit(limit, 20);
  const page = await searchUsersForAdminOverviewPage(query, capped, cursor);
  const rows = page.rows;
  const nextCursor = page.nextCursor;
  const totalCapped = nextCursor !== null;
  const ids = rows.map((row) => row.id);
  if (!ids.length) {
    return { users: [], limit: capped, totalCapped, nextCursor: page.nextCursor };
  }

  const things = await getThingsCollection();
  const sessions = await getSessionsCollection();

	const [fullUsers, subs, appCounts, linkCounts, patCounts, grantPairs, namespaceCounters] = await Promise.all([
    findUsersByIds(ids),
    getSubscriptions('user', ids),
		things.aggregate([{ $match: { thingtime: 'app', ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]).toArray(),
    things
      .aggregate([
        { $match: { thingtime: 'account-link', ownerId: { $in: ids } } },
        { $group: { _id: { userId: '$ownerId', linkKind: '$crystal.linkKind' }, n: { $sum: 1 } } }
      ])
      .toArray(),
		sessions.aggregate([{ $match: { userId: { $in: ids }, purpose: 'pat' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]).toArray(),
    sessions
      .aggregate([
        { $match: { userId: { $in: ids }, purpose: 'app', ...createLiveSessionClause() } },
        { $group: { _id: { userId: '$userId', clientId: '$meta.clientId' } } },
        { $group: { _id: '$_id.userId', n: { $sum: 1 } } }
      ])
      .toArray(),
    things
			.find({
				ownerId: { $in: ids },
				shareId: { $regex: `^${APP_STORAGE_RESERVED_ID_PREFIX}` },
				sandboxExpiresAt: { $exists: false }
			})
      .toArray()
  ]);

  const byId = <T extends { _id: any }>(docs: T[]) => new Map(docs.map((doc) => [String(doc._id), doc]));
  const apps = byId(appCounts as any[]);
  const pats = byId(patCounts as any[]);
  const grants = byId(grantPairs as any[]);
	const appNamespaceTotals = new Map<string, number | null>(ids.map((id) => [id, 0]));
	for (const counter of namespaceCounters as any[]) {
		const ownerId = typeof counter.ownerId === 'string' ? counter.ownerId : '';
		const appId = typeof counter.crystal?.appId === 'string' ? counter.crystal.appId : '';
		if (!ownerId || !appNamespaceTotals.has(ownerId)) continue;
		const scope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
		const current = appNamespaceTotals.get(ownerId);
		if (current === null || !appId || !appStorageCounterEnvelopeIsTrusted(counter, scope) || !appStorageCounterCrystalIsReady(counter.crystal)) {
			appNamespaceTotals.set(ownerId, null);
			continue;
		}
		const next = current + Number(counter.crystal.usedBytes);
		appNamespaceTotals.set(ownerId, Number.isSafeInteger(next) ? next : null);
	}
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
			const pub = toPublicUser(doc, subs.get(String(doc._id)));
      return [pub.id, pub] as const;
    })
  );

  return {
    users: rows.map((row) => {
      const pub = publicUsers.get(row.id);
			const subscription = subs.get(row.id)!;
			const storage = pub?.storage ?? serializeStorage(subscription.storage) ?? unavailableStorage();
      return {
        ...row,
        accountKind: pub?.accountKind === 'service' ? 'service' : 'user',
        createdAt: pub?.createdAt ?? row.createdAt,
				storage,
				storageAllowanceBytes: storage.allowanceBytes,
				storageUsedBytes: storage.status === 'ready' ? storage.usedBytes : null,
				appNamespaceBytes:
					storage.status === 'ready' && Number.isSafeInteger(appNamespaceTotals.get(row.id)) ? Number(appNamespaceTotals.get(row.id)) : null,
				subscription,
        counts: {
          apps: (apps.get(row.id) as any)?.n ?? 0,
          linkedApps: links.get(row.id)?.app ?? 0,
          ownedAccounts: links.get(row.id)?.account ?? 0,
          pats: (pats.get(row.id) as any)?.n ?? 0,
          connectedApps: (grants.get(row.id) as any)?.n ?? 0
        }
      };
    }),
    limit: capped,
    totalCapped,
    nextCursor
  };
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
	// Canonical app-wide aggregate from the app Thing. The flat field is a
	// compatibility alias and is null while that ledger cannot be trusted.
	storage: AdminStorageOverview | null;
	usedBytes: number | null;
  subscription: SubscriptionInfo;
};

export type AdminAppOverviewSnapshot = {
  apps: AdminAppOverviewRow[];
  limit: number;
  totalCapped: boolean;
  nextCursor: string | null;
};

type AdminAppsCursor = {
  v: 1;
  kind: 'apps';
  q: string;
  key: AdminSnapshotCursorKey;
};

const readAdminAppsCursor = (cursor: unknown, q: string): AdminAppsCursor | null => {
  const decoded = decodeAdminSnapshotCursor(cursor);
  if (!decoded) return null;
  if (decoded.v !== 1 || decoded.kind !== 'apps' || decoded.q !== q) throw new InvalidAdminSnapshotCursorError();
  return { v: 1, kind: 'apps', q, key: requireAdminSnapshotCursorKey(decoded.key) };
};

export const listAdminAppsOverview = async (query: string, limit = 100, cursor?: string | null): Promise<AdminAppOverviewSnapshot> => {
  const q = normalizeAdminSnapshotQuery(query);
  const capped = normalizeAdminSnapshotLimit(limit, 100);
  const continuation = readAdminAppsCursor(cursor, q);
  const things = await getThingsCollection();
  const sessions = await getSessionsCollection();

  const pattern = { $regex: escapeRegex(q), $options: 'i' };
	const baseFilter = q ? { thingtime: 'app', $or: [{ 'crystal.name': pattern }, { 'crystal.clientId': pattern }] } : { thingtime: 'app' };
	const filter = continuation ? { $and: [baseFilter, adminSnapshotAfterFilter(continuation.key, 'shareId')] } : baseFilter;
  const found = await things
    .find(filter as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(capped + 1)
    .toArray();
  const totalCapped = found.length > capped;
  const docs = found.slice(0, capped);
  const nextCursor = totalCapped
    ? encodeAdminSnapshotCursor({
        v: 1,
        kind: 'apps',
        q,
        key: adminSnapshotCursorKey(docs[docs.length - 1] as any)
      })
    : null;
  const clientIds = docs.map((doc: any) => String(doc.crystal?.clientId ?? '')).filter(Boolean);
  if (!clientIds.length) return { apps: [], limit: capped, totalCapped, nextCursor };

	const [subs, userCounts, linkDocs] = await Promise.all([
    getSubscriptions('app', clientIds),
    sessions
      .aggregate([
        { $match: { purpose: 'app', 'meta.clientId': { $in: clientIds }, ...createLiveSessionClause() } },
        { $group: { _id: { clientId: '$meta.clientId', userId: '$userId' } } },
        { $group: { _id: '$_id.clientId', n: { $sum: 1 } } }
      ])
      .toArray(),
		things.find({ thingtime: 'account-link', 'crystal.linkKind': 'app', 'crystal.targetId': { $in: clientIds } }).toArray()
  ]);

  const users = new Map((userCounts as any[]).map((doc) => [String(doc._id), doc.n]));
  const managersByApp = new Map<string, string[]>();
  for (const doc of linkDocs as any[]) {
    const target = String(doc.crystal?.targetId ?? '');
    const list = managersByApp.get(target) ?? [];
    list.push(String(doc.crystal?.userId ?? doc.ownerId ?? ''));
    managersByApp.set(target, list);
  }

  // Usernames for owners + managers: one query per user store for the bounded
  // distinct id set, never one two-store lookup per person.
	const personIds = [...new Set([...docs.map((doc: any) => String(doc.ownerId)), ...[...managersByApp.values()].flat()])].filter(Boolean);
  const people = new Map(
    (await findUsersByIds(personIds)).map((doc: any) => {
			return [String(doc._id), typeof doc.username === 'string' ? doc.username : null] as const;
    })
  );

  return {
    apps: docs.map((doc: any) => {
      const clientId = String(doc.crystal?.clientId ?? '');
      const ownerId = String(doc.ownerId ?? '');
			const subscription = subs.get(clientId)!;
			const storage = serializeStorage(subscription.storage);
      return {
        clientId,
        name: String(doc.crystal?.name ?? ''),
        origins: Array.isArray(doc.crystal?.origins) ? doc.crystal.origins : [],
        createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
        revokedAt: doc.crystal?.revokedAt instanceof Date ? doc.crystal.revokedAt.toISOString() : null,
        owner: { id: ownerId, username: people.get(ownerId) ?? null },
        managers: (managersByApp.get(clientId) ?? []).map((id) => ({ id, username: people.get(id) ?? null })),
        userCount: users.get(clientId) ?? 0,
				storage,
				usedBytes: storage?.status === 'ready' ? storage.usedBytes : null,
				subscription
      };
    }),
    limit: capped,
    totalCapped,
    nextCursor
  };
};

// Ensure a set of clientIds exist (input validation for admin link writes).
export const appsExist = async (clientIds: string[]): Promise<Map<string, boolean>> => {
  const found = await findAppsByClientIds(clientIds);
  const present = new Set(found.map((doc: any) => String(doc.crystal?.clientId)));
  return new Map(clientIds.map((id) => [id, present.has(id)]));
};
