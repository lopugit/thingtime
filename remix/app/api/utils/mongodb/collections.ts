import { getMongoUri } from './config';
import { getMongoDb } from './mongodb';

// Memoised client so a single request (and a warm serverless instance) reuses
// one connection instead of opening a new MongoClient per collection lookup.
let clientPromise: Promise<any> | null = null;

const getClientCached = async () => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { MongoClient } = await getMongoDb();
      const client = new MongoClient(getMongoUri(), {});
      await client.connect();
      return client;
    })().catch((err) => {
      // don't cache a failed connection — let the next call retry
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
};

// Single `thingtime` database (see FUNDAMENTALS.md §3).
export const getThingtimeDb = async () => (await getClientCached()).db('thingtime');

export const getUsersCollection = async () => (await getThingtimeDb()).collection('users');
export const getSessionsCollection = async () => (await getThingtimeDb()).collection('sessions');
export const getRostersCollection = async () => (await getThingtimeDb()).collection('rosters');
export const getThingsCollection = async () => (await getThingtimeDb()).collection('things');
export const getEmailVerificationsCollection = async () => (await getThingtimeDb()).collection('emailVerifications');
export const getLopuMusingRateLimitsCollection = async () =>
  (await getThingtimeDb()).collection('lopuMusingRateLimits');
export const getThemesCollection = async () => (await getThingtimeDb()).collection('themes');
export const getWaitlistCollection = async () => (await getThingtimeDb()).collection('waitlist');
export const getFeedAlgorithmsCollection = async () => (await getThingtimeDb()).collection('feedAlgorithms');
// Global, admin-editable app settings (singleton docs keyed by `key`, e.g. the
// rate-limit config) and the general per-endpoint rate-limit windows.
export const getSettingsCollection = async () => (await getThingtimeDb()).collection('settings');
export const getRateLimitsCollection = async () => (await getThingtimeDb()).collection('rateLimits');
// Owned email layer (see api/utils/email): every send writes an outbox row to
// email_messages; events/suppression/unsubscribes back deliverability.
export const getEmailMessagesCollection = async () => (await getThingtimeDb()).collection('email_messages');
export const getEmailEventsCollection = async () => (await getThingtimeDb()).collection('email_events');
export const getEmailTemplatesCollection = async () => (await getThingtimeDb()).collection('email_templates');
export const getEmailSubscriptionsCollection = async () => (await getThingtimeDb()).collection('email_subscriptions');
export const getEmailSuppressionListCollection = async () => (await getThingtimeDb()).collection('email_suppression_list');
export const getEmailUnsubscribesCollection = async () => (await getThingtimeDb()).collection('email_unsubscribes');
export const getEmailIdentitiesCollection = async () => (await getThingtimeDb()).collection('email_identities');
// Single-use auth tokens: password-reset links and login OTP challenges, both
// TTL-reaped (mirrors emailVerifications).
export const getPasswordResetsCollection = async () => (await getThingtimeDb()).collection('passwordResets');
export const getAuthOtpsCollection = async () => (await getThingtimeDb()).collection('authOtps');

// Idempotently create server-side collections + their indexes. createIndex
// creates the collection if it doesn't exist yet, so this also bootstraps an
// empty `thingtime` db on first run. Memoised so it runs at most once per
// process. The unique indexes are the real source of truth that
// usernames/emails/tokens can't be duplicated (the app-level findUser checks are
// racy on their own).
let indexesEnsured: Promise<void> | null = null;

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

export const ensureIndexes = async () => {
  if (!indexesEnsured) {
    indexesEnsured = (async () => {
      const db = await getThingtimeDb();
      await Promise.all([
        db.collection('users').createIndex({ username: 1 }, { unique: true }),
        db.collection('users').createIndex({ email: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ jti: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ userId: 1 }),
        // TTL: reap sessions once expiresAt passes. getLiveSession already
        // treats past-expiry docs as dead, so deletion removes nothing usable —
        // without it expired/revoked sessions (app grants especially) pile up
        // forever. Docs with expiresAt: null are exempt (TTL skips non-dates).
        db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // deleteApp revokes app sessions by clientId ACROSS users — without
        // this the sweep scans the whole sessions collection. Partial so the
        // (much larger) browser/service session population stays out.
        db.collection('sessions').createIndex(
          { 'meta.clientId': 1 },
          { partialFilterExpression: { purpose: 'app' } }
        ),
        // account-switcher rosters: one doc per browser, entries reference
        // sessions by jti; TTL reaps rosters abandoned past their rolling expiry
        db.collection('rosters').createIndex({ rosterId: 1 }, { unique: true }),
        db.collection('rosters').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('emailVerifications').createIndex({ token: 1 }, { unique: true }),
        db.collection('emailVerifications').createIndex({ userId: 1 }),
        // password-reset links + login OTP challenges: single-use tokens, TTL
        // reaps them at expiresAt (consumed docs keep their consumedAt until then)
        db.collection('passwordResets').createIndex({ token: 1 }, { unique: true }),
        db.collection('passwordResets').createIndex({ userId: 1 }),
        db.collection('passwordResets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('authOtps').createIndex({ challenge: 1 }, { unique: true }),
        db.collection('authOtps').createIndex({ userId: 1 }),
        db.collection('authOtps').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        // owned email layer: outbox + delivery events + list hygiene
        db.collection('email_messages').createIndex({ createdAt: -1 }),
        db.collection('email_messages').createIndex({ to: 1 }),
        db.collection('email_messages').createIndex({ stream: 1, status: 1, createdAt: -1 }),
        db.collection('email_messages').createIndex({ providerMessageId: 1 }, { sparse: true }),
        db.collection('email_events').createIndex({ emailMessageId: 1 }),
        db.collection('email_events').createIndex({ providerMessageId: 1 }),
        db.collection('email_events').createIndex({ eventType: 1, receivedAt: -1 }),
        db.collection('email_templates').createIndex({ key: 1 }, { unique: true }),
        db.collection('email_subscriptions').createIndex({ email: 1, listId: 1 }, { unique: true }),
        db.collection('email_subscriptions').createIndex({ listId: 1, status: 1 }),
        db.collection('email_suppression_list').createIndex({ email: 1 }, { unique: true }),
        db.collection('email_unsubscribes').createIndex({ email: 1, listId: 1 }, { unique: true }),
        db.collection('email_identities').createIndex({ identity: 1 }, { unique: true }),
        db.collection('lopuMusingRateLimits').createIndex({ key: 1 }, { unique: true }),
        db.collection('lopuMusingRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('themes').createIndex({ shareId: 1 }, { unique: true }),
        db.collection('themes').createIndex({ ownerId: 1 }),
        db.collection('waitlist').createIndex({ email: 1 }, { unique: true }),
        // everything in `things` is a thing (see api/utils/things + app/schemas);
        // shareId is included so the (createdAt desc, shareId asc) page sort is
        // fully index-provided instead of an in-memory sort per request. The
        // kind-prefixed indexes serve v1-era docs until the things migration
        // runs; the thingtime-prefixed ones serve v2 (multikey on the schema-id
        // array), and targetId serves comment/reaction/share lookups.
        db.collection('things').createIndex({ shareId: 1 }, { unique: true, sparse: true }),
        // generalized uniqueness for system kinds (username:<u>, hashed email
        // keys, schema:<id>, …): multikey unique — each element unique across
        // the collection; sparse so ordinary things skip the index entirely
        db.collection('things').createIndex({ uniqueKeys: 1 }, { unique: true, sparse: true }),
        // login + people-search lookups on user things (thingtime is the only
        // multikey field here, so the compound is legal)
        db.collection('things').createIndex({ thingtime: 1, 'crystal.username': 1 }),
        // admin roster: a partial index over just the (rare) admin user things,
        // so listAdmins is a few-entry scan, not a full-user-base fetch+filter
        db.collection('things').createIndex(
          { secureAdmin: 1 },
          { partialFilterExpression: { secureAdmin: true } }
        ),
        db.collection('things').createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ thingtime: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ targetId: 1, thingtime: 1, createdAt: 1, shareId: 1 }),
        // schema-usage counting (schemas/browse decorate): data things are
        // grouped by crystal.schemaId (stamped) with a crystal.schema name
        // fallback for pre-stamp docs — both need index support or every
        // schema browse page scans the whole data partition
        db.collection('things').createIndex({ thingtime: 1, 'crystal.schemaId': 1 }),
        db.collection('things').createIndex({ thingtime: 1, 'crystal.schema': 1 }),
        // acl and thingtime are both arrays — Mongo forbids two multikey fields
        // in one compound index, so the audience index stands alone
        db.collection('things').createIndex({ acl: 1, createdAt: -1, shareId: 1 }),
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
          db.collection('things'),
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
          db.collection('things'),
          { targetId: 1, ownerId: 1, 'crystal.emoji': 1 },
          {
            name: 'things_reaction_unique',
            unique: true,
            partialFilterExpression: { targetId: { $type: 'string' }, 'crystal.emoji': { $exists: true } }
          },
          ['targetId_1_ownerId_1_crystal.emoji_1']
        ),
        // Legacy relational era (kind:'reaction'/'comment' docs written by the
        // pre-unification relational model): aggregation + dedup indexes stay
        // until the things migration converts those docs to thingtime things.
        db.collection('things').createIndex({ kind: 1, parentId: 1, createdAt: 1 }),
        db.collection('things').createIndex(
          { parentId: 1, ownerId: 1, token: 1 },
          { unique: true, partialFilterExpression: { kind: 'reaction' } }
        ),
        db.collection('things').createIndex(
          { commentId: 1 },
          { unique: true, partialFilterExpression: { kind: 'comment' } }
        ),
        // Embed apps ("Login with Thingtime", api/utils/apps): one thing per
        // clientId, ever — a second doc claiming an existing clientId (however
        // created) could answer origin lookups with a different allowlist, so
        // uniqueness is structural. Only app things carry crystal.clientId;
        // app-data things reference the app as crystal.appId instead.
        db.collection('things').createIndex(
          { 'crystal.clientId': 1 },
          { unique: true, partialFilterExpression: { 'crystal.clientId': { $exists: true } } }
        ),
        // App data: one thing per (user, app, key) — set() stays an idempotent
        // insert-or-update under races, and the index serves list-by-(user, app).
        db.collection('things').createIndex(
          { ownerId: 1, 'crystal.appId': 1, 'crystal.key': 1 },
          {
            unique: true,
            partialFilterExpression: { 'crystal.appId': { $exists: true }, 'crystal.key': { $exists: true } }
          }
        ),
        db.collection('feedAlgorithms').createIndex({ shareId: 1 }, { unique: true }),
        db.collection('feedAlgorithms').createIndex({ ownerId: 1 }),
        // global app settings singletons (rate-limit config lives here)
        db.collection('settings').createIndex({ key: 1 }, { unique: true }),
        // general per-endpoint rate-limit windows; TTL reaps expired windows
        db.collection('rateLimits').createIndex({ key: 1 }, { unique: true }),
        db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      ]);
    })().catch((err) => {
      // don't cache a failed run — let the next call retry
      indexesEnsured = null;
      throw err;
    });
  }
  return indexesEnsured;
};
