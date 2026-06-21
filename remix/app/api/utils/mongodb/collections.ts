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
