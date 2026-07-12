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
        db.collection('things').createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ thingtime: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ targetId: 1, thingtime: 1, createdAt: 1, shareId: 1 }),
        // acl and thingtime are both arrays — Mongo forbids two multikey fields
        // in one compound index, so the audience index stands alone
        db.collection('things').createIndex({ acl: 1, createdAt: -1, shareId: 1 }),
        // One weighted wildcard text index powers /api/v1/things/search ranked
        // text mode across every string field of every thing (a collection can
        // hold at most ONE text index — this is it). language_override points at
        // a field no crystal will ever set, so user data containing a
        // `language` key can never break inserts with an unsupported language.
        db.collection('things').createIndex(
          { '$**': 'text' },
          {
            name: 'things_text_search',
            weights: { 'crystal.name': 10, 'crystal.text': 10, 'crystal.title': 8, 'crystal.listing.title': 8, tags: 6 },
            default_language: 'english',
            language_override: 'ttTextLanguage'
          }
        ),
        // One reaction per (target, user, emoji token): makes toggle-on an
        // idempotent upsert and dedups even under races. Partial via
        // crystal.emoji-exists so it only applies to reaction things.
        db.collection('things').createIndex(
          { targetId: 1, ownerId: 1, 'crystal.emoji': 1 },
          { unique: true, partialFilterExpression: { 'crystal.emoji': { $exists: true } } }
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
