import { createHash } from 'node:crypto';

import { getSessionsCollection, getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { consumeByteBudget, refundByteBudget } from '../rateLimit/byteBudget';
import { DEFAULT_SUBSCRIPTION_TIER, isKnownSubscriptionTier, subscriptionTierById } from '../subscriptions/tierCatalog';
import { getLiveSubscriptionTier, getSubscriptionTierVersion, tierAssignmentSnapshot } from '../subscriptions/tierCatalogStore';
import { appStoragePolicyOf, findAppByClientId } from './apps';
import { effectiveAppUserAllowance, remainingStorageBytes, storageUsage, storedByteCount } from './appStorageCore';
import type { FiniteStorageUsage, StorageUsage } from './appStorageCore';
import { scopeCovers, sessionScopes } from './scopes';
import { SANDBOX_TOKEN_TTL_MS, sandboxDisplayName } from './sandbox';
import type { AppTokenContext } from './appTokens';
import {
	StorageMutationError,
	USER_STORAGE_ACCOUNTING_VERSION,
	USER_STORAGE_STATUS,
	nonSandboxStorageCandidateExpression,
	realStorageSourceExpression,
	thingStorageSizeBytes
} from '../storage/storageCore';
import { getUserStorageUsage } from '../storage/userStorage';
import {
  ACL_APP_PREFIX,
  ACL_OWNER,
  APP_STORAGE_ACCOUNTING_VERSION,
	APP_STORAGE_LEDGER_ENVELOPE_VERSION,
	APP_STORAGE_RESERVED_ID_PREFIX,
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
// Backward-compatible export: app and first-party account storage now share
// one byte definition instead of two subtly diverging calculators.
export const appThingSizeBytes = thingStorageSizeBytes;

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
	`${APP_STORAGE_RESERVED_ID_PREFIX}${createHash('sha256').update(ownerId).update('\0').update(appId).digest('hex').slice(0, 48)}`;
export const appStorageCounterShareId = storageShareId;
export const isAppStorageCounterCandidateId = (value: unknown): value is string =>
	typeof value === 'string' && value.startsWith(APP_STORAGE_RESERVED_ID_PREFIX);

const safeWholeNumberExpression = (field: unknown) => ({
	$let: {
		vars: { whole: { $convert: { input: field, to: 'long', onError: null, onNull: null } } },
		in: {
			$and: [
				{ $isNumber: field },
				{ $ne: ['$$whole', null] },
				{ $eq: [field, '$$whole'] },
				{ $gte: ['$$whole', 0] },
				{ $lte: ['$$whole', Number.MAX_SAFE_INTEGER] }
			]
		}
	}
});

const APP_STORAGE_COUNTER_ROOT_KEYS = [
	'_id',
	'shareId',
	'schemaVersion',
	'thingtime',
	'crystal',
	'ownerId',
	'acl',
	'targetId',
	'tags',
	'createdAt',
	'updatedAt',
	'storageLedgerEnvelopeVersion',
	'sandboxExpiresAt'
] as const;
const APP_STORAGE_COUNTER_CRYSTAL_KEYS = [
	'quotaKind',
	'appId',
	'usedBytes',
	'storageAllowanceBytes',
	'storageAccountingVersion',
	'storageLedgerStatus',
	'storageReconciledAt',
	'storageUpdatedAt'
] as const;

const objectKeysSubsetExpression = (value: unknown, allowed: readonly string[]) => ({
	$setIsSubset: [
		{
			$map: {
				input: { $objectToArray: { $ifNull: [value, {}] } },
				as: 'field',
				in: '$$field.k'
			}
		},
		[...allowed]
	]
});

const optionalDateExpression = (field: string) => ({
	$in: [{ $type: field }, ['missing', 'date']]
});

const exactAppStorageCounterExpression = () => ({
	$and: [
		objectKeysSubsetExpression('$$ROOT', APP_STORAGE_COUNTER_ROOT_KEYS),
		objectKeysSubsetExpression('$crystal', APP_STORAGE_COUNTER_CRYSTAL_KEYS),
		safeWholeNumberExpression('$crystal.usedBytes'),
		{
			$or: [
				{ $eq: [{ $type: '$crystal.storageAllowanceBytes' }, 'missing'] },
				{ $eq: ['$crystal.storageAllowanceBytes', null] },
				safeWholeNumberExpression('$crystal.storageAllowanceBytes')
			]
		},
		optionalDateExpression('$crystal.storageReconciledAt'),
		optionalDateExpression('$crystal.storageUpdatedAt'),
		optionalDateExpression('$sandboxExpiresAt')
	]
});

// NOTE: crystal carries appId but never `key`, so the counter can never enter
// the app-data (ownerId, crystal.appId, crystal.key) unique index. It carries
// no root appId either — bookkeeping is not app content, so namespace reads
// never see it.
export const appStorageCounterMatch = (ownerId: string, appId: string) => ({
  shareId: storageShareId(ownerId, appId),
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	thingtime: [APP_STORAGE_KIND],
	ownerId,
	acl: [ACL_OWNER],
	targetId: null,
	tags: [],
	createdAt: { $type: 'date' },
	updatedAt: { $type: 'date' },
	storageLedgerEnvelopeVersion: APP_STORAGE_LEDGER_ENVELOPE_VERSION,
	'crystal.quotaKind': APP_STORAGE_KIND,
	'crystal.appId': appId,
	'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
	'crystal.storageLedgerStatus': {
		$in: [USER_STORAGE_STATUS.ready, USER_STORAGE_STATUS.needsReconcile, USER_STORAGE_STATUS.initializing]
	},
	// These are content-envelope stamps. Their presence proves that a generic
	// data Thing occupied the deterministic id and must never be promoted into
	// an accounting authority by a hot request path.
	appId: { $exists: false },
	sizeBytes: { $exists: false },
	storageClass: { $exists: false },
	storageAccountingVersion: { $exists: false },
	// Keep the exact-key/valid-value test inside `$and`: callers frequently add
	// their own top-level `$expr`, and an object spread must never overwrite the
	// identity guard that distinguishes authority from a promoted generic row.
	$and: [{ $expr: exactAppStorageCounterExpression() }]
});

// Delete recovery is deliberately broader than debit/admission. It accepts
// the exact server envelope and current accounting version even when the
// ledger's status/value fields are malformed, solely to serialize the delete
// and force needs-reconcile. It still rejects extra-field/promoted generic
// occupants, so this path can never confer accounting authority on them.
export const appStorageCounterFenceMatch = (ownerId: string, appId: string) => ({
	shareId: storageShareId(ownerId, appId),
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	thingtime: [APP_STORAGE_KIND],
  ownerId,
	acl: [ACL_OWNER],
	targetId: null,
	tags: [],
	storageLedgerEnvelopeVersion: APP_STORAGE_LEDGER_ENVELOPE_VERSION,
	'crystal.quotaKind': APP_STORAGE_KIND,
	'crystal.appId': appId,
	'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
	appId: { $exists: false },
	sizeBytes: { $exists: false },
	storageClass: { $exists: false },
	storageAccountingVersion: { $exists: false },
	$and: [
		{
			$expr: {
				$and: [
					objectKeysSubsetExpression('$$ROOT', APP_STORAGE_COUNTER_ROOT_KEYS),
					objectKeysSubsetExpression('$crystal', APP_STORAGE_COUNTER_CRYSTAL_KEYS)
				]
			}
		}
	]
});

const storageMatch = (scope: AppNamespaceScope) => ({
	...appStorageCounterMatch(scope.ownerId, scope.appId),
	...(scope.sandbox ? { sandboxExpiresAt: { $type: 'date' } } : { sandboxExpiresAt: { $exists: false } })
});

const isPlainObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasExactKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
	Object.keys(value).every((key) => allowed.includes(key));
const isValidOptionalDate = (value: unknown): boolean => value === undefined || (value instanceof Date && Number.isFinite(value.getTime()));

// A duplicate deterministic id is only a harmless lost-upsert race when the
// winner is already the complete server-only envelope. In particular, an old
// generic `data` counter is not trusted merely because its free-form crystal
// claims to be an app-storage ledger; the explicit migration must reconcile
// and convert that legacy row first.
export const appStorageCounterEnvelopeIsTrusted = (doc: any, scope: AppNamespaceScope): boolean => {
	const crystal = doc?.crystal;
	const allowance = crystal?.storageAllowanceBytes;
	const status = crystal?.storageLedgerStatus;
	const validStatus =
		status === USER_STORAGE_STATUS.ready || status === USER_STORAGE_STATUS.needsReconcile || status === USER_STORAGE_STATUS.initializing;
	const hasContentStamp = ['appId', 'sizeBytes', 'storageClass', 'storageAccountingVersion'].some((field) =>
		Object.prototype.hasOwnProperty.call(doc ?? {}, field)
	);
	const sandboxShape = scope.sandbox
		? doc?.sandboxExpiresAt instanceof Date && Number.isFinite(doc.sandboxExpiresAt.getTime())
		: !Object.prototype.hasOwnProperty.call(doc ?? {}, 'sandboxExpiresAt');

	return (
		isPlainObject(doc) &&
		doc.shareId === storageShareId(scope.ownerId, scope.appId) &&
		doc.schemaVersion === COLLECTION_SCHEMA_VERSIONS.things &&
		Array.isArray(doc.thingtime) &&
		doc.thingtime.length === 1 &&
		doc.thingtime[0] === APP_STORAGE_KIND &&
		doc.ownerId === scope.ownerId &&
		Array.isArray(doc.acl) &&
		doc.acl.length === 1 &&
		doc.acl[0] === ACL_OWNER &&
		doc.targetId === null &&
		Array.isArray(doc.tags) &&
		doc.tags.length === 0 &&
		doc.storageLedgerEnvelopeVersion === APP_STORAGE_LEDGER_ENVELOPE_VERSION &&
		hasExactKeys(doc, APP_STORAGE_COUNTER_ROOT_KEYS) &&
		!hasContentStamp &&
		sandboxShape &&
		isPlainObject(crystal) &&
		hasExactKeys(crystal, APP_STORAGE_COUNTER_CRYSTAL_KEYS) &&
		crystal.quotaKind === APP_STORAGE_KIND &&
		crystal.appId === scope.appId &&
		!Object.prototype.hasOwnProperty.call(crystal, 'key') &&
		isNonNegativeSafeInteger(crystal.usedBytes) &&
		crystal.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION &&
		validStatus &&
		(allowance === undefined || allowance === null || isNonNegativeSafeInteger(allowance)) &&
		isValidOptionalDate(crystal.storageReconciledAt) &&
		isValidOptionalDate(crystal.storageUpdatedAt) &&
		doc.createdAt instanceof Date &&
		Number.isFinite(doc.createdAt.getTime()) &&
		doc.updatedAt instanceof Date &&
		Number.isFinite(doc.updatedAt.getTime())
	);
};

const LEGACY_APP_STORAGE_COUNTER_ROOT_KEYS = [
	'_id',
	'shareId',
	'schemaVersion',
	'thingtime',
	'crystal',
	'ownerId',
	'acl',
	'targetId',
	'tags',
	'createdAt',
	'updatedAt'
] as const;

export type HistoricalAppStorageCounterConversionPlan = {
	shareId: string;
	replacement: {
		shareId: string;
		schemaVersion: number;
		thingtime: string[];
		crystal: Record<string, unknown>;
		ownerId: string;
		acl: string[];
		targetId: null;
		tags: never[];
		storageLedgerEnvelopeVersion: number;
		createdAt: Date;
		updatedAt: Date;
	};
};

const historicalCounterInvariant = (): StorageMutationError =>
	new StorageMutationError(
		503,
		'storage_invariant',
		'The deterministic app-storage id is occupied by a foreign or malformed Thing; it was left untouched for admin cleanup'
	);

// Pure, migration-only conversion. Historical `data` counters were owner-
// editable, and the old hot ensure could promote one without removing its
// payload, so no usage or allowance from that source is authoritative. The
// default plan discards both and requires an exact source reconciliation. A
// separately trusted server source may explicitly supply an allowance.
export const historicalAppStorageCounterConversionPlan = (
	doc: any,
	ownerId: string,
	appId: string,
	options: { trustedAllowanceBytes?: number | null; now?: Date } = {}
): HistoricalAppStorageCounterConversionPlan => {
	if (
		typeof ownerId !== 'string' ||
		!ownerId.trim() ||
		ownerId.trim() !== ownerId ||
		ownerId.startsWith('sandbox:') ||
		typeof appId !== 'string' ||
		!appId.trim() ||
		appId.trim() !== appId ||
		!isPlainObject(doc) ||
		!hasExactKeys(doc, LEGACY_APP_STORAGE_COUNTER_ROOT_KEYS) ||
		doc.shareId !== storageShareId(ownerId, appId) ||
		doc.ownerId !== ownerId ||
		doc.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things ||
		!Array.isArray(doc.thingtime) ||
		doc.thingtime.length !== 1 ||
		(doc.thingtime[0] !== 'data' && doc.thingtime[0] !== APP_STORAGE_KIND) ||
		!Array.isArray(doc.acl) ||
		doc.acl.length !== 1 ||
		doc.acl[0] !== ACL_OWNER ||
		doc.targetId !== null ||
		!Array.isArray(doc.tags) ||
		doc.tags.length !== 0 ||
		!(doc.createdAt instanceof Date) ||
		!Number.isFinite(doc.createdAt.getTime()) ||
		!(doc.updatedAt instanceof Date) ||
		!Number.isFinite(doc.updatedAt.getTime()) ||
		!isPlainObject(doc.crystal) ||
		!hasExactKeys(doc.crystal, APP_STORAGE_COUNTER_CRYSTAL_KEYS) ||
		doc.crystal.quotaKind !== APP_STORAGE_KIND ||
		doc.crystal.appId !== appId ||
		!isNonNegativeSafeInteger(doc.crystal.usedBytes)
	) {
		throw historicalCounterInvariant();
	}

	const sourceAllowance = doc.crystal.storageAllowanceBytes;
	const sourceVersion = doc.crystal.storageAccountingVersion;
	const sourceStatus = doc.crystal.storageLedgerStatus;
	if (
		(sourceAllowance !== undefined && sourceAllowance !== null && !isNonNegativeSafeInteger(sourceAllowance)) ||
		(sourceVersion !== undefined && sourceVersion !== APP_STORAGE_ACCOUNTING_VERSION) ||
		(sourceStatus !== undefined &&
			sourceStatus !== USER_STORAGE_STATUS.ready &&
			sourceStatus !== USER_STORAGE_STATUS.needsReconcile &&
			sourceStatus !== USER_STORAGE_STATUS.initializing) ||
		!isValidOptionalDate(doc.crystal.storageReconciledAt) ||
		!isValidOptionalDate(doc.crystal.storageUpdatedAt)
	) {
		throw historicalCounterInvariant();
	}

	const now = options.now ?? new Date();
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw historicalCounterInvariant();
	const trustedAllowance = options.trustedAllowanceBytes;
	if (trustedAllowance !== undefined && trustedAllowance !== null && !isNonNegativeSafeInteger(trustedAllowance)) {
		throw historicalCounterInvariant();
	}

	return {
		shareId: doc.shareId,
		replacement: {
			shareId: doc.shareId,
			schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
			thingtime: [APP_STORAGE_KIND],
			crystal: {
				quotaKind: APP_STORAGE_KIND,
				appId,
				usedBytes: 0,
				storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
				storageLedgerStatus: USER_STORAGE_STATUS.needsReconcile,
				storageUpdatedAt: now,
				...(trustedAllowance === undefined || trustedAllowance === null ? {} : { storageAllowanceBytes: trustedAllowance })
			},
			ownerId,
			acl: [ACL_OWNER],
			targetId: null,
			tags: [],
			storageLedgerEnvelopeVersion: APP_STORAGE_LEDGER_ENVELOPE_VERSION,
			createdAt: new Date(doc.createdAt.getTime()),
			updatedAt: now
		}
	};
};

export type HistoricalAppStorageCounterConversionResult =
	| { status: 'missing'; shareId: string }
	| { status: 'canonical'; shareId: string }
	| { status: 'converted'; shareId: string };

const convertHistoricalAppStorageCounterInSession = async (
	ownerId: string,
	appId: string,
	session: any,
	trustedAllowanceBytes?: number | null
): Promise<HistoricalAppStorageCounterConversionResult> => {
	if (
		typeof ownerId !== 'string' ||
		!ownerId.trim() ||
		ownerId.trim() !== ownerId ||
		ownerId.startsWith('sandbox:') ||
		typeof appId !== 'string' ||
		!appId.trim() ||
		appId.trim() !== appId
	) {
		throw historicalCounterInvariant();
	}
	const things = await getThingsCollection();
	const shareId = storageShareId(ownerId, appId);
	const existing = await things.findOne({ shareId }, { session });
	if (!existing) return { status: 'missing', shareId };
	const scope: AppNamespaceScope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
	if (appStorageCounterEnvelopeIsTrusted(existing, scope)) return { status: 'canonical', shareId };

	const plan = historicalAppStorageCounterConversionPlan(existing, ownerId, appId, { trustedAllowanceBytes });
	const replaced = await things.replaceOne(
		{
			_id: existing._id,
			shareId,
			ownerId,
			schemaVersion: existing.schemaVersion,
			thingtime: existing.thingtime,
			crystal: existing.crystal,
			acl: existing.acl,
			targetId: existing.targetId,
			tags: existing.tags,
			createdAt: existing.createdAt,
			updatedAt: existing.updatedAt
		},
		plan.replacement as any,
		{ session }
	);
	if (replaced.matchedCount !== 1) throw historicalCounterInvariant();
	return { status: 'converted', shareId };
};

export const convertHistoricalAppStorageCounter = async (
	ownerId: string,
	appId: string,
	options: { session?: any; trustedAllowanceBytes?: number | null } = {}
): Promise<HistoricalAppStorageCounterConversionResult> => {
	if (options.session) {
		return convertHistoricalAppStorageCounterInSession(ownerId, appId, options.session, options.trustedAllowanceBytes);
	}
	return withMongoTransaction((session) => convertHistoricalAppStorageCounterInSession(ownerId, appId, session, options.trustedAllowanceBytes));
};

// MongoDB forbids `$expr` inside an upsert predicate. Keep the rich
// appStorageCounterMatch() for ordinary reads/updates, but create the reserved
// row through its deterministic shareId and validate the returned full
// envelope before trusting it. A foreign occupant therefore remains untouched
// and fails closed instead of being promoted into an accounting authority.
export const appStorageCounterUpsertPlan = (scope: AppNamespaceScope, now = new Date()) => ({
	match: { shareId: storageShareId(scope.ownerId, scope.appId) },
	setOnInsert: {
		shareId: storageShareId(scope.ownerId, scope.appId),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [APP_STORAGE_KIND],
		storageLedgerEnvelopeVersion: APP_STORAGE_LEDGER_ENVELOPE_VERSION,
		crystal: {
			quotaKind: APP_STORAGE_KIND,
			appId: scope.appId,
			usedBytes: 0,
			storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
			// A registered-app counter can be missing while legacy namespace
			// content already exists. Never certify a guessed zero merely
			// because an app manager edited this user's allowance first.
			// The first registered write/recovery reconciles the whole app;
			// isolated sandbox counters have no legacy corpus to migrate.
			storageLedgerStatus: scope.sandbox ? USER_STORAGE_STATUS.ready : USER_STORAGE_STATUS.needsReconcile,
			...(scope.sandbox ? { storageReconciledAt: now } : {}),
			storageUpdatedAt: now
		},
		ownerId: scope.ownerId,
		acl: [ACL_OWNER],
		targetId: null,
		tags: [],
		createdAt: now,
		updatedAt: now,
		// a sandbox namespace's ledger dies with its namespace
		...(scope.sandbox ? { sandboxExpiresAt: new Date(now.getTime() + SANDBOX_TOKEN_TTL_MS) } : {})
	}
});

export const ensureAppStorageCounter = async (scope: AppNamespaceScope, session?: any): Promise<boolean> => {
  const things = await getThingsCollection();
	const plan = appStorageCounterUpsertPlan(scope);
  try {
		const result = await things.findOneAndUpdate(
			plan.match,
			{ $setOnInsert: plan.setOnInsert },
			{
				upsert: true,
				returnDocument: 'after',
				includeResultMetadata: true,
				...(session ? { session } : {})
			}
		);
		const existing = result?.value;
		if (!appStorageCounterEnvelopeIsTrusted(existing, scope)) {
			throw new StorageMutationError(
				503,
				'storage_invariant',
				'The reserved app-storage ledger id is occupied by an untrusted Thing and requires admin migration'
			);
		}
		return result?.lastErrorObject?.updatedExisting === false;
  } catch (err: any) {
		// Outside a transaction, a duplicate means another writer won the
		// deterministic upsert. Inside one, let the driver abort/retry the whole
		// transaction: continuing after a duplicate-key abort would make later
		// ledger writes look successful even though the session cannot commit.
		if (session || err?.code !== 11000) throw err;
		const existing = await things.findOne(plan.match);
		if (appStorageCounterEnvelopeIsTrusted(existing, scope)) return false;
		throw new StorageMutationError(
			503,
			'storage_invariant',
			'The reserved app-storage ledger id is occupied by an untrusted Thing and requires admin migration'
		);
  }
};

type AppStorageSourceRow = { _id?: unknown; bytes?: unknown; invalid?: unknown };

export type AppStorageReconciliationPlan = {
	usedBytes: number;
	ownerTotals: Array<{ ownerId: string; usedBytes: number }>;
	staleOwnerIds: string[];
};

const appStorageSourceInvariant = (): StorageMutationError =>
	new StorageMutationError(503, 'storage_invariant', 'App storage source documents require the current storage migration before reconciliation');

// Pure normalization shared by the Mongo repair and focused tests. The
// aggregation is expected to produce one row per owner, but every boundary is
// still validated before an absolute ledger value can become authoritative.
export const appStorageReconciliationPlan = (
	rows: readonly AppStorageSourceRow[],
	existingOwnerIds: readonly unknown[] = []
): AppStorageReconciliationPlan => {
	const compareOwnerIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
	const bytesByOwner = new Map<string, number>();
	for (const row of rows) {
		const ownerId = typeof row?._id === 'string' ? row._id : '';
		const bytes = row?.bytes;
		const invalid = row?.invalid ?? 0;
		if (
			!ownerId ||
			ownerId.startsWith('sandbox:') ||
			typeof bytes !== 'number' ||
			!Number.isSafeInteger(bytes) ||
			bytes < 0 ||
			typeof invalid !== 'number' ||
			!Number.isSafeInteger(invalid) ||
			invalid !== 0
		) {
			throw appStorageSourceInvariant();
		}
		const combined = (bytesByOwner.get(ownerId) ?? 0) + bytes;
		if (!Number.isSafeInteger(combined)) throw appStorageSourceInvariant();
		bytesByOwner.set(ownerId, combined);
	}

	const ownerTotals = [...bytesByOwner]
		.sort(([left], [right]) => compareOwnerIds(left, right))
		.map(([ownerId, usedBytes]) => ({ ownerId, usedBytes }));
	let usedBytes = 0;
	for (const entry of ownerTotals) {
		usedBytes += entry.usedBytes;
		if (!Number.isSafeInteger(usedBytes)) throw appStorageSourceInvariant();
	}
	const staleOwnerIds = [...new Set(existingOwnerIds.filter((value): value is string => typeof value === 'string' && !!value))]
		.filter((ownerId) => !bytesByOwner.has(ownerId))
		.sort(compareOwnerIds);
	return { usedBytes, ownerTotals, staleOwnerIds };
};

export type AppStorageAdmissionLedgerDecision = 'ready' | 'reconcile' | 'blocked';

export const appStorageLedgerNeedsBaseline = (crystal: any): boolean =>
	crystal?.storageAccountingVersion !== APP_STORAGE_ACCOUNTING_VERSION || crystal?.storageLedgerStatus !== USER_STORAGE_STATUS.ready;

// Missing status is the one backward-compatible ready shape: version 1 app
// records existed before the explicit status fence. Only an exact
// needs-reconcile marker opts into automatic repair; initializing, malformed
// statuses and unknown versions stay migration-required and fail closed.
export const appStorageAdmissionLedgerDecision = (appCrystal: any, counterCrystal: any): AppStorageAdmissionLedgerDecision => {
	if (
		appCrystal?.storageAccountingVersion !== APP_STORAGE_ACCOUNTING_VERSION ||
		counterCrystal?.storageAccountingVersion !== APP_STORAGE_ACCOUNTING_VERSION
	) {
		return 'blocked';
	}
	const statuses = [appCrystal?.storageLedgerStatus, counterCrystal?.storageLedgerStatus];
	if (statuses.some((status) => status !== USER_STORAGE_STATUS.ready && status !== USER_STORAGE_STATUS.needsReconcile)) return 'blocked';
	return statuses.includes(USER_STORAGE_STATUS.needsReconcile) ? 'reconcile' : 'ready';
};

// Reads and admission must agree on what constitutes an authoritative
// app-user counter. Otherwise a malformed value can render as a reassuring
// ready/zero total even while the next positive write correctly refuses it.
export const appStorageCounterCrystalIsReady = (crystal: any): boolean => {
	if (!isPlainObject(crystal)) return false;
	const allowance = crystal.storageAllowanceBytes;
	return (
		hasExactKeys(crystal, APP_STORAGE_COUNTER_CRYSTAL_KEYS) &&
		crystal.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION &&
		crystal.storageLedgerStatus === USER_STORAGE_STATUS.ready &&
		isNonNegativeSafeInteger(crystal.usedBytes) &&
		(allowance === undefined || allowance === null || isNonNegativeSafeInteger(allowance))
	);
};

export const appStorageCounterProjectionIsReady = (counter: any, scope: AppNamespaceScope): boolean => {
	// Absence is not a counter. Even when no namespace content is currently
	// visible, projecting an inferred zero would create a second display source
	// and hide a deleted/corrupt ledger. First write or migration creates the
	// protected row; until then reads are explicitly unavailable.
	if (!counter) return false;
	return appStorageCounterEnvelopeIsTrusted(counter, scope) && appStorageCounterCrystalIsReady(counter.crystal);
};

const appStorageSourcePipeline = (appId: string): Record<string, unknown>[] => {
	const exactStampedSize = {
		$and: [
			{ $eq: ['$schemaVersion', COLLECTION_SCHEMA_VERSIONS.things] },
			{ $isArray: '$thingtime' },
			{ $eq: ['$storageClass', 'content'] },
			{ $eq: ['$storageAccountingVersion', USER_STORAGE_ACCOUNTING_VERSION] },
    {
				$cond: [
					{ $isNumber: '$sizeBytes' },
					{
						$and: [{ $gte: ['$sizeBytes', 0] }, { $lte: ['$sizeBytes', Number.MAX_SAFE_INTEGER] }, { $eq: ['$sizeBytes', { $trunc: '$sizeBytes' }] }]
					},
					false
				]
    }
  ]
	};
	return [
		{ $match: { appId } },
		{ $match: { $expr: nonSandboxStorageCandidateExpression } },
		{
			$set: {
				__appStorageSourceValid: { $and: [realStorageSourceExpression, exactStampedSize] }
			}
		},
		{
			$group: {
				_id: '$ownerId',
				bytes: { $sum: { $cond: ['$__appStorageSourceValid', '$sizeBytes', 0] } },
				invalid: { $sum: { $cond: ['$__appStorageSourceValid', 0, 1] } }
			}
		}
	];
};

const registeredAppStorageLedgersMatch = (appId: string): Record<string, unknown> => ({
	schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
	thingtime: [APP_STORAGE_KIND],
	ownerId: { $type: 'string' },
	acl: [ACL_OWNER],
	targetId: null,
	tags: [],
	createdAt: { $type: 'date' },
	updatedAt: { $type: 'date' },
	storageLedgerEnvelopeVersion: APP_STORAGE_LEDGER_ENVELOPE_VERSION,
	'crystal.quotaKind': APP_STORAGE_KIND,
	'crystal.appId': appId,
	'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
	'crystal.storageLedgerStatus': {
		$in: [USER_STORAGE_STATUS.ready, USER_STORAGE_STATUS.needsReconcile, USER_STORAGE_STATUS.initializing]
	},
	appId: { $exists: false },
	sizeBytes: { $exists: false },
	storageClass: { $exists: false },
	storageAccountingVersion: { $exists: false },
	sandboxExpiresAt: { $exists: false },
	$and: [{ $expr: exactAppStorageCounterExpression() }]
});

export type AppStorageReconciliation = {
	appId: string;
	usedBytes: number;
	userLedgers: number;
	zeroedLedgers: number;
	reconciledAt: Date;
};

const reconcileAppStorageInSession = async (appId: string, session: any): Promise<AppStorageReconciliation> => {
  const things = await getThingsCollection();
	const appMatch = {
		thingtime: 'app',
		'crystal.clientId': appId,
		'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION
	};
	const app = await things.findOne(appMatch, { session });
	const appStatus = app?.crystal?.storageLedgerStatus;
	const appHasValidPolicyFields =
		!!app &&
		appStoragePolicyOf({
			...app,
			crystal: { ...app.crystal, storageLedgerStatus: USER_STORAGE_STATUS.ready }
		}).ready;
	if (
		!appHasValidPolicyFields ||
		(appStatus !== USER_STORAGE_STATUS.ready && appStatus !== USER_STORAGE_STATUS.needsReconcile && appStatus !== USER_STORAGE_STATUS.initializing)
	) {
		throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting requires the current storage migration');
	}

	const rows = (await things.aggregate(appStorageSourcePipeline(appId), { session }).toArray()) as AppStorageSourceRow[];
	const existingLedgers = await things.find(registeredAppStorageLedgersMatch(appId), { session }).project({ ownerId: 1 }).toArray();
	const plan = appStorageReconciliationPlan(
		rows,
		existingLedgers.map((ledger: any) => ledger.ownerId)
	);
	const now = new Date();

	// The app aggregate is the serialization point shared with every normal
	// registered-app mutation. A concurrent writer forces the transaction to
	// retry from its content snapshot instead of allowing a stale total.
	const repairedApp = await things.findOneAndUpdate(
		appMatch,
    {
			$set: {
				'crystal.storageUsedBytes': plan.usedBytes,
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
				'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
				'crystal.storageReconciledAt': now,
				'crystal.storageUpdatedAt': now
      }
    },
		{ session, returnDocument: 'after' }
  );
	if (!repairedApp) {
		throw new StorageMutationError(503, 'accounting_unavailable', 'The registered app storage ledger is missing');
  }

	// Counters with no remaining source documents must become exactly zero;
	// otherwise conservative delete underflows would stay stranded forever.
	await things.updateMany(
		registeredAppStorageLedgersMatch(appId),
		{
			$set: {
				'crystal.usedBytes': 0,
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
				'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
				'crystal.storageReconciledAt': now,
				'crystal.storageUpdatedAt': now,
				updatedAt: now
			}
		},
		{ session }
	);

	for (const total of plan.ownerTotals) {
		const scope: AppNamespaceScope = {
			appId,
			ownerId: total.ownerId,
			sharedRead: false,
			scopes: [],
			username: '',
			sandbox: null
		};
		await ensureAppStorageCounter(scope, session);
		const repaired = await things.updateOne(
			storageMatch(scope),
			{
				$set: {
					'crystal.usedBytes': total.usedBytes,
					'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
					'crystal.storageReconciledAt': now,
					'crystal.storageUpdatedAt': now,
					updatedAt: now
				}
			},
			{ session }
		);
		if (!repaired.matchedCount) {
			throw new StorageMutationError(503, 'accounting_unavailable', 'An app-user storage ledger is missing');
		}
	}

  return {
		appId,
		usedBytes: plan.usedBytes,
		userLedgers: plan.ownerTotals.length,
		zeroedLedgers: plan.staleOwnerIds.length,
		reconciledAt: now
  };
};

export const reconcileAppStorage = async (appId: string): Promise<AppStorageReconciliation> => {
	if (typeof appId !== 'string' || !appId.trim()) throw appStorageSourceInvariant();
	return withMongoTransaction((session) => reconcileAppStorageInSession(appId.trim(), session));
};

export type OrphanAppStorageReconciliation = {
	appId: string;
	usedBytes: number;
	userLedgers: number;
	zeroedLedgers: number;
	convertedLedgers: number;
	createdLedgers: number;
	reconciledAt: Date;
};

// Semantic wrapper used by the orphan migration helper and its database-free
// tests. Existing counter owners absent from the source sum are deliberately
// returned as stale so their canonical ledgers can be reset to exactly zero.
export const orphanAppStorageReconciliationPlan = (
	rows: readonly AppStorageSourceRow[],
	existingOwnerIds: readonly unknown[] = []
): AppStorageReconciliationPlan => appStorageReconciliationPlan(rows, existingOwnerIds);

const orphanAppInvariant = (message: string): StorageMutationError => new StorageMutationError(503, 'storage_invariant', message);

// Migration-only repair for app namespaces whose aggregate app Thing was
// deleted. It must never run for a live app: doing so would update user
// counters without serializing the aggregate ledger. Historical counters are
// canonicalized first, then every current source owner is set to its exact
// stamped sum and every stale counter is zeroed in the same transaction.
export const reconcileOrphanAppStorage = async (rawAppId: string): Promise<OrphanAppStorageReconciliation> => {
	const appId = typeof rawAppId === 'string' ? rawAppId.trim() : '';
	if (!appId) throw orphanAppInvariant('Orphan app storage reconciliation requires a valid app id');

	return withMongoTransaction(async (session) => {
		const things = await getThingsCollection();
		const liveApp = await things.findOne({ thingtime: 'app', 'crystal.clientId': appId }, { projection: { _id: 1 }, session });
		if (liveApp) {
			throw orphanAppInvariant('Orphan app storage reconciliation refuses a live app; use aggregate app reconciliation instead');
		}

		const rows = (await things.aggregate(appStorageSourcePipeline(appId), { session }).toArray()) as AppStorageSourceRow[];
		const candidates = await things
			.find(
    {
					shareId: {
						$gte: APP_STORAGE_RESERVED_ID_PREFIX,
						$lt: `${APP_STORAGE_RESERVED_ID_PREFIX}\uffff`
					},
					'crystal.quotaKind': APP_STORAGE_KIND,
					'crystal.appId': appId,
					sandboxExpiresAt: { $exists: false }
				},
				{ session }
			)
			.toArray();

		const candidateOwnerIds: string[] = [];
		for (const candidate of candidates) {
			// Defense in depth for alternate collection adapters/tests: a forged
			// quotaKind on an ordinary non-reserved app Thing remains billable
			// source content and is not promoted into a counter candidate.
			if (!isAppStorageCounterCandidateId(candidate.shareId)) continue;
			const ownerId = typeof candidate.ownerId === 'string' ? candidate.ownerId : '';
			if (!ownerId || ownerId.startsWith('sandbox:')) throw historicalCounterInvariant();
			const scope: AppNamespaceScope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
			if (!appStorageCounterEnvelopeIsTrusted(candidate, scope)) {
				// Plan-only validation proves this is the exact historical envelope;
				// conversion itself happens below with a compare-and-swap.
				historicalAppStorageCounterConversionPlan(candidate, ownerId, appId);
			}
			candidateOwnerIds.push(ownerId);
        }

		const plan = orphanAppStorageReconciliationPlan(rows, candidateOwnerIds);
		const bytesByOwner = new Map(plan.ownerTotals.map(({ ownerId, usedBytes }) => [ownerId, usedBytes]));
		const owners = [...new Set([...bytesByOwner.keys(), ...plan.staleOwnerIds])].sort();
		let convertedLedgers = 0;
		let createdLedgers = 0;
		const now = new Date();

		for (const ownerId of owners) {
			const converted = await convertHistoricalAppStorageCounterInSession(ownerId, appId, session);
			if (converted.status === 'converted') convertedLedgers += 1;
			const scope: AppNamespaceScope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
			if (converted.status === 'missing') {
				if (await ensureAppStorageCounter(scope, session)) createdLedgers += 1;
      }
			const repaired = await things.updateOne(
				storageMatch(scope),
				{
					$set: {
						'crystal.usedBytes': bytesByOwner.get(ownerId) ?? 0,
						'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
						'crystal.storageReconciledAt': now,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
    }
				},
				{ session }
			);
			if (repaired.matchedCount !== 1) throw historicalCounterInvariant();
		}

		return {
			appId,
			usedBytes: plan.usedBytes,
			userLedgers: plan.ownerTotals.length,
			zeroedLedgers: plan.staleOwnerIds.length,
			convertedLedgers,
			createdLedgers,
			reconciledAt: now
		};
	});
};

const readyAppStorageMatch = (appId: string) => ({
	thingtime: 'app',
	'crystal.clientId': appId,
	'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
	'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
	$expr: {
		$and: [
			safeWholeNumberExpression('$crystal.storageUsedBytes'),
			safeWholeNumberExpression('$crystal.userStorageAllowanceBytes'),
			{
				$or: [{ $eq: ['$crystal.storageAllowanceBytes', null] }, safeWholeNumberExpression('$crystal.storageAllowanceBytes')]
			}
		]
	}
});

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
			$and: [
				storageMatch(scope),
				...(!scope.sandbox
					? [{ 'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION }, healthyStorageLedgerStatusMatch('crystal.storageLedgerStatus')]
					: []),
				{
      $expr: {
        $lte: [{ $add: [{ $ifNull: ['$crystal.usedBytes', 0] }, deltaBytes] }, effectiveAllowance]
      }
				}
			]
    },
    {
      $inc: { 'crystal.usedBytes': deltaBytes },
			$set: {
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
				'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
				updatedAt: new Date()
			}
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

const healthyStorageLedgerStatusMatch = (field: string): Record<string, unknown> => ({
	[field]: USER_STORAGE_STATUS.ready
});

const transactionalReadyAppStorageMatch = (appId: string): Record<string, unknown> => ({
	$and: [readyAppStorageMatch(appId)]
});

const rethrowStorageMutationFailure = (error: unknown): never => {
	if (error instanceof StorageMutationError) throw error;
	// Preserve the driver's retry contract. withTransaction can only retry a
	// transient callback when it sees Mongo's original labelled error.
	if (
		error &&
		typeof error === 'object' &&
		typeof (error as { hasErrorLabel?: unknown }).hasErrorLabel === 'function' &&
		(error as { hasErrorLabel(label: string): boolean }).hasErrorLabel('TransientTransactionError')
	) {
		throw error;
	}
	throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting is unavailable — try again');
};

const explainAppStorageAdmissionFailure = async (scope: AppNamespaceScope, deltaBytes: number, session: any): Promise<never> => {
	const app = await (await getThingsCollection()).findOne({ thingtime: 'app', 'crystal.clientId': scope.appId }, { session });
	const policy = appStoragePolicyOf(app);
	const status = app?.crystal?.storageLedgerStatus;
	if (!app || !policy.ready || status !== USER_STORAGE_STATUS.ready) {
		throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting is being initialized or reconciled — try again shortly');
	}
	if (policy.storageAllowanceBytes !== null && policy.storageUsedBytes + deltaBytes > policy.storageAllowanceBytes) {
		throw new StorageMutationError(
			507,
			'quota_exceeded',
			`This would exceed the app storage allowance (${policy.storageUsedBytes} of ${policy.storageAllowanceBytes} bytes used across all users)`
		);
	}
	throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting is unavailable — try again');
};

const explainAppUserStorageAdmissionFailure = async (
	scope: AppNamespaceScope,
	deltaBytes: number,
	appPolicy: ReturnType<typeof appStoragePolicyOf>,
	session: any
): Promise<never> => {
	const counter = await (await getThingsCollection()).findOne(storageMatch(scope), { session });
	if (!counter || !appStorageCounterCrystalIsReady(counter.crystal)) {
		throw new StorageMutationError(
			503,
			'accounting_unavailable',
			'App-user storage accounting is being initialized or reconciled — try again shortly'
		);
	}
	const usedBytes = storedByteCount(counter.crystal?.usedBytes, 0);
	const allowanceBytes = effectiveAppUserAllowance(
		appPolicy.userStorageAllowanceBytes,
		counter.crystal?.storageAllowanceBytes,
		appPolicy.storageAllowanceBytes
	);
	if (usedBytes + deltaBytes > allowanceBytes) {
		throw new StorageMutationError(
			507,
			'quota_exceeded',
			`This would exceed the app storage allowance for this user (${usedBytes} of ${allowanceBytes} bytes used)`
		);
	}
	throw new StorageMutationError(503, 'accounting_unavailable', 'App-user storage accounting is unavailable — try again');
};

// Apply one registered-app namespace delta inside the caller's ACTIVE Mongo
// transaction. Both dimensions use the same session and the same lock order
// (app aggregate, then app-user), so a thrown error aborts both increments.
// Callers must let StorageMutationError escape their withTransaction callback.
// Sandboxes deliberately remain on their existing namespace + write-burn path.
export const applyAppStorageDeltaTransaction = async (scope: AppNamespaceScope, deltaBytes: number, session: any): Promise<void> => {
	if (scope.sandbox || deltaBytes === 0) return;
	if (!Number.isSafeInteger(deltaBytes)) {
		throw new StorageMutationError(503, 'storage_invariant', 'App storage delta must be an exact whole number of bytes');
	}
	if (!session || (typeof session.inTransaction === 'function' && !session.inTransaction())) {
		throw new StorageMutationError(503, 'accounting_unavailable', 'App storage mutation requires an active transaction');
	}

	try {
		const things = await getThingsCollection();
		const now = new Date();

		if (deltaBytes > 0) {
			await ensureAppStorageCounter(scope, session);

			const appLedger = await things.findOne(
				{ thingtime: 'app', 'crystal.clientId': scope.appId },
				{ projection: { 'crystal.storageAccountingVersion': 1, 'crystal.storageLedgerStatus': 1 }, session }
			);
			const userLedger = await things.findOne(storageMatch(scope), {
				projection: { 'crystal.storageAccountingVersion': 1, 'crystal.storageLedgerStatus': 1 },
				session
			});
			const ledgerDecision = appStorageAdmissionLedgerDecision(appLedger?.crystal, userLedger?.crystal);
			if (ledgerDecision === 'blocked') {
				throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting requires the current storage migration');
			}
			if (ledgerDecision === 'reconcile') {
				// The pending content is not visible in this snapshot yet: repair the
				// exact pre-mutation totals, then apply deltaBytes once below.
				await reconcileAppStorageInSession(scope.appId, session);
			}

			const app = await things.findOneAndUpdate(
				{
					...transactionalReadyAppStorageMatch(scope.appId),
					$expr: {
						$or: [
							{ $eq: ['$crystal.storageAllowanceBytes', null] },
							{ $lte: [{ $add: ['$crystal.storageUsedBytes', deltaBytes] }, '$crystal.storageAllowanceBytes'] }
						]
					}
				} as any,
				{
					$inc: { 'crystal.storageUsedBytes': deltaBytes },
					$set: {
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
						'crystal.storageUpdatedAt': now
					}
				},
				{ session, returnDocument: 'after' }
			);
			if (!app) await explainAppStorageAdmissionFailure(scope, deltaBytes, session);

			const policy = appStoragePolicyOf(app);
			if (!policy.ready) {
				throw new StorageMutationError(503, 'accounting_unavailable', 'App storage accounting is unavailable — try again');
			}
			const configuredAllowance = { $ifNull: ['$crystal.storageAllowanceBytes', policy.userStorageAllowanceBytes] };
			const effectiveAllowance =
				policy.storageAllowanceBytes === null ? configuredAllowance : { $min: [configuredAllowance, policy.storageAllowanceBytes] };
			const user = await things.findOneAndUpdate(
				{
					$and: [
						storageMatch(scope),
						{ 'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION },
						healthyStorageLedgerStatusMatch('crystal.storageLedgerStatus'),
						{
							$expr: {
								$and: [
									safeWholeNumberExpression('$crystal.usedBytes'),
									{
										$or: [
											{ $eq: [{ $type: '$crystal.storageAllowanceBytes' }, 'missing'] },
											{ $eq: ['$crystal.storageAllowanceBytes', null] },
											safeWholeNumberExpression('$crystal.storageAllowanceBytes')
										]
									},
									safeWholeNumberExpression(effectiveAllowance as any),
									{ $lte: [{ $add: ['$crystal.usedBytes', deltaBytes] }, effectiveAllowance] }
								]
							}
						}
					]
				} as any,
				{
					$inc: { 'crystal.usedBytes': deltaBytes },
					$set: {
						'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
					}
				},
				{ session, returnDocument: 'after' }
			);
			if (!user) await explainAppUserStorageAdmissionFailure(scope, deltaBytes, policy, session);
			return;
		}

		const bytes = -deltaBytes;
		const app = await things.findOneAndUpdate(
			{
				thingtime: 'app',
				'crystal.clientId': scope.appId,
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
				'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
				'crystal.storageUsedBytes': { $gte: bytes },
				$expr: safeWholeNumberExpression('$crystal.storageUsedBytes')
			},
			{
				$inc: { 'crystal.storageUsedBytes': -bytes },
				$set: { 'crystal.storageUpdatedAt': now }
			},
			{ session, returnDocument: 'after' }
		);
		if (!app) {
			// Never floor an inconsistent aggregate: retaining its old value is
			// conservative, and the marker fences positive growth until repair.
			await things.updateOne(
				{ thingtime: 'app', 'crystal.clientId': scope.appId },
				{
					$set: {
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
						'crystal.storageUpdatedAt': now
					}
				},
				{ session }
			);
		}

		const user = await things.findOneAndUpdate(
			{
				...storageMatch(scope),
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
				'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
				'crystal.usedBytes': { $gte: bytes },
				$expr: safeWholeNumberExpression('$crystal.usedBytes')
			} as any,
			{
				$inc: { 'crystal.usedBytes': -bytes },
				$set: { 'crystal.storageUpdatedAt': now, updatedAt: now }
			},
			{ session, returnDocument: 'after' }
		);
		if (!user) {
			await things.updateOne(
				storageMatch(scope),
				{
					$set: {
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
					}
				},
				{ session }
			);
		}
	} catch (error) {
		rethrowStorageMutationFailure(error);
	}
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
	// The authoritative whole Thingtime-account total. appStorage/userStorage
	// above are overlapping app-specific sub-limits and are never added to it.
	accountStorage: Awaited<ReturnType<typeof getUserStorageUsage>> | null;
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
	const [counter, app, accountStorage] = await Promise.all([
		// Fetch by reserved id, not by the trusted match. A malformed/foreign
		// occupant must make the projection unavailable; treating "trusted query
		// found nothing" as an ordinary zero counter would hide the collision.
		things.findOne({ shareId: storageShareId(scope.ownerId, scope.appId) }),
		scope.sandbox ? Promise.resolve(null) : findAppByClientId(scope.appId),
		scope.sandbox ? Promise.resolve(null) : getUserStorageUsage(scope.ownerId)
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
	const appStatus = app?.crystal?.storageLedgerStatus;
	const counterReady = appStorageCounterProjectionIsReady(counter, scope);
	const storageAccountingReady =
		policy.ready && appStatus === USER_STORAGE_STATUS.ready && counterReady && accountStorage?.status === USER_STORAGE_STATUS.ready;
  return {
    usedBytes: userStorage.usedBytes,
    budgetBytes: userStorage.allowanceBytes,
    remainingBytes: userStorage.remainingBytes,
    userStorage,
    appStorage,
		accountStorage,
		storageAccountingReady: scope.sandbox ? counterReady : storageAccountingReady
  };
};

export const appStorageBudgetBytes = async (scope: AppNamespaceScope): Promise<number> =>
  (await getAppStorageUsage(scope)).userStorage.allowanceBytes;

export type StorageCharge = ({ ok: true } & AppStorageUsage) | Fail;

// Ephemeral sandbox admission only. Registered app content must use
// applyAppStorageDeltaTransaction in the SAME transaction as its source write;
// keeping that path out of this compensating non-transactional helper makes a
// future caller fail closed instead of quietly creating a split-brain ledger.
export const chargeAppStorage = async (scope: AppNamespaceScope, deltaBytes: number): Promise<StorageCharge> => {
	if (!scope.sandbox) {
		return fail(500, 'Registered app storage mutations require the transactional content-write path');
	}
  try {
    if (deltaBytes <= 0) {
      const bytes = Math.max(0, -deltaBytes);
			await refundUserStorage(scope, bytes, true);
      return { ok: true, ...(await getAppStorageUsage(scope)) };
    }

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
	if (allowanceBytes !== null && (!Number.isSafeInteger(allowanceBytes) || allowanceBytes < 0)) {
		throw new StorageMutationError(400, 'storage_invariant', 'App-user storage allowance must be an exact non-negative byte count');
	}
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
				'crystal.storageAllowanceBytes': allowanceBytes,
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
	if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) throw appStorageSourceInvariant();
	return withMongoTransaction(async (session) => {
  const scope: AppNamespaceScope = { appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null };
  const things = await getThingsCollection();
		const existing = await things.findOne(storageMatch(scope), {
			projection: { 'crystal.storageAccountingVersion': 1, 'crystal.storageLedgerStatus': 1 },
			session
		});
		if (options.onlyIfNotLive && !appStorageLedgerNeedsBaseline(existing?.crystal)) {
			return false;
		}
		await ensureAppStorageCounter(scope, session);
		const now = new Date();
  const result = await things.updateOne(
			storageMatch(scope),
    {
				$set: {
					'crystal.usedBytes': usedBytes,
					'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
					'crystal.storageReconciledAt': now,
					'crystal.storageUpdatedAt': now,
					updatedAt: now
    }
			},
			{ session }
  );
  return result.matchedCount > 0;
	});
};

// Bootstrap one legacy app exactly once. Positive writes require the version
// marker plus the three policy fields, so they remain fail-closed while the
// migration reconciles user ledgers; the aggregate is enabled last.
export const initializeAppStorageAccounting = async (appId: string, usedBytes: number): Promise<boolean> => {
  const things = await getThingsCollection();
	const candidate = await things.findOne(
		{ thingtime: 'app', 'crystal.clientId': appId },
    {
			projection: {
				'crystal.subscriptionTier': 1,
				'crystal.storageAccountingVersion': 1,
				'crystal.storageLedgerStatus': 1
			}
		}
  );
	if (!candidate) return false;
	if (candidate.crystal?.storageAccountingVersion === APP_STORAGE_ACCOUNTING_VERSION) {
		if (candidate.crystal?.storageLedgerStatus === USER_STORAGE_STATUS.ready) return false;
		await reconcileAppStorage(appId);
		return true;
	}
	if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) throw appStorageSourceInvariant();
	const legacyApp = candidate;
  const legacyTierId = legacyApp.crystal?.subscriptionTier;
  const staticLegacyTier = isKnownSubscriptionTier(legacyTierId) ? subscriptionTierById(legacyTierId) : null;
  const exactStaticLegacyTier = staticLegacyTier ? await getSubscriptionTierVersion(staticLegacyTier.versionId) : null;
  const resolvedLegacyTier = exactStaticLegacyTier ?? (await getLiveSubscriptionTier(legacyTierId));
  const liveDefault = resolvedLegacyTier ?? (await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER));
  const defaultSnapshot = tierAssignmentSnapshot(liveDefault ?? staticLegacyTier ?? subscriptionTierById(DEFAULT_SUBSCRIPTION_TIER));
	const now = new Date();
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
					'crystal.storageUsedBytes': usedBytes,
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
					'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready,
					'crystal.storageReconciledAt': now,
					'crystal.storageUpdatedAt': now
        }
      }
    ],
    { returnDocument: 'after' }
  );
  return !!initialized;
};
