import { getMongoUri } from './config';
import { getActiveMongoDbName, getActiveMongoUri, isCustomMongoEndpointActive } from './endpoint';
import { getMongoDb } from './mongodb';
import { COLLECTIONS, physicalCollectionName } from './collectionNames';
import { MIGRATION_DIAGNOSTIC_THINGTIME } from '../../../schemas/registry';
import { CI_DASHBOARD_UPDATED_INDEX } from '../ciControl/dashboardQueryCore';

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
//
// Sessions are CLIENT-bound: a session only works with collection handles from
// the MongoClient that started it. The two variants mirror the collection
// getters — withMongoTransaction follows the request's ACTIVE data plane
// (exactly like getCollection/getThingtimeDb, so data-plane transactions stay
// on the override's client when one is active), and withHomeMongoTransaction
// is pinned to the home deployment (like getHomeCollection) for
// identity/control-plane transactions, which must keep working while a
// data-plane override is active on the request. A transaction cannot span both
// planes: with an override active, home and active are different clients.
const runMongoTransaction = async <T>(client: any, work: (session: any) => Promise<T>): Promise<T> => {
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

export const withMongoTransaction = async <T>(work: (session: any) => Promise<T>): Promise<T> =>
	runMongoTransaction(
		await (isCustomMongoEndpointActive() ? getClientCachedFor(getActiveMongoUri(), false) : getClientCachedFor(getMongoUri(), true)),
		work
	);

export const withHomeMongoTransaction = async <T>(work: (session: any) => Promise<T>): Promise<T> =>
	runMongoTransaction(await getClientCachedFor(getMongoUri(), true), work);

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

// Transactions (storage accounting, registration's subscription-ledger seed)
// require a REPLICA SET: a standalone mongod rejects them with
// IllegalOperation, and there is deliberately no non-transactional fallback
// (see withMongoTransaction). Atlas is always a replica set; a local dev
// mongod usually is not — and every transactional flow (registration, service
// accounts, storage-accounted writes) then 500s. Probe once at boot and say
// so loudly with the exact fix, instead of letting the first registration
// surface a bare IllegalOperation.
let transactionSupportProbed = false;
export const warnIfTransactionsUnsupported = async (): Promise<void> => {
  if (transactionSupportProbed) return;
  transactionSupportProbed = true;
  try {
    const db = await getHomeThingtimeDb();
    const hello = await db.admin().command({ hello: 1 });
    if (!hello?.setName) {
      console.error(
        '[mongodb] The connected MongoDB is STANDALONE — multi-document transactions (registration, service accounts, storage-accounted writes) WILL FAIL with IllegalOperation.\n' +
          '[mongodb] Fix: run it as a single-node replica set. Add to mongod.conf (brew: /opt/homebrew/etc/mongod.conf):\n' +
          '[mongodb]     replication:\n' +
          '[mongodb]       replSetName: rs0\n' +
          '[mongodb] restart mongod, then initiate ONCE with an explicit localhost member host:\n' +
          `[mongodb]     mongosh --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]})'`
      );
    }
  } catch (err: any) {
    // A replSet-configured but NOT-YET-INITIATED mongod cannot serve normal
    // operations, so the connect/hello above fails instead of answering. Name
    // that state (conditionally — the same error also covers mongod-down).
    const text = String(err?.message || err);
    if (/NotYetInitialized|no replset config|Server selection timed out/i.test(text)) {
      console.error(
        '[mongodb] Could not reach a usable MongoDB. If mongod is running and was recently switched to replSetName without initiating, run ONCE:\n' +
          `[mongodb]     mongosh --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]})'`
      );
    }
  }
};

// THE way to a collection handle: logical name in, current-generation physical
// collection out. Every read and write in the codebase goes through one of
// these two (or a named getter below), so nothing can touch a stale generation
// by accident. getCollection follows the request's ACTIVE endpoint (the open
// data plane); getHomeCollection is pinned to the home deployment and is what
// every identity / auth / control-plane getter uses.
export const getCollection = async (logical: string) => (await getThingtimeDb()).collection(physicalCollectionName(logical));
export const getHomeCollection = async (logical: string) => (await getHomeThingtimeDb()).collection(physicalCollectionName(logical));

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
// Admin integration records are a home-pinned control plane. Their encrypted
// credential material is never represented as a user Thing or browser setting.
export const getAdminIntegrationSecretsCollection = async () => getHomeCollection('adminIntegrationSecrets');
export const getAdminIntegrationEndpointsCollection = async () => getHomeCollection('adminIntegrationEndpoints');
export const getAdminIntegrationClaimsCollection = async () => getHomeCollection('adminIntegrationClaims');
export const getAdminIntegrationAuditCollection = async () => getHomeCollection('adminIntegrationAudit');
// Ordered, named Lopu credentials are encrypted at rest and only decrypted for
// a short-lived HMAC-authenticated controller fetch. Browser APIs project
// metadata only.
export const getLopuCredentialsCollection = async () => getHomeCollection('lopuCredentials');
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

// dropIndex with a bounded retry: ensureIndexes fires every createIndex in one
// Promise.all, so on the boot that performs an index swap a legacy-name drop
// can race a sibling index build and get rejected (observed live: the first
// swap run left crystal.clientId_1 behind while its replacement built).
// Absent index (IndexNotFound 27) is success; anything else backs off and
// retries, then gives up quietly — the next boot's run re-prunes.
const dropIndexRetrying = async (collection: any, name: string, attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await collection.dropIndex(name);
      return;
    } catch (err: any) {
      if (err?.code === 27 || err?.codeName === 'IndexNotFound') return;
      if (attempt === attempts - 1) return;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
};

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
    await dropIndexRetrying(collection, options.name);
    for (const legacy of legacyNames) await dropIndexRetrying(collection, legacy);
    await collection.createIndex(keys, options);
  }
  // New index is in place — now prune any legacy-named siblings of the same shape.
  for (const legacy of legacyNames) {
    if (legacy === options.name) continue;
    await dropIndexRetrying(collection, legacy); // absent = fine
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
				options?.name ||
				Object.entries(keys)
					.map(([field, dir]) => `${field}_${dir}`)
					.join('_');
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
// fully index-provided instead of an in-memory sort per request. That
// holds only while EVERY branch of a query can provide the sort: the
// dual-era post match is an $or over thingtime and kind, and a branch
// with no matching index forces the planner to fetch the whole $or
// result and sort it in memory — see the kind/createdAt index below. The
// kind-prefixed indexes serve v1-era docs until the things migration
// runs; the thingtime-prefixed ones serve v2 (multikey on the schema-id
// array), and targetId serves comment/reaction/share lookups.
// KIND-BLIND HISTORY (the unique-slot squat class): the relationship key
// indexes below were once UNIQUE with filters that saw only `crystal.<key>`
// — no kind scoping — so a free-form data thing carrying e.g.
// crystal.followKey '<followerId>:<followeeId>' entered the index and
// permanently blocked the victim's real follow with E11000. Their
// uniqueness now rides the server-only root uniqueKeys namespace (index
// below + messenger/shared.ts relationshipUniqueKeys), the crystal-path
// indexes are plain lookups, and data crystals reserve no names. NEVER add
// a new unique index over a crystal path reachable by free-form data
// crystals: put dedupe in uniqueKeys, or — where a crystal-path unique
// index is truly needed — use the thingtime-scoped filter pattern of
// things_app_data_unique (partial-filter equality on the multikey thingtime
// array verifiedly includes array-contains matches on MongoDB 8.0).

const createThingsDataIndexes = (db: any): Promise<any>[] => {
  // Tagged so a createIndex failure names the exact `things.<index>` that
  // broke, whether this runs on the home db or a custom endpoint.
  const col = taggedCollection(thingsCollection(db), 'things');
  return [
    col.createIndex({ shareId: 1 }, { unique: true, sparse: true }),
    // generalized uniqueness for system kinds (username:<u>, hashed email
    // keys, schema:<id>, …) AND relationship dedupe (followKey:<a>:<b>,
    // memberKey:, dmKey:, inviteCode:, emojiKey:, friendKey:, voteKey:,
    // linkKey: — stamped by
    // messenger/shared.ts relationshipUniqueKeys): multikey unique — each
    // element unique across the collection; sparse so ordinary things skip
    // the index entirely. Root field + BinData = no user input can ever
    // reach this namespace, which is why relationship invariants live here
    // instead of on user-writable crystal paths.
    col.createIndex({ uniqueKeys: 1 }, { unique: true, sparse: true }),
    // login + people-search lookups on user things (thingtime is the only
    // multikey field here, so the compound is legal)
    col.createIndex({ thingtime: 1, 'crystal.username': 1 }),
    // admin roster: a partial index over just the (rare) admin user things,
    // so listAdmins is a few-entry scan, not a full-user-base fetch+filter
		col.createIndex({ secureAdmin: 1 }, { partialFilterExpression: { secureAdmin: true } }),
    col.createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
    col.createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
    // The feed and profile matches are $or over BOTH eras
    // ({thingtime:'post'} | {kind:'post'} — see postMatch in things.ts). The
    // thingtime side had its (createdAt desc, shareId asc) index above; the
    // kind side had one only when also filtered by visibility or ownerId, so
    // a plain chronological feed left that branch sortless. The planner then
    // could not push the limit into the scan: it fetched EVERY post the
    // viewer can see and sorted them in memory, scaling linearly with the
    // visible-post count.
    //
    // Purely additive — no query changes, both eras stay correct, and
    // dropping the kind branch instead would silently hide v1-era posts
    // (custom data-plane endpoints may still hold unmigrated docs).
    // Verified on a local dataset: the plan goes from SORT <- FETCH <- OR
    // (67 docs examined to return 21) to LIMIT <- FETCH <- SORT_MERGE with
    // no blocking sort (38 examined).
    col.createIndex({ kind: 1, createdAt: -1, shareId: 1 }),
    // Admin user/app snapshots filter by thingtime without ownerId, then
    // take a small newest-first window with a stable shareId tiebreaker.
    col.createIndex({ thingtime: 1, createdAt: -1, shareId: 1 }),
    // Public tag feeds (`GET /api/v1/things/feed?tag=…`): one tag's posts,
    // newest first. Without `tags` as a key the tag is a post-scan residual —
    // the pager walks every post in createdAt order until it fills a page, so a
    // rare tag reads the whole post history on an unauthenticated endpoint.
    //
    // `thingtime` must NOT be a key here: it is itself multikey on every
    // things-era doc (`thingtime: ['post']`, `['waitlist']`, …), so pairing it
    // with `tags` is a parallel-array compound. Mongo then rejects EVERY
    // things insert with `cannot index parallel arrays [tags] [thingtime]`
    // (code 171) — even `tags: []` counts as an array — taking down post
    // creation and waitlist signup alike. Post-ness stays a cheap residual on
    // a set already narrowed to the one tag; it cannot be a partial filter
    // either, because postMatch() spells post-ness as an $or over
    // thingtime/kind that the planner cannot prove subsumed (measured: the
    // partial variant is not selected and examines the whole corpus).
    //
    // Verified on a 10k-post local dataset: this query goes from 10,000 keys
    // and 10,000 docs examined to return 3, down to 3 keys and 3 docs.
    col.createIndex({ tags: 1, createdAt: -1, shareId: 1 }),
    col.createIndex({ thingtime: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
    // /things folder browsing: one owner's direct children of one folder,
    // newest first — fully index-provided including the page sort
    col.createIndex({ ownerId: 1, folderId: 1, createdAt: -1, shareId: 1 }),
    // Control-plane history is relational: one ci-event per provider delivery
    // and parent entity, never an unbounded status array on the current row.
    col.createIndex({ thingtime: 1, parentId: 1, createdAt: -1, shareId: 1 }),
    // Admin CI snapshots are repository-scoped and ordered by the latest
    // provider update. Without this exact sort index, MongoDB must materialize
    // every growing ci-event/run/deployment row before applying the dashboard
    // limit and eventually trips its 32 MiB blocking-sort ceiling.
    col.createIndex(CI_DASHBOARD_UPDATED_INDEX, { name: 'things_ci_repository_updated' }),
    // The unread-notification badge counts (thingtime, ownerId, readAt: null).
    // The general (thingtime, ownerId, createdAt, shareId) index above narrows
    // to the user's notifications, but readAt is not a key in it, so the count
    // landed in a FETCH stage that pulled EVERY notification that user had
    // ever received just to test one field — cost grew with history, on a
    // badge polled by every session.
    //
    // Partial on readAt: null so the index holds only the unread set, which is
    // normally a handful and empty for a caught-up user. Verified against a
    // local dataset: the planner selects this index (isPartial) and the same
    // query drops from fetching every notification to examining none when
    // there is nothing unread, with counts identical to a collection scan
    // across every owner.
    col.createIndex(
      { thingtime: 1, ownerId: 1 },
      { name: 'notification_unread', partialFilterExpression: { thingtime: 'notification', readAt: null } }
    ),
    // Canonical account-storage reconciliation: content allocations are
    // grouped by owner and summed from their exact versioned byte stamps.
    // Control-plane Things never enter this partial index.
    col.createIndex(
      { storageClass: 1, ownerId: 1, storageAccountingVersion: 1, sizeBytes: 1 },
      { partialFilterExpression: { storageClass: 'content' } }
    ),
    col.createIndex({ targetId: 1, thingtime: 1, createdAt: 1, shareId: 1 }),
    // Live share counts are an $or of the v2 shape ({thingtime:'share',
    // targetId}) and the v1 shape (a post carrying shareOfId). shareOfId had
    // no index, and one unindexed branch drags the whole $or down: the
    // aggregation ran as a full COLLSCAN of `things` on EVERY feed page,
    // profile page, search page, single-post read, post/comment create,
    // thing update AND every reaction toggle (resolveRelated runs it for the
    // reaction's target). Measured locally: 4,846 documents examined and 0
    // index keys to produce share counts for 20 posts; with this index the
    // same aggregation examines 6 documents and 6 keys.
    //
    // sparse rather than a $type partial filter: sparse is provably usable
    // for the $in over non-null strings, while $type subsumption proving is
    // more fragile across server versions. Additive — dropping the v1 branch
    // instead would be faster still but would silently stop counting
    // un-migrated v1 shares (thingtimeOf/targetIdOf still read that shape).
    col.createIndex({ shareOfId: 1 }, { sparse: true }),
    // Private-S3 attachment lifecycle scans. Deliberately NOT a TTL index:
    // expiry cleanup must delete/abort S3 first and refund the user ledger in
    // one Mongo transaction; TTL deletion would orphan bytes and accounting.
    col.createIndex(
      { ownerId: 1, attachmentState: 1, attachmentExpiresAt: 1, shareId: 1 },
      { partialFilterExpression: { thingtime: 'attachment' } }
    ),
    // Hourly global draft reaper: expiry is the leading key so a bounded scan
    // across owners never walks the whole attachment partition. Attached
    // rows clear attachmentExpiresAt when bound and therefore do not enter the
    // useful key range. This must remain a normal index, never Mongo TTL.
    col.createIndex(
      { attachmentExpiresAt: 1, shareId: 1 },
      { partialFilterExpression: { thingtime: 'attachment' } }
    ),
    col.createIndex(
      { targetId: 1, ownerId: 1, attachmentState: 1, createdAt: 1, shareId: 1 },
      { partialFilterExpression: { thingtime: 'attachment', targetId: { $type: 'string' } } }
    ),
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
    // Retire the superseded follow-marker generation. Current follow writers
    // use crystal.followKey for lookup and protected root uniqueKeys for
    // dedupe; no registered schema mints crystal.follow. Leaving this old
    // kind-blind unique index behind would needlessly constrain ordinary data
    // Things after the crystal namespace reopens in phase 2.
    dropIndexRetrying(col, 'things_follow_unique'),
    // One friendship doc per unordered user pair, regardless of who asked:
    // crystal.friendKey is '<minId>~<maxId>', written only by the friend
    // endpoint. Uniqueness rides uniqueKeys ('friendKey:<min>~<max>', stamped
    // at insert) so duplicate/crossed requests still die structurally; this
    // index is now the LOOKUP only. createIndexReplacing keeps a friendKey
    // index live throughout the swap and retires the old unique name.
    createIndexReplacing(
      col,
      { 'crystal.friendKey': 1 },
      {
        name: 'things_friend_key_lookup',
        partialFilterExpression: { 'crystal.friendKey': { $exists: true } }
      },
      ['things_friend_unique']
    ),
    // (Notification list/unread queries are served by the general
    // { thingtime, ownerId, createdAt desc, shareId } index above.)
    // Legacy relational era (kind:'reaction'/'comment' docs written by the
    // pre-unification relational model): aggregation + dedup indexes stay
    // until the things migration converts those docs to thingtime things.
    col.createIndex({ kind: 1, parentId: 1, createdAt: 1 }),
		col.createIndex({ parentId: 1, ownerId: 1, token: 1 }, { unique: true, partialFilterExpression: { kind: 'reaction' } }),
		col.createIndex({ commentId: 1 }, { unique: true, partialFilterExpression: { kind: 'comment' } }),
    // Embed apps ("Login with Thingtime", api/utils/apps): one thing per
    // clientId, ever — a second doc claiming an existing clientId (however
    // created) could answer origin lookups with a different allowlist, so
    // uniqueness is structural. Scoped to thingtime:'app' for the same
    // reason the reaction index requires a string targetId: a free-form data
    // thing may legitimately carry a `clientId` key, and an exists-only
    // filter 409s it against an unrelated app. Narrowing keeps the security
    // property intact because every lookup in api/utils/apps/apps.ts already
    // filters thingtime:'app' — a data thing can never answer one.
    createIndexReplacing(
      col,
      { 'crystal.clientId': 1 },
      {
        name: 'things_app_client_unique',
        unique: true,
        partialFilterExpression: { thingtime: 'app', 'crystal.clientId': { $exists: true } }
      },
      ['crystal.clientId_1']
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
    // Same scoping: setAppData's filter is thingtime:'app-data', so without
    // it here a plain data thing carrying appId+key squats the slot (app
    // writes then miss it, insert 11000 three times, and 503 permanently),
    // and two ordinary data things sharing those values 409 each other.
    createIndexReplacing(
      col,
      { ownerId: 1, 'crystal.appId': 1, 'crystal.key': 1 },
      {
        name: 'things_app_data_unique',
        unique: true,
        partialFilterExpression: {
          thingtime: 'app-data',
          'crystal.appId': { $exists: true },
          'crystal.key': { $exists: true }
        }
      },
      ['ownerId_1_crystal.appId_1_crystal.key_1']
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
		col.createIndex({ 'crystal.appId': 1, acl: 1, updatedAt: -1, shareId: -1 }, { partialFilterExpression: { 'crystal.appId': { $exists: true } } }),
    // Account-ownership links (accounts/accountLinks.ts): "who is linked
    // to this target" — the admin owners view and app co-manager checks.
    // Links a USER holds ride the (thingtime, ownerId) prefix instead.
    col.createIndex(
      { 'crystal.targetId': 1, 'crystal.linkKind': 1 },
      { partialFilterExpression: { 'crystal.targetId': { $exists: true } } }
    ),
    // Messenger (api/utils/messenger) relationship LOOKUP indexes. The
    // structural invariants (one membership per (chat|community, user), one
    // DM per pair, collision-proof invite codes, one emoji name per scope,
    // one follow edge per pair) ride the server-only uniqueKeys namespace
    // above — stamped in newThingDoc (messenger/shared.ts), backfilled onto
    // legacy docs by the backfill-relationship-unique-keys migration. The
    // crystal-path indexes here serve the findOne/$in query shapes only;
    // their old kind-blind UNIQUE ancestors were squattable through
    // free-form data crystals (see KIND-BLIND HISTORY above) and are
    // retired by each swap, create-then-drop, so a lookup index stays
    // live throughout:
    createIndexReplacing(
      col,
      { 'crystal.memberKey': 1 },
      { name: 'things_member_key_lookup', partialFilterExpression: { 'crystal.memberKey': { $type: 'string' } } },
      ['things_member_key_unique']
    ),
    createIndexReplacing(
      col,
      { 'crystal.dmKey': 1 },
      { name: 'things_dm_key_lookup', partialFilterExpression: { 'crystal.dmKey': { $type: 'string' } } },
      ['things_dm_key_unique']
    ),
    createIndexReplacing(
      col,
      { 'crystal.inviteCode': 1 },
      { name: 'things_invite_code_lookup', partialFilterExpression: { 'crystal.inviteCode': { $type: 'string' } } },
      ['things_invite_code_unique']
    ),
    createIndexReplacing(
      col,
      { 'crystal.emojiKey': 1 },
      { name: 'things_emoji_key_lookup', partialFilterExpression: { 'crystal.emojiKey': { $type: 'string' } } },
      ['things_emoji_key_unique']
    ),
    createIndexReplacing(
      col,
      { 'crystal.followKey': 1 },
      { name: 'things_follow_key_lookup', partialFilterExpression: { 'crystal.followKey': { $type: 'string' } } },
      ['things_follow_key_unique']
    ),
    // Poll voting is deliberately outside this release, but its preview
    // branch already installed the old kind-blind index in the shared develop
    // database. Retire it here with the rest of the family so phase 2 can
    // safely reopen voteKey too. Any existing vote docs are backfilled into
    // uniqueKeys; this lookup preserves the future query shape without
    // shipping the poll product surface.
    createIndexReplacing(
      col,
      { 'crystal.voteKey': 1 },
      { name: 'things_vote_key_lookup', partialFilterExpression: { 'crystal.voteKey': { $type: 'string' } } },
      ['things_vote_key_unique']
    ),
    // One passkey app link per (passkey, app/origin): dedupe AND the
    // per-login upsert's read both ride root uniqueKeys
    // (`linkKey:<passkeyId>:<appKey>`, stamped in auth/passkeys.ts and served
    // by the uniqueKeys_1 index above), so this family needs no crystal-path
    // index at all. PR #323 briefly gave it a kind-blind unique index here —
    // the squat class retired above, and one a free-form data crystal could
    // duplicate to fail this whole battery on E11000. Retired outright rather
    // than swapped to a lookup index like its siblings: those exist because
    // their kinds are READ by crystal path, while this one's only read is the
    // dedupe itself, which now matches the stamped root value. One less index
    // on the collection with the most of them (MongoDB caps a collection at
    // 64) and one less write to amplify on every login.
    dropIndexRetrying(col, 'things_passkey_link_key_unique'),
    // Thread replies list under their root message (main chat pages ride the
    // shared { targetId, thingtime, createdAt, shareId } index above).
    col.createIndex(
      { 'crystal.threadRootId': 1, createdAt: 1, shareId: 1 },
      { name: 'things_thread_root', partialFilterExpression: { 'crystal.threadRootId': { $type: 'string' } } }
    ),
    // Channel directory + channel caps query chats by their community.
    col.createIndex(
      { 'crystal.communityId': 1, createdAt: 1, shareId: 1 },
      { name: 'things_chat_community', partialFilterExpression: { 'crystal.communityId': { $type: 'string' } } }
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
			const col = (logical: string) => taggedCollection(db.collection(physicalCollectionName(logical)), logical);
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
        // Rotating ChatGPT refresh grants are joined to their encrypted
        // connection record by this opaque session id. Keep final disconnects
        // bounded to that one connection rather than sweeping all sessions.
        col('sessions').createIndex({ userId: 1, purpose: 1, 'meta.connectionSessionJti': 1 }),
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
        // notification-email hourly throttle (stream+to+createdAt) and the
        // weekly-digest idempotency lookback (templateKey+createdAt+to)
        col('email_messages').createIndex({ stream: 1, to: 1, createdAt: -1 }),
        col('email_messages').createIndex({ templateKey: 1, createdAt: -1 }),
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
				// Migration diagnostics exist only on Thingtime's HOME plane. Keep
				// this live TTL deleter out of createThingsDataIndexes(), which also
				// installs indexes on user-supplied custom Mongo endpoints.
				col('things').createIndex(
					{ expiresAt: 1 },
					{
						name: 'migration_diagnostic_expires_at',
						expireAfterSeconds: 0,
						partialFilterExpression: { thingtime: MIGRATION_DIAGNOSTIC_THINGTIME }
					}
				),
        col('feedAlgorithms').createIndex({ shareId: 1 }, { unique: true }),
        col('feedAlgorithms').createIndex({ ownerId: 1 }),
        // global app settings singletons (rate-limit config lives here)
        col('settings').createIndex({ key: 1 }, { unique: true }),
        // general per-endpoint rate-limit windows; TTL reaps expired windows
        col('rateLimits').createIndex({ key: 1 }, { unique: true }),
        col('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // Admin integration vault: write-only encrypted values, endpoint policy,
        // short create-only claims, and redacted, expiring audit evidence.
        col('adminIntegrationSecrets').createIndex({ id: 1 }, { unique: true }),
        col('adminIntegrationSecrets').createIndex({ label: 1 }, { unique: true }),
        col('adminIntegrationEndpoints').createIndex({ id: 1 }, { unique: true }),
        col('adminIntegrationEndpoints').createIndex({ secretId: 1 }),
        col('adminIntegrationClaims').createIndex({ endpointId: 1, resourceKey: 1 }, { unique: true }),
        col('adminIntegrationClaims').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('adminIntegrationAudit').createIndex({ createdAt: -1 }),
        col('adminIntegrationAudit').createIndex({ endpointId: 1, createdAt: -1 }),
        col('adminIntegrationAudit').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('lopuCredentials').createIndex({ id: 1 }, { unique: true }),
        col('lopuCredentials').createIndex({ name: 1 }, { unique: true }),
        col('lopuCredentials').createIndex({ priority: 1 }),
        col('lopuCredentials').createIndex({ enabled: 1, priority: 1 }),
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
