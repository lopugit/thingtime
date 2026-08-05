import { createHash } from 'node:crypto';

import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { consumeByteBudget, refundByteBudget } from '../rateLimit/byteBudget';
import { DEFAULT_SUBSCRIPTION_TIER, isKnownSubscriptionTier, subscriptionTierById } from '../subscriptions/tierCatalog';
import { getLiveSubscriptionTier, getSubscriptionTierVersion, tierAssignmentSnapshot } from '../subscriptions/tierCatalogStore';
import { appStoragePolicyOf, findAppByClientId } from './apps';
import { admitAppAndUserStorage, effectiveAppUserAllowance, remainingStorageBytes, storageUsage } from './appStorageCore';
import type { AppStorageReservation, FiniteStorageUsage, StorageUsage } from './appStorageCore';
import { scopeCovers, sessionScopes } from './scopes';
import { SANDBOX_TOKEN_TTL_MS, sandboxDisplayName } from './sandbox';
import type { AppTokenContext } from './appTokens';
import {
  ACL_APP_PREFIX,
  ACL_OWNER,
  APP_STORAGE_ACCOUNTING_VERSION,
  COLLECTION_SCHEMA_VERSIONS,
  DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
  DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES,
  SANDBOX_STORAGE_BYTES
} from '~/schemas/registry';

// The app-namespace layer — ONE implementation of every rule that makes an
// app token's slice of the things collection (FUNDAMENTALS.md §1 style:
// single source of truth; app-data, the opened things routes, and the
// session-auth browse APIs all resolve namespace membership, audience,
// stamping, and storage budgets through here).
//
// The model:
//   • NAMESPACE membership is the server-stamped scalar root `appId` field —
//     never the acl. Users can hand-write tt:app/<x> acl entries through the
//     generic routes (sanitizeAcl accepts them syntactically), so an
//     acl-derived namespace would be spoofable INTO an app's view; a root
//     field the generic write paths never copy from input is not.
//   • AUDIENCE stays the acl array with its existing meaning: ['tt:user'] =
//     private to the owning user; + 'tt:app/<clientId>' = readable by other
//     users of THIS app (behind the author's live app-data.shared grant).
//     Apps can never express tt:all / other apps / other users / exclusions.
//   • The END USER owns every namespace doc (ownerId = the user), sees all of
//     it first-party (owner short-circuit), and can delete any of it.
//   • STORAGE has two byte ceilings: the app's aggregate allowance and this
//     (user, app) namespace's allowance. Guarded $inc admission is race-safe
//     and fail-closed at both layers. No doc counts anywhere.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// The acl entry granting an app's user base read access to an entry.
export const appAclEntry = (appId: string) => `${ACL_APP_PREFIX}${appId}`;

export type AppNamespaceScope = {
  appId: string; // the app's clientId
  ownerId: string; // the acting user's id ('sandbox:<uuid>' for sandbox tokens)
  sharedRead: boolean; // token covers app-data.shared → may read the app-audience slice
  scopes: string[]; // the token's full grant — projections gate author fields by it
  username: string; // the acting user's username (self-author shaping)
  sandbox: { space: string | null } | null;
};

export const appScopeOf = (ctx: AppTokenContext): AppNamespaceScope => ({
  appId: ctx.clientId,
  ownerId: ctx.user.id,
  sharedRead: scopeCovers(ctx.scopes, 'app-data.shared'),
  scopes: [...ctx.scopes],
  username: ctx.user.username,
  sandbox: ctx.sandbox ? { space: ctx.sandboxSpace ?? null } : null
});

// ---------------------------------------------------------------------------
// Reads. Every app-lens Mongo query conjoins these clauses (into $and — the
// coarse tier), and every returned doc re-checks appCanViewDoc (the exact
// tier) — the same two-tier pattern first-party reads use.

export const appNamespaceClauses = (scope: AppNamespaceScope): Record<string, unknown>[] => [
  { appId: scope.appId },
  // Sandbox fencing, exactly as the app-data shared feed does it: real
  // viewers never even scan sandbox docs; sandbox viewers are fenced to
  // their own namespace, or to their opt-in space's pool.
  scope.sandbox
    ? scope.sandbox.space
      ? { $or: [{ ownerId: scope.ownerId }, { sandboxSpace: scope.sandbox.space }] }
      : { ownerId: scope.ownerId }
    : { sandboxExpiresAt: { $exists: false } },
  // Audience: own docs always; the app-audience slice only when the token
  // holds app-data.shared (exact scope — never implied by app-data). Docs
  // carrying tt:inherit (comments/reactions) pass the COARSE tier — their
  // audience lives on their terminal ancestor, resolved by the exact verdict.
  scope.sharedRead ? { $or: [{ ownerId: scope.ownerId }, { acl: { $in: [appAclEntry(scope.appId), 'tt:inherit'] } }] } : { ownerId: scope.ownerId }
];

// Exact per-doc verdict for the app lens. NOTE: deliberately no owner
// short-circuit against doc.ownerId === viewer alone — membership (appId)
// comes first, so an app can never see the user's non-app things.
export const appCanViewDoc = (scope: AppNamespaceScope, doc: any): boolean => {
  if (!doc || doc.appId !== scope.appId) return false;
  const own = String(doc.ownerId) === scope.ownerId;
  if (scope.sandbox) {
    const pooled = !!scope.sandbox.space && doc.sandboxSpace === scope.sandbox.space;
    if (!own && !pooled) return false;
  } else if (doc.sandboxExpiresAt !== undefined && doc.sandboxExpiresAt !== null) {
    return false; // sandbox junk written under a real clientId
  }
  if (own) return true;
  return scope.sharedRead && Array.isArray(doc.acl) && doc.acl.includes(appAclEntry(scope.appId));
};

// ---------------------------------------------------------------------------
// Writes.

// Serialized size of the content an app write stores — the number charged
// against the namespace budget and stamped on the doc as root sizeBytes.
// UTF-8 JSON length, matching every other byte measurement in the repo.
export const appThingSizeBytes = (doc: { crystal?: unknown; extended?: unknown; tags?: unknown }): number => {
  const serialized = JSON.stringify({
    crystal: doc.crystal ?? null,
    extended: doc.extended ?? null,
    tags: doc.tags ?? []
  });
  return Buffer.byteLength(serialized, 'utf8');
};

// The root fields stamped on every doc written through an app token. The
// stamp is server-authoritative: no generic input path copies these fields,
// which is exactly what makes root appId the trustworthy namespace marker.
export const appNamespaceStamp = (scope: AppNamespaceScope, sizeBytes: number): Record<string, unknown> => ({
  appId: scope.appId,
  sizeBytes,
  ...(scope.sandbox
    ? {
        sandboxExpiresAt: new Date(Date.now() + SANDBOX_TOKEN_TTL_MS),
        ...(scope.sandbox.space ? { sandboxSpace: scope.sandbox.space } : {})
      }
    : {})
});

// Resolve the requested audience for an app write into a stored acl. Accepts
// the acl array itself, or `visibility` sugar ('private' | 'app'). App acls
// are deliberately narrower than general thing acls: only the owner and this
// one app's user base are expressible — tt:all / other apps / other users /
// exclusions are rejected, so a compromised or sloppy app can never widen an
// entry beyond its own walls. Returns acl null when the write doesn't mention
// audience at all (update keeps the stored acl; insert defaults PRIVATE —
// never the generic route's public default).
export const resolveAppScopedAcl = (appId: string, visibility: unknown, acl: unknown): { acl: string[] | null; shared: boolean } | Fail => {
  const shared = appAclEntry(appId);

  if (acl !== undefined && acl !== null) {
    if (!Array.isArray(acl)) return fail(400, 'acl must be a list of tt: entries');
    const entries: string[] = [];
    for (const raw of acl) {
      const entry = typeof raw === 'string' ? raw.trim() : '';
      if (!entry) continue;
      if (entry !== ACL_OWNER && entry !== shared) {
        return fail(400, `app acl entries can only be ${ACL_OWNER} (just this user) or ${shared} (users of this app)`);
      }
      if (!entries.includes(entry)) entries.push(entry);
    }
    if (!entries.includes(ACL_OWNER)) entries.unshift(ACL_OWNER); // owners always read their own
    return { acl: entries, shared: entries.includes(shared) };
  }

  if (visibility === undefined || visibility === null) return { acl: null, shared: false };
  if (visibility === 'private') return { acl: [ACL_OWNER], shared: false };
  if (visibility === 'app') return { acl: [ACL_OWNER, shared], shared: true };
  return fail(400, "visibility must be 'private' or 'app' (or pass an acl array)");
};

// ---------------------------------------------------------------------------
// Author liveness. An entry shared to the app audience only surfaces while
// its AUTHOR still holds a live grant for this app covering app-data.shared —
// revoke the grant (or let it expire) and the entries leave every app read
// immediately; the docs themselves stay the author's.

export const liveSharingAuthors = async (clientId: string, userIds: string[]): Promise<Map<string, string[]>> => {
  if (!userIds.length) return new Map();
  const sessions = await (
    await getSessionsCollection()
  )
    .find({
      purpose: 'app',
      'meta.clientId': clientId,
      userId: { $in: userIds },
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    })
    .toArray();

  const scopesByUser = new Map<string, string[]>();
  for (const session of sessions) {
    const userId = String(session.userId);
    const union = scopesByUser.get(userId) || [];
    for (const scope of sessionScopes(session.meta)) {
      if (!union.includes(scope)) union.push(scope);
    }
    scopesByUser.set(userId, union);
  }
  for (const [userId, scopes] of [...scopesByUser]) {
    if (!scopeCovers(scopes, 'app-data.shared')) scopesByUser.delete(userId);
  }
  return scopesByUser;
};

// Same-space sandbox authors: live app-sandbox sessions for these owners in
// this clientId's pool — the sandbox mirror of liveSharingAuthors, carrying
// each pretend user's username + scope set. A dead session (expired token)
// drops its author from the pool, mirroring real revocation semantics.
export const liveSandboxAuthors = async (
  clientId: string,
  space: string,
  userIds: string[]
): Promise<Map<string, { scopes: string[]; username: string }>> => {
  if (!userIds.length) return new Map();
  const sessions = await (
    await getSessionsCollection()
  )
    .find({
      purpose: 'app-sandbox',
      'meta.clientId': clientId,
      'meta.space': space,
      userId: { $in: userIds },
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    })
    .toArray();

  const byUser = new Map<string, { scopes: string[]; username: string }>();
  for (const session of sessions) {
    const scopes = sessionScopes(session.meta);
    if (!scopeCovers(scopes, 'app-data.shared')) continue;
    byUser.set(String(session.userId), {
      scopes,
      username: typeof session.meta?.username === 'string' ? session.meta.username : 'sandbox-you'
    });
  }
  return byUser;
};

// Batch-verdict for a page of app-lens docs: which docs survive the
// author-liveness gate. Own docs always survive; cross-user docs need a live
// sharing author (real or same-space sandbox).
export const filterByLiveAuthors = async (scope: AppNamespaceScope, docs: any[]): Promise<any[]> => {
  const crossUserAuthors = [...new Set(docs.filter((doc) => String(doc.ownerId) !== scope.ownerId).map((doc) => String(doc.ownerId)))];
  if (!crossUserAuthors.length) return docs;

  let liveIds: Set<string>;
  if (scope.sandbox) {
    liveIds = scope.sandbox.space ? new Set((await liveSandboxAuthors(scope.appId, scope.sandbox.space, crossUserAuthors)).keys()) : new Set(); // isolated sandbox: cross-user docs never survive
  } else {
    liveIds = new Set((await liveSharingAuthors(scope.appId, crossUserAuthors)).keys());
  }
  return docs.filter((doc) => String(doc.ownerId) === scope.ownerId || liveIds.has(String(doc.ownerId)));
};

export { sandboxDisplayName };

// ---------------------------------------------------------------------------
// Storage allowances: bytes, not counts. The app Thing is the aggregate
// ledger; one deterministic counter Thing tracks each (user, app). Positive
// writes reserve the app first and then the user with guarded $inc admission,
// so races cannot overshoot either allowance. User refusal compensates the
// aggregate reservation. Refunds floor at zero. FAIL-CLOSED: a store error
// refuses the write. Drift repair is a namespace sizeBytes sum.

export const APP_STORAGE_KIND = 'app-storage';
export { APP_STORAGE_ACCOUNTING_VERSION };

const storageShareId = (ownerId: string, appId: string): string =>
  `app-storage-${createHash('sha256').update(ownerId).update('\0').update(appId).digest('hex').slice(0, 48)}`;

// NOTE: crystal carries appId but never `key`, so the counter can never enter
// the app-data (ownerId, crystal.appId, crystal.key) unique index. It carries
// no root appId either — bookkeeping is not app content, so namespace reads
// never see it.
export const appStorageCounterMatch = (ownerId: string, appId: string) => ({
  shareId: storageShareId(ownerId, appId),
  ownerId,
  'crystal.quotaKind': APP_STORAGE_KIND
});

const storageMatch = (scope: AppNamespaceScope) => appStorageCounterMatch(scope.ownerId, scope.appId);

export const ensureAppStorageCounter = async (scope: AppNamespaceScope): Promise<void> => {
  const things = await getThingsCollection();
  const now = new Date();
  try {
    await things.updateOne(
      storageMatch(scope),
      {
        // Adopt #158/#170's original `data` counter into a protected system
        // kind on first touch. Users can browse their app data, but can never
        // edit/delete the accounting row through generic Thing CRUD.
        $set: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: [APP_STORAGE_KIND]
        },
        $setOnInsert: {
          crystal: { quotaKind: APP_STORAGE_KIND, appId: scope.appId, usedBytes: 0 },
          acl: [ACL_OWNER],
          targetId: null,
          tags: [],
          createdAt: now,
          updatedAt: now,
          // a sandbox namespace's ledger dies with its namespace
          ...(scope.sandbox ? { sandboxExpiresAt: new Date(now.getTime() + SANDBOX_TOKEN_TTL_MS) } : {})
        }
      },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // lost the upsert race — counter exists
  }
};

const readyAppStorageMatch = (appId: string) => ({
  thingtime: 'app',
  'crystal.clientId': appId,
  'crystal.storageUsedBytes': { $gte: 0 },
  'crystal.userStorageAllowanceBytes': { $gte: 0 },
  'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
  $or: [
    { 'crystal.storageAllowanceBytes': { $gte: 0 } },
    {
      $and: [{ 'crystal.storageAllowanceBytes': { $exists: true } }, { 'crystal.storageAllowanceBytes': null }]
    }
  ]
});

const reserveRegisteredAppStorage = async (appId: string, deltaBytes: number): Promise<AppStorageReservation | null> => {
  const things = await getThingsCollection();
  const app = await things.findOneAndUpdate(
    {
      ...readyAppStorageMatch(appId),
      $expr: {
        $or: [
          { $eq: ['$crystal.storageAllowanceBytes', null] },
          { $lte: [{ $add: ['$crystal.storageUsedBytes', deltaBytes] }, '$crystal.storageAllowanceBytes'] }
        ]
      }
    },
    { $inc: { 'crystal.storageUsedBytes': deltaBytes } },
    { returnDocument: 'after' }
  );
  if (!app) return null;
  const policy = appStoragePolicyOf(app);
  if (!policy.ready) {
    await refundRegisteredAppStorage(appId, deltaBytes);
    return null;
  }
  return {
    usedBytes: policy.storageUsedBytes,
    allowanceBytes: policy.storageAllowanceBytes,
    userAllowanceBytes: policy.userStorageAllowanceBytes
  };
};

const refundRegisteredAppStorage = async (appId: string, bytes: number): Promise<boolean> => {
  if (!(bytes > 0)) return false;
  const refunded = await (
    await getThingsCollection()
  ).findOneAndUpdate(readyAppStorageMatch(appId), [
    {
      $set: {
        'crystal.storageUsedBytes': {
          $max: [0, { $subtract: ['$crystal.storageUsedBytes', bytes] }]
        }
      }
    }
  ]);
  return !!refunded;
};

const reserveUserStorage = async (
  scope: AppNamespaceScope,
  deltaBytes: number,
  defaultAllowanceBytes: number,
  appAllowanceBytes: number | null
): Promise<FiniteStorageUsage | null> => {
  await ensureAppStorageCounter(scope);
  const configuredAllowance = { $ifNull: ['$crystal.storageAllowanceBytes', defaultAllowanceBytes] };
  const effectiveAllowance = appAllowanceBytes === null ? configuredAllowance : { $min: [configuredAllowance, appAllowanceBytes] };
  const admitted = await (
    await getThingsCollection()
  ).findOneAndUpdate(
    {
      ...storageMatch(scope),
      $expr: {
        $lte: [{ $add: [{ $ifNull: ['$crystal.usedBytes', 0] }, deltaBytes] }, effectiveAllowance]
      }
    },
    {
      $inc: { 'crystal.usedBytes': deltaBytes },
      $set: { 'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION, updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );
  if (!admitted) return null;
  const allowanceBytes = effectiveAppUserAllowance(defaultAllowanceBytes, admitted.crystal?.storageAllowanceBytes, appAllowanceBytes);
  return storageUsage(admitted.crystal?.usedBytes ?? deltaBytes, allowanceBytes, allowanceBytes);
};

const refundUserStorage = async (scope: AppNamespaceScope, bytes: number, markLive = true): Promise<void> => {
  if (!(bytes > 0)) return;
  await ensureAppStorageCounter(scope);
  await (
    await getThingsCollection()
  ).findOneAndUpdate(storageMatch(scope), [
    {
      $set: {
        'crystal.usedBytes': {
          $max: [0, { $subtract: [{ $ifNull: ['$crystal.usedBytes', 0] }, bytes] }]
        },
        ...(markLive ? { 'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION } : {}),
        updatedAt: '$$NOW'
      }
    }
  ]);
};

export type AppStorageUsage = {
  // Backward-compatible names for the current app user's ledger.
  usedBytes: number;
  budgetBytes: number;
  remainingBytes: number;
  userStorage: { usedBytes: number; allowanceBytes: number; remainingBytes: number };
  // Sandboxes have no registered standing app allowance; their aggregate
  // protection is the separate windowed sandbox.storage.global brake.
  appStorage: (StorageUsage & { remainingBytes: number | null }) | null;
  storageAccountingReady: boolean;
};

function withRemaining(usage: FiniteStorageUsage): FiniteStorageUsage & { remainingBytes: number };
function withRemaining(usage: StorageUsage): StorageUsage & { remainingBytes: number | null };
function withRemaining(usage: StorageUsage) {
  return {
    ...usage,
    remainingBytes: remainingStorageBytes(usage)
  };
}

export const getAppStorageUsage = async (scope: AppNamespaceScope): Promise<AppStorageUsage> => {
  const things = await getThingsCollection();
  const [counter, app] = await Promise.all([
    things.findOne(storageMatch(scope), {
      projection: { 'crystal.usedBytes': 1, 'crystal.storageAllowanceBytes': 1 }
    }),
    scope.sandbox ? Promise.resolve(null) : findAppByClientId(scope.appId)
  ]);
  const policy = appStoragePolicyOf(app);
  const userAllowanceBytes = scope.sandbox
    ? SANDBOX_STORAGE_BYTES
    : effectiveAppUserAllowance(policy.userStorageAllowanceBytes, counter?.crystal?.storageAllowanceBytes, policy.storageAllowanceBytes);
  const userUsage = storageUsage(counter?.crystal?.usedBytes, userAllowanceBytes, userAllowanceBytes);
  const userStorage = {
    usedBytes: userUsage.usedBytes,
    allowanceBytes: userAllowanceBytes,
    remainingBytes: remainingStorageBytes(userUsage) ?? 0
  };
  const appStorage = app
    ? withRemaining(storageUsage(policy.storageUsedBytes, policy.storageAllowanceBytes, DEFAULT_APP_STORAGE_ALLOWANCE_BYTES))
    : null;
  return {
    usedBytes: userStorage.usedBytes,
    budgetBytes: userStorage.allowanceBytes,
    remainingBytes: userStorage.remainingBytes,
    userStorage,
    appStorage,
    storageAccountingReady: scope.sandbox ? true : policy.ready
  };
};

export const appStorageBudgetBytes = async (scope: AppNamespaceScope): Promise<number> =>
  (await getAppStorageUsage(scope)).userStorage.allowanceBytes;

export type StorageCharge = ({ ok: true } & AppStorageUsage) | Fail;

// Admit `deltaBytes` against both standing allowances. Registered apps reserve
// aggregate → user; sandboxes retain their namespace allowance + global burn
// window and never touch a registered app's standing aggregate.
export const chargeAppStorage = async (scope: AppNamespaceScope, deltaBytes: number): Promise<StorageCharge> => {
  try {
    if (deltaBytes <= 0) {
      const bytes = Math.max(0, -deltaBytes);
      // Only mark a registered user ledger live when the matching aggregate
      // was ready and refunded too. Before the legacy-app migration enables
      // that aggregate, an owner delete must not make the baseline ledger
      // ineligible for reconciliation.
      const appWasReady = scope.sandbox ? false : await refundRegisteredAppStorage(scope.appId, bytes);
      await refundUserStorage(scope, bytes, !!scope.sandbox || appWasReady);
      return { ok: true, ...(await getAppStorageUsage(scope)) };
    }

    if (scope.sandbox) {
      // The global window measures write burn, so deletes do not restore it.
      const globalWindow = await consumeByteBudget('sandbox.storage.global', deltaBytes);
      if (!globalWindow.allowed) {
        return fail(
          globalWindow.unavailable ? 503 : 507,
          globalWindow.unavailable ? 'Storage accounting is unavailable — try again' : 'The sandbox is very busy right now — try again soon'
        );
      }
      const user = await reserveUserStorage(scope, deltaBytes, SANDBOX_STORAGE_BYTES, SANDBOX_STORAGE_BYTES);
      if (!user) {
        await refundByteBudget('sandbox.storage.global', deltaBytes);
        const usage = await getAppStorageUsage(scope);
        return fail(
          507,
          `This would exceed the sandbox's ${SANDBOX_STORAGE_BYTES / (1024 * 1024)} MiB storage allowance ` +
            `(${usage.usedBytes} of ${usage.budgetBytes} bytes used — delete entries or store less)`
        );
      }
      return { ok: true, ...(await getAppStorageUsage(scope)) };
    }

    const admitted = await admitAppAndUserStorage({
      reserveApp: () => reserveRegisteredAppStorage(scope.appId, deltaBytes),
      reserveUser: (allowanceBytes, appAllowanceBytes) => reserveUserStorage(scope, deltaBytes, allowanceBytes, appAllowanceBytes),
      refundApp: async () => {
        await refundRegisteredAppStorage(scope.appId, deltaBytes);
      }
    });
    if (admitted.ok === true) {
      const userStorage = withRemaining(admitted.user);
      const appStorage = withRemaining(admitted.app);
      return {
        ok: true,
        usedBytes: userStorage.usedBytes,
        budgetBytes: userStorage.allowanceBytes,
        remainingBytes: userStorage.remainingBytes,
        userStorage,
        appStorage,
        storageAccountingReady: true
      };
    }

    const usage = await getAppStorageUsage(scope);
    if (!usage.appStorage) return fail(403, 'This app is no longer registered');
    if (!usage.storageAccountingReady) {
      return fail(503, 'App storage accounting is not initialized — run the pending storage migration');
    }
    if (admitted.exhausted === 'app') {
      return fail(
        507,
        `This would exceed the app's aggregate storage allowance ` +
          `(${usage.appStorage.usedBytes} of ${usage.appStorage.allowanceBytes} bytes used across all users)`
      );
    }
    return fail(
      507,
      `This would exceed the app's storage allowance for this user ` +
        `(${usage.userStorage.usedBytes} of ${usage.userStorage.allowanceBytes} bytes used — delete entries or store less)`
    );
  } catch {
    // Standing storage admission fails closed: an unavailable or ambiguous
    // ledger refuses the write instead of allowing either ceiling to drift low.
    return fail(503, 'Storage accounting is unavailable — try again');
  }
};

export const refundAppStorage = async (scope: AppNamespaceScope, bytes: number): Promise<void> => {
  if (!(bytes > 0)) return;
  await chargeAppStorage(scope, -bytes);
};

// App-manager primitive. `null` clears the user's custom sub-tier and returns
// them to the app default; numeric overrides stay relational on this one
// protected ledger instead of growing an embedded map on the app Thing.
export const setAppUserStorageAllowance = async (ownerId: string, appId: string, allowanceBytes: number | null): Promise<AppStorageUsage> => {
  const scope: AppNamespaceScope = {
    appId,
    ownerId,
    sharedRead: false,
    scopes: [],
    username: '',
    sandbox: null
  };
  await ensureAppStorageCounter(scope);
  const things = await getThingsCollection();
  if (allowanceBytes === null) {
    await things.updateOne(storageMatch(scope), {
      $unset: { 'crystal.storageAllowanceBytes': '' },
      $set: { updatedAt: new Date() }
    });
  } else {
    await things.updateOne(storageMatch(scope), {
      $set: {
        'crystal.storageAllowanceBytes': Math.max(0, Math.floor(allowanceBytes)),
        updatedAt: new Date()
      }
    });
  }
  return getAppStorageUsage(scope);
};

// Drift repair: set a (user, app) ledger to an absolute value — the backfill
// migration and reconcile sweeps write the $sum of the namespace's sizeBytes
// through this, never by hand-editing counter docs.
export const setAppStorageUsed = async (
  ownerId: string,
  appId: string,
  usedBytes: number,
  options: { onlyIfNotLive?: boolean } = {}
): Promise<boolean> => {
  const scope: AppNamespaceScope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
  await ensureAppStorageCounter(scope);
  const things = await getThingsCollection();
  const result = await things.updateOne(
    {
      ...storageMatch(scope),
      ...(options.onlyIfNotLive ? { 'crystal.storageAccountingVersion': { $exists: false } } : {})
    },
    {
      $set: { 'crystal.usedBytes': Math.max(0, Math.floor(usedBytes)), updatedAt: new Date() }
    }
  );
  return result.matchedCount > 0;
};

// Bootstrap one legacy app exactly once. Positive writes require the version
// marker plus the three policy fields, so they remain fail-closed while the
// migration reconciles user ledgers; the aggregate is enabled last.
export const initializeAppStorageAccounting = async (appId: string, usedBytes: number): Promise<boolean> => {
  const things = await getThingsCollection();
  const legacyApp = await things.findOne(
    {
      thingtime: 'app',
      'crystal.clientId': appId,
      'crystal.storageAccountingVersion': { $ne: APP_STORAGE_ACCOUNTING_VERSION }
    },
    { projection: { 'crystal.subscriptionTier': 1 } }
  );
  if (!legacyApp) return false;
  const legacyTierId = legacyApp.crystal?.subscriptionTier;
  const staticLegacyTier = isKnownSubscriptionTier(legacyTierId) ? subscriptionTierById(legacyTierId) : null;
  const exactStaticLegacyTier = staticLegacyTier ? await getSubscriptionTierVersion(staticLegacyTier.versionId) : null;
  const resolvedLegacyTier = exactStaticLegacyTier ?? (await getLiveSubscriptionTier(legacyTierId));
  const liveDefault = resolvedLegacyTier ?? (await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER));
  const defaultSnapshot = tierAssignmentSnapshot(liveDefault ?? staticLegacyTier ?? subscriptionTierById(DEFAULT_SUBSCRIPTION_TIER));
  const initialized = await things.findOneAndUpdate(
    {
      thingtime: 'app',
      'crystal.clientId': appId,
      'crystal.storageAccountingVersion': { $ne: APP_STORAGE_ACCOUNTING_VERSION }
    },
    [
      {
        $set: {
          'crystal.storageAllowanceBytes': {
            $cond: [
              {
                $or: [
                  { $eq: [{ $type: '$crystal.storageAllowanceBytes' }, 'null'] },
                  {
                    $and: [{ $isNumber: '$crystal.storageAllowanceBytes' }, { $gte: ['$crystal.storageAllowanceBytes', 0] }]
                  }
                ]
              },
              '$crystal.storageAllowanceBytes',
              defaultSnapshot.quotas.appStorageBytes
            ]
          },
          'crystal.storageUsedBytes': Math.max(0, Math.floor(usedBytes)),
          'crystal.userStorageAllowanceBytes': {
            $cond: [
              { $isNumber: '$crystal.userStorageAllowanceBytes' },
              '$crystal.userStorageAllowanceBytes',
              DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES
            ]
          },
          'crystal.subscriptionTier': { $ifNull: ['$crystal.subscriptionTier', defaultSnapshot.tierId] },
          'crystal.subscriptionTierVersionId': {
            $ifNull: ['$crystal.subscriptionTierVersionId', defaultSnapshot.versionId]
          },
          'crystal.subscriptionTierVersion': {
            $ifNull: ['$crystal.subscriptionTierVersion', defaultSnapshot.version]
          },
          'crystal.subscriptionTierName': {
            $ifNull: ['$crystal.subscriptionTierName', defaultSnapshot.title]
          },
          'crystal.subscriptionTierMetered': {
            $ifNull: ['$crystal.subscriptionTierMetered', defaultSnapshot.metered]
          },
          'crystal.subscriptionTierQuotas': {
            $ifNull: ['$crystal.subscriptionTierQuotas', { $literal: defaultSnapshot.quotas }]
          },
          'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION
        }
      }
    ],
    { returnDocument: 'after' }
  );
  return !!initialized;
};
