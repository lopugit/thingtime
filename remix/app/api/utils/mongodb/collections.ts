import { getMongoUri } from './config';
import { getActiveMongoDbName, getActiveMongoUri, isCustomMongoEndpointActive } from './endpoint';
import { getMongoDb } from './mongodb';
import { COLLECTIONS, physicalCollectionName } from './collectionNames';

export { COLLECTIONS, physicalCollectionName, versionedCollectionName, collectionVersion } from './collectionNames';

// Memoised clients keyed by connection URI so a single request (and a warm
// serverless instance) reuses one connection per endpoint instead of opening a
// new MongoClient per collection lookup. The home deployment's client is
// pinned; custom endpoint clients (the request-scoped override — see
// endpoint.ts) are kept LRU-bounded so an API client cycling many URLs can't
// accumulate unbounded open connections.
const clientCache = new Map<string, Promise<any>>();
const MAX_CUSTOM_CLIENTS = 6;

const getClientCachedFor = (uri: string, isHome: boolean) => {
  const cached = clientCache.get(uri);
  if (cached) {
    // LRU touch — Map iteration order is insertion order
    clientCache.delete(uri);
    clientCache.set(uri, cached);
    return cached;
  }

  const entry = (async () => {
    const { MongoClient } = await getMongoDb();
    // Home gets serverless-tuned options: driver defaults are maxPoolSize 100
    // and a 30s serverSelection timeout — on Atlas M0 (hard ~500-connection
    // cap) a burst of instances each opening tens of connections (the
    // boot-time index ensure is a ~55-command Promise.all) risks the cap, and
    // an unreachable cluster would stall every request 30s instead of failing
    // fast. appName makes this app attributable in Atlas metrics. Custom
    // endpoints get tight timeouts so an unreachable override fails a request
    // in seconds instead of hanging it on driver defaults.
    const client = new MongoClient(
      uri,
      isHome
        ? {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            appName: 'thingtime-api'
          }
        : { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 }
    );
    await client.connect();
    return client;
  })().catch((err) => {
    // don't cache a failed connection — let the next call retry
    clientCache.delete(uri);
    throw err;
  });
  clientCache.set(uri, entry);

  // Evict the oldest custom clients beyond the cap (never the home client).
  let homeUri: string | null = null;
  try {
    homeUri = getMongoUri();
  } catch {
    // home unconfigured — everything counts as custom for eviction purposes
  }
  const customUris = [...clientCache.keys()].filter((key) => key !== homeUri);
  for (const staleUri of customUris.slice(0, Math.max(0, customUris.length - MAX_CUSTOM_CLIENTS))) {
    const stale = clientCache.get(staleUri);
    clientCache.delete(staleUri);
    customIndexesEnsured.delete(staleUri);
    stale?.then((client: any) => client.close()).catch(() => {});
  }

  return entry;
};

// Run one logical mutation against MongoDB's transaction retry contract. The
// driver's withTransaction helper retries TransientTransactionError callbacks
// and UnknownTransactionCommitResult commits with the same session. Storage
// accounting deliberately has no non-transactional fallback: allowing a
// content write when one of its ledgers could not commit would create a silent
// under-count. Atlas replica sets support transactions; an unsupported local
// deployment therefore fails the write loudly instead of weakening the
// invariant.
export const withMongoTransaction = async <T>(work: (session: any) => Promise<T>): Promise<T> => {
	const client = await getClientCached();
	const session = client.startSession();
	let result!: T;
	try {
		await session.withTransaction(
			async () => {
				result = await work(session);
			},
			{
				readConcern: { level: 'snapshot' },
				writeConcern: { w: 'majority' },
				readPreference: 'primary'
			}
		);
		return result;
	} finally {
		await session.endSession();
	}
};

// Issues the last adoption pass could not resolve (rename unsupported /
// unauthorized). Surfaced through the admin migrations census so a split
// (legacy collection still holding data beside its versioned successor) is
// loudly visible, never silent.
let adoptionIssues: string[] = [];
export const getAdoptionIssues = () => [...adoptionIssues];

// Adopt physical collection versioning on first db contact: any legacy
// unversioned collection ("things") whose current versioned name ("things_v2")
// doesn't exist yet is renamed in place — instant, index-preserving, no doc
// copying — before any caller can touch a collection handle. Steady state
// (nothing unversioned left) is a single listCollections round trip.
//
// If BOTH names exist (another instance renamed first and writes already
// landed, or rename is unavailable on this tier and a previous pass fell
// through), the rename is skipped and the admin-run merge-legacy-collections
// migration folds the residue forward instead. Rename failures are recorded,
// never thrown — a degraded adoption must not take the whole API down.
const adoptVersionedCollections = async (db: any) => {
  const names = new Set<string>((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name));
  const issues: string[] = [];
  for (const logical of COLLECTIONS) {
    const physical = physicalCollectionName(logical);
    if (!names.has(logical)) continue;
    if (names.has(physical)) {
      issues.push(`${logical}: legacy collection still exists beside ${physical} — run merge-legacy-collections`);
      continue;
    }
    try {
      await db.renameCollection(logical, physical);
    } catch (err: any) {
      // 48 NamespaceExists / 26 NamespaceNotFound: another instance won the
      // rename race — either way the destination is in place
      if (err?.code === 48 || err?.code === 26) continue;
      // rename unavailable (Atlas M0 free tier) or unauthorized: leave the
      // legacy collection in place for the merge migration and say so
      issues.push(`${logical}: rename to ${physical} failed (${err?.codeName || err?.code || 'error'}) — run merge-legacy-collections`);
    }
  }
  adoptionIssues = issues;
};

// Home deployment database — identity, auth and every control-plane
// collection live here REGARDLESS of any active endpoint override. Single
// `thingtime` database (see FUNDAMENTALS.md §3). The memoised promise
// includes the adoption pass, so no caller can reach a collection handle
// before legacy names have been (re)checked.
let homeDbPromise: Promise<any> | null = null;

export const getHomeThingtimeDb = async () => {
  if (!homeDbPromise) {
    homeDbPromise = (async () => {
      const db = (await getClientCachedFor(getMongoUri(), true)).db('thingtime');
      await adoptVersionedCollections(db);
      return db;
    })().catch((err) => {
      // don't cache a failed connection/adoption — let the next call retry
      homeDbPromise = null;
      throw err;
    });
  }
  return homeDbPromise;
};

// Active data-plane database: the home db — unless the request carries a
// custom MongoDB endpoint override (endpoint.ts), in which case the
// override's URI + db name serve the open data plane for this request.
//
// The adoption pass deliberately does NOT run against a custom endpoint:
// renaming collections inside a user-supplied database (a foreign `users`
// collection would become `users_v1`) is not ours to do. An override DB is
// only ever read and written at the CURRENT generation, via the same
// physicalCollectionName mapping as home.
export const getThingtimeDb = async () => {
  if (!isCustomMongoEndpointActive()) return getHomeThingtimeDb();
  const uri = getActiveMongoUri();
  const db = (await getClientCachedFor(uri, false)).db(getActiveMongoDbName());
  ensureCustomDataIndexes(uri, db);
  return db;
};

// THE way to a collection handle: logical name in, current-generation physical
// collection out. Every read and write in the codebase goes through one of
// these two (or a named getter below), so nothing can touch a stale generation
// by accident. getCollection follows the request's ACTIVE endpoint (the open
// data plane); getHomeCollection is pinned to the home deployment and is what
// every identity / auth / control-plane getter uses.
export const getCollection = async (logical: string) =>
  (await getThingtimeDb()).collection(physicalCollectionName(logical));
export const getHomeCollection = async (logical: string) =>
  (await getHomeThingtimeDb()).collection(physicalCollectionName(logical));

export const getUsersCollection = async () => getHomeCollection('users');
export const getSessionsCollection = async () => getHomeCollection('sessions');
export const getRostersCollection = async () => getHomeCollection('rosters');
// The open `things` DATA PLANE (posts, comments, reactions, shares, data,
// schemas, app-data) follows the request's active endpoint override. Identity
// and the protected system kinds (user, theme, feed-algorithm, waitlist) are
// written by their dedicated utils through getHomeThingsCollection instead, so
// a custom endpoint can never capture logins or protected-kind writes.
export const getThingsCollection = async () => getCollection('things');
export const getHomeThingsCollection = async () => getHomeCollection('things');
export const getEmailVerificationsCollection = async () => getHomeCollection('emailVerifications');
export const getLopuMusingRateLimitsCollection = async () => getHomeCollection('lopuMusingRateLimits');
export const getThemesCollection = async () => getHomeCollection('themes');
export const getWaitlistCollection = async () => getHomeCollection('waitlist');
export const getFeedAlgorithmsCollection = async () => getHomeCollection('feedAlgorithms');
// Global, admin-editable app settings (singleton docs keyed by `key`, e.g. the
// rate-limit config) and the general per-endpoint rate-limit windows.
export const getSettingsCollection = async () => getHomeCollection('settings');
export const getRateLimitsCollection = async () => getHomeCollection('rateLimits');
// Owned email layer (see api/utils/email): every send writes an outbox row to
// email_messages; events/suppression/unsubscribes back deliverability.
export const getEmailMessagesCollection = async () => getHomeCollection('email_messages');
export const getEmailEventsCollection = async () => getHomeCollection('email_events');
export const getEmailTemplatesCollection = async () => getHomeCollection('email_templates');
export const getEmailSubscriptionsCollection = async () => getHomeCollection('email_subscriptions');
export const getEmailSuppressionListCollection = async () => getHomeCollection('email_suppression_list');
export const getEmailUnsubscribesCollection = async () => getHomeCollection('email_unsubscribes');
export const getEmailIdentitiesCollection = async () => getHomeCollection('email_identities');
// Single-use auth tokens: password-reset links and login OTP challenges, both
// TTL-reaped (mirrors emailVerifications).
export const getPasswordResetsCollection = async () => getHomeCollection('passwordResets');
export const getAuthOtpsCollection = async () => getHomeCollection('authOtps');
// Post view telemetry: one doc per (postId, viewerKey) — home-pinned so view
// counts (an anti-manipulation surface) stay under platform control even when
// a request carries a custom data-endpoint override.
export const getPostViewsCollection = async () => getHomeCollection('postViews');

// Idempotently create server-side collections + their indexes. createIndex
// creates the collection if it doesn't exist yet, so this also bootstraps an
// empty `thingtime` db on first run. Memoised so it runs at most once per
// process. The unique indexes are the real source of truth that
// usernames/emails/tokens can't be duplicated (the app-level findUser checks are
// racy on their own).
//
// WHO CALLS THIS: the boot-time warmup (server/plugins/mongo-warmup) fires it
// in the background on every fresh instance, and the true bootstrap paths
// (registerUser, admin migrations) still await it so a brand-new database
// converges before its first unique-constrained insert. Hot request paths
// deliberately do NOT call it — indexes only need creating once per database,
// and re-confirming ~55 of them inside user requests was the dominant
// cold-start cost (see PR: cold-start index battery).
let indexesEnsured: Promise<void> | null = null;

// Only in-flight and successful runs stay memoised. A failed boot warmup must
// not poison awaited bootstrap work for a fixed cooldown: the next explicit
// caller (registration or an admin migration) retries immediately. Hot request
// paths no longer call ensureIndexes, so clearing a failed run cannot recreate
// the old all-request retry storm.

// createIndex with different options than an existing same-key index throws
// IndexOptionsConflict (85) / IndexKeySpecsConflict (86). For indexes whose
// options evolve (partial filters, text weights/overrides), drop the old
// definition by name and recreate — idempotent, and the only alternative is a
// manual migration per deploy.
//
// Order matters for UNIQUE indexes: create the new index BEFORE dropping the
// legacy-named one. Dropping first opens a window with no index at all — for a
// unique index that means the uniqueness constraint briefly disappears, so
// racing upserts (e.g. reaction toggles) could insert duplicates. MongoDB (4.2+)
// lets same-key indexes with distinct names / partial-filter options coexist, so
// create-then-drop keeps a constraint active throughout the swap.
const createIndexReplacing = async (
  collection: any,
  keys: Record<string, any>,
  options: Record<string, any> & { name: string },
  legacyNames: string[] = []
) => {
  try {
    await collection.createIndex(keys, options);
  } catch (err: any) {
    if (err?.code !== 85 && err?.code !== 86) throw err;
    // The new spec conflicts with an existing index of the same name (evolved
    // options) or a legacy name (same spec, different name) — drop the conflicting
    // definitions and recreate. This is the only branch with a no-index window,
    // and it fires only when options genuinely changed (text weights/overrides),
    // never for the steady-state unique-index swap above.
    await collection.dropIndex(options.name).catch(() => {});
    for (const legacy of legacyNames) await collection.dropIndex(legacy).catch(() => {});
    await collection.createIndex(keys, options);
  }
  // New index is in place — now prune any legacy-named siblings of the same shape.
  for (const legacy of legacyNames) {
    if (legacy === options.name) continue;
    await collection.dropIndex(legacy).catch(() => {}); // absent = fine
  }
};

// Wrap a collection so createIndex failures carry `<logical>.<index name>`:
// Promise.all surfaces only the first rejection, and driver messages don't
// always name the index being built — so the boot-time ensure can report
// exactly which index broke. dropIndex passes straight through, so this wrapper
// is a drop-in for createIndexReplacing too.
const taggedCollection = (collection: any, logical: string) => ({
  dropIndex: (name: string) => collection.dropIndex(name),
  createIndex: async (keys: Record<string, any>, options?: Record<string, any>) => {
    try {
      return await collection.createIndex(keys, options);
    } catch (err: any) {
      const name =
        options?.name || Object.entries(keys).map(([field, dir]) => `${field}_${dir}`).join('_');
      if (err && typeof err === 'object') err.indexBeingBuilt = `${logical}.${name}`;
      throw err;
    }
  }
});

// The current-generation physical `things` handle for a db (home OR a custom
// endpoint): things → things_v2, so the data-plane indexes always land on
// exactly the collection reads and writes touch.
const thingsCollection = (db: any) => db.collection(physicalCollectionName('things'));

// Data-plane (`things`) index definitions, shared by the home ensure below and
// the lazy per-endpoint ensure for CUSTOM data-plane DBs — a fresh override DB
// bootstraps with the same structural guarantees (unique shareId/uniqueKeys,
// reaction dedup, page-sort + text-search support) as the home db.
//
// everything in `things` is a thing (see api/utils/things + app/schemas);
// shareId is included so the (createdAt desc, shareId asc) page sort is
// fully index-provided instead of an in-memory sort per request. The
// kind-prefixed indexes serve v1-era docs until the things migration
// runs; the thingtime-prefixed ones serve v2 (multikey on the schema-id
// array), and targetId serves comment/reaction/share lookups.
const createThingsDataIndexes = (db: any): Promise<any>[] => {
  // Tagged so a createIndex failure names the exact `things.<index>` that
  // broke, whether this runs on the home db or a custom endpoint.
  const col = taggedCollection(thingsCollection(db), 'things');
  return [
    col.createIndex({ shareId: 1 }, { unique: true, sparse: true }),
    // generalized uniqueness for system kinds (username:<u>, hashed email
    // keys, schema:<id>, …): multikey unique — each element unique across
    // the collection; sparse so ordinary things skip the index entirely
    col.createIndex({ uniqueKeys: 1 }, { unique: true, sparse: true }),
    // login + people-search lookups on user things (thingtime is the only
    // multikey field here, so the compound is legal)
    col.createIndex({ thingtime: 1, 'crystal.username': 1 }),
    // admin roster: a partial index over just the (rare) admin user things,
    // so listAdmins is a few-entry scan, not a full-user-base fetch+filter
    col.createIndex(
      { secureAdmin: 1 },
      { partialFilterExpression: { secureAdmin: true } }
    ),
    col.createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
    col.createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
    // Admin user/app snapshots filter by thingtime without ownerId, then
    // take a small newest-first window with a stable shareId tiebreaker.
    col.createIndex({ thingtime: 1, createdAt: -1, shareId: 1 }),
    col.createIndex({ thingtime: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
    // Canonical account-storage reconciliation: content allocations are
    // grouped by owner and summed from their exact versioned byte stamps.
    // Control-plane Things never enter this partial index.
    col.createIndex(
      { storageClass: 1, ownerId: 1, storageAccountingVersion: 1, sizeBytes: 1 },
      { partialFilterExpression: { storageClass: 'content' } }
    ),
    col.createIndex({ targetId: 1, thingtime: 1, createdAt: 1, shareId: 1 }),
    // schema-usage counting (schemas/browse decorate): data things are
    // grouped by crystal.schemaId (stamped) with a crystal.schema name
    // fallback for pre-stamp docs — both need index support or every
    // schema browse page scans the whole data partition
    col.createIndex({ thingtime: 1, 'crystal.schemaId': 1 }),
    col.createIndex({ thingtime: 1, 'crystal.schema': 1 }),
    // acl and thingtime are both arrays — Mongo forbids two multikey fields
    // in one compound index, so the audience index stands alone
    col.createIndex({ acl: 1, createdAt: -1, shareId: 1 }),
    // One weighted wildcard text index powers /api/v1/things/search ranked
    // text mode across every string field of every thing (a collection can
    // hold at most ONE text index — this is it; wildcard is deliberate:
    // data crystals hold arbitrary user keys, and searching them is the
    // feature). The language_override name is honoured INSIDE embedded
    // documents too (verified: a crystal key with the override name and an
    // unsupported value fails the insert), so it must be a name no crystal
    // can ever contain — ':' is outside the data-key grammar, making
    // 'tt:textLanguage' unwritable through every sanitizer.
    createIndexReplacing(
      col,
      { '$**': 'text' },
      {
        name: 'things_text_search',
        weights: { 'crystal.name': 10, 'crystal.text': 10, 'crystal.title': 8, 'crystal.listing.title': 8, tags: 6 },
        default_language: 'english',
        language_override: 'tt:textLanguage'
      }
    ),
    // One reaction per (target, user, emoji token): makes toggle-on an
    // idempotent upsert and dedups even under races. The partial filter
    // requires a STRING targetId as well as crystal.emoji — reactions
    // always attach to a target, while free-form data things (targetId
    // null) may legitimately carry an `emoji` key and must never collide
    // here (verified: the emoji-exists-only filter 409'd the second data
    // thing sharing an emoji value).
    createIndexReplacing(
      col,
      { targetId: 1, ownerId: 1, 'crystal.emoji': 1 },
      {
        name: 'things_reaction_unique',
        unique: true,
        partialFilterExpression: { targetId: { $type: 'string' }, 'crystal.emoji': { $exists: true } }
      },
      ['targetId_1_ownerId_1_crystal.emoji_1']
    ),
    // One follow edge per (followed, follower): toggle-on is an idempotent
    // upsert, deduped under races. Only follow things carry crystal.follow
    // (constant true) — same marker-field trick as the reaction index, since
    // partial filters can't reliably scope on the multikey thingtime array.
    createIndexReplacing(
      col,
      { targetId: 1, ownerId: 1 },
      {
        name: 'things_follow_unique',
        unique: true,
        partialFilterExpression: { targetId: { $type: 'string' }, 'crystal.follow': { $exists: true } }
      }
    ),
    // One friendship doc per unordered user pair, regardless of who asked:
    // crystal.friendKey is '<minId>~<maxId>', written only by the friend
    // endpoint. Uniqueness kills duplicate/crossed requests structurally.
    createIndexReplacing(
      col,
      { 'crystal.friendKey': 1 },
      {
        name: 'things_friend_unique',
        unique: true,
        partialFilterExpression: { 'crystal.friendKey': { $exists: true } }
      }
    ),
    // (Notification list/unread queries are served by the general
    // { thingtime, ownerId, createdAt desc, shareId } index above.)
    // Legacy relational era (kind:'reaction'/'comment' docs written by the
    // pre-unification relational model): aggregation + dedup indexes stay
    // until the things migration converts those docs to thingtime things.
    col.createIndex({ kind: 1, parentId: 1, createdAt: 1 }),
    col.createIndex(
      { parentId: 1, ownerId: 1, token: 1 },
      { unique: true, partialFilterExpression: { kind: 'reaction' } }
    ),
    col.createIndex(
      { commentId: 1 },
      { unique: true, partialFilterExpression: { kind: 'comment' } }
    ),
    // Embed apps ("Login with Thingtime", api/utils/apps): one thing per
    // clientId, ever — a second doc claiming an existing clientId (however
    // created) could answer origin lookups with a different allowlist, so
    // uniqueness is structural. Only app things carry crystal.clientId;
    // app-data things reference the app as crystal.appId instead.
    col.createIndex(
      { 'crystal.clientId': 1 },
      { unique: true, partialFilterExpression: { 'crystal.clientId': { $exists: true } } }
    ),
    // Immutable subscription-tier revisions: one (tierId, version) ever,
    // at most one live revision per stable tier id, plus the status/order
    // scan used by the admin Live / Draft / Archived sections.
    col.createIndex(
      { 'crystal.quotaKind': 1, 'crystal.tierId': 1, 'crystal.version': 1 },
      {
        unique: true,
        partialFilterExpression: {
          thingtime: 'subscription-tier',
          'crystal.quotaKind': 'subscription-tier'
        }
      }
    ),
    col.createIndex(
      { 'crystal.tierId': 1, 'crystal.status': 1 },
      {
        unique: true,
        partialFilterExpression: {
          thingtime: 'subscription-tier',
          'crystal.quotaKind': 'subscription-tier',
          'crystal.status': 'live'
        }
      }
    ),
    col.createIndex(
      { 'crystal.quotaKind': 1, 'crystal.status': 1, 'crystal.sortOrder': 1, updatedAt: -1 },
      {
        partialFilterExpression: {
          thingtime: 'subscription-tier',
          'crystal.quotaKind': 'subscription-tier'
        }
      }
    ),
    // App data: one thing per (user, app, key) — set() stays an idempotent
    // insert-or-update under races, and the index serves list-by-(user, app).
    col.createIndex(
      { ownerId: 1, 'crystal.appId': 1, 'crystal.key': 1 },
      {
        unique: true,
        partialFilterExpression: { 'crystal.appId': { $exists: true }, 'crystal.key': { $exists: true } }
      }
    ),
    // Protected per-(app, user) storage ledgers. App-owner management and
    // the admin directory enumerate one app's users newest-first; keeping
    // quotaKind first excludes ordinary app-data without a second
    // multikey field or an unbounded collection scan.
    col.createIndex(
      { 'crystal.quotaKind': 1, 'crystal.appId': 1, updatedAt: -1, ownerId: 1 },
      { partialFilterExpression: { 'crystal.quotaKind': 'app-storage' } }
    ),
    // Admin user snapshots sum every app-storage ledger held by each user.
    // ownerId must immediately follow quotaKind: the appId/updatedAt index
    // above cannot seek its owner suffix without those fields constrained.
    col.createIndex({ 'crystal.quotaKind': 1, ownerId: 1 }, { partialFilterExpression: { 'crystal.quotaKind': 'app-storage' } }),
    // The app-scoped shared read (/app-data/shared): entries whose acl
    // carries tt:app/<clientId>, newest first. acl is the only multikey
    // field here (appId/updatedAt/shareId are scalars), so the compound is
    // legal; partial keeps every non-app-data thing out.
    col.createIndex(
      { 'crystal.appId': 1, acl: 1, updatedAt: -1, shareId: -1 },
      { partialFilterExpression: { 'crystal.appId': { $exists: true } } }
    ),
    // Account-ownership links (accounts/accountLinks.ts): "who is linked
    // to this target" — the admin owners view and app co-manager checks.
    // Links a USER holds ride the (thingtime, ownerId) prefix instead.
    col.createIndex(
      { 'crystal.targetId': 1, 'crystal.linkKind': 1 },
      { partialFilterExpression: { 'crystal.targetId': { $exists: true } } }
    ),
    // Sandbox app-data is ephemeral: only docs written under a sandbox
    // token carry sandboxExpiresAt (TTL skips docs without the field), so
    // pretend data reaps itself with the token's lifetime.
    col.createIndex({ sandboxExpiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Full-power app namespaces: every thing written through an app token
    // carries a server-stamped scalar root appId (the namespace marker —
    // never inferred from acl, which users can hand-write). Own-namespace
    // reads page by (appId, ownerId); shared-slice reads by (appId, acl).
    // appId is scalar, so each compound has at most one multikey field
    // (acl) and both are legal; partials keep non-app things out.
    col.createIndex({ appId: 1, ownerId: 1, updatedAt: -1, shareId: -1 }, { partialFilterExpression: { appId: { $exists: true } } }),
    col.createIndex({ appId: 1, acl: 1, updatedAt: -1, shareId: -1 }, { partialFilterExpression: { appId: { $exists: true } } })
  ];
};

// Lazily ensure the data-plane indexes on a CUSTOM endpoint's database, once
// per URI per process. Fire-and-forget by design: the first requests against a
// fresh override DB must not block on (potentially slow, e.g. the wildcard
// text index over a large foreign collection) index builds — reads simply run
// unindexed until the builds land, EXCEPT text-mode search: $text errors (it
// does not degrade) until the text index finishes building, then heals on its
// own. A failed run clears the memo so a later request retries.
const customIndexesEnsured = new Map<string, Promise<void>>();
const ensureCustomDataIndexes = (uri: string, db: any) => {
  if (customIndexesEnsured.has(uri)) return;
  const run = Promise.all(createThingsDataIndexes(db)).then(
    () => undefined,
    (err) => {
      customIndexesEnsured.delete(uri);
      console.error('[mongodb] data-plane index ensure failed for custom endpoint:', err?.message || err);
    }
  );
  customIndexesEnsured.set(uri, run);
};

export const ensureIndexes = async () => {
  if (!indexesEnsured) {
    indexesEnsured = (async () => {
      // HOME db explicitly — ensureIndexes can run inside a request that
      // carries a custom endpoint override (e.g. via enforceRateLimit), and
      // the control-plane index set must never land on an override DB.
      const db = await getHomeThingtimeDb();
      // indexes land on the current-generation physical collections; createIndex
      // failures are tagged with `<logical>.<index name>` (via taggedCollection)
      // because Promise.all surfaces only the first rejection and driver
      // messages don't always name the index being built
      const col = (logical: string) =>
        taggedCollection(db.collection(physicalCollectionName(logical)), logical);
      await Promise.all([
        col('users').createIndex({ username: 1 }, { unique: true }),
        col('users').createIndex({ email: 1 }, { unique: true }),
        // Admin directory snapshots merge this legacy store with user Things
        // newest-first; the id suffix makes equal timestamps deterministic.
        col('users').createIndex({ createdAt: -1, _id: 1 }),
        // The current-admin roster filters legacy users by the stored flag and
        // then takes the same deterministic newest-first window. Keep this
        // rare subset partial so the sort never scans the whole legacy store.
				col('users').createIndex({ 'meta.admin': 1, createdAt: -1, _id: 1 }, { partialFilterExpression: { 'meta.admin': true } }),
        col('sessions').createIndex({ jti: 1 }, { unique: true }),
        col('sessions').createIndex({ userId: 1 }),
        // TTL: reap sessions once expiresAt passes. getLiveSession already
        // treats past-expiry docs as dead, so deletion removes nothing usable —
        // without it expired/revoked sessions (app grants especially) pile up
        // forever. Docs with expiresAt: null are exempt (TTL skips non-dates).
        col('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // deleteApp revokes app sessions by clientId ACROSS users — without
        // this the sweep scans the whole sessions collection. Partial so the
        // (much larger) browser/service session population stays out.
        col('sessions').createIndex({ 'meta.clientId': 1 }, { partialFilterExpression: { purpose: 'app' } }),
        // account-switcher rosters: one doc per browser, entries reference
        // sessions by jti; TTL reaps rosters abandoned past their rolling expiry
        col('rosters').createIndex({ rosterId: 1 }, { unique: true }),
        col('rosters').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('emailVerifications').createIndex({ token: 1 }, { unique: true }),
        col('emailVerifications').createIndex({ userId: 1 }),
        // password-reset links + login OTP challenges: single-use tokens, TTL
        // reaps them at expiresAt (consumed docs keep their consumedAt until then)
        col('passwordResets').createIndex({ token: 1 }, { unique: true }),
        col('passwordResets').createIndex({ userId: 1 }),
        col('passwordResets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('authOtps').createIndex({ challenge: 1 }, { unique: true }),
        col('authOtps').createIndex({ userId: 1 }),
        col('authOtps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // owned email layer: outbox + delivery events + list hygiene
        col('email_messages').createIndex({ createdAt: -1 }),
        col('email_messages').createIndex({ to: 1 }),
        col('email_messages').createIndex({ stream: 1, status: 1, createdAt: -1 }),
        col('email_messages').createIndex({ providerMessageId: 1 }, { sparse: true }),
        col('email_events').createIndex({ emailMessageId: 1 }),
        col('email_events').createIndex({ providerMessageId: 1 }),
        col('email_events').createIndex({ eventType: 1, receivedAt: -1 }),
        col('email_templates').createIndex({ key: 1 }, { unique: true }),
        col('email_subscriptions').createIndex({ email: 1, listId: 1 }, { unique: true }),
        col('email_subscriptions').createIndex({ listId: 1, status: 1 }),
        col('email_suppression_list').createIndex({ email: 1 }, { unique: true }),
        col('email_unsubscribes').createIndex({ email: 1, listId: 1 }, { unique: true }),
        col('email_identities').createIndex({ identity: 1 }, { unique: true }),
        col('lopuMusingRateLimits').createIndex({ key: 1 }, { unique: true }),
        col('lopuMusingRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('themes').createIndex({ shareId: 1 }, { unique: true }),
        col('themes').createIndex({ ownerId: 1 }),
        col('waitlist').createIndex({ email: 1 }, { unique: true }),
        // the shared data-plane (`things`) index set — see createThingsDataIndexes
        ...createThingsDataIndexes(db),
        col('feedAlgorithms').createIndex({ shareId: 1 }, { unique: true }),
        col('feedAlgorithms').createIndex({ ownerId: 1 }),
        // global app settings singletons (rate-limit config lives here)
        col('settings').createIndex({ key: 1 }, { unique: true }),
        // general per-endpoint rate-limit windows; TTL reaps expired windows
        col('rateLimits').createIndex({ key: 1 }, { unique: true }),
        col('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // post view telemetry: one doc per (post, viewer identity) — the
        // unique index IS the dedup that keeps unique-viewer counts honest
        // under racing writes; its postId prefix serves the per-post stats
        // aggregation on feed reads
        col('postViews').createIndex({ postId: 1, viewerKey: 1 }, { unique: true })
      ]);
    })().catch((err: any) => {
      // Name the broken index, then clear the failed promise so the next
      // explicit bootstrap caller can retry as soon as the database/data is
      // healthy. Ordinary API traffic never calls ensureIndexes.
      indexesEnsured = null;
      console.error(
        `[mongodb] ensureIndexes failed${err?.indexBeingBuilt ? ` building ${err.indexBeingBuilt}` : ''} — next bootstrap call will retry:`,
        err?.message || err
      );
      throw err;
    });
  }
  return indexesEnsured;
};
