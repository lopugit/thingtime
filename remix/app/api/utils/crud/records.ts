import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import type { PublicUser } from '../auth/users';
import { ensureIndexes, getThingsCollection, getThingTypesCollection } from '../mongodb/collections';
import {
  decryptEnvelope,
  encryptValue,
  envelopeAad,
  loadDataKeys,
  normalizeExactValue,
  normalizeTerms,
  searchToken,
  type StoredThingValue
} from './encryption.server';
import {
  canAdminRecord,
  canReadRecord,
  canWriteRecord,
  projectAclFor,
  sanitizeAclInput,
  subjectKeyForUser,
  subjectKeysForUser,
  type ThingRecordAcl
} from './permissions';
import { findVisibleType, type ThingTypeDoc } from './types';
import {
  fail,
  isFail,
  missingRequiredField,
  validateFieldValue,
  type Fail,
  type ThingTypeField
} from './validation';

// Generic user records live in thingtime.things as kind:'record' docs — the
// "actual data lives in things" rule — discriminated from feed posts by kind.

export type ThingRecordDoc = {
  _id?: any;
  shareId: string;
  kind: 'record';
  typeId: string; // ThingTypeDoc.shareId — the only type id ever stored/exposed
  ownerId: string;
  acl: ThingRecordAcl;
  values: Record<string, StoredThingValue>;
  search: {
    tokens: string[];
    publicText: string | null;
  };
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type RecordPermissions = {
  canRead: boolean;
  canSearch: boolean;
  canWrite: boolean;
  canAdmin: boolean;
};

export type PublicThingRecord = {
  id: string;
  typeId: string;
  version: number;
  values: Record<string, unknown>;
  encryptedFields: string[];
  permissions: RecordPermissions;
  acl: { readKeys: string[]; writeKeys: string[]; adminKeys: string[]; searchKeys: string[] } | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicThingRecordSummary = {
  id: string;
  typeId: string;
  version: number;
  values: Record<string, unknown>;
  encryptedFields: string[];
  snippet: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const MAX_PUBLIC_TEXT_CHARS = 280;

// ---------------------------------------------------------------------------
// Cursor pagination on (updatedAt desc, shareId asc) — same stable-cursor
// shape as the feed's chrono cursor, shared with search.ts.

export const parseUpdatedCursor = (cursor: string | null | undefined): { updatedAt: Date; id: string } | null => {
  if (!cursor) return null;
  const [ms, id] = cursor.split('_');
  const time = Number(ms);
  if (!Number.isFinite(time) || !id) return null;
  return { updatedAt: new Date(time), id };
};

export const buildUpdatedCursor = (doc: { updatedAt: Date | string; shareId: string }) =>
  `${new Date(doc.updatedAt).getTime()}_${doc.shareId}`;

export const cursorPageFilter = (cursor: { updatedAt: Date; id: string } | null) =>
  cursor
    ? {
        $or: [
          { updatedAt: { $lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, shareId: { $gt: cursor.id } }
        ]
      }
    : null;

export const capListLimit = (limit: unknown) =>
  Math.min(Math.max(1, Number(limit) || DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);

// ---------------------------------------------------------------------------
// Value storage + search index building.

const fieldByKey = (type: ThingTypeDoc) => new Map((type.fields || []).map((field) => [field.key, field]));

type DataKeys = Extract<ReturnType<typeof loadDataKeys>, { ok: true }>['keys'];

// Data keys are only required when a write actually touches an encrypted
// field, so plain-only types keep working with no encryption env configured.
const dataKeysIfNeeded = (needed: boolean): { ok: true; keys: DataKeys | null } | Fail => {
  if (!needed) return { ok: true, keys: null };
  const loaded = loadDataKeys();
  if (isFail(loaded)) return loaded;
  return { ok: true, keys: loaded.keys };
};

// Validate + normalize the submitted values, then wrap each in its storage
// form (plain, or an AES-GCM envelope bound to this record/field via AAD).
// `normalized` carries the post-validation plaintext for every submitted field
// (encrypted ones included) — used transiently for search tokens, never stored.
const buildStoredValues = (
  type: ThingTypeDoc,
  recordId: string,
  submitted: Record<string, unknown>
): { ok: true; stored: Record<string, StoredThingValue>; normalized: Record<string, unknown> } | Fail => {
  const fields = fieldByKey(type);

  for (const key of Object.keys(submitted)) {
    if (!fields.has(key)) return fail(400, `Unknown field "${key}" for this type`);
  }

  const needsKeys = Object.entries(submitted).some(([key, value]) => {
    const field = fields.get(key)!;
    return field.encrypted && value !== null && value !== undefined;
  });
  const keys = dataKeysIfNeeded(needsKeys);
  if (isFail(keys)) return keys;

  const stored: Record<string, StoredThingValue> = {};
  const normalized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(submitted)) {
    const field = fields.get(key)!;
    const validated = validateFieldValue(field, rawValue);
    if (isFail(validated)) return validated;

    normalized[key] = validated.value;
    if (field.encrypted && validated.value !== null) {
      stored[key] = {
        storage: 'encrypted',
        envelope: encryptValue(keys.keys!, validated.value, envelopeAad(type.shareId, recordId, key))
      };
    } else {
      stored[key] = { storage: 'plain', value: validated.value };
    }
  }
  return { ok: true, stored, normalized };
};

// Search tokens for one field value. Plain searchable fields store their
// normalized tokens; encrypted ones store blind-index digests (same format).
const tokensForField = (
  type: ThingTypeDoc,
  field: ThingTypeField,
  plainValue: unknown,
  keys: DataKeys | null
): string[] => {
  if (field.searchable === 'none' || plainValue === null || plainValue === undefined) return [];
  const encryptedWith = field.encrypted ? keys : null;
  if (field.encrypted && !keys) return []; // keys unconfigured — skip rather than fail the write
  if (field.searchable === 'term') {
    return normalizeTerms(plainValue).map((term) =>
      searchToken(type.shareId, field.key, 'term', term, encryptedWith)
    );
  }
  return [searchToken(type.shareId, field.key, 'exact', normalizeExactValue(plainValue), encryptedWith)];
};

const tokenFieldKey = (token: string) => token.split(':')[2] || '';

// publicText is a display convenience only (never used to authorize): plain,
// term-searchable text values, capped.
const buildPublicText = (type: ThingTypeDoc, plainValues: Record<string, unknown>): string | null => {
  const text = (type.fields || [])
    .filter((field) => !field.encrypted && field.searchable === 'term' && typeof plainValues[field.key] === 'string')
    .map((field) => String(plainValues[field.key]))
    .join(' ')
    .trim()
    .slice(0, MAX_PUBLIC_TEXT_CHARS);
  return text || null;
};

// ---------------------------------------------------------------------------
// Projections.

const decryptedValues = (
  doc: ThingRecordDoc,
  type: ThingTypeDoc
): { ok: true; values: Record<string, unknown>; encryptedFields: string[] } | Fail => {
  const values: Record<string, unknown> = {};
  const encryptedFields: string[] = [];
  const hasEnvelopes = Object.values(doc.values || {}).some((entry) => entry.storage === 'encrypted');
  const keys = dataKeysIfNeeded(hasEnvelopes);
  if (isFail(keys)) return keys;

  for (const [key, entry] of Object.entries(doc.values || {})) {
    if (entry.storage === 'encrypted') {
      encryptedFields.push(key);
      const decrypted = decryptEnvelope(keys.keys!, entry.envelope, envelopeAad(type.shareId, doc.shareId, key));
      if (isFail(decrypted)) return decrypted;
      values[key] = decrypted.value;
    } else {
      values[key] = entry.value;
    }
  }
  return { ok: true, values, encryptedFields };
};

const plainValuesOf = (doc: ThingRecordDoc): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(doc.values || {})) {
    if (entry.storage === 'plain') values[key] = entry.value;
  }
  return values;
};

const encryptedFieldKeysOf = (doc: ThingRecordDoc): string[] =>
  Object.entries(doc.values || {})
    .filter(([, entry]) => entry.storage === 'encrypted')
    .map(([key]) => key);

// Full read projection — decrypts, so only call after a read-permission check.
export const toPublicRecord = (
  doc: ThingRecordDoc,
  type: ThingTypeDoc,
  user: PublicUser | null
): PublicThingRecord | Fail => {
  const decrypted = decryptedValues(doc, type);
  if (isFail(decrypted)) return decrypted;
  const { permissions, acl } = projectAclFor(doc.acl, user);
  return {
    id: doc.shareId,
    typeId: doc.typeId,
    version: doc.version || 1,
    values: decrypted.values,
    encryptedFields: decrypted.encryptedFields,
    permissions,
    acl,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString()
  };
};

// List/search projection — plain values only; encrypted values are omitted by
// default (v1) so summaries never need key material.
export const toRecordSummary = (doc: ThingRecordDoc): PublicThingRecordSummary => ({
  id: doc.shareId,
  typeId: doc.typeId,
  version: doc.version || 1,
  values: plainValuesOf(doc),
  encryptedFields: encryptedFieldKeysOf(doc),
  snippet: doc.search?.publicText || null,
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString()
});

// ---------------------------------------------------------------------------
// CRUD operations.

const getTypeForRecord = async (typeId: string): Promise<ThingTypeDoc | null> => {
  const types = await getThingTypesCollection();
  return (await types.findOne({ shareId: typeId })) as any as ThingTypeDoc | null;
};

const findLiveRecord = async (id: unknown): Promise<ThingRecordDoc | null> => {
  if (typeof id !== 'string' || !id.trim()) return null;
  const things = await getThingsCollection();
  return (await things.findOne({
    shareId: id.trim(),
    kind: 'record',
    deletedAt: null
  } as any)) as any as ThingRecordDoc | null;
};

// Unauthorized ids 404 (never 403) so existence isn't revealed; 403 is only
// used once the caller could already see the record via read permission.
const notFound = () => fail(404, 'Record not found');

type CreateRecordInput = {
  typeId?: unknown;
  values?: unknown;
  acl?: unknown;
};

export const createRecord = async (
  user: PublicUser,
  input: CreateRecordInput
): Promise<Fail | { ok: true; record: PublicThingRecord }> => {
  const type = await findVisibleType(user, input.typeId);
  if (!type) return fail(404, 'Type not found');
  if (type.archivedAt) return fail(400, 'This type is archived and no longer accepts new records');

  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    return fail(400, 'values must be an object of field values');
  }
  const submitted = input.values as Record<string, unknown>;

  const owner = { ownerId: user.id, ownerSubject: subjectKeyForUser(user) };
  // The type's defaultAcl only applies to the type owner's own records —
  // otherwise a public type could silently grant its author access to other
  // users' data. Everyone else starts private unless they pass an explicit acl.
  const aclSource =
    input.acl && typeof input.acl === 'object'
      ? (input.acl as any)
      : String(type.ownerId) === user.id
        ? type.defaultAcl
        : {};
  const acl = sanitizeAclInput(aclSource, owner);
  if (isFail(acl)) return acl;

  const shareId = randomUUID();
  const stored = buildStoredValues(type, shareId, submitted);
  if (isFail(stored)) return stored;

  const missing = missingRequiredField(
    type.fields,
    Object.fromEntries(
      Object.entries(stored.stored).map(([key, entry]) => [
        key,
        entry.storage === 'encrypted' ? true : entry.value
      ])
    )
  );
  if (missing) return fail(400, `Field "${missing.key}" is required`);

  const keysResult = dataKeysIfNeeded(type.fields.some((field) => field.encrypted && field.searchable !== 'none'));
  const searchKeys = isFail(keysResult) ? null : keysResult.keys;
  const plainForSearch: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(stored.stored)) {
    if (entry.storage === 'plain') plainForSearch[key] = entry.value;
  }
  const tokens = (type.fields || []).flatMap((field) =>
    tokensForField(type, field, stored.normalized[field.key] ?? null, field.encrypted ? searchKeys : null)
  );

  await ensureIndexes();
  const now = new Date();
  const doc: ThingRecordDoc = {
    shareId,
    kind: 'record',
    typeId: type.shareId,
    ownerId: user.id,
    acl,
    values: stored.stored,
    search: {
      tokens,
      publicText: buildPublicText(type, plainForSearch)
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  const things = await getThingsCollection();
  await things.insertOne(doc as any);

  const record = toPublicRecord(doc, type, user);
  if (isFail(record)) return record;
  return { ok: true, record };
};

export const getRecord = async (
  user: PublicUser | null,
  id: unknown
): Promise<Fail | { ok: true; record: PublicThingRecord }> => {
  const doc = await findLiveRecord(id);
  if (!doc || !canReadRecord(doc.acl, user)) return notFound();
  const type = await getTypeForRecord(doc.typeId);
  if (!type) return notFound();
  const record = toPublicRecord(doc, type, user);
  if (isFail(record)) return record;
  return { ok: true, record };
};

type ListRecordsInput = { typeId?: unknown; cursor?: string | null; limit?: unknown };

export const listRecords = async (
  user: PublicUser | null,
  input: ListRecordsInput
): Promise<Fail | { ok: true; records: PublicThingRecordSummary[]; nextCursor: string | null }> => {
  const type = await findVisibleType(user, input.typeId);
  if (!type) return fail(404, 'Type not found');

  const limit = capListLimit(input.limit);
  const cursor = parseUpdatedCursor(input.cursor);
  const pageFilter = cursorPageFilter(cursor);

  // Listing is a search-shaped read: the permission filter is part of the
  // Mongo query itself, so unmatched records never leave the database.
  const match: any = {
    kind: 'record',
    typeId: type.shareId,
    deletedAt: null,
    'acl.searchKeys': { $in: subjectKeysForUser(user) },
    ...(pageFilter || {})
  };

  const things = await getThingsCollection();
  const docs = (await things
    .find(match)
    .sort({ updatedAt: -1, shareId: 1 })
    .limit(limit + 1)
    .toArray()) as any as ThingRecordDoc[];

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? buildUpdatedCursor(last) : null;
  return { ok: true, records: page.map(toRecordSummary), nextCursor };
};

type UpdateRecordInput = { id?: unknown; values?: unknown; expectedVersion?: unknown };

export const updateRecord = async (
  user: PublicUser,
  input: UpdateRecordInput
): Promise<Fail | { ok: true; record: PublicThingRecord | null }> => {
  const doc = await findLiveRecord(input.id);
  if (!doc) return notFound();
  const readable = canReadRecord(doc.acl, user);
  if (!canWriteRecord(doc.acl, user)) {
    return readable ? fail(403, 'You do not have write access to this record') : notFound();
  }

  if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
    return fail(400, 'values must be an object of field values');
  }
  const submitted = input.values as Record<string, unknown>;
  if (!Object.keys(submitted).length) return fail(400, 'values must contain at least one field');

  let expectedVersion: number | null = null;
  if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
    expectedVersion = Number(input.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return fail(400, 'expectedVersion must be a positive integer');
    }
  }

  const type = await getTypeForRecord(doc.typeId);
  if (!type) return notFound();

  const stored = buildStoredValues(type, doc.shareId, submitted);
  if (isFail(stored)) return stored;

  const mergedValues: Record<string, StoredThingValue> = { ...(doc.values || {}), ...stored.stored };
  const missing = missingRequiredField(
    type.fields,
    Object.fromEntries(
      Object.entries(mergedValues).map(([key, entry]) => [
        key,
        entry.storage === 'encrypted' ? true : entry.value
      ])
    )
  );
  if (missing) return fail(400, `Field "${missing.key}" is required`);

  // Rebuild search tokens only for the fields this write touched — tokens
  // embed their field key, so untouched fields keep their existing tokens
  // (including blind-index digests we couldn't rebuild without decrypting).
  const updatedKeys = new Set(Object.keys(stored.stored));
  const keysResult = dataKeysIfNeeded(
    type.fields.some((field) => updatedKeys.has(field.key) && field.encrypted && field.searchable !== 'none')
  );
  const searchDataKeys = isFail(keysResult) ? null : keysResult.keys;
  const keptTokens = (doc.search?.tokens || []).filter((token) => !updatedKeys.has(tokenFieldKey(token)));
  const newTokens = (type.fields || [])
    .filter((field) => updatedKeys.has(field.key))
    .flatMap((field) =>
      tokensForField(type, field, stored.normalized[field.key] ?? null, field.encrypted ? searchDataKeys : null)
    );

  const mergedPlain: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(mergedValues)) {
    if (entry.storage === 'plain') mergedPlain[key] = entry.value;
  }

  const now = new Date();
  const things = await getThingsCollection();
  // $inc keeps version strictly monotonic under concurrent writers — a $set
  // computed from the earlier findOne could mint duplicate version numbers and
  // quietly defeat expectedVersion conflict detection.
  const updated = (await things.findOneAndUpdate(
    {
      _id: new ObjectId(doc._id),
      deletedAt: null,
      ...(expectedVersion !== null ? { version: expectedVersion } : {})
    } as any,
    {
      $set: {
        values: mergedValues,
        search: { tokens: [...keptTokens, ...newTokens], publicText: buildPublicText(type, mergedPlain) },
        updatedAt: now
      },
      $inc: { version: 1 }
    },
    { returnDocument: 'after' }
  )) as any as ThingRecordDoc | null;
  if (!updated) {
    return expectedVersion !== null
      ? fail(409, `Record changed since version ${expectedVersion} — reload and retry`)
      : notFound();
  }

  // A write grant alone must not become a read oracle: only return the
  // decrypted record when the caller could also read it.
  if (!readable) {
    return { ok: true, record: null };
  }
  const record = toPublicRecord(updated, type, user);
  if (isFail(record)) return record;
  return { ok: true, record };
};

export const deleteRecord = async (
  user: PublicUser,
  input: { id?: unknown }
): Promise<Fail | { ok: true }> => {
  const doc = await findLiveRecord(input.id);
  if (!doc) return notFound();
  if (!canAdminRecord(doc.acl, user)) {
    return canReadRecord(doc.acl, user) ? fail(403, 'Only a record admin can delete it') : notFound();
  }
  const things = await getThingsCollection();
  // Soft delete: hidden from read/list/search immediately; retention/hard
  // delete is a later policy decision (see the plan).
  await things.updateOne(
    { _id: new ObjectId(doc._id) },
    { $set: { deletedAt: new Date(), updatedAt: new Date() } }
  );
  return { ok: true };
};

type UpdatePermissionsInput = {
  id?: unknown;
  readKeys?: unknown;
  writeKeys?: unknown;
  adminKeys?: unknown;
  searchKeys?: unknown;
};

export const updateRecordPermissions = async (
  user: PublicUser,
  input: UpdatePermissionsInput
): Promise<Fail | { ok: true; permissions: RecordPermissions; acl: PublicThingRecord['acl'] }> => {
  const doc = await findLiveRecord(input.id);
  if (!doc) return notFound();
  if (!canAdminRecord(doc.acl, user)) {
    return canReadRecord(doc.acl, user)
      ? fail(403, 'Only a record admin can change its permissions')
      : notFound();
  }

  const acl = sanitizeAclInput(input, {
    ownerId: doc.acl.ownerId,
    ownerSubject: doc.acl.ownerSubject
  });
  if (isFail(acl)) return acl;

  const things = await getThingsCollection();
  await things.updateOne(
    { _id: new ObjectId(doc._id) },
    { $set: { acl, updatedAt: new Date() }, $inc: { version: 1 } }
  );

  const projected = projectAclFor(acl, user);
  return { ok: true, permissions: projected.permissions, acl: projected.acl };
};
