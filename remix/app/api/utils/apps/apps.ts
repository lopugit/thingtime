import { randomUUID } from 'node:crypto';

import { getSessionsCollection, getThingsCollection } from '../mongodb/collections';
import {
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_APPS_PER_USER,
  MAX_APP_NAME_CHARS,
  MAX_APP_ORIGINS
} from '~/schemas/registry';

// Embed apps for "Login with Thingtime" (FUNDAMENTALS.md: everything is a
// thing) — a registered app is a `things` doc with thingtime ['app'] and
// crystal { clientId, name, origins }, owned by the developer user. Apps are
// created ONLY here (the schema has no generic-route sanitizer), the server
// mints the clientId, and a partial unique index keeps clientId one-of-a-kind.
//
// ORIGINS ARE DEFAULT-OPEN (owner decision, 2026-07): ANY valid web origin may
// open the authorize popup and receive a token for any registered app — so
// Thingtime SSO "just works" from preview deploys (Vercel previews, branch
// URLs) without the developer pre-registering each one. `origins` is kept as
// optional reference metadata only; nothing enforces it. The load-bearing
// protections are per-token, not per-list: every token is bound to the exact
// origin that requested it (embed routes require request Origin === token
// origin), the popup postMessages only to that origin, the consent screen
// shows the requesting host, and deleting the app revokes every token.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type PublicApp = {
  clientId: string;
  name: string;
  origins: string[];
  createdAt: Date;
  updatedAt: Date;
};

// The shape shown to ANONYMOUS callers (the authorize popup before login):
// just enough to render a consent screen, nothing about the owner or the
// reference origins list.
export type EmbedApp = {
  clientId: string;
  name: string;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Normalize a web origin: http(s), no path/query/hash/credentials, lowercased.
// Plain http is allowed only for localhost so dev sites can test the embed —
// production embeds must be https or tokens would travel in cleartext.
export const normalizeAppOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed.toLowerCase());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname)) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;

  return url.origin;
};

export const sanitizeAppName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_APP_NAME_CHARS) return null;
  return name;
};

// Origins are optional reference metadata (see the default-open note above):
// omitted/empty is fine, but anything provided must still be a clean origin so
// the stored list stays meaningful.
export const sanitizeAppOrigins = (value: unknown): string[] | Fail => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    return fail(400, 'origins must be a list of web origins');
  }
  if (value.length > MAX_APP_ORIGINS) {
    return fail(400, `An app can have at most ${MAX_APP_ORIGINS} origins`);
  }

  const origins: string[] = [];
  for (const entry of value) {
    const normalized = normalizeAppOrigin(entry);
    if (!normalized) {
      return fail(
        400,
        'Origins must be bare https origins like https://example.com (http is allowed for localhost only)'
      );
    }
    if (!origins.includes(normalized)) origins.push(normalized);
  }
  return origins;
};

const toPublicApp = (doc: any): PublicApp => ({
  clientId: doc.crystal?.clientId,
  name: doc.crystal?.name,
  origins: Array.isArray(doc.crystal?.origins) ? doc.crystal.origins : [],
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

export const findAppByClientId = async (clientId: string) => {
  if (typeof clientId !== 'string' || !clientId.trim()) return null;
  const things = await getThingsCollection();
  return things.findOne({ thingtime: 'app', 'crystal.clientId': clientId.trim() });
};

// Batch counterpart for grant listings: one indexed query instead of one
// findAppByClientId round-trip per connected app.
export const findAppsByClientIds = async (clientIds: string[]) => {
  const ids = clientIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
  if (!ids.length) return [];
  const things = await getThingsCollection();
  return things.find({ thingtime: 'app', 'crystal.clientId': { $in: ids } }).toArray();
};

export const createApp = async (
  ownerId: string,
  input: { name?: unknown; origins?: unknown }
): Promise<{ ok: true; app: PublicApp } | Fail> => {
  const name = sanitizeAppName(input.name);
  if (!name) return fail(400, `App name is required (max ${MAX_APP_NAME_CHARS} chars)`);

  const origins = sanitizeAppOrigins(input.origins);
  if (!Array.isArray(origins)) return origins;

  const things = await getThingsCollection();

  // Soft product cap (like the app-data key cap): racing registrations can
  // momentarily exceed it, which is harmless — listApps returns everything,
  // so nothing becomes invisible or undeletable.
  const count = await things.countDocuments({ thingtime: 'app', ownerId });
  if (count >= MAX_APPS_PER_USER) {
    return fail(400, `You can register at most ${MAX_APPS_PER_USER} apps`);
  }

  const now = new Date();
  const doc = {
    shareId: randomUUID(),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['app'],
    crystal: { clientId: `ttapp_${randomUUID()}`, name, origins },
    ownerId,
    acl: [ACL_OWNER],
    targetId: null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };

  await things.insertOne(doc as any);
  return { ok: true, app: toPublicApp(doc) };
};

// No .limit(): if racing registrations ever exceed the soft cap, the overflow
// apps must still show up here so the owner can see and delete them.
export const listApps = async (ownerId: string): Promise<PublicApp[]> => {
  const things = await getThingsCollection();
  const docs = await things.find({ thingtime: 'app', ownerId }).sort({ createdAt: 1 }).toArray();
  return docs.map(toPublicApp);
};

export const updateApp = async (
  ownerId: string,
  clientId: unknown,
  input: { name?: unknown; origins?: unknown }
): Promise<{ ok: true; app: PublicApp } | Fail> => {
  if (typeof clientId !== 'string' || !clientId.trim()) return fail(400, 'clientId is required');

  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = sanitizeAppName(input.name);
    if (!name) return fail(400, `App name is required (max ${MAX_APP_NAME_CHARS} chars)`);
    set['crystal.name'] = name;
  }

  if (input.origins !== undefined) {
    const origins = sanitizeAppOrigins(input.origins);
    if (!Array.isArray(origins)) return origins;
    set['crystal.origins'] = origins;
  }

  const things = await getThingsCollection();
  const updated = await things.findOneAndUpdate(
    { thingtime: 'app', 'crystal.clientId': clientId.trim(), ownerId },
    { $set: set },
    { returnDocument: 'after' }
  );

  if (!updated) return fail(404, 'App not found');
  return { ok: true, app: toPublicApp(updated) };
};

// Deleting an app revokes every app-scoped session minted for it, so tokens
// held by embedding sites die immediately. End users' app-data things are
// KEPT — that data belongs to the users, not the app developer.
export const deleteApp = async (ownerId: string, clientId: unknown): Promise<{ ok: true } | Fail> => {
  if (typeof clientId !== 'string' || !clientId.trim()) return fail(400, 'clientId is required');
  const id = clientId.trim();

  const things = await getThingsCollection();
  const deleted = await things.deleteOne({ thingtime: 'app', 'crystal.clientId': id, ownerId });
  if (!deleted.deletedCount) return fail(404, 'App not found');

  await (await getSessionsCollection()).updateMany(
    { purpose: 'app', 'meta.clientId': id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  return { ok: true };
};

export const toEmbedApp = (appDoc: any): EmbedApp => ({
  clientId: appDoc.crystal?.clientId,
  name: appDoc.crystal?.name
});
