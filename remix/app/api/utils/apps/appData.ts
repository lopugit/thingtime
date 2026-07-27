import { randomUUID } from 'node:crypto';

import { ensureIndexes, getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import { findUserById } from '../auth/users';
import { SANDBOX_MAX_KEYS, SANDBOX_TOKEN_TTL_MS } from './sandbox';
import { scopeCovers, sessionScopes } from './scopes';
import {
  ACL_APP_PREFIX,
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_APP_DATA_KEYS_PER_APP_USER,
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

// The acl entry granting an app's user base read access to an entry.
export const appAclEntry = (appId: string) => `${ACL_APP_PREFIX}${appId}`;

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

// Resolve the requested audience for a write into a stored acl. Accepts the
// acl array itself, or `visibility` sugar ('private' | 'app'). App-data acls
// are deliberately narrower than general thing acls: only the owner and this
// one app's user base are expressible — tt:all / other apps / other users are
// rejected, so a compromised or sloppy app can never widen an entry beyond
// its own walls. Returns null when the write doesn't mention audience at all
// (update keeps the entry's current acl; insert defaults private).
export const resolveAppDataAcl = (
  appId: string,
  visibility: unknown,
  acl: unknown
): { acl: string[] | null; shared: boolean } | Fail => {
  const shared = appAclEntry(appId);

  if (acl !== undefined && acl !== null) {
    if (!Array.isArray(acl)) return fail(400, 'acl must be a list of tt: entries');
    const entries: string[] = [];
    for (const raw of acl) {
      const entry = typeof raw === 'string' ? raw.trim() : '';
      if (!entry) continue;
      if (entry !== ACL_OWNER && entry !== shared) {
        return fail(400, `app-data acl entries can only be ${ACL_OWNER} (just you) or ${shared} (users of this app)`);
      }
      if (!entries.includes(entry)) entries.push(entry);
    }
    if (!entries.includes(ACL_OWNER)) entries.unshift(ACL_OWNER); // owners always read their own
    return { acl: entries, shared: entries.includes(shared) };
  }

  if (visibility === undefined || visibility === null) return { acl: null, shared: false };
  if (visibility === 'private') return { acl: [ACL_OWNER], shared: false };
  if (visibility === 'app') return { acl: [ACL_OWNER, shared], shared: true };
  return fail(400, "visibility must be 'private' or 'app' (or pass an acl array)");
};

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
  value: unknown,
  audience: { visibility?: unknown; acl?: unknown; allowShared: boolean; sandbox?: boolean } = { allowShared: false }
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

    // Audience only changes when the write names one — a plain { key, value }
    // update never silently flips a shared entry private (or vice versa).
    const set: Record<string, unknown> = { 'crystal.value': value, updatedAt: now };
    if (resolved.acl) set.acl = resolved.acl;

    const updated = await things.findOneAndUpdate(
      filter,
      { $set: set },
      { returnDocument: 'after' }
    );
    if (updated) return { ok: true, entry: toEntry(updated) };

    // New key: soft product cap on keys per (user, app), then insert.
    // Sandbox namespaces get a tighter budget — the mint is anonymous.
    const maxKeys = audience.sandbox ? SANDBOX_MAX_KEYS : MAX_APP_DATA_KEYS_PER_APP_USER;
    const count = await things.countDocuments({ thingtime: 'app-data', ownerId, 'crystal.appId': appId });
    if (count >= maxKeys) {
      return fail(400, `An app can store at most ${maxKeys} keys per user${audience.sandbox ? ' in the sandbox' : ''}`);
    }

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
      // sandbox writes are ephemeral: the TTL reaper deletes them with the
      // token's lifetime, so pretend data can never accumulate
      ...(audience.sandbox ? { sandboxExpiresAt: new Date(now.getTime() + SANDBOX_TOKEN_TTL_MS) } : {})
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

// The authors (of `userIds`) whose grant for this app is still alive AND still
// covers app-data.shared — revoke the grant (or let it expire) and your
// entries leave the shared feed immediately; the docs themselves stay yours.
// Returns each live author's scope union, for userinfo-style field gating.
const liveSharingAuthors = async (clientId: string, userIds: string[]): Promise<Map<string, string[]>> => {
  if (!userIds.length) return new Map();
  const sessions = await (await getSessionsCollection())
    .find({
      purpose: 'app',
      'meta.clientId': clientId,
      userId: { $in: userIds },
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    })
    .toArray();

  const scopesByUser = new Map<string, string[]>();
  for (const session of sessions) {
    const userId = String(session.userId);
    const union = scopesByUser.get(userId) || [];
    for (const scope of sessionScopes(session.meta)) {
      if (!union.includes(scope)) union.push(scope);
    }
    scopesByUser.set(userId, union);
  }
  for (const [userId, scopes] of [...scopesByUser]) {
    if (!scopeCovers(scopes, 'app-data.shared')) scopesByUser.delete(userId);
  }
  return scopesByUser;
};

export const listSharedAppData = async (
  appId: string,
  params: { key?: string | null; prefix?: string | null; limit?: number | null; cursor?: string | null },
  // Sandbox viewers see ONLY their own namespace (two sandboxes never see
  // each other), with the synthetic author attached — no session/user lookups.
  viewer?: { sandbox?: { ownerId: string; author: SharedEntryAuthor } }
): Promise<{ ok: true; entries: SharedAppDataEntry[]; nextCursor: string | null } | Fail> => {
  const limit = Math.min(MAX_SHARED_PAGE, Math.max(1, Math.floor(params.limit ?? DEFAULT_SHARED_PAGE) || DEFAULT_SHARED_PAGE));

  // key= filters exactly; a trailing * (e.g. key=post:*) or prefix= filters by
  // prefix. Regex is built from an escaped literal, never raw user input.
  let keyFilter: Record<string, unknown> | null = null;
  const rawKey = typeof params.key === 'string' ? params.key.trim() : '';
  const rawPrefix = typeof params.prefix === 'string' ? params.prefix.trim() : '';
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (rawKey.endsWith('*')) {
    keyFilter = { $regex: `^${escapeRe(rawKey.slice(0, -1))}` };
  } else if (rawKey) {
    const key = sanitizeAppDataKey(rawKey);
    if (!key) return fail(400, 'key is not a valid app-data key (append * for a prefix match)');
    keyFilter = { $eq: key };
  } else if (rawPrefix) {
    keyFilter = { $regex: `^${escapeRe(rawPrefix)}` };
  }

  const shared = appAclEntry(appId);
  const baseFilter: Record<string, unknown> = {
    thingtime: 'app-data',
    'crystal.appId': appId,
    acl: shared,
    // Real feeds never even SCAN sandbox docs (anyone can mint a sandbox
    // token naming a real clientId and write junk under it — the author-grant
    // filter would drop those entries anyway, but a flood could still thin
    // real pages); sandbox viewers are fenced to their own namespace.
    ...(viewer?.sandbox ? { ownerId: viewer.sandbox.ownerId } : { sandboxExpiresAt: { $exists: false } }),
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
    if (viewer?.sandbox) {
      // The sandbox owner is by definition live (the viewer's own token).
      for (const id of authorIds) authorScopes.set(id, ['app-data.shared']);
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
  if (viewer?.sandbox) {
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
