import { getThingsCollection } from '../mongodb/collections';
import { COUNT_MAX_TIME_MS, fetchCappedTotal } from '../mongodb/cappedTotal';
import {
  asViewer,
  canViewInherited,
  chronoCursorClause,
  fail,
  isFail,
  oldestCursorClause,
  parseChronoCursor,
  savedTargetIds,
  toPublicThings,
  visibilityQueryFor,
  withMatch,
  type Fail,
  type PublicThing,
  type ThingDoc,
  type Viewer
} from '../things/things';
import { searchThings } from '../things/search';

// Browse published schema things (thingtime ['schema']) for /schemas and the
// /search schema rail. Read paths reuse the hardened searchThings grammar
// wherever possible; the extras here are the sorts/filters search doesn't do:
//
//   sort=popular   reaction-count ranking (offset cursor, bounded window)
//   library=1      only schemas the viewer saved (ordered by save recency)
//   mine=1         only the viewer's own schemas (any audience)
//
// Every result is decorated with reactionCounts / viewerReactions / saved /
// usageCount so cards can render actions without N+1 client fetches.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const POPULAR_MAX_OFFSET = 500;
// COUNT_LIMIT / COUNT_MAX_TIME_MS and the capped-count helper live in
// ../mongodb/cappedTotal, shared with things/search.ts so the "N match" readout
// and its cap/timeout stay identical on /schemas and /search. COUNT_MAX_TIME_MS
// is imported above because the usage-count aggregate below reuses the deadline.

export type BrowseSchemasQuery = {
  q?: unknown;
  sort?: unknown; // newest (default) | oldest | popular | relevance (with q)
  cursor?: unknown;
  limit?: unknown;
  library?: unknown; // truthy → only the viewer's saved schemas
  mine?: unknown; // truthy → only the viewer's own schemas
};

export type BrowseSchemaEntry = PublicThing & {
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  saved: boolean;
  usageCount: number;
};

export type BrowseSchemasResult = {
  ok: true;
  schemas: BrowseSchemaEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

const clampLimit = (raw: unknown): number =>
  Math.min(Math.max(1, Number(raw) || DEFAULT_LIMIT), MAX_LIMIT);

const truthyFlag = (raw: unknown): boolean => raw === true || raw === '1' || raw === 'true';

// Schema things are v2-only (the schema crystal postdates the v1 era), so
// reactions pointing at them are always v2 reaction things — no legacy
// kind:'reaction' pass needed here.
const decorate = async (viewer: Viewer, things: PublicThing[]): Promise<BrowseSchemaEntry[]> => {
  if (!things.length) return [];
  const ids = things.map((thing) => thing.id);
  const names = things
    .map((thing) => (typeof thing.crystal?.name === 'string' ? thing.crystal.name : null))
    .filter(Boolean) as string[];

  const collection = await getThingsCollection();
  const visibility = visibilityQueryFor(viewer, []);
  const viewerId = viewer?.id || null;

  const [reactionGroups, saved, usageDocs] = await Promise.all([
    // Aggregate reaction counts server-side (one $group per (target, emoji))
    // instead of shipping every raw reaction doc for the page's schemas over the
    // wire — a schema with thousands of reactions would otherwise stream them all
    // just to be reduced to per-token counts in JS. viewerReacted is folded in so
    // no per-doc ownerId comparison is needed on the app server.
    collection
      .aggregate([
        { $match: { thingtime: 'reaction', targetId: { $in: ids } } },
        {
          $group: {
            _id: { t: '$targetId', e: '$crystal.emoji' },
            count: { $sum: 1 },
            viewerReacted: { $max: { $cond: [{ $eq: ['$ownerId', viewerId] }, 1, 0] } }
          }
        }
      ])
      .toArray(),
    savedTargetIds(viewer, ids),
    visibility
      ? collection
          .aggregate([
            {
              // data things created via the schema form stamp crystal.schemaId
              // (the schema thing's shareId) — the precise per-schema key.
              // Docs from before the stamp fall back to the display name,
              // which isn't unique, so only legacy docs keep name semantics.
              $match: withMatch(
                { thingtime: 'data' },
                {
                  $or: [
                    { 'crystal.schemaId': { $in: ids } },
                    ...(names.length
                      ? [{ 'crystal.schemaId': { $exists: false }, 'crystal.schema': { $in: names } }]
                      : [])
                  ]
                },
                visibility
              )
            },
            { $group: { _id: { $ifNull: ['$crystal.schemaId', '$crystal.schema'] }, count: { $sum: 1 } } }
          ], { maxTimeMS: COUNT_MAX_TIME_MS })
          .toArray()
          // usage counts are decoration — a slow/failed count must not take
          // the whole browse page down with it
          .catch(() => [] as any[])
      : Promise.resolve([] as any[])
  ]);

  const reactionsByTarget = new Map<string, { counts: Record<string, number>; viewer: string[] }>();
  for (const row of reactionGroups as any[]) {
    const targetId = row._id?.t != null ? String(row._id.t) : null;
    const token = typeof row._id?.e === 'string' ? row._id.e : null;
    if (!targetId || !token) continue;
    const entry = reactionsByTarget.get(targetId) || { counts: {}, viewer: [] };
    entry.counts[token] = (entry.counts[token] || 0) + (Number(row.count) || 0);
    if (row.viewerReacted && !entry.viewer.includes(token)) entry.viewer.push(token);
    reactionsByTarget.set(targetId, entry);
  }

  // keyed by schemaId (shareId) for stamped docs, by display name for legacy
  const usageByKey = new Map<string, number>();
  for (const doc of usageDocs as any[]) {
    if (typeof doc._id === 'string') usageByKey.set(doc._id, Number(doc.count) || 0);
  }

  return things.map((thing) => {
    const reactions = reactionsByTarget.get(thing.id) || { counts: {}, viewer: [] };
    const name = typeof thing.crystal?.name === 'string' ? thing.crystal.name : '';
    return {
      ...thing,
      reactionCounts: reactions.counts,
      viewerReactions: reactions.viewer,
      saved: saved.has(thing.id),
      usageCount: (usageByKey.get(thing.id) || 0) + (name ? usageByKey.get(name) || 0 : 0)
    };
  });
};

// popular: reaction-count ranking over the visibility superset, exact acl
// check on the fetched page (same superset-then-exact model as search/feed).
const browsePopular = async (
  viewer: Viewer,
  cursor: unknown,
  limit: number
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null; totalCapped: boolean }> => {
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { things: [], nextCursor: null, total: 0, totalCapped: false };

  const offset = Math.min(Math.max(0, Number(cursor) || 0), POPULAR_MAX_OFFSET);
  const match = withMatch({ thingtime: 'schema' }, visibility);

  const collection = await getThingsCollection();

  // Rank in two indexed passes instead of a per-schema $lookup (which ran a
  // reaction sub-pipeline for EVERY schema in the visibility superset on every
  // request): (1) collect candidate schema ids, (2) one $group over reaction
  // things by targetId. Sort the counts in memory (same order the $sort used:
  // reactionCount desc, createdAt desc, shareId asc) and page by offset.
  const [candidates, { total, totalCapped }] = await Promise.all([
    collection.find(match as any).project({ shareId: 1, createdAt: 1 }).toArray() as Promise<
      { shareId: string; createdAt: Date }[]
    >,
    fetchCappedTotal(collection, match, cursor)
  ]);

  const candidateIds = candidates.map((candidate) => candidate.shareId);
  const reactionCounts = new Map<string, number>();
  if (candidateIds.length) {
    const grouped = (await collection
      .aggregate([
        { $match: { thingtime: 'reaction', targetId: { $in: candidateIds } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
      ])
      .toArray()) as any[];
    for (const row of grouped) reactionCounts.set(String(row._id), Number(row.count) || 0);
  }

  const ranked = candidates
    .map((candidate) => ({
      shareId: candidate.shareId,
      createdAt: candidate.createdAt,
      reactionCount: reactionCounts.get(candidate.shareId) || 0
    }))
    .sort(
      (a, b) =>
        b.reactionCount - a.reactionCount ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        (a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0)
    );

  const pageIds = ranked.slice(offset, offset + limit + 1).map((entry) => entry.shareId);
  const fetched = pageIds.length
    ? ((await collection.find({ shareId: { $in: pageIds } } as any).toArray()) as any as ThingDoc[])
    : [];
  const byId = new Map(fetched.map((doc) => [doc.shareId, doc]));
  const docs = pageIds.map((id) => byId.get(id)).filter(Boolean) as ThingDoc[];

  const page = docs.slice(0, limit);
  const visibleFlags = await Promise.all(page.map((doc) => canViewInherited(doc, viewer)));
  const visible = page.filter((_, index) => visibleFlags[index]);
  const nextOffset = offset + limit;
  const nextCursor = docs.length > limit && nextOffset <= POPULAR_MAX_OFFSET ? String(nextOffset) : null;
  return {
    things: await toPublicThings(visible, viewer),
    nextCursor,
    total,
    totalCapped
  };
};

// library: the viewer's save things (newest save first) resolved to their
// schema targets. Cursor pages over the SAVE docs, so unsave/reorder is stable.
const browseLibrary = async (
  viewer: Viewer,
  cursor: unknown,
  limit: number
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null }> => {
  if (!viewer?.id) return fail(401, 'Sign in to see your library');
  const collection = await getThingsCollection();

  const cursorDoc = parseChronoCursor(typeof cursor === 'string' ? cursor : undefined);
  const match = withMatch(
    { ownerId: viewer.id, thingtime: 'save' },
    ...(cursorDoc ? [chronoCursorClause(cursorDoc)] : [])
  );
  const saves = (await collection
    .find(match as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(limit + 1)
    .toArray()) as any as ThingDoc[];

  const page = saves.slice(0, limit);
  const targetIds = page.map((save) => save.targetId).filter(Boolean) as string[];
  const targets = targetIds.length
    ? ((await collection.find({ shareId: { $in: targetIds }, thingtime: 'schema' } as any).toArray()) as any as ThingDoc[])
    : [];
  const byId = new Map(targets.map((doc) => [doc.shareId, doc]));
  const ordered = targetIds.map((id) => byId.get(id)).filter(Boolean) as ThingDoc[];
  const visibleFlags = await Promise.all(ordered.map((doc) => canViewInherited(doc, viewer)));
  const visible = ordered.filter((_, index) => visibleFlags[index]);

  const last = page[page.length - 1];
  const nextCursor =
    saves.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { things: await toPublicThings(visible, viewer), nextCursor };
};

// mine: the viewer's own schemas, any audience, chrono cursors.
const browseMine = async (
  viewer: Viewer,
  sort: 'newest' | 'oldest',
  cursor: unknown,
  limit: number
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null; totalCapped: boolean }> => {
  if (!viewer?.id) return fail(401, 'Sign in to see your schemas');
  const collection = await getThingsCollection();

  const cursorDoc = parseChronoCursor(typeof cursor === 'string' ? cursor : undefined);
  const match = withMatch(
    { ownerId: viewer.id, thingtime: 'schema' },
    ...(cursorDoc ? [sort === 'oldest' ? oldestCursorClause(cursorDoc) : chronoCursorClause(cursorDoc)] : [])
  );
  const [docs, { total, totalCapped }] = await Promise.all([
    collection
      .find(match as any)
      .sort(sort === 'oldest' ? { createdAt: 1, shareId: 1 } : { createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray() as Promise<ThingDoc[]>,
    fetchCappedTotal(collection, { ownerId: viewer.id, thingtime: 'schema' }, cursor)
  ]);

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { things: await toPublicThings(page, viewer), nextCursor, total, totalCapped };
};

export const browseSchemas = async (
  viewerInput: string | Viewer,
  query: BrowseSchemasQuery
): Promise<Fail | BrowseSchemasResult> => {
  const viewer = asViewer(viewerInput);
  const limit = clampLimit(query.limit);
  const sortRaw = typeof query.sort === 'string' ? query.sort.trim() : '';
  const q = typeof query.q === 'string' ? query.q.trim() : '';

  if (truthyFlag(query.library)) {
    const result = await browseLibrary(viewer, query.cursor, limit);
    if (isFail(result)) return result;
    return {
      ok: true,
      schemas: await decorate(viewer, result.things),
      nextCursor: result.nextCursor,
      total: null,
      totalCapped: false
    };
  }

  if (truthyFlag(query.mine)) {
    const sort = sortRaw === 'oldest' ? 'oldest' : 'newest';
    const result = await browseMine(viewer, sort, query.cursor, limit);
    if (isFail(result)) return result;
    return {
      ok: true,
      schemas: await decorate(viewer, result.things),
      nextCursor: result.nextCursor,
      total: result.total,
      totalCapped: result.totalCapped
    };
  }

  if (sortRaw === 'popular') {
    const result = await browsePopular(viewer, query.cursor, limit);
    if (isFail(result)) return result;
    return {
      ok: true,
      schemas: await decorate(viewer, result.things),
      nextCursor: result.nextCursor,
      total: result.total,
      totalCapped: result.totalCapped
    };
  }

  // newest / oldest / relevance-with-q ride the hardened search grammar
  const sort = sortRaw === 'oldest' ? 'oldest' : sortRaw === 'relevance' && q ? 'relevance' : q && !sortRaw ? undefined : 'newest';
  const result = await searchThings(viewer, {
    q: q || undefined,
    thingtime: 'schema',
    sort,
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
    limit
  });
  if (isFail(result)) return result;
  return {
    ok: true,
    schemas: await decorate(viewer, result.things),
    nextCursor: result.nextCursor,
    total: result.total,
    totalCapped: result.totalCapped
  };
};
