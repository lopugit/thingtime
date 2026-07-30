import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { findUserById } from '../auth/users';
import { sandboxDisplayName } from './sandbox';
import { scopeCovers } from './scopes';
import {
  appAclEntry,
  appNamespaceStamp,
  appThingSizeBytes,
  chargeAppStorage,
  liveSandboxAuthors,
  liveSharingAuthors,
  refundAppStorage,
  resolveAppScopedAcl
} from './namespace';
import type { AppNamespaceScope } from './namespace';
import {
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_APP_DATA_KEY_CHARS,
  MAX_APP_DATA_VALUE_BYTES
} from '~/schemas/registry';

// Per-(user, app) key/value storage for embedded apps — each entry is its own
// atomic `things` doc (thingtime ['app-data'], crystal { appId, key, value }),
// owned by the END USER, per FUNDAMENTALS.md §3: bounded docs, per-item
// writes, a partial unique index on (ownerId, appId, key) for race-safe
// upserts, and natural paging. Written only through /api/v1/app-data with an
// app-scoped Bearer token.
//
// AUDIENCE IS THE ACL ARRAY — no separate visibility field. Private entries
// carry acl ["tt:user"]; entries the app marks shared carry
// ["tt:user", "tt:app/<clientId>"], meaning "other users of THIS app may read
// this" (via GET /app-data/shared) — never other apps, never the public web,
// never Thingtime-site viewers (registry aclEntryMatches ignores tt:app/).
// The wire's `visibility: 'private' | 'app'` is derived sugar over that acl,
// exactly like the platform's legacy visibility names (registry
// LEGACY_VISIBILITY_ACLS / visibilityFromAcl).

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type AppDataVisibility = 'private' | 'app';

export type AppDataEntry = {
  key: string;
  value: unknown;
  visibility: AppDataVisibility;
  acl: string[];
  updatedAt: Date;
};

// The acl entry granting an app's user base read access to an entry —
// canonical home is apps/namespace.ts; re-exported here for existing callers.
export { appAclEntry } from './namespace';

const APP_DATA_KEY_RE = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,${MAX_APP_DATA_KEY_CHARS - 1}}$`);

export const sanitizeAppDataKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return APP_DATA_KEY_RE.test(key) ? key : null;
};

const entryAcl = (doc: any): string[] =>
  Array.isArray(doc.acl) && doc.acl.length ? doc.acl : [ACL_OWNER];

const toEntry = (doc: any): AppDataEntry => {
  const acl = entryAcl(doc);
  return {
    key: doc.crystal?.key,
    value: doc.crystal?.value ?? null,
    visibility: acl.includes(appAclEntry(doc.crystal?.appId)) ? 'app' : 'private',
    acl,
    updatedAt: doc.updatedAt
  };
};

// Resolve the requested audience for a write into a stored acl — the ONE
// app-write acl clamp, shared with the full things surface (canonical
// implementation + rationale in apps/namespace.ts resolveAppScopedAcl).
export const resolveAppDataAcl = resolveAppScopedAcl;

export const getAppData = async (
  ownerId: string,
  appId: string,
  key: string
): Promise<AppDataEntry | null> => {
  const things = await getThingsCollection();
  const doc = await things.findOne({ thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key });
  return doc ? toEntry(doc) : null;
};

const MAX_PRIVATE_PAGE = 200;

// Opaque private-list cursor: the last returned key, base64url.
const encodeKeyCursor = (key: string): string => Buffer.from(JSON.stringify({ k: key }), 'utf8').toString('base64url');
const decodeKeyCursor = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return typeof parsed?.k === 'string' ? parsed.k : null;
  } catch {
    return null;
  }
};

// key= filters exactly; a trailing * (e.g. key=post:*) or prefix= filters by
// prefix. Regex is built from an escaped literal, never raw user input. One
// grammar for the private list and the shared feed.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildKeyFilter = (
  params: { key?: string | null; prefix?: string | null }
): Record<string, unknown> | null | Fail => {
  const rawKey = typeof params.key === 'string' ? params.key.trim() : '';
  const rawPrefix = typeof params.prefix === 'string' ? params.prefix.trim() : '';
  if (rawKey.endsWith('*')) return { $regex: `^${escapeRe(rawKey.slice(0, -1))}` };
  if (rawKey) {
    const key = sanitizeAppDataKey(rawKey);
    if (!key) return fail(400, 'key is not a valid app-data key (append * for a prefix match)');
    return { $eq: key };
  }
  if (rawPrefix) return { $regex: `^${escapeRe(rawPrefix)}` };
  return null;
};

export const listAppData = async (
  ownerId: string,
  appId: string,
  params: { prefix?: string | null; key?: string | null; limit?: number | null; cursor?: string | null } = {}
): Promise<{ ok: true; entries: AppDataEntry[]; nextCursor: string | null } | Fail> => {
  const limit = Math.min(MAX_PRIVATE_PAGE, Math.max(1, Math.floor(params.limit ?? MAX_PRIVATE_PAGE) || MAX_PRIVATE_PAGE));

  const keyFilter = buildKeyFilter(params);
  if (keyFilter && 'ok' in keyFilter) return keyFilter;

  let afterKey: string | null = null;
  if (params.cursor) {
    afterKey = decodeKeyCursor(params.cursor);
    if (!afterKey) return fail(400, 'cursor is not a cursor this endpoint issued');
  }

  const keyCond: Record<string, unknown> = { ...(keyFilter ?? {}) };
  if (afterKey) keyCond.$gt = afterKey;

  const things = await getThingsCollection();
  const docs = await things
    .find({
      thingtime: 'app-data',
      ownerId,
      'crystal.appId': appId,
      ...(Object.keys(keyCond).length ? { 'crystal.key': keyCond } : {})
    })
    .sort({ 'crystal.key': 1 })
    .limit(limit + 1)
    .toArray();

  const page = docs.slice(0, limit);
  return {
    ok: true,
    entries: page.map(toEntry),
    nextCursor: docs.length > limit && page.length ? encodeKeyCursor(page[page.length - 1].crystal?.key) : null
  };
};

export const setAppData = async (
  ownerId: string,
  appId: string,
  rawKey: unknown,
  value: unknown,
  audience: {
    visibility?: unknown;
    acl?: unknown;
    allowShared: boolean;
    sandbox?: boolean;
    sandboxSpace?: string | null;
  } = { allowShared: false }
): Promise<{ ok: true; entry: AppDataEntry } | Fail> => {
  const key = sanitizeAppDataKey(rawKey);
  if (!key) {
    return fail(400, `Keys are 1-${MAX_APP_DATA_KEY_CHARS} chars of letters, digits, . _ : - (starting alphanumeric)`);
  }

  const resolved = resolveAppDataAcl(appId, audience.visibility, audience.acl);
  if ('ok' in resolved) return resolved;
  // Sharing rides the author's OWN grant: without the app-data.shared scope
  // on this token, the app can't widen this user's entries past private.
  if (resolved.shared && !audience.allowShared) {
    return fail(403, 'This token was not granted the app-data.shared scope, so entries stay private');
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

  const things = await getThingsCollection();
  const filter = { thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key };

  const scope: AppNamespaceScope = {
    appId,
    ownerId,
    sharedRead: audience.allowShared,
    scopes: [], // budget accounting only — no projections ride this scope
    username: '',
    sandbox: audience.sandbox ? { space: audience.sandboxSpace ?? null } : null
  };

  // Byte budget: charge the size DELTA before writing (admission can never
  // overshoot the budget), refund if the write ultimately fails; shrinking
  // writes refund after success so a failed write never loses bytes. Racing
  // same-key writes can briefly over-charge — the safe direction, healed by
  // the sizeBytes reconcile sweep.
  const newSize = appThingSizeBytes({ crystal: { appId, key, value } });
  const existing = await things.findOne(filter, { projection: { sizeBytes: 1, crystal: 1, extended: 1, tags: 1 } });
  const oldSize = existing
    ? typeof existing.sizeBytes === 'number'
      ? existing.sizeBytes
      : appThingSizeBytes(existing)
    : 0;
  const delta = newSize - oldSize;
  if (delta > 0) {
    const charge = await chargeAppStorage(scope, delta);
    if (!charge.ok) return charge;
  }

  const finish = async (entry: AppDataEntry): Promise<{ ok: true; entry: AppDataEntry }> => {
    if (delta < 0) await refundAppStorage(scope, -delta);
    return { ok: true, entry };
  };

  // update-then-insert, retried: a racing set() of the same new key loses the
  // insert to the unique index and folds into an update on the next pass; a
  // set() racing a delete of the winner just inserts on the next pass. Two
  // full passes always suffice for one interleaving; the bound only trips
  // under sustained adversarial interleaving, which gets a structured 503
  // instead of a raw duplicate-key 500.
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();

    // Audience only changes when the write names one — a plain { key, value }
    // update never silently flips a shared entry private (or vice versa).
    // Root appId + sizeBytes ride every write, adopting pre-namespace docs on
    // their first touch (sandbox TTL stamps are creation-only).
    const set: Record<string, unknown> = { 'crystal.value': value, updatedAt: now, appId, sizeBytes: newSize };
    if (resolved.acl) set.acl = resolved.acl;

    const updated = await things.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after' }
    );
    if (updated) return finish(toEntry(updated));

    const doc = {
      shareId: randomUUID(),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      thingtime: ['app-data'],
      crystal: { appId, key, value },
      ownerId,
      acl: resolved.acl ?? [ACL_OWNER],
      targetId: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
      // namespace stamp: root appId + sizeBytes, plus the ephemeral-sandbox
      // TTL/space stamps so pretend data reaps itself with the token
      ...appNamespaceStamp(scope, newSize)
    };

    try {
      await things.insertOne(doc as any);
      return finish(toEntry(doc));
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // lost the insert race — loop back to the update path
    }
  }

  if (delta > 0) await refundAppStorage(scope, delta);
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
  const doc = await things.findOneAndDelete({ thingtime: 'app-data', ownerId, 'crystal.appId': appId, 'crystal.key': key });
  if (doc) {
    // refund the freed bytes (legacy pre-stamp docs re-measure on the way out)
    const bytes = typeof doc.sizeBytes === 'number' ? doc.sizeBytes : appThingSizeBytes(doc);
    await refundAppStorage({ appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox: null }, bytes);
  }
  return { ok: true, deleted: !!doc };
};

// ---------------------------------------------------------------------------
// The app-scoped shared read: every entry users of ONE app opted into sharing
// (acl carries tt:app/<clientId>), newest first, cursor-paginated.

// Each entry's author is shaped by the AUTHOR's own grant, exactly as
// /oauth/userinfo would shape it — id + username always, displayName/avatar
// only if that author granted them. One consent model everywhere.
export type SharedEntryAuthor = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type SharedAppDataEntry = {
  key: string;
  value: unknown;
  visibility: 'app';
  updatedAt: Date;
  createdAt: Date;
  author: SharedEntryAuthor;
};

const MAX_SHARED_PAGE = 50;
const DEFAULT_SHARED_PAGE = 20;

// Opaque cursor: (updatedAt, shareId) of the last scanned doc, base64url.
const encodeCursor = (doc: any): string =>
  Buffer.from(JSON.stringify({ u: new Date(doc.updatedAt).getTime(), s: doc.shareId }), 'utf8').toString('base64url');

const decodeCursor = (raw: string): { u: number; s: string } | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.u !== 'number' || typeof parsed?.s !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
};

// Author-liveness gates (liveSharingAuthors / liveSandboxAuthors) are the
// namespace layer's — one revocation semantic for the KV feed and the full
// things surface alike (apps/namespace.ts).

export const listSharedAppData = async (
  appId: string,
  params: { key?: string | null; prefix?: string | null; limit?: number | null; cursor?: string | null },
  // Sandbox viewers see their own namespace — or, when minted into a space,
  // the pool of every same-space sandbox, each entry authored by its own
  // pretend user. Never real entries, never another space.
  viewer?: { sandbox?: { ownerId: string; space?: string | null; author: SharedEntryAuthor } }
): Promise<{ ok: true; entries: SharedAppDataEntry[]; nextCursor: string | null } | Fail> => {
  const limit = Math.min(MAX_SHARED_PAGE, Math.max(1, Math.floor(params.limit ?? DEFAULT_SHARED_PAGE) || DEFAULT_SHARED_PAGE));

  // Same key/prefix grammar as the private list (buildKeyFilter above).
  const keyFilter = buildKeyFilter(params);
  if (keyFilter && 'ok' in keyFilter) return keyFilter;

  const shared = appAclEntry(appId);
  const baseFilter: Record<string, unknown> = {
    thingtime: 'app-data',
    'crystal.appId': appId,
    acl: shared,
    // Real feeds never even SCAN sandbox docs (anyone can mint a sandbox
    // token naming a real clientId and write junk under it — the author-grant
    // filter would drop those entries anyway, but a flood could still thin
    // real pages); sandbox viewers are fenced to their own namespace, or to
    // their opt-in space's pool.
    ...(viewer?.sandbox
      ? viewer.sandbox.space
        ? { sandboxSpace: viewer.sandbox.space }
        : { ownerId: viewer.sandbox.ownerId }
      : { sandboxExpiresAt: { $exists: false } }),
    ...(keyFilter ? { 'crystal.key': keyFilter } : {})
  };

  let after: { u: number; s: string } | null = null;
  if (params.cursor) {
    after = decodeCursor(params.cursor);
    if (!after) return fail(400, 'cursor is not a cursor this endpoint issued');
  }

  const things = await getThingsCollection();
  const kept: any[] = [];
  const authorScopes = new Map<string, string[]>();
  const sandboxUsernames = new Map<string, string>();
  let lastScanned: any = null;
  let exhausted = false;

  // Scan in batches: docs whose author's grant died are filtered out, so a
  // page may need more than one fetch. Bounded passes keep the worst case
  // (many revoked authors) from turning into an unbounded walk — the cursor
  // resumes the scan where this request stopped.
  for (let pass = 0; pass < 4 && kept.length <= limit; pass++) {
    const cursorFilter = after
      ? {
          $or: [
            { updatedAt: { $lt: new Date(after.u) } },
            { updatedAt: new Date(after.u), shareId: { $lt: after.s } }
          ]
        }
      : {};
    const batchSize = Math.max(limit + 1, 25);
    const docs = await things
      .find({ ...baseFilter, ...cursorFilter })
      .sort({ updatedAt: -1, shareId: -1 })
      .limit(batchSize)
      .toArray();

    if (!docs.length) {
      exhausted = true;
      break;
    }

    const authorIds = [...new Set(docs.map((doc: any) => String(doc.ownerId)))].filter(
      (id) => !authorScopes.has(id)
    );
    if (viewer?.sandbox && !viewer.sandbox.space) {
      // The sandbox owner is by definition live (the viewer's own token).
      for (const id of authorIds) authorScopes.set(id, ['app-data.shared']);
    } else if (viewer?.sandbox && viewer.sandbox.space) {
      const live = await liveSandboxAuthors(appId, viewer.sandbox.space, authorIds);
      for (const id of authorIds) authorScopes.set(id, live.get(id)?.scopes || []);
      for (const [id, info] of live) sandboxUsernames.set(id, info.username);
    } else {
      const live = await liveSharingAuthors(appId, authorIds);
      for (const id of authorIds) authorScopes.set(id, live.get(id) || []);
    }

    for (const doc of docs) {
      lastScanned = doc;
      if (kept.length > limit) break;
      if ((authorScopes.get(String(doc.ownerId)) || []).length) kept.push(doc);
    }

    after = { u: new Date(lastScanned.updatedAt).getTime(), s: lastScanned.shareId };
    if (docs.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  const page = kept.slice(0, limit);
  const hasMore = kept.length > limit || !exhausted;

  // One user fetch per distinct author on the page, shaped per their grant.
  // Sandbox pages skip the lookup — every entry is the viewer's own synthetic
  // author.
  const pageAuthors = [...new Set(page.map((doc: any) => String(doc.ownerId)))];
  const authorsById = new Map<string, SharedEntryAuthor>();
  if (viewer?.sandbox && viewer.sandbox.space) {
    // Pooled sandboxes: each entry authored by its own pretend user, gated by
    // that token's scopes exactly like real authors.
    for (const id of pageAuthors) {
      const username = sandboxUsernames.get(id);
      if (!username) continue;
      const scopes = authorScopes.get(id) || [];
      authorsById.set(id, {
        id,
        username,
        ...(scopeCovers(scopes, 'profile.displayName') ? { displayName: sandboxDisplayName(username) } : {}),
        ...(scopeCovers(scopes, 'profile.avatar') ? { avatarUrl: null } : {})
      });
    }
  } else if (viewer?.sandbox) {
    authorsById.set(viewer.sandbox.ownerId, viewer.sandbox.author);
  } else {
    const users = await Promise.all(pageAuthors.map((id) => findUserById(id)));
    pageAuthors.forEach((id, index) => {
      const user = users[index];
      if (!user) return;
      const scopes = authorScopes.get(id) || [];
      authorsById.set(id, {
        id: String(user._id),
        username: user.username,
        ...(scopeCovers(scopes, 'profile.displayName') ? { displayName: user.displayName ?? null } : {}),
        ...(scopeCovers(scopes, 'profile.avatar') ? { avatarUrl: user.avatarUrl ?? null } : {})
      });
    });
  }

  const entries: SharedAppDataEntry[] = [];
  for (const doc of page) {
    const author = authorsById.get(String(doc.ownerId));
    if (!author) continue; // author account gone — entry is unreadable
    entries.push({
      key: doc.crystal?.key,
      value: doc.crystal?.value ?? null,
      visibility: 'app',
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt,
      author
    });
  }

  return {
    ok: true,
    entries,
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : hasMore && lastScanned ? encodeCursor(lastScanned) : null
  };
};
