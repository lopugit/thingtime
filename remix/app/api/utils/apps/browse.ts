import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { appStoragePolicyOf, findAppsByClientIds } from './apps';
import {
	APP_STORAGE_ACCOUNTING_VERSION,
	appStorageCounterCrystalIsReady,
	appStorageCounterEnvelopeIsTrusted,
	appStorageCounterMatch
} from './namespace';
import type { AppNamespaceScope } from './namespace';
import { effectiveAppUserAllowance } from './appStorageCore';
import { deleteThingsAtomically, refundDeletedNamespaceDocs } from '../things/things';
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
	// Null is deliberate: a missing, old, or malformed ledger must never be
	// rendered as a reassuring zero. The protected counter below is the only
	// display source; entryCount is informational and is never a byte ledger.
	usedBytes: number | null;
  budgetBytes: number | null;
	budgetKind: 'finite' | 'unlimited' | 'unavailable';
	storageAccountingStatus: 'ready' | 'reconciling' | 'unavailable';
	storageAccountingVersion: number | null;
  lastUpdatedAt: string | null;
};

const nonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const projectAppDataStorage = ({
	appId,
	ownerId,
	app,
	counter
}: {
	appId: string;
	ownerId: string;
	app: any | null;
	counter: any | null;
}): Pick<AppDataSummary, 'usedBytes' | 'budgetBytes' | 'budgetKind' | 'storageAccountingStatus' | 'storageAccountingVersion'> => {
	const scope: AppNamespaceScope = {
		appId,
		ownerId,
		sharedRead: false,
		scopes: [],
		username: '',
		sandbox: null
	};
	const trustedCounter = appStorageCounterEnvelopeIsTrusted(counter, scope);
	const counterReady = trustedCounter && appStorageCounterCrystalIsReady(counter?.crystal);
	const appPolicy = app ? appStoragePolicyOf(app) : null;
	// A deleted app has no aggregate standing allowance to enforce, but its
	// preserved namespace still has an exact per-user ledger. A live app needs
	// both layers ready because both govern its next write.
	const ready = counterReady && (!app || appPolicy?.ready === true);
	const statuses = [counter?.crystal?.storageLedgerStatus, app?.crystal?.storageLedgerStatus];
	const reconciling = !ready && statuses.some((status) => status === 'initializing' || status === 'needs-reconcile');

	let budgetBytes: number | null = null;
	let budgetKind: AppDataSummary['budgetKind'] = 'unavailable';
	if (appPolicy?.ready) {
		budgetBytes = effectiveAppUserAllowance(
			appPolicy.userStorageAllowanceBytes,
			counter?.crystal?.storageAllowanceBytes,
			appPolicy.storageAllowanceBytes
		);
		budgetKind = 'finite';
	} else if (!app && trustedCounter && nonNegativeSafeInteger(counter?.crystal?.storageAllowanceBytes)) {
		// Only an explicit historical per-user override survives app deletion.
		// Null/absent meant "inherit the app default", which no longer exists and
		// therefore cannot honestly be labelled unlimited.
		budgetBytes = counter.crystal.storageAllowanceBytes;
		budgetKind = 'finite';
	}

	return {
		usedBytes: ready ? counter.crystal.usedBytes : null,
		budgetBytes,
		budgetKind,
		storageAccountingStatus: ready ? 'ready' : reconciling ? 'reconciling' : 'unavailable',
		storageAccountingVersion:
			trustedCounter && counter.crystal?.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION ? APP_STORAGE_ACCOUNTING_VERSION : null
	};
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
          lastUpdatedAt: { $max: '$updatedAt' }
        }
      },
      { $sort: { lastUpdatedAt: -1 } }
    ])
    .toArray();

	const appIds = groups.map((group) => String(group._id || '')).filter(Boolean);
	const [apps, counters] = await Promise.all([
		findAppsByClientIds(appIds),
		appIds.length ? things.find({ $or: appIds.map((appId) => appStorageCounterMatch(userId, appId)) }).toArray() : Promise.resolve([])
	]);
	const appsById = new Map<string, any>(apps.map((app: any) => [String(app.crystal?.clientId ?? ''), app]));
	const countersByAppId = new Map<string, any>(counters.map((counter: any) => [String(counter.crystal?.appId ?? ''), counter]));

  const summaries: AppDataSummary[] = [];
  for (const group of groups) {
    const appId = String(group._id || '');
    if (!appId) continue;
		const app = appsById.get(appId) ?? null;
		const storage = projectAppDataStorage({
			appId,
			ownerId: userId,
			app,
			counter: countersByAppId.get(appId) ?? null
		});
    summaries.push({
      appId,
      appName: typeof app?.crystal?.name === 'string' ? app.crystal.name : null,
      entryCount: group.entryCount || 0,
			...storage,
      lastUpdatedAt: group.lastUpdatedAt ? new Date(group.lastUpdatedAt).toISOString() : null
    });
  }
  return summaries;
};

// The union of scopes across the user's LIVE grants for one app — the exact
// consent the app currently operates under (empty = no live grant).
export const userGrantScopes = async (clientId: string, userId: string): Promise<string[]> => {
	const sessions = await (
		await getSessionsCollection()
	)
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
// the cross-user children cascading under them, and the freed bytes refunded
// to each affected user + app ledger by guarded deltas.
export const deleteAllAppData = async (userId: string, clientId: unknown): Promise<{ ok: true; deleted: number } | Fail> => {
  const appId = typeof clientId === 'string' ? clientId.trim() : '';
  if (!appId) return fail(400, 'appId is required');

  const things = await getThingsCollection();
  let deleted = 0;

  while (true) {
    const batch = (await things
      .find({ ownerId: userId, appId })
      .project({
        shareId: 1,
        ownerId: 1,
        appId: 1,
        sizeBytes: 1,
        crystal: 1,
        extended: 1,
        tags: 1,
        sandboxExpiresAt: 1,
        sandboxSpace: 1
      })
      .limit(DELETE_BATCH)
      .toArray()) as any as ThingDoc[];
    if (!batch.length) break;

    const ids = batch.map((doc) => doc.shareId);
    // children (other users' comments/reactions in the same namespace, or the
    // owner's own) go with their targets — fetched first so their bytes refund
    // the RIGHT ledgers
    const cascadeFilter = {
      targetId: { $in: ids },
      thingtime: { $in: ['comment', 'reaction', 'save', 'vote'] }
    };
    const cascade = (await things
      .find(cascadeFilter as any)
      .project({
        shareId: 1,
        ownerId: 1,
        appId: 1,
        sizeBytes: 1,
        crystal: 1,
        extended: 1,
        tags: 1,
        sandboxExpiresAt: 1,
        sandboxSpace: 1
      })
      .toArray()) as any as ThingDoc[];

    // A child owned by this user can appear in both the namespace batch and
    // the parent's cascade. De-dupe before delete/count/refund so its bytes are
    // never returned twice.
    const removed = [...new Map([...batch, ...cascade].map((doc) => [doc.shareId, doc])).values()];
    const actuallyRemoved = await deleteThingsAtomically(removed);
    deleted += actuallyRemoved.length;
    // Delta refunds compose with a token writing concurrently. An absolute
    // "set this user's ledger to zero" after deletion could erase a new
    // reservation and undercount; a crash here can only leave conservative
    // over-counting for the reconcile migration to repair.
    await refundDeletedNamespaceDocs(actuallyRemoved);
    if (batch.length < DELETE_BATCH) break;
  }

  return { ok: true, deleted };
};
