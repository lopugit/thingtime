import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { findAppByClientId } from './apps';
import { appStorageBudgetBytes, setAppStorageUsed } from './namespace';
import type { AppNamespaceScope } from './namespace';
import { refundDeletedNamespaceDocs } from '../things/things';
import type { ThingDoc } from '../things/things';
import { scopeCovers, sessionScopes } from './scopes';

// The first-party browsing surface over app namespaces: what has each app
// stored for me, browse/delete it, and see the shared slice exactly as the
// app would. Session-auth only — app tokens never reach these.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type AppDataSummary = {
  appId: string;
  appName: string | null; // null = app deleted/unregistered — data persists
  entryCount: number;
  usedBytes: number;
  budgetBytes: number | null;
  lastUpdatedAt: string | null;
};

// Enumerated from THINGS, not grants: an app whose grant expired (or that was
// deleted) vanishes from the grants list while its data persists — orphaned
// data must stay visible, or it becomes undeletable.
export const listAppDataSummaries = async (userId: string): Promise<AppDataSummary[]> => {
  const things = await getThingsCollection();
  const groups = await things
    .aggregate([
      // root appId = namespace membership; the storage-ledger counter docs
      // carry only crystal.appId, so they never count themselves
      { $match: { ownerId: userId, appId: { $exists: true }, sandboxExpiresAt: { $exists: false } } },
      {
        $group: {
          _id: '$appId',
          entryCount: { $sum: 1 },
          usedBytes: { $sum: { $ifNull: ['$sizeBytes', 0] } },
          lastUpdatedAt: { $max: '$updatedAt' }
        }
      },
      { $sort: { lastUpdatedAt: -1 } }
    ])
    .toArray();

  const summaries: AppDataSummary[] = [];
  for (const group of groups) {
    const appId = String(group._id || '');
    if (!appId) continue;
    const app = await findAppByClientId(appId);
    summaries.push({
      appId,
      appName: typeof app?.crystal?.name === 'string' ? app.crystal.name : null,
      entryCount: group.entryCount || 0,
      usedBytes: group.usedBytes || 0,
      budgetBytes: await appStorageBudgetBytes({
        appId,
        ownerId: userId,
        sharedRead: false,
        scopes: [],
        username: '',
        sandbox: null
      }),
      lastUpdatedAt: group.lastUpdatedAt ? new Date(group.lastUpdatedAt).toISOString() : null
    });
  }
  return summaries;
};

// The union of scopes across the user's LIVE grants for one app — the exact
// consent the app currently operates under (empty = no live grant).
export const userGrantScopes = async (clientId: string, userId: string): Promise<string[]> => {
  const sessions = await (await getSessionsCollection())
    .find({
      purpose: 'app',
      'meta.clientId': clientId,
      userId,
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    })
    .toArray();
  const union: string[] = [];
  for (const session of sessions) {
    for (const scope of sessionScopes(session.meta)) {
      if (!union.includes(scope)) union.push(scope);
    }
  }
  return union;
};

// The user's view THROUGH the app's lens: a synthetic namespace scope built
// from their own live grant, run through the same read path app tokens use —
// so "what would I see in this app" can never drift from what the app sees.
export const userAppLens = async (
  clientId: string,
  user: { id: string; username: string }
): Promise<{ ok: true; scope: AppNamespaceScope; sharedRead: boolean } | Fail> => {
  const scopes = await userGrantScopes(clientId, user.id);
  if (!scopes.length) {
    return fail(403, 'No live grant for this app — sign in to it with Thingtime first (your data stays either way)');
  }
  const sharedRead = scopeCovers(scopes, 'app-data.shared');
  return {
    ok: true,
    scope: {
      appId: clientId,
      ownerId: user.id,
      sharedRead,
      scopes,
      username: user.username,
      sandbox: null
    },
    sharedRead
  };
};

const DELETE_BATCH = 500;

// "Delete everything app X stored for me": every namespace doc the user owns,
// the cross-user children cascading under them, the freed bytes refunded to
// each affected (owner, app) ledger, and finally the user's own ledger zeroed.
export const deleteAllAppData = async (
  userId: string,
  clientId: unknown
): Promise<{ ok: true; deleted: number } | Fail> => {
  const appId = typeof clientId === 'string' ? clientId.trim() : '';
  if (!appId) return fail(400, 'appId is required');

  const things = await getThingsCollection();
  let deleted = 0;

  while (true) {
    const batch = (await things
      .find({ ownerId: userId, appId })
      .project({ shareId: 1, ownerId: 1, appId: 1, sizeBytes: 1, crystal: 1, extended: 1, tags: 1 })
      .limit(DELETE_BATCH)
      .toArray()) as any as ThingDoc[];
    if (!batch.length) break;

    const ids = batch.map((doc) => doc.shareId);
    // children (other users' comments/reactions in the same namespace, or the
    // owner's own) go with their targets — fetched first so their bytes refund
    // the RIGHT ledgers
    const cascadeFilter = {
      targetId: { $in: ids },
      thingtime: { $in: ['comment', 'reaction', 'save'] }
    };
    const cascade = (await things
      .find(cascadeFilter as any)
      .project({ shareId: 1, ownerId: 1, appId: 1, sizeBytes: 1, crystal: 1, extended: 1, tags: 1 })
      .toArray()) as any as ThingDoc[];

    await things.deleteMany({ shareId: { $in: [...ids, ...cascade.map((doc) => doc.shareId)] } } as any);
    deleted += batch.length + cascade.length;
    // refund everyone EXCEPT this user's own (user, app) ledger — that one is
    // zeroed absolutely below, so partial-failure reruns stay correct
    await refundDeletedNamespaceDocs(
      [...batch, ...cascade].filter((doc) => !(String(doc.ownerId) === userId && doc.appId === appId))
    );
    if (batch.length < DELETE_BATCH) break;
  }

  await setAppStorageUsed(userId, appId, 0);
  return { ok: true, deleted };
};
