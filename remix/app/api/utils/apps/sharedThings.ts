import { createHash } from 'node:crypto';
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS, isProtectedThingtime } from '~/schemas/registry';

export const SESSION_RESOURCE_GRANT_KIND = 'session-resource-grant';
// Query/write batch sizes are independent of the total selected audience.
const GRANT_BATCH = 100;
type Fail = { ok: false; status: number; error: string };
const allowedResource = (doc: any) => !isProtectedThingtime(doc.thingtime || (doc.kind ? [doc.kind] : []));

export const sanitizeSharedThings = async (ownerId: string, value: unknown): Promise<{ ok: true; sharedThings: string[] } | Fail> => {
  if (value === undefined || value === null) return { ok: true, sharedThings: [] };
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'sharedThings must be a list of thing ids' };
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 128)
      return { ok: false, status: 400, error: 'sharedThings must be a list of thing ids' };
    ids.add(entry.trim());
  }
  const selected = [...ids];
  const things = await getThingsCollection();
  for (let offset = 0; offset < selected.length; offset += GRANT_BATCH) {
    const batch = selected.slice(offset, offset + GRANT_BATCH);
    const owned = await things.find({ shareId: { $in: batch }, ownerId }).project({ shareId: 1, thingtime: 1, kind: 1 }).toArray();
    const ownedIds = new Set(owned.filter(allowedResource).map((doc: any) => doc.shareId));
    if (batch.some(id => !ownedIds.has(id))) return { ok: false, status: 400, error: 'sharedThings may only contain ordinary things you own' };
  }
  return { ok: true, sharedThings: selected };
};

export type SharedThingsSource = readonly string[] | { sessionId: string; count: number };
export const sharedThingsCount = (source: SharedThingsSource): number => Array.isArray(source) ? new Set(source).size : (source as { count: number }).count;
const grantId = (sessionId: string, resourceId: string) => 'session-resource-grant-' + createHash('sha256').update(JSON.stringify([sessionId, resourceId])).digest('hex');

/** Only called inside the home session-issuance transaction. Rows are private,
 * disposable authorization control state, not user content or credentials. */
export const storeSessionSharedThings = async (things: any, ownerId: string, sessionId: string, expiresAt: Date, source: SharedThingsSource, session: any) => {
  const now = new Date();
  const write = async (ids: string[]) => {
    if (!ids.length) return;
    await things.insertMany(ids.map(resourceId => ({
      shareId: grantId(sessionId, resourceId), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      thingtime: [SESSION_RESOURCE_GRANT_KIND], ownerId, targetId: sessionId, parentId: resourceId,
      acl: ['tt:user'], storageClass: 'control', crystal: {}, createdAt: now, updatedAt: now, expiresAt
    })), { session });
  };
  if (Array.isArray(source)) {
    const ids = [...new Set(source)];
    for (let offset = 0; offset < ids.length; offset += GRANT_BATCH) await write(ids.slice(offset, offset + GRANT_BATCH));
  } else {
    // A consumed, verified desktop code delegates its exact saved grant set.
    // Copy through bounded batches without embedding it into the new session.
    const cursor = things.find({ thingtime: SESSION_RESOURCE_GRANT_KIND, ownerId, targetId: (source as { sessionId: string }).sessionId }, { session, projection: { parentId: 1 } }).batchSize(GRANT_BATCH);
    let batch: string[] = [], count = 0;
    for await (const row of cursor) {
      if (typeof row.parentId !== 'string') throw new Error('Saved sharing grant is invalid');
      batch.push(row.parentId); count++;
      if (batch.length === GRANT_BATCH) { await write(batch); batch = []; }
    }
    await write(batch);
    if (count !== (source as { count: number }).count) throw new Error('Saved sharing grants changed during authorization');
  }
};

export type SharedThing = { shareId: string; thingtime: string[]; crystal: Record<string, any> | null; tags: string[]; createdAt: Date; updatedAt: Date };
const project = (doc: any): SharedThing => ({ shareId: doc.shareId, thingtime: Array.isArray(doc.thingtime) ? doc.thingtime : doc.kind ? [doc.kind] : [], crystal: doc.crystal ?? null, tags: Array.isArray(doc.tags) ? doc.tags : [], createdAt: doc.createdAt, updatedAt: doc.updatedAt });
const readOwned = async (ownerId: string, ids: readonly string[]): Promise<SharedThing[]> => {
  if (!ids.length) return [];
  const docs = await (await getThingsCollection()).find({ shareId: { $in: ids }, ownerId })
    .project({ shareId: 1, thingtime: 1, crystal: 1, kind: 1, tags: 1, createdAt: 1, updatedAt: 1 }).sort({ createdAt: -1 }).toArray();
  return docs.filter(allowedResource).map(project);
};
// Legacy internal adapter remains complete and never silently truncates IDs.
export const getSharedThings = async (ownerId: string, ids: string[]): Promise<SharedThing[]> => {
  const result: SharedThing[] = [];
  for (let offset = 0; offset < ids.length; offset += GRANT_BATCH) result.push(...await readOwned(ownerId, ids.slice(offset, offset + GRANT_BATCH)));
  return result;
};

/** Caller has verified the current live session/app/origin/scope. A zero-row
 * relational set is authoritative: never revive legacy metadata after removal. */
export const getSessionSharedThings = async (ownerId: string, sessionId: string, legacyIds: readonly string[] | null, query: { cursor?: string | null; limit?: number; id?: string } = {}): Promise<{ things: SharedThing[]; nextCursor: string | null }> => {
  const limit = Math.max(1, Math.min(GRANT_BATCH, Math.floor(query.limit || GRANT_BATCH)));
  if (legacyIds) {
    const selected = [...new Set(legacyIds)].sort().filter(id => query.id ? id === query.id : !query.cursor || id > query.cursor);
    const page = selected.slice(0, limit);
    return { things: await readOwned(ownerId, page), nextCursor: !query.id && selected.length > limit ? page.at(-1)! : null };
  }
  const grants = await getHomeThingsCollection();
  if (query.id) {
    const granted = await grants.findOne({ shareId: grantId(sessionId, query.id), thingtime: SESSION_RESOURCE_GRANT_KIND, ownerId, targetId: sessionId, parentId: query.id });
    return { things: granted ? await readOwned(ownerId, [query.id]) : [], nextCursor: null };
  }
  const after = query.cursor?.match(/^(\d+)_(session-resource-grant-[a-f0-9]{64})$/);
  if (query.cursor && (!after || !Number.isFinite(new Date(Number(after[1])).getTime()))) throw new Error('Invalid sharing cursor');
  const rows = await grants.find({ thingtime: SESSION_RESOURCE_GRANT_KIND, ownerId, targetId: sessionId,
    ...(after ? { $or: [{ createdAt: { $gt: new Date(Number(after[1])) } }, { createdAt: new Date(Number(after[1])), shareId: { $gt: after[2] } }] } : {}) })
    .sort({ createdAt: 1, shareId: 1 }).limit(limit + 1).project({ shareId: 1, parentId: 1, createdAt: 1 }).toArray();
  const page = rows.slice(0, limit);
  return { things: await readOwned(ownerId, page.map((row: any) => row.parentId)), nextCursor: rows.length > limit ? `${new Date(page.at(-1)!.createdAt).getTime()}_${page.at(-1)!.shareId}` : null };
};
