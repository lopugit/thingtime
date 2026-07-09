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
export const getEmailMessagesCollection = async () => (await getThingtimeDb()).collection('email_messages');
export const getEmailEventsCollection = async () => (await getThingtimeDb()).collection('email_events');
export const getEmailTemplatesCollection = async () => (await getThingtimeDb()).collection('email_templates');
export const getEmailSubscriptionsCollection = async () => (await getThingtimeDb()).collection('email_subscriptions');
export const getEmailSuppressionListCollection = async () => (await getThingtimeDb()).collection('email_suppression_list');
export const getEmailUnsubscribesCollection = async () => (await getThingtimeDb()).collection('email_unsubscribes');
export const getEmailIdentitiesCollection = async () => (await getThingtimeDb()).collection('email_identities');
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
        // feed posts live in `things` under kind:'post' (see api/utils/things);
        // shareId is included so the (createdAt desc, shareId asc) page sort is
        // fully index-provided instead of an in-memory sort per request
        db.collection('things').createIndex({ shareId: 1 }, { unique: true, sparse: true }),
        db.collection('things').createIndex({ kind: 1, visibility: 1, createdAt: -1, shareId: 1 }),
        db.collection('things').createIndex({ kind: 1, ownerId: 1, createdAt: -1, shareId: 1 }),
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
