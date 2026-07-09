import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import type { PublicUser } from '../auth/users';
import { ensureIndexes, getThingsCollection, getThingTypesCollection } from '../mongodb/collections';
import { sanitizeAclInput, subjectKeyForUser, type ThingRecordAcl } from './permissions';
import {
  fail,
  isFail,
  sanitizeExtended,
  validateTypeInput,
  type Fail,
  type ThingTypeField,
  type ThingTypeVisibility
} from './validation';

// User-defined data types (thingtime.thingTypes). A type's shareId is its
// public id and is what kind:'record' things store as typeId.

export type ThingTypeDoc = {
  _id?: any;
  shareId: string;
  ownerId: string;
  key: string;
  name: string;
  description: string | null;
  visibility: ThingTypeVisibility;
  version: number;
  fields: ThingTypeField[];
  defaultAcl: ThingRecordAcl;
  // schema-free extensible data — same escape hatch records have
  extended: unknown | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicThingType = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  visibility: ThingTypeVisibility;
  version: number;
  fields: ThingTypeField[];
  extended: unknown | null;
  archived: boolean;
  owned: boolean;
  createdAt: string;
  updatedAt: string;
};

const MAX_TYPES_PER_USER = 100;

export const toPublicThingType = (doc: any, user: PublicUser | null): PublicThingType => ({
  id: doc.shareId,
  key: doc.key,
  name: doc.name,
  description: doc.description ?? null,
  visibility: doc.visibility === 'public' ? 'public' : 'private',
  version: doc.version || 1,
  fields: (doc.fields || []).map((field: ThingTypeField) => ({ ...field })),
  extended: doc.extended ?? null,
  archived: !!doc.archivedAt,
  owned: !!user && String(doc.ownerId) === user.id,
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString()
});

// A "permitted type read": your own types always, public types for everyone.
export const findVisibleType = async (user: PublicUser | null, typeId: unknown): Promise<ThingTypeDoc | null> => {
  if (typeof typeId !== 'string' || !typeId.trim()) return null;
  const types = await getThingTypesCollection();
  const doc = (await types.findOne({ shareId: typeId.trim() })) as any as ThingTypeDoc | null;
  if (!doc) return null;
  if (doc.visibility !== 'public' && (!user || String(doc.ownerId) !== user.id)) return null;
  return doc;
};

export const listTypes = async (user: PublicUser | null): Promise<PublicThingType[]> => {
  const types = await getThingTypesCollection();
  const visible = user
    ? { $or: [{ ownerId: user.id }, { visibility: 'public' }] }
    : { visibility: 'public' };
  const docs = await types
    .find({ ...visible, archivedAt: null })
    .sort({ updatedAt: -1, shareId: 1 })
    .limit(200)
    .toArray();
  return docs.map((doc: any) => toPublicThingType(doc, user));
};

const countLiveRecords = async (typeId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments({ kind: 'record', typeId, deletedAt: null });
};

type SaveTypeInput = Record<string, unknown> & { id?: unknown; defaultAcl?: unknown };
type SaveTypeResult = Fail | { ok: true; type: PublicThingType };

// Create a type, or update a caller-owned type when `id` is provided.
export const saveType = async (user: PublicUser, input: SaveTypeInput): Promise<SaveTypeResult> => {
  const validated = validateTypeInput(input);
  if (isFail(validated)) return validated;

  const owner = { ownerId: user.id, ownerSubject: subjectKeyForUser(user) };
  const defaultAcl = sanitizeAclInput(
    input.defaultAcl && typeof input.defaultAcl === 'object' ? (input.defaultAcl as any) : {},
    owner
  );
  if (isFail(defaultAcl)) return defaultAcl;

  const extended = sanitizeExtended(input.extended);
  if (isFail(extended)) return extended;
  const hasExtendedChange = input.extended !== undefined;

  await ensureIndexes();
  const types = await getThingTypesCollection();
  const now = new Date();

  if (typeof input.id === 'string' && input.id) {
    const existing = (await types.findOne({ shareId: input.id })) as any as ThingTypeDoc | null;
    if (!existing || String(existing.ownerId) !== user.id) {
      return fail(404, 'Type not found');
    }
    // key is a stable integration identifier — never rewritten after creation
    if (validated.key !== existing.key) {
      return fail(400, 'A type key cannot be changed after creation');
    }

    // With live records, changing a field between encrypted and plain would
    // silently mix storage forms — refuse until a migration path exists.
    const existingFieldByKey = new Map((existing.fields || []).map((field) => [field.key, field]));
    const encryptionChanged = validated.fields.some((field) => {
      const previous = existingFieldByKey.get(field.key);
      return previous && previous.encrypted !== field.encrypted;
    });
    const liveRecords = await countLiveRecords(existing.shareId);
    if (encryptionChanged && liveRecords > 0) {
      return fail(400, 'Cannot change field encryption while records exist for this type');
    }
    if (liveRecords > 0) {
      // The same mixed-storage hazard hides behind remove-then-re-add: a field
      // absent from the current definition has no `previous` to compare, so
      // check re-added keys against the storage form actually persisted.
      const things = await getThingsCollection();
      for (const field of validated.fields) {
        if (existingFieldByKey.has(field.key)) continue;
        const mismatched = await things.countDocuments(
          {
            kind: 'record',
            typeId: existing.shareId,
            deletedAt: null,
            [`values.${field.key}.storage`]: field.encrypted ? 'plain' : 'encrypted'
          },
          { limit: 1 }
        );
        if (mismatched > 0) {
          return fail(
            400,
            `Field "${field.key}" has stored ${field.encrypted ? 'plain' : 'encrypted'} values — cannot re-add it with a different encryption setting while records exist`
          );
        }
      }
    }

    const update = {
      name: validated.name,
      description: validated.description,
      visibility: validated.visibility,
      fields: validated.fields,
      defaultAcl,
      ...(hasExtendedChange ? { extended: extended.value } : {}),
      version: (existing.version || 1) + 1,
      updatedAt: now
    };
    await types.updateOne({ _id: new ObjectId(existing._id) }, { $set: update });
    return { ok: true, type: toPublicThingType({ ...existing, ...update }, user) };
  }

  const duplicateKey = await types.findOne({ ownerId: user.id, key: validated.key });
  if (duplicateKey) return fail(409, `You already have a type with key "${validated.key}"`);

  const count = await types.countDocuments({ ownerId: user.id });
  if (count >= MAX_TYPES_PER_USER) {
    return fail(400, `Type limit reached (${MAX_TYPES_PER_USER})`);
  }

  const doc: ThingTypeDoc = {
    shareId: randomUUID(),
    ownerId: user.id,
    key: validated.key,
    name: validated.name,
    description: validated.description,
    visibility: validated.visibility,
    version: 1,
    fields: validated.fields,
    defaultAcl,
    extended: extended.value === undefined ? null : extended.value,
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  };
  try {
    await types.insertOne(doc as any);
  } catch (err: any) {
    // unique (ownerId, key) index race — mirror the register/createPost 409
    if (err?.code === 11000) return fail(409, `You already have a type with key "${validated.key}"`);
    throw err;
  }
  return { ok: true, type: toPublicThingType(doc, user) };
};

type DeleteTypeResult = Fail | { ok: true; archived: boolean };

// Delete a caller-owned type; refuse while live records exist unless the
// caller asked to archive instead.
export const deleteType = async (
  user: PublicUser,
  input: { id?: unknown; archive?: unknown }
): Promise<DeleteTypeResult> => {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return fail(400, 'Type id is required');
  }
  const types = await getThingTypesCollection();
  const existing = (await types.findOne({ shareId: input.id.trim() })) as any as ThingTypeDoc | null;
  if (!existing || String(existing.ownerId) !== user.id) {
    return fail(404, 'Type not found');
  }

  const liveRecords = await countLiveRecords(existing.shareId);
  if (input.archive === true) {
    await types.updateOne(
      { _id: new ObjectId(existing._id) },
      { $set: { archivedAt: new Date(), updatedAt: new Date() } }
    );
    return { ok: true, archived: true };
  }
  if (liveRecords > 0) {
    return fail(409, `This type still has ${liveRecords} record(s) — pass archive: true instead`);
  }
  await types.deleteOne({ _id: new ObjectId(existing._id) });
  return { ok: true, archived: false };
};
