import { getMongoUri } from './config';
import { getActiveMongoDbName, getActiveMongoUri, isCustomMongoEndpointActive } from './endpoint';
import { getMongoDb } from './mongodb';
import { COLLECTIONS, physicalCollectionName } from './collectionNames';
import { MIGRATION_DIAGNOSTIC_THINGTIME } from '../../../schemas/registry';
import { CI_DASHBOARD_UPDATED_INDEX } from '../ciControl/dashboardQueryCore';
import { thingUniqueKey } from './uniqueKeys';

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
// Peer discovery is a control plane: every deployment is a separate row with
// a short TTL lease, never an unbounded embedded list on a settings document.
export const getDeploymentPeersCollection = async () => getHomeCollection('deploymentPeers');
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
// CI control plane (api/utils/ciControl): every ci-* Thing — current-state
// projections AND the append-only ci-event history — lives in its own
// home-pinned satellite, never in `things`. Measured in production
// (2026-09-02): 1.82M of things_v2's 1.82M docs were CI telemetry, and every
// one of the collection's 60+ indexes paid an entry per row (3.1 GB of index
// for ~4.5k real content docs). A satellite gets a six-index plan sized for
// its two readers (dashboard + per-parent history) and TTL retention.
export const getCiControlCollection = async () => getHomeCollection('ciControl');

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

// MongoDB's hard per-collection index ceiling, `_id_` included. A collection
// sitting on it fails every createIndex with CannotCreateIndex (67), which is
// why the swaps below degrade and why the twin prune has a cap escape hatch.
export const MONGODB_COLLECTION_INDEX_LIMIT = 64;

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
// Absent index (IndexNotFound 27) is success, and so is an absent collection
// (NamespaceNotFound 26): a `things` collection that does not exist yet cannot
// be holding a stale index, so there is nothing to retry for. Treating 26 as a
// transient error instead cost every FRESH database ~2s of pure backoff sleep
// per pruned name on the awaited bootstrap path (5 retired names = ~10s added
// to the first write). Anything else backs off and retries, then gives up
// quietly — the next boot's run re-prunes.
const dropIndexRetrying = async (collection: any, name: string, attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await collection.dropIndex(name);
      return;
    } catch (err: any) {
      if (err?.code === 27 || err?.codeName === 'IndexNotFound') return;
      if (err?.code === 26 || err?.codeName === 'NamespaceNotFound') return;
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
    if (err?.code === 67 && legacyNames.length) {
      // CannotCreateIndex: the collection is parked at MongoDB's 64-index cap
      // (observed on a local mongod shared by many worktrees, each ensuring
      // its own branch's residue). Create-then-drop needs a free slot it
      // cannot get, so degrade to drop-then-create for the legacy names —
      // a brief no-index window, taken only in this degenerate state and
      // never while the swap can run slot-safe.
      for (const legacy of legacyNames) await dropIndexRetrying(collection, legacy);
      await collection.createIndex(keys, options);
      return;
    }
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

// Test seam for the swap's cap fallback (indexBudget.test.ts) — the swap
// itself is only ever driven by the plan above.
export const createIndexReplacingForTests = createIndexReplacing;

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

const LEGACY_DEVICE_UNIQUE_INDEXES = [
	'things_device_key_unique',
	'things_device_state_key_unique',
	'things_device_connector_key_unique',
	'things_device_command_key_unique',
	'things_device_event_key_unique',
	'things_device_ai_live_state_key_unique',
	'things_device_ai_live_sequence_unique',
	'things_device_approval_key_unique',
	'things_device_screen_key_unique'
] as const;

const LEGACY_DEVICE_TTL_INDEXES = [
	'things_device_transient_event_ttl',
	'things_device_terminal_command_ttl',
	'things_device_approval_ttl'
] as const;

const CONSOLIDATED_THING_UNIQUE_INDEXES = [
	'things_ai_connection_key_unique',
	'things_external_community_key_unique',
	'things_external_conversation_key_unique',
	'things_external_message_key_unique',
	'things_device_unique_keys'
] as const;

const CONSOLIDATED_THING_UNIQUE_FIELDS = [
	{ crystalField: 'aiConnectionKey', uniqueField: 'aiConnectionKey', array: false },
	{ crystalField: 'externalCommunityKey', uniqueField: 'externalCommunityKey', array: false },
	{ crystalField: 'externalConversationKey', uniqueField: 'externalConversationKey', array: false },
	{ crystalField: 'externalMessageKey', uniqueField: 'externalMessageKey', array: false },
	{ crystalField: 'deviceUniqueKeys', uniqueField: 'deviceUniqueKey', array: true }
] as const;

export const backfillConsolidatedThingUniqueKeys = async (raw: any) => {
	const cursor = raw.find(
		{
			$or: CONSOLIDATED_THING_UNIQUE_FIELDS.map(({ crystalField, array }) => ({
				[`crystal.${crystalField}`]: { $type: array ? 'array' : 'string' }
			}))
		},
		{
			projection: Object.fromEntries([
				['_id', 1],
				...CONSOLIDATED_THING_UNIQUE_FIELDS.map(({ crystalField }) => [`crystal.${crystalField}`, 1])
			])
		}
	).batchSize(500);
	let operations: any[] = [];
	const flush = async () => {
		if (!operations.length) return;
		await raw.bulkWrite(operations, { ordered: false });
		operations = [];
	};
	for await (const doc of cursor) {
		const keys = CONSOLIDATED_THING_UNIQUE_FIELDS.flatMap(({ crystalField, uniqueField, array }) => {
			const rawValue = doc.crystal?.[crystalField];
			const values = array ? (Array.isArray(rawValue) ? rawValue : []) : [rawValue];
			return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))).map((value) =>
				thingUniqueKey(uniqueField, value)
			);
		});
		if (!keys.length) continue;
		operations.push({ updateOne: { filter: { _id: doc._id }, update: { $addToSet: { uniqueKeys: { $each: keys } } } } });
		if (operations.length >= 500) await flush();
	}
	await flush();
};

// Indexes installed by superseded Things-era implementations. None of these
// names is part of the current index plan: their query paths are now served by
// the general thingtime/owner indexes, protected uniqueKeys, or migrated v2
// fields. Prune them before creating anything so a database already sitting at
// MongoDB's 64-index ceiling can still converge instead of failing every
// bootstrap and blocking unrelated schema migrations.
// NOTE: `notification_unread` and `shareOfId_1` are deliberately NOT listed.
// Both are still created by createThingsDataIndexes below and still serve live
// hot query paths — the unread badge count polled by every session
// (notifications.ts `countDocuments({thingtime:'notification', ownerId,
// readAt:null})`) and the share-count $or that runs on every feed/profile/
// search/post read and reaction toggle (things.ts `$or: [{thingtime:'share',
// targetId}, {shareOfId}]`). Listing them here would drop and immediately
// rebuild both on EVERY bootstrap, leaving those two aggregations on a
// collection scan for the length of each rebuild.
export const RETIRED_THINGS_INDEXES = [
	'sourceIds_1_createdAt_-1_shareId_1',
	'thingtime_1_crystal.accountId_1_createdAt_-1_shareId_1',
	// Device event pagination now supplies the deterministic control-scope key,
	// so the retention index serves the same cursor in either scan direction.
	'things_device_event_cursor',
	// Measured live on production things_v2 (2026-09-02): five indexes over
	// root fields that exist on ZERO documents (`typeId`, `search.tokens`,
	// `acl.readKeys`, `acl.searchKeys`, `deletedAt` — a pre-Things data model
	// no code in this repository has ever written). Each still held one null
	// entry per document: ~137 MB apiece, ~685 MB of index for nothing.
	'kind_1_typeId_1_ownerId_1_updatedAt_-1_shareId_1',
	'kind_1_typeId_1_search.tokens_1_updatedAt_-1_shareId_1',
	'kind_1_typeId_1_acl.searchKeys_1_updatedAt_-1_shareId_1',
	'kind_1_typeId_1_acl.readKeys_1_updatedAt_-1_shareId_1',
	'kind_1_deletedAt_1_updatedAt_-1_shareId_1',
	// CI control-plane rows moved to the ciControl satellite collection; their
	// two purpose-built things indexes (169 MB + 124 MB live) go with them.
	// The satellite keeps its own copy of this key (ci_control_parent_created
	// in createCiControlIndexes); only the things_v2 copy retires.
	// Connections DOES pair thingtime with parentId on things_v2 (the
	// external-post-source feed read), but deliberately serves it as a
	// residual over thingtime_1_createdAt_-1_shareId_1 rather than by
	// reviving this name — see createThingsDataIndexes. Anything that needs
	// this key as a real prefix must reclaim a budget slot under a NEW name,
	// because every name in this list is dropped on every bootstrap.
	// (Legacy comment/reaction cascades ride kind_1_parentId_1_createdAt_1.)
	'thingtime_1_parentId_1_createdAt_-1_shareId_1',
	'things_ci_repository_updated'
	// NOT listed: the unfiltered v1-era `kind_*` and `sandboxExpiresAt_1`
	// originals. Those are swapped for partial replacements by
	// createIndexReplacing (create the new one, THEN drop the old name) so a
	// database never sits without them mid-swap; pruning them here first would
	// open exactly that window. Retiring the seven names above frees enough
	// slots for the swaps to run even on a collection parked at the 64 cap.
] as const;

// Home-only: a custom data endpoint belongs to the user and may legitimately
// use one of these historical names for its own index. Never remove an index
// from that foreign database merely because Thingtime retired its home copy.
export const pruneRetiredHomeThingsIndexes = async (db: any) => {
	const col = taggedCollection(thingsCollection(db), 'things');
	for (const name of RETIRED_THINGS_INDEXES) await dropIndexRetrying(col, name);
};

// `<name>__rebuild` twins are the transient same-key indexes the
// rebuild-things-indexes migration holds while it drops and recreates a
// unique index (migrations/ciControlRelocationCore.ts). A rebuild that was
// interrupted (deploy, timeout) can leave them behind, each occupying one of
// the 64 slots the plan below needs — and because the migration runner
// bootstraps indexes before it runs (acquireMigrationLease awaits
// ensureIndexes), the migration that would clean them up could never start.
//
// Which twin is safe to drop depends entirely on whether its ORIGINAL is
// there, because ensureIndexes is not a rare event: mongo-warmup fires it on
// every serverless cold start, so it runs *during* the multi-minute rebuild.
//   - original present → the twin is pure redundancy and dropping it removes
//     no constraint. This is also the shape that actually parked the
//     collection at the cap (an aborted rebuild that created its twins up
//     front), so it is what this prune exists for.
//   - original ABSENT → the twin is orphaned precisely because a rebuild is
//     between its dropIndex and createIndex, and it is then the ONLY thing
//     holding that unique key. Dropping it leaves the key completely
//     unprotected while rebuild-things-indexes still reports it as twinned
//     ("protected by a same-key twin throughout"), so leave it to the
//     rebuild's own reconcileRebuildTwins.
// The exception is a collection with no free slot at all: there a stuck boot
// ensure is the worse failure, so orphans are dropped to make room and the
// plan below recreates the original moments later.
export const REBUILD_TWIN_SUFFIX = '__rebuild';
export const pruneRebuildTwins = async (db: any): Promise<string[]> => {
	const raw = thingsCollection(db);
	let names: string[] = [];
	try {
		names = (await raw.indexes()).map((index: any) => String(index.name));
	} catch (err: any) {
		// NamespaceNotFound (26): a fresh database has no things collection yet
		if (err?.code === 26 || err?.codeName === 'NamespaceNotFound') return [];
		throw err;
	}
	const present = new Set(names);
	const originalOf = (twin: string) => twin.slice(0, -REBUILD_TWIN_SUFFIX.length);
	const twins = names.filter((name) => name.endsWith(REBUILD_TWIN_SUFFIX));
	const col = taggedCollection(raw, 'things');
	const dropped: string[] = [];
	for (const name of twins.filter((name) => present.has(originalOf(name)))) {
		await dropIndexRetrying(col, name);
		dropped.push(name);
	}
	const orphans = twins.filter((name) => !present.has(originalOf(name)));
	if (orphans.length && names.length - dropped.length >= MONGODB_COLLECTION_INDEX_LIMIT) {
		for (const name of orphans) {
			await dropIndexRetrying(col, name);
			dropped.push(name);
		}
	}
	return dropped;
};

// Pre-release mesh builds used one unique/TTL index per protected device kind
// and could take `things_v2` to MongoDB's hard 64-index ceiling. Converge those
// rows and indexes before the normal parallel ensure: first backfill the shared
// fields, drop only the non-unique legacy TTL indexes to make room, create the
// replacement constraints, then remove the redundant unique indexes. This
// preserves uniqueness throughout upgrades and leaves future index headroom.
export const migrateDeviceIndexLayout = async (db: any) => {
	const raw = thingsCollection(db);
	const col = taggedCollection(raw, 'things');
	const keyFields = [
		'$crystal.deviceKey',
		'$crystal.deviceStateKey',
		'$crystal.deviceConnectorKey',
		'$crystal.deviceCommandKey',
		'$crystal.deviceEventKey',
		'$crystal.deviceAiLiveStateKey',
		'$crystal.liveEventSequenceKey',
		'$crystal.deviceApprovalKey',
		'$crystal.deviceScreenKey'
	];
	await raw.updateMany(
		{
			// Only rows that predate the root `uniqueKeys` stamp need the legacy
			// crystal mirror. `newDeviceThing` now stamps root keys and deliberately
			// leaves `crystal.deviceUniqueKeys` unset, so without this guard every
			// device row written since the last cold start matches again and the
			// bootstrap resurrects the field the consolidation removed — an
			// unaccounted `raw` write (it bypasses the storage ledger) on the
			// hottest collection, on a filter that never converges.
			uniqueKeys: { $exists: false },
			'crystal.deviceUniqueKeys': { $exists: false },
			$or: keyFields.map((field) => ({ [field.slice(1)]: { $type: 'string' } }))
		},
		[
			{
				$set: {
					'crystal.deviceUniqueKeys': {
						$setUnion: [
							{
								$filter: {
									input: keyFields,
									as: 'key',
									cond: { $eq: [{ $type: '$$key' }, 'string'] }
								}
							},
							[]
						]
					}
				}
			}
		]
	);
	// Fold the five pre-release uniqueness families into the existing protected
	// root uniqueKeys index before removing their one-index-per-field copies.
	// One cursor covers all affected rows and adds Binary domain keys in bounded
	// batches; $addToSet makes repeated bootstraps idempotent.
	await backfillConsolidatedThingUniqueKeys(raw);
	await raw.updateMany(
		{
			thingtime: { $in: ['device-command', 'device-command-event'] },
			'crystal.expiresAt': { $type: 'date' },
			'crystal.deviceTtlAt': { $exists: false }
		},
		[{ $set: { 'crystal.deviceTtlAt': '$crystal.expiresAt' } }]
	);
	await raw.updateMany(
		{
			thingtime: 'device-approval',
			'crystal.approvalTtlAt': { $type: 'date' },
			'crystal.deviceTtlAt': { $exists: false }
		},
		[{ $set: { 'crystal.deviceTtlAt': '$crystal.approvalTtlAt' } }]
	);
	for (const name of LEGACY_DEVICE_TTL_INDEXES) await dropIndexRetrying(col, name);
	await col.createIndex(
		{ 'crystal.deviceTtlAt': 1 },
		{
			name: 'things_device_ttl',
			expireAfterSeconds: 0,
			partialFilterExpression: { 'crystal.deviceTtlAt': { $type: 'date' } }
		}
	);
	for (const name of CONSOLIDATED_THING_UNIQUE_INDEXES) await dropIndexRetrying(col, name);
	for (const name of LEGACY_DEVICE_UNIQUE_INDEXES) await dropIndexRetrying(col, name);
};

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

export const createThingsDataIndexes = (db: any): Promise<any>[] => {
  // Tagged so a createIndex failure names the exact `things.<index>` that
  // broke, whether this runs on the home db or a custom endpoint.
  const col = taggedCollection(thingsCollection(db), 'things');
  return [
    col.createIndex({ shareId: 1 }, { unique: true, sparse: true }),
    // generalized uniqueness for system kinds (username:<u>, hashed email
    // keys, schema:<id>, …) AND relationship dedupe (followKey:<a>:<b>,
    // memberKey:, dmKey:, inviteCode:, emojiKey:, friendKey:, voteKey:,
    // linkKey:, AI import hashes, and device idempotency hashes — stamped by
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
    // v1-era (`kind`-rooted) indexes are PARTIAL on kind's existence. Every
    // things-era doc carries `thingtime` and no `kind`, so an unfiltered kind
    // index holds one null entry per doc — five of them, each ~124–142 MB on
    // production where NOT ONE document has `kind` (measured 2026-09-02) —
    // and every insert wrote five useless keys. The planner still uses a
    // partial index for any predicate that implies `kind` exists (equality,
    // $in), which is every v1 branch in postMatch/cascade/legacy counts.
    // Custom data-plane endpoints holding unmigrated v1 docs keep exactly the
    // same coverage; the auto-named unfiltered originals are retired
    // (RETIRED_THINGS_INDEXES) or swapped in place here.
    createIndexReplacing(
      col,
      { kind: 1, visibility: 1, createdAt: -1, shareId: 1 },
      { name: 'things_v1_kind_visibility_created', partialFilterExpression: { kind: { $exists: true } } },
      ['kind_1_visibility_1_createdAt_-1_shareId_1']
    ),
    createIndexReplacing(
      col,
      { kind: 1, ownerId: 1, createdAt: -1, shareId: 1 },
      { name: 'things_v1_kind_owner_created', partialFilterExpression: { kind: { $exists: true } } },
      ['kind_1_ownerId_1_createdAt_-1_shareId_1']
    ),
    // embed SDK: listEmbeddedThings pages a single owner's `kind: 'embed'`
    // things by most-recently-updated, so that sort needs its own index
    createIndexReplacing(
      col,
      { kind: 1, ownerId: 1, updatedAt: -1, shareId: 1 },
      { name: 'things_v1_kind_owner_updated', partialFilterExpression: { kind: { $exists: true } } },
      ['kind_1_ownerId_1_updatedAt_-1_shareId_1']
    ),
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
    createIndexReplacing(
      col,
      { kind: 1, createdAt: -1, shareId: 1 },
      { name: 'things_v1_kind_created', partialFilterExpression: { kind: { $exists: true } } },
      ['kind_1_createdAt_-1_shareId_1']
    ),
    // Admin user/app snapshots filter by thingtime without ownerId, then
    // take a small newest-first window with a stable shareId tiebreaker.
    col.createIndex({ thingtime: 1, createdAt: -1, shareId: 1 }),
    // Public theme gallery (`GET /api/v1/themes/shared` with no id): public
    // themes, newest-UPDATED first. Every other index here sorts by createdAt,
    // so the gallery's `updatedAt` sort had nothing to ride: the planner
    // narrowed on thingtime, then blocking-sorted EVERY theme thing in memory
    // just to take 60 — a sort that grows with the theme corpus and eventually
    // trips Mongo's 32 MB in-memory sort limit outright.
    //
    // `acl` deliberately stays OUT of the key and remains a residual: it is an
    // array, `thingtime` is an array, and a compound over both is a parallel
    // -array index that Mongo refuses to write to at all. The residual is cheap
    // because the walk is already scoped to themes and stops at the page.
    //
    // Verified on a local 40k-theme / 40k-post dataset: 40,000 keys and 40,000
    // docs examined with a blocking SORT, down to 600 and 600 with none.
    //
    // PARTIAL on thingtime:'theme' — `things` is the whole platform (posts,
    // comments, reactions, chat messages, attachments, every ci-* record), and
    // an unfiltered key would add an entry per thingtime element to EVERY one
    // of those writes, forever, to serve one gallery read. The partial filter
    // is the same tool `notification_unread` below uses for the same reason.
    // Both theme queries name thingtime:'theme' explicitly, so the planner can
    // still prove the predicate implies the filter and use the index for the
    // gallery AND listThemesForUser; no other query in the codebase sorts
    // `things` by a bare updatedAt under a thingtime equality.
    //
    // createIndexReplacing (not a bare createIndex) because a same-key index
    // with different options is IndexOptionsConflict(85): any environment that
    // already built the unfiltered `thingtime_1_updatedAt_-1` gets it swapped
    // for the scoped one instead of failing the whole ensure batch.
    createIndexReplacing(
      col,
      { thingtime: 1, updatedAt: -1 },
      { name: 'theme_gallery_updated', partialFilterExpression: { thingtime: 'theme' } },
      ['thingtime_1_updatedAt_-1']
    ),
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
		col.createIndex(
			{ ownerId: 1, sourceDeviceId: 1, createdAt: -1, shareId: 1 },
			{ partialFilterExpression: { sourceDeviceId: { $exists: true } } }
		),
    // /things folder browsing: one owner's direct children of one folder,
    // newest first — fully index-provided including the page sort
    col.createIndex({ ownerId: 1, folderId: 1, createdAt: -1, shareId: 1 }),
    // (CI control-plane rows and their two indexes — per-parent ci-event
    // history and the repository/updatedAt dashboard sort — live on the
    // ciControl satellite: see createCiControlIndexes.)
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
		col.createIndex({ ownerId: 1, attachmentState: 1, attachmentExpiresAt: 1, shareId: 1 }, { partialFilterExpression: { thingtime: 'attachment' } }),
    // Hourly global draft reaper: expiry is the leading key so a bounded scan
    // across owners never walks the whole attachment partition. Attached
    // rows clear attachmentExpiresAt when bound and therefore do not enter the
    // useful key range. This must remain a normal index, never Mongo TTL.
		col.createIndex({ attachmentExpiresAt: 1, shareId: 1 }, { partialFilterExpression: { thingtime: 'attachment' } }),
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
    // CONNECTIONS ADDS NO INDEX OF ITS OWN — deliberately. This plan sits at
    // exactly the indexBudget.test.ts ceiling (64 hard limit minus the 4-slot
    // upgrade reserve), so a new feature has to ride the existing shapes or
    // reclaim a slot. Connections rides two that already exist:
    //   • the feed read (the viewer's accounts' membership rows, newest first,
    //     chrono cursor) and the external-account-link reverse lookup ("who
    //     links this account") ride `thingtime_1_createdAt_-1_shareId_1`
    //     above. `thingtime` equality bounds the scan to the one kind, and
    //     (createdAt:-1, shareId:1) IS the page sort, so it is index-provided
    //     rather than a blocking sort; `parentId` (the account) applies as a
    //     residual filter on the way through.
    //   • "does this viewer's account source this exact post?" narrows on
    //     (targetId, thingtime) above, which is already exactly that post's
    //     membership rows — one per sourcing account — leaving parentId a
    //     residual over a handful of docs.
    // Read the first bullet literally: `parentId` is RESIDUAL there, not part
    // of the index key, so the feed read walks every external-post-source row
    // newer than the cursor and keeps the viewer's. That is cheap while the
    // over-fetch is 2×limit and sync volume is low, and it is the thing to
    // re-measure first if connections traffic grows — the answer would be a
    // partial index on this kind, NOT the two names below.
    // That is also why external-post-source/external-account-link stamp a root
    // `parentId` (the account's shareId) alongside crystal.accountId: it keeps
    // the residual a root-field compare. Both of the purpose-built shapes that
    // would serve it as an index PREFIX —
    // `thingtime_1_crystal.accountId_1_createdAt_-1_shareId_1` and
    // `thingtime_1_parentId_1_createdAt_-1_shareId_1` — are listed in
    // RETIRED_THINGS_INDEXES and dropped from this collection on every
    // bootstrap, so re-creating either name here would drop and rebuild it
    // forever. Reclaim a slot and give a new index a NEW name instead.
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
    createIndexReplacing(
      col,
      { kind: 1, parentId: 1, createdAt: 1 },
      { name: 'things_v1_kind_parent_created', partialFilterExpression: { kind: { $exists: true } } },
      ['kind_1_parentId_1_createdAt_1']
    ),
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
		col.createIndex({ 'crystal.targetId': 1, 'crystal.linkKind': 1 }, { partialFilterExpression: { 'crystal.targetId': { $exists: true } } }),
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
    // Subspace post feeds (api/utils/subspaces): every /s/<slug> sort reads the
    // newest posts of ONE subspace — chronological pages for "new", a bounded
    // newest-first candidate window for hot/top/rising/controversial (the ranked
    // home-feed pattern, so vote tallies stay relational and no denormalized
    // score field is ever needed). Partial on the string ref so posts outside
    // any subspace never enter it; the match always carries thingtime:'post',
    // so a free-form data crystal squatting the key can't surface.
    col.createIndex(
      { 'crystal.subspaceId': 1, createdAt: -1, shareId: 1 },
      { name: 'things_subspace_posts', partialFilterExpression: { 'crystal.subspaceId': { $type: 'string' } } }
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
    // Poll voting DOES ship on this branch (things/vote.ts), but it does not
    // get its old kind-blind things_vote_key_unique back — that index is the
    // squat class this family just retired. 'vote' is already in
    // RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, so one-vote-per-(poll, user) belongs
    // in the protected root uniqueKeys stamp above, not on a crystal path.

		// AI-import and device idempotency hashes ride the protected root
		// uniqueKeys index above. Do not reintroduce per-crystal unique indexes:
		// they consume five slots and place plain hashes in the wildcard text
		// index instead of its Binary-safe namespace.
		col.createIndex(
			{ ownerId: 1, targetId: 1, 'crystal.approvalPendingSlot': 1 },
			{
				name: 'things_device_approval_pending_slot_unique',
				unique: true,
				partialFilterExpression: { 'crystal.approvalPendingSlot': { $type: 'number' } }
			}
		),
		col.createIndex(
			{ ownerId: 1, targetId: 1, 'crystal.status': 1, createdAt: 1, shareId: 1 },
			{ name: 'things_device_command_queue', partialFilterExpression: { 'crystal.deviceCommandKey': { $type: 'string' } } }
		),
		col.createIndex(
			{ ownerId: 1, targetId: 1, 'crystal.deviceControlEventScopeKey': 1, createdAt: -1, shareId: -1 },
			{ name: 'things_device_control_event_retention', partialFilterExpression: { 'crystal.deviceControlEventScopeKey': { $type: 'string' } } }
		),
		col.createIndex(
			{ ownerId: 1, targetId: 1, 'crystal.liveControlEventScopeKey': 1, createdAt: -1, shareId: -1 },
			{ name: 'things_device_live_event_retention', partialFilterExpression: { 'crystal.liveControlEventScopeKey': { $type: 'string' } } }
		),
		col.createIndex(
			{ 'crystal.externalLiveMessageRootKey': 1, 'crystal.externalSource.segmentIndex': 1 },
			{ name: 'things_external_live_message_segments', partialFilterExpression: { 'crystal.externalLiveMessageRootKey': { $type: 'string' } } }
		),
		col.createIndex(
			{ 'crystal.deviceTtlAt': 1 },
			{
				name: 'things_device_ttl',
				expireAfterSeconds: 0,
				partialFilterExpression: { 'crystal.deviceTtlAt': { $type: 'date' } }
			}
		),
		col.createIndex(
			{ ownerId: 1, targetId: 1, 'crystal.status': 1, createdAt: -1, shareId: 1 },
			{ name: 'things_device_approval_list', partialFilterExpression: { 'crystal.deviceApprovalKey': { $type: 'string' } } }
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
    // Partial on the field's existence: TTL reaping only ever touches docs
    // that carry the stamp, and an unfiltered TTL index held one null entry
    // per thing (10.6 MB live for a field on zero documents).
    createIndexReplacing(
      col,
      { sandboxExpiresAt: 1 },
      { name: 'things_sandbox_expires_at', expireAfterSeconds: 0, partialFilterExpression: { sandboxExpiresAt: { $exists: true } } },
      ['sandboxExpiresAt_1']
    ),
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

// CI control-plane satellite (`ciControl`, home-pinned — see
// getCiControlCollection). Six indexes, sized for exactly the reads in
// api/utils/ciControl: the admin dashboard (one kind for one repository,
// newest-updated first, plus exact status counts), the per-parent ci-event
// history drawer, deterministic-shareId upserts, automation/policy lookups by
// external id, and TTL retention. No wildcard text index: these rows are never
// searched, and on `things` they were 18% of a 3.1 GB text index.
export const createCiControlIndexes = (db: any): Promise<any>[] => {
  const col = taggedCollection(db.collection(physicalCollectionName('ciControl')), 'ciControl');
  return [
    // deterministic ids: recordCiEvent/upsertCiEntity/claimCiDispatchRoute
    // all key their idempotent upserts on shareId
    col.createIndex({ shareId: 1 }, { name: 'ci_control_share_id_unique', unique: true }),
    // dashboard readKind: {thingtime, crystal.repository} sorted
    // (updatedAt desc, shareId asc) — fully index-provided page sort
    col.createIndex(CI_DASHBOARD_UPDATED_INDEX, { name: 'ci_control_repository_updated' }),
    // dashboard stats: exact countDocuments over {thingtime, repository,
    // crystal.status ∈ [...]} — an index-only count instead of a residual
    // filter over every run/PR/preview of the repository
    col.createIndex({ thingtime: 1, 'crystal.repository': 1, 'crystal.status': 1 }, { name: 'ci_control_repository_status' }),
    // automation policy + dispatch/stack lookups by provider external id
    col.createIndex({ thingtime: 1, 'crystal.repository': 1, 'crystal.externalId': 1 }, { name: 'ci_control_repository_external_id' }),
    // per-parent history: listCiEventsForParents pages one parent's events
    // newest-first (repository is a cheap residual on an already-narrow set)
    col.createIndex({ thingtime: 1, parentId: 1, createdAt: -1, shareId: 1 }, { name: 'ci_control_parent_created' }),
    // retention: ciControl/retentionCore stamps root expiresAt on every
    // event/job/activity row (entities without a window carry no field, and
    // TTL skips docs without one)
    col.createIndex({ expiresAt: 1 }, { name: 'ci_control_expires_at', expireAfterSeconds: 0 })
  ];
};

// Home-only `things` indexes that ride beside createThingsDataIndexes in the
// boot ensure (never on a custom endpoint's database).
const createHomeOnlyThingsIndexes = (db: any): Promise<any>[] => [
  // Migration diagnostics exist only on Thingtime's HOME plane. Keep this
  // live TTL deleter out of createThingsDataIndexes(), which also installs
  // indexes on user-supplied custom Mongo endpoints.
  taggedCollection(thingsCollection(db), 'things').createIndex(
    { expiresAt: 1 },
    {
      name: 'migration_diagnostic_expires_at',
      expireAfterSeconds: 0,
      partialFilterExpression: { thingtime: MIGRATION_DIAGNOSTIC_THINGTIME }
    }
  )
];

// The complete home `things` plan in one call: what the boot ensure converges
// to, and what the rebuild-things-indexes migration re-runs after dropping.
export const ensureHomeThingsIndexPlan = (db: any): Promise<any> =>
  Promise.all([...createThingsDataIndexes(db), ...createHomeOnlyThingsIndexes(db)]);

// The index NAMES the home `things` plan owns, derived by replaying the plan
// against an in-memory recorder (the plan is only ever expressed as
// createIndex calls, so this cannot drift from it). The rebuild migration
// drops and recreates exactly these, and leaves every other index on the
// collection alone.
export const thingsIndexPlanNames = async (): Promise<Set<string>> => {
  const names = new Set<string>();
  const recorder = {
    collection: () => ({
      createIndex: async (keys: Record<string, unknown>, options: Record<string, unknown> = {}) => {
        const name = String(
          options.name ||
            Object.entries(keys)
              .map(([field, direction]) => `${field}_${direction}`)
              .join('_')
        );
        names.add(name);
        return name;
      },
      dropIndex: async () => undefined
    })
  };
  await ensureHomeThingsIndexPlan(recorder);
  return names;
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

export const createWatchPairingIndexes = (sessions: any) => [
	sessions.createIndex({ 'meta.userCodeHash': 1, expiresAt: 1 }, { partialFilterExpression: { purpose: 'watch-pairing' } }),
	sessions.createIndex({ 'meta.userCodeHash': 1 }, { name: 'watch_active_pin_unique', unique: true, partialFilterExpression: { purpose: 'watch-pairing', 'meta.shortCodeActive': true } }),
	sessions.createIndex({ 'meta.recipientUserId': 1, createdAt: -1 }, { partialFilterExpression: { purpose: 'watch-pairing' } })
];

export const ensureIndexes = async () => {
  if (!indexesEnsured) {
    indexesEnsured = (async () => {
      // HOME db explicitly — ensureIndexes can run inside a request that
      // carries a custom endpoint override (e.g. via enforceRateLimit), and
      // the control-plane index set must never land on an override DB.
      const db = await getHomeThingtimeDb();
			// Capacity recovery must happen before either the shared device indexes
			// or the normal parallel ensure. On a full collection, trying to create
			// first can never reach the later cleanup.
			await pruneRetiredHomeThingsIndexes(db);
			await pruneRebuildTwins(db);
			await migrateDeviceIndexLayout(db);
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
				...createWatchPairingIndexes(col('sessions')),
        // TTL: reap sessions once expiresAt passes. getLiveSession already
        // treats past-expiry docs as dead, so deletion removes nothing usable —
        // without it expired/revoked sessions (app grants especially) pile up
        // forever. Docs with expiresAt: null are exempt (TTL skips non-dates).
        col('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // deleteApp revokes app sessions by clientId ACROSS users — without
        // this the sweep scans the whole sessions collection. Partial so the
        // (much larger) browser/service session population stays out.
        col('sessions').createIndex({ 'meta.clientId': 1 }, { partialFilterExpression: { purpose: 'app' } }),
				// Device pairing/node credentials are opaque random tokens; only
				// domain-separated SHA-256 hashes are persisted and indexed. The
				// owner/device index powers safe presence aggregation and revocation.
				col('sessions').createIndex(
					{ 'meta.pairingSecretHash': 1 },
					{ name: 'sessions_device_pairing_hash_unique', unique: true, partialFilterExpression: { purpose: 'device-pairing' } }
				),
				col('sessions').createIndex(
					{ 'meta.deviceCredentialHash': 1 },
					{ name: 'sessions_device_credential_hash_unique', unique: true, partialFilterExpression: { purpose: 'device' } }
				),
				col('sessions').createIndex(
					{ purpose: 1, userId: 1, 'meta.deviceId': 1 },
					{ name: 'sessions_device_owner', partialFilterExpression: { purpose: 'device' } }
				),
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
        // home-only `things` indexes (migration-diagnostic TTL)
        ...createHomeOnlyThingsIndexes(db),
        // the CI control-plane satellite — see createCiControlIndexes
        ...createCiControlIndexes(db),
        col('feedAlgorithms').createIndex({ shareId: 1 }, { unique: true }),
        col('feedAlgorithms').createIndex({ ownerId: 1 }),
        // global app settings singletons (rate-limit config lives here)
        col('settings').createIndex({ key: 1 }, { unique: true }),
        // general per-endpoint rate-limit windows; TTL reaps expired windows
        col('rateLimits').createIndex({ key: 1 }, { unique: true }),
        col('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        col('deploymentPeers').createIndex({ origin: 1 }, { unique: true }),
        col('deploymentPeers').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // listActivePeers filters by federationId, then pages lastSeenAt desc /
        // origin asc. The federation prefix is new: name the index and retire
        // the auto-named `lastSeenAt_-1_origin_1` it supersedes, or every
        // already-deployed database keeps both forever (a plain createIndex
        // with a new key shape never drops the old one).
        createIndexReplacing(
          col('deploymentPeers'),
          { federationId: 1, lastSeenAt: -1, origin: 1 },
          { name: 'deployment_peers_federation_recent' },
          ['lastSeenAt_-1_origin_1']
        ),
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
