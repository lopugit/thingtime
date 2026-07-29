import { createHash } from 'node:crypto';

import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { scopeCovers, sessionScopes } from './scopes';
import { SANDBOX_TOKEN_TTL_MS, sandboxDisplayName } from './sandbox';
import type { AppTokenContext } from './appTokens';
import {
  ACL_APP_PREFIX,
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  DEFAULT_APP_STORAGE_BYTES,
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
//   • STORAGE is byte-budgeted per (user, app): a service-quota-style counter
//     thing admits writes with a race-safe guarded $inc, fail-closed. No doc
//     counts anywhere.

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
  scope.sharedRead
    ? { $or: [{ ownerId: scope.ownerId }, { acl: { $in: [appAclEntry(scope.appId), 'tt:inherit'] } }] }
    : { ownerId: scope.ownerId }
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
export const resolveAppScopedAcl = (
  appId: string,
  visibility: unknown,
  acl: unknown
): { acl: string[] | null; shared: boolean } | Fail => {
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
  const sessions = await (await getSessionsCollection())
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
  const sessions = await (await getSessionsCollection())
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
  const crossUserAuthors = [
    ...new Set(docs.filter((doc) => String(doc.ownerId) !== scope.ownerId).map((doc) => String(doc.ownerId)))
  ];
  if (!crossUserAuthors.length) return docs;

  let liveIds: Set<string>;
  if (scope.sandbox) {
    liveIds = scope.sandbox.space
      ? new Set((await liveSandboxAuthors(scope.appId, scope.sandbox.space, crossUserAuthors)).keys())
      : new Set(); // isolated sandbox: cross-user docs never survive
  } else {
    liveIds = new Set((await liveSharingAuthors(scope.appId, crossUserAuthors)).keys());
  }
  return docs.filter((doc) => String(doc.ownerId) === scope.ownerId || liveIds.has(String(doc.ownerId)));
};

export { sandboxDisplayName };

// ---------------------------------------------------------------------------
// Storage budgets: bytes, not counts. One counter thing per (user, app) —
// deterministic shareId, guarded $inc admission (the filter itself enforces
// `used + delta ≤ budget`, so racing writes can never overshoot), pipeline
// refunds floored at zero. FAIL-CLOSED: a store error refuses the write.
// Drift repair is one $sum over the namespace's sizeBytes (the backfill
// migration seeds counters the same way).

const APP_STORAGE_KIND = 'app-storage';

const storageShareId = (ownerId: string, appId: string): string =>
  `app-storage-${createHash('sha256').update(ownerId).update('\0').update(appId).digest('hex').slice(0, 48)}`;

// NOTE: crystal carries appId but never `key`, so the counter can never enter
// the app-data (ownerId, crystal.appId, crystal.key) unique index. It carries
// no root appId either — bookkeeping is not app content, so namespace reads
// never see it.
const storageMatch = (scope: AppNamespaceScope) => ({
  shareId: storageShareId(scope.ownerId, scope.appId),
  ownerId: scope.ownerId,
  thingtime: 'data',
  'crystal.quotaKind': APP_STORAGE_KIND
});

export const appStorageBudgetBytes = (scope: AppNamespaceScope): number =>
  scope.sandbox ? SANDBOX_STORAGE_BYTES : DEFAULT_APP_STORAGE_BYTES;

const ensureStorageCounter = async (scope: AppNamespaceScope): Promise<void> => {
  const things = await getThingsCollection();
  const now = new Date();
  try {
    await things.updateOne(
      storageMatch(scope),
      {
        $setOnInsert: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: ['data'],
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

export type StorageCharge = { ok: true; usedBytes: number; budgetBytes: number } | Fail;

// Admit `deltaBytes` of new storage into the namespace, atomically. Negative
// deltas refund (floored at zero) and always succeed.
export const chargeAppStorage = async (scope: AppNamespaceScope, deltaBytes: number): Promise<StorageCharge> => {
  const budgetBytes = appStorageBudgetBytes(scope);
  try {
    const things = await getThingsCollection();

    if (deltaBytes <= 0) {
      const refunded = await things.findOneAndUpdate(
        storageMatch(scope),
        [
          {
            $set: {
              'crystal.usedBytes': {
                $max: [0, { $add: [{ $ifNull: ['$crystal.usedBytes', 0] }, deltaBytes] }]
              },
              updatedAt: '$$NOW'
            }
          }
        ],
        { returnDocument: 'after' }
      );
      return { ok: true, usedBytes: refunded?.crystal?.usedBytes ?? 0, budgetBytes };
    }

    await ensureStorageCounter(scope);
    const admitted = await things.findOneAndUpdate(
      { ...storageMatch(scope), 'crystal.usedBytes': { $lte: budgetBytes - deltaBytes } },
      { $inc: { 'crystal.usedBytes': deltaBytes }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!admitted) {
      const used = await getAppStorageUsage(scope);
      return fail(
        507,
        `This would exceed the app's ${Math.floor(budgetBytes / (1024 * 1024))}MB storage budget for this user ` +
          `(${used.usedBytes} of ${budgetBytes} bytes used — delete entries or store less)`
      );
    }
    return { ok: true, usedBytes: admitted.crystal?.usedBytes ?? deltaBytes, budgetBytes };
  } catch {
    // fail CLOSED: storage admission guards a standing resource — an
    // unavailable ledger refuses the write instead of waving it through
    return fail(503, 'Storage accounting is unavailable — try again');
  }
};

export const refundAppStorage = async (scope: AppNamespaceScope, bytes: number): Promise<void> => {
  if (!(bytes > 0)) return;
  await chargeAppStorage(scope, -bytes);
};

export const getAppStorageUsage = async (
  scope: AppNamespaceScope
): Promise<{ usedBytes: number; budgetBytes: number }> => {
  const things = await getThingsCollection();
  const doc = await things.findOne(storageMatch(scope), { projection: { 'crystal.usedBytes': 1 } });
  return { usedBytes: doc?.crystal?.usedBytes ?? 0, budgetBytes: appStorageBudgetBytes(scope) };
};
