import { createHash } from 'node:crypto';

// These are request work sizes, never an owner library limit. Pages are live
// observations: neither exhaustion nor a cursor is deletion/snapshot authority.
export const OWNED_LIST_PAGE_SIZE = 64;
export const OWNED_LIST_QUERY_TIMEOUT_MS = 5_000;
type Purpose = 'themes' | 'algorithms';
type OrderField = 'updatedAt' | 'createdAt';
type Position = { time: string; id: string };

export class OwnedListCursorError extends Error {
  constructor() { super('Invalid owned list cursor'); }
}
const scope = (purpose: Purpose, ownerId: string) => createHash('sha256').update(JSON.stringify([purpose, ownerId])).digest('hex');
const encode = (purpose: Purpose, ownerId: string, position: Position) =>
  Buffer.from(JSON.stringify({ v: 1, scope: scope(purpose, ownerId), ...position })).toString('base64url');
const decode = (purpose: Purpose, ownerId: string, cursor?: string | null): Position | null => {
  if (cursor == null) return null;
  try {
    if (!cursor || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || value.v !== 1 || value.scope !== scope(purpose, ownerId) ||
      typeof value.time !== 'string' || !Number.isFinite(Date.parse(value.time)) || new Date(value.time).toISOString() !== value.time ||
      typeof value.id !== 'string' || !value.id || value.id.length > 512 ||
      encode(purpose, ownerId, { time: value.time, id: value.id }) !== cursor) throw new Error();
    return { time: value.time, id: value.id };
  } catch { throw new OwnedListCursorError(); }
};

/** Two bounded chronological windows, with modern authority checked outside
 * the cursor window before stale legacy twins can affect cursor progress. */
export const ownedListPage = async <T extends { shareId: string; createdAt: Date; updatedAt: Date }>(options: {
  ownerId: string;
  purpose: Purpose;
  things: any;
  legacy: any;
  kind: string;
  field: OrderField;
  direction: 1 | -1;
  cursor?: string | null;
  signal?: AbortSignal;
  fromThing(thing: any): T;
}): Promise<{ items: T[]; nextCursor: string | null }> => {
  const { ownerId, purpose, things, legacy, kind, field, direction, fromThing } = options;
  options.signal?.throwIfAborted();
  const position = decode(purpose, ownerId, options.cursor);
  const queryOptions = { maxTimeMS: OWNED_LIST_QUERY_TIMEOUT_MS, ...(options.signal ? { signal: options.signal } : {}) };
  const read = async (query: any): Promise<any[]> => {
    options.signal?.throwIfAborted();
    const rows = await query.toArray();
    options.signal?.throwIfAborted();
    return rows;
  };
  const after = position ? { $or: [
    { [field]: { [direction === 1 ? '$gt' : '$lt']: new Date(position.time) } },
    { [field]: new Date(position.time), shareId: { $gt: position.id } }
  ] } : {};
  const sort = { [field]: direction, shareId: 1 };
  const [modern, old] = await Promise.all([
    read(things.find({ ownerId, thingtime: kind, ...after }, queryOptions).sort(sort).limit(OWNED_LIST_PAGE_SIZE)),
    read(legacy.find({ ownerId, ...after }, queryOptions).sort(sort).limit(OWNED_LIST_PAGE_SIZE))
  ]);
  const candidates = [
    ...modern.map((doc: any) => ({ doc: fromThing(doc), legacy: false })),
    ...old.map((doc: T) => ({ doc, legacy: true }))
  ].sort((a, b) => direction * (new Date(a.doc[field]).getTime() - new Date(b.doc[field]).getTime()) ||
    (a.doc.shareId < b.doc.shareId ? -1 : a.doc.shareId > b.doc.shareId ? 1 : 0));
  const inspected = candidates.slice(0, OWNED_LIST_PAGE_SIZE);
  const legacyIds = inspected.filter(candidate => candidate.legacy).map(candidate => candidate.doc.shareId);
  // Do not filter this lookup by date: the authoritative twin can be on any
  // earlier/later page. Ownership and kind remain part of every lookup.
  const authoritative = legacyIds.length ? await read(things.find({ ownerId, thingtime: kind, shareId: { $in: legacyIds } }, queryOptions)
    .project({ shareId: 1 }).limit(OWNED_LIST_PAGE_SIZE)) : [];
  const modernIds = new Set(authoritative.map((doc: any) => doc.shareId));
  const items = inspected.filter(candidate => !candidate.legacy || !modernIds.has(candidate.doc.shareId)).map(candidate => candidate.doc);
  const last = inspected.at(-1)?.doc;
  const mayContinue = candidates.length > inspected.length || modern.length === OWNED_LIST_PAGE_SIZE || old.length === OWNED_LIST_PAGE_SIZE;
  options.signal?.throwIfAborted();
  return { items, nextCursor: last && mayContinue ? encode(purpose, ownerId, { time: new Date(last[field]).toISOString(), id: last.shareId }) : null };
};
