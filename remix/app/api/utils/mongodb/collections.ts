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
const createIndexReplacing = async (
  collection: any,
  keys: Record<string, any>,
  options: Record<string, any> & { name: string },
  legacyNames: string[] = []
) => {
  for (const legacy of legacyNames) {
    await collection.dropIndex(legacy).catch(() => {}); // absent = fine
  }
  try {
    await collection.createIndex(keys, options);
  } catch (err: any) {
    if (err?.code !== 85 && err?.code !== 86) throw err;
    await collection.dropIndex(options.name).catch(() => {});
    await collection.createIndex(keys, options);
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
        // account-switcher rosters: one doc per browser, entries reference
        // sessions by jti; TTL reaps rosters abandoned past their rolling expiry
        db.collection('rosters').createIndex({ rosterId: 1 }, { unique: true }),
        db.collection('rosters').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('emailVerifications').createIndex({ token: 1 }, { unique: true }),
        db.collection('emailVerifications').createIndex({ userId: 1 }),
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
        db.collection('things').createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ thingtime: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ targetId: 1, thingtime: 1, createdAt: 1, shareId: 1 }),
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
