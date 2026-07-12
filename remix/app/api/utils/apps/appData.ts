import { randomUUID } from 'node:crypto';

import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import {
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_APP_DATA_KEYS_PER_APP_USER,
  MAX_APP_DATA_KEY_CHARS,
  MAX_APP_DATA_VALUE_BYTES
} from '~/schemas/registry';

// Per-(user, app) key/value storage for embedded apps — each entry is its own
// atomic `things` doc (thingtime ['app-data'], crystal { appId, key, value }),
// owned by the END USER with acl ["tt:user"], per FUNDAMENTALS.md §3: bounded
// docs, per-item writes, a partial unique index on (ownerId, appId, key) for
// race-safe upserts, and natural paging. Written only through /api/v1/app-data
// with an app-scoped Bearer token.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type AppDataEntry = { key: string; value: unknown; updatedAt: Date };

const APP_DATA_KEY_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${MAX_APP_DATA_KEY_CHARS - 1}}$`);

export const sanitizeAppDataKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return APP_DATA_KEY_RE.test(key) ? key : null;
};

const toEntry = (doc: any): AppDataEntry => ({
  key: doc.crystal?.key,
  value: doc.crystal?.value ?? null,
  updatedAt: doc.updatedAt
});

export const getAppData = async (
  ownerId: string,
  appId: string,
  key: string
): Promise<AppDataEntry | null> => {
  const things = await getThingsCollection();
  const doc = await things.findOne({ thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key });
  return doc ? toEntry(doc) : null;
};

export const listAppData = async (ownerId: string, appId: string): Promise<AppDataEntry[]> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'app-data', ownerId, 'crystal.appId': appId })
    .sort({ 'crystal.key': 1 })
    .limit(MAX_APP_DATA_KEYS_PER_APP_USER)
    .toArray();
  return docs.map(toEntry);
};

export const setAppData = async (
  ownerId: string,
  appId: string,
  rawKey: unknown,
  value: unknown
): Promise<{ ok: true; entry: AppDataEntry } | Fail> => {
  const key = sanitizeAppDataKey(rawKey);
  if (!key) {
    return fail(400, `Keys are 1-${MAX_APP_DATA_KEY_CHARS} chars of letters, digits, . _ : - (starting alphanumeric)`);
  }

  if (value === undefined) return fail(400, 'value is required (use delete to remove a key)');
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail(400, 'value must be JSON-serializable');
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_APP_DATA_VALUE_BYTES) {
    return fail(400, `value must be JSON up to ${MAX_APP_DATA_VALUE_BYTES / 1024}KB`);
  }

  await ensureIndexes();
  const things = await getThingsCollection();
  const filter = { thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key };

  // update-then-insert, retried: a racing set() of the same new key loses the
  // insert to the unique index and folds into an update on the next pass; a
  // set() racing a delete of the winner just inserts on the next pass. Two
  // full passes always suffice for one interleaving; the bound only trips
  // under sustained adversarial interleaving, which gets a structured 503
  // instead of a raw duplicate-key 500.
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();

    const updated = await things.findOneAndUpdate(
      filter,
      { $set: { 'crystal.value': value, updatedAt: now } },
      { returnDocument: 'after' }
    );
    if (updated) return { ok: true, entry: toEntry(updated) };

    // New key: soft product cap on keys per (user, app), then insert.
    const count = await things.countDocuments({ thingtime: 'app-data', ownerId, 'crystal.appId': appId });
    if (count >= MAX_APP_DATA_KEYS_PER_APP_USER) {
      return fail(400, `An app can store at most ${MAX_APP_DATA_KEYS_PER_APP_USER} keys per user`);
    }

    const doc = {
      shareId: randomUUID(),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      thingtime: ['app-data'],
      crystal: { appId, key, value },
      ownerId,
      acl: [ACL_OWNER],
      targetId: null,
      tags: [],
      createdAt: now,
      updatedAt: now
    };

    try {
      await things.insertOne(doc as any);
      return { ok: true, entry: toEntry(doc) };
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // lost the insert race — loop back to the update path
    }
  }

  return fail(503, 'Storage is busy for this key — try again');
};

export const deleteAppData = async (
  ownerId: string,
  appId: string,
  rawKey: unknown
): Promise<{ ok: true; deleted: boolean } | Fail> => {
  const key = sanitizeAppDataKey(rawKey);
  if (!key) return fail(400, 'key is required');

  const things = await getThingsCollection();
  const result = await things.deleteOne({ thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key });
  return { ok: true, deleted: result.deletedCount > 0 };
};
