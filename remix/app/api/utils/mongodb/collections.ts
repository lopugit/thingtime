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
export const getThingsCollection = async () => (await getThingtimeDb()).collection('things');
export const getEmailVerificationsCollection = async () => (await getThingtimeDb()).collection('emailVerifications');
export const getLopuMusingRateLimitsCollection = async () =>
  (await getThingtimeDb()).collection('lopuMusingRateLimits');
export const getThemesCollection = async () => (await getThingtimeDb()).collection('themes');
export const getWaitlistCollection = async () => (await getThingtimeDb()).collection('waitlist');
export const getFeedAlgorithmsCollection = async () => (await getThingtimeDb()).collection('feedAlgorithms');

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
        db.collection('feedAlgorithms').createIndex({ shareId: 1 }, { unique: true }),
        db.collection('feedAlgorithms').createIndex({ ownerId: 1 })
      ]);
    })().catch((err) => {
      // don't cache a failed run — let the next call retry
      indexesEnsured = null;
      throw err;
    });
  }
  return indexesEnsured;
};
