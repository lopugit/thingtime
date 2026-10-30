import { getThingsCollection } from '../mongodb/collections';

// The consent screen's things picker: the user hand-picks specific things to
// share with a platform; the grant stores their shareIds (session
// meta.sharedThings) and GET /api/v1/oauth/shared serves exactly those,
// read-only. Access is by explicit owner grant, so the read path checks
// ownership at request time (deleted or transferred things silently drop out)
// rather than the acl machinery.

export const MAX_SHARED_THINGS = 100;

type Fail = { ok: false; status: number; error: string };

// Validate a picker selection at grant time: known shape, capped, and every
// id must be a thing the granting user OWNS — you can only share your own.
export const sanitizeSharedThings = async (
  ownerId: string,
  value: unknown
): Promise<{ ok: true; sharedThings: string[] } | Fail> => {
  if (value === undefined || value === null) return { ok: true, sharedThings: [] };
  if (!Array.isArray(value)) {
    return { ok: false, status: 400, error: 'sharedThings must be a list of thing ids' };
  }
  if (value.length > MAX_SHARED_THINGS) {
    return { ok: false, status: 400, error: `You can share at most ${MAX_SHARED_THINGS} things with an app` };
  }

  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 128) {
      return { ok: false, status: 400, error: 'sharedThings must be a list of thing ids' };
    }
    const id = entry.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return { ok: true, sharedThings: [] };

  const things = await getThingsCollection();
  const owned = await things
    .find({ shareId: { $in: ids }, ownerId })
    .project({ shareId: 1 })
    .toArray();
  const ownedIds = new Set(owned.map((doc: any) => doc.shareId));

  const missing = ids.filter((id) => !ownedIds.has(id));
  if (missing.length) {
    return { ok: false, status: 400, error: 'sharedThings may only contain things you own' };
  }

  return { ok: true, sharedThings: ids };
};

export type SharedThing = {
  shareId: string;
  thingtime: string[];
  crystal: Record<string, any> | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

// Serve a grant's shared things — re-checking ownership at read time, and
// projecting only the thing's content fields (never acl or owner internals).
export const getSharedThings = async (ownerId: string, sharedIds: string[]): Promise<SharedThing[]> => {
  if (!Array.isArray(sharedIds) || !sharedIds.length) return [];

  const things = await getThingsCollection();
  const docs = await things
    .find({ shareId: { $in: sharedIds.slice(0, MAX_SHARED_THINGS) }, ownerId })
    .project({ shareId: 1, thingtime: 1, crystal: 1, kind: 1, tags: 1, createdAt: 1, updatedAt: 1 })
    .sort({ createdAt: -1 })
    .toArray();

  return docs.map((doc: any) => ({
    shareId: doc.shareId,
    thingtime: Array.isArray(doc.thingtime) ? doc.thingtime : doc.kind ? [doc.kind] : [],
    crystal: doc.crystal ?? null,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  }));
};
