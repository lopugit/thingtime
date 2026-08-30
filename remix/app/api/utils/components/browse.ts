import { getThingsCollection } from '../mongodb/collections';
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
import { COMPONENT_LIBRARIES } from '~/schemas/registry';

// Browse published component things (thingtime ['component']) for /components
// — the UI-first sibling of /api/v1/schemas/browse. Same read model:
//
//   sort=popular   reaction-count ranking (offset cursor, bounded window)
//   library=1      only components the viewer saved (ordered by save recency)
//   mine=1         only the viewer's own components (any audience)
//   q=             text search via the hardened searchThings grammar
//   lib=<id>       design-library filter (antd/bootstrap/…), no-q pages only
//   category=<id>  catalog category filter, no-q pages only
//
// Every result carries reactionCounts / viewerReactions / saved / usageCount
// (visible saved versions sharing the componentKey) so cards render actions
// without N+1 client fetches.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const POPULAR_MAX_OFFSET = 500;
const COUNT_LIMIT = 1000;
const COUNT_MAX_TIME_MS = 2000;
const MAX_CATEGORY_FILTER_CHARS = 40;

export type BrowseComponentsQuery = {
  q?: unknown;
  sort?: unknown; // newest (default) | oldest | popular | relevance (with q)
  cursor?: unknown;
  limit?: unknown;
  library?: unknown; // truthy → only the viewer's saved components
  mine?: unknown; // truthy → only the viewer's own components
  lib?: unknown; // design-library filter
  category?: unknown; // category filter
  group?: unknown; // 'family' → one representative card per familyKey
  family?: unknown; // fetch every design of one family (familyKey or componentKey)
};

export type ComponentDesignRef = { id: string; library: string };

export type BrowseComponentEntry = PublicThing & {
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  saved: boolean;
  usageCount: number;
  // present on group=family pages: every visible design of this entry's family
  designs?: ComponentDesignRef[];
};

export type BrowseComponentsResult = {
  ok: true;
  components: BrowseComponentEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

const clampLimit = (raw: unknown): number => Math.min(Math.max(1, Number(raw) || DEFAULT_LIMIT), MAX_LIMIT);

const truthyFlag = (raw: unknown): boolean => raw === true || raw === '1' || raw === 'true';

// First-page-only capped total (cursor pages skip the count, failures → null).
const cappedCount = async (
  collection: { countDocuments: (filter: any, options: any) => Promise<number> },
  match: unknown,
  cursor: unknown
): Promise<number | null> => {
  if (cursor) return null;
  try {
    const count = await collection.countDocuments(match, { limit: COUNT_LIMIT + 1, maxTimeMS: COUNT_MAX_TIME_MS });
    return Math.min(count, COUNT_LIMIT);
  } catch {
    return null;
  }
};

// The two catalog filters ride the no-q pages as exact crystal matches; both
// are validated so arbitrary strings never reach the query.
const libFilterOf = (raw: unknown): string | null => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return (COMPONENT_LIBRARIES as readonly string[]).includes(value) ? value : null;
};

const categoryFilterOf = (raw: unknown): string | null => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value && value.length <= MAX_CATEGORY_FILTER_CHARS && /^[a-z0-9-]+$/.test(value) ? value : null;
};

// Component things are v2-only (the component crystal postdates the v1 era),
// so reactions pointing at them are always v2 reaction things.
const decorate = async (viewer: Viewer, things: PublicThing[]): Promise<BrowseComponentEntry[]> => {
  if (!things.length) return [];
  const ids = things.map((thing) => thing.id);
  const componentKeys = things
    .map((thing) => (typeof thing.crystal?.componentKey === 'string' ? thing.crystal.componentKey : null))
    .filter(Boolean) as string[];

  const collection = await getThingsCollection();
  const visibility = visibilityQueryFor(viewer, []);
  const viewerId = viewer?.id || null;

  const [reactionGroups, saved, versionDocs] = await Promise.all([
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
    // usage = visible saved versions/forks sharing the componentKey (the
    // seeded source itself is excluded per-entry below)
    visibility && componentKeys.length
      ? collection
          .aggregate(
            [
              { $match: withMatch({ thingtime: 'component' }, { 'crystal.componentKey': { $in: componentKeys } }, visibility) },
              { $group: { _id: '$crystal.componentKey', count: { $sum: 1 } } }
            ],
            { maxTimeMS: COUNT_MAX_TIME_MS }
          )
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

  const versionsByKey = new Map<string, number>();
  for (const doc of versionDocs as any[]) {
    if (typeof doc._id === 'string') versionsByKey.set(doc._id, Number(doc.count) || 0);
  }

  return things.map((thing) => {
    const reactions = reactionsByTarget.get(thing.id) || { counts: {}, viewer: [] };
    const componentKey = typeof thing.crystal?.componentKey === 'string' ? thing.crystal.componentKey : '';
    const kin = componentKey ? versionsByKey.get(componentKey) || 0 : 0;
    return {
      ...thing,
      reactionCounts: reactions.counts,
      viewerReactions: reactions.viewer,
      saved: saved.has(thing.id),
      // the doc itself is part of its componentKey group — report OTHER versions
      usageCount: Math.max(0, kin - 1)
    };
  });
};

// Canonical design order: the house style fronts a family, then the source
// libraries in catalog order. Used to pick a family's representative card and
// to order design switcher pills.
const DESIGN_LIBRARY_ORDER = ['thingtime', 'antd', 'bootstrap', 'mui', 'shadcn', 'untitled', 'daisyui', 'reactflow', 'custom'];
const designRank = (library: unknown): number => {
  const index = DESIGN_LIBRARY_ORDER.indexOf(typeof library === 'string' ? library : '');
  return index === -1 ? DESIGN_LIBRARY_ORDER.length : index;
};

const familyKeyOf = (raw: unknown): string | null => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value && value.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ? value : null;
};

const MAX_FAMILY_DESIGNS = 16;

// One family, every visible design — powers the card's designs click-through
// and the /components/:key detail page. Key matches familyKey OR componentKey
// (so individual design slugs deep-link too).
const browseFamily = async (
  viewer: Viewer,
  key: string
): Promise<Fail | { things: PublicThing[]; nextCursor: null; total: number | null }> => {
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { things: [], nextCursor: null, total: 0 };

  const collection = await getThingsCollection();
  const match = withMatch(
    { thingtime: 'component' },
    { $or: [{ 'crystal.familyKey': key }, { 'crystal.componentKey': key }] },
    visibility
  );
  let docs = (await collection
    .find(match as any)
    .limit(MAX_FAMILY_DESIGNS * 2)
    .toArray()) as any as ThingDoc[];

  // a componentKey slug names ONE design — expand to its whole family so the
  // detail page always gets the full designs roster
  const expandKey = docs
    .map((doc) => (typeof (doc as any).crystal?.familyKey === 'string' ? (doc as any).crystal.familyKey : null))
    .find((candidate) => candidate && candidate !== key);
  if (expandKey) {
    docs = (await collection
      .find(withMatch({ thingtime: 'component' }, { 'crystal.familyKey': expandKey }, visibility) as any)
      .limit(MAX_FAMILY_DESIGNS * 2)
      .toArray()) as any as ThingDoc[];
  }

  const visibleFlags = await Promise.all(docs.map((doc) => canViewInherited(doc, viewer)));
  const visible = docs
    .filter((_, index) => visibleFlags[index])
    .sort(
      (a, b) =>
        designRank((a as any).crystal?.library) - designRank((b as any).crystal?.library) ||
        (a.shareId < b.shareId ? -1 : 1)
    )
    .slice(0, MAX_FAMILY_DESIGNS);
  return { things: await toPublicThings(visible, viewer), nextCursor: null, total: visible.length };
};

// group=family: one representative card per familyKey (offset cursor over a
// bounded window, mirroring the popular path's superset-then-exact model).
// Ungrouped docs (no familyKey — e.g. user saved versions) group by shareId,
// so they still appear as their own card.
const browseFamilies = async (
  viewer: Viewer,
  cursor: unknown,
  limit: number,
  category: string | null
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null; designsByFamily: Map<string, ComponentDesignRef[]> }> => {
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { things: [], nextCursor: null, total: 0, designsByFamily: new Map() };

  const offset = Math.min(Math.max(0, Number(cursor) || 0), POPULAR_MAX_OFFSET);
  const filters: Record<string, unknown>[] = [];
  if (category) filters.push({ 'crystal.category': category });
  const match = withMatch({ thingtime: 'component' }, ...filters, visibility);

  const collection = await getThingsCollection();
  const groups = (await collection
    .aggregate(
      [
        { $match: match },
        { $sort: { createdAt: -1, shareId: 1 } },
        {
          $group: {
            _id: { $ifNull: ['$crystal.familyKey', '$shareId'] },
            latest: { $first: '$createdAt' },
            designs: { $push: { id: '$shareId', library: '$crystal.library' } }
          }
        },
        { $sort: { latest: -1, _id: 1 } },
        { $skip: offset },
        { $limit: limit + 1 }
      ],
      { maxTimeMS: COUNT_MAX_TIME_MS * 2 }
    )
    .toArray()) as any[];

  const page = groups.slice(0, limit);
  const candidatesByFamily = new Map<string, ComponentDesignRef[]>();
  const candidateIds: string[] = [];
  for (const group of page) {
    const designs = (Array.isArray(group.designs) ? group.designs : [])
      .filter((design: any) => typeof design?.id === 'string')
      .map((design: any) => ({ id: design.id, library: typeof design.library === 'string' ? design.library : 'custom' }))
      .sort((a: ComponentDesignRef, b: ComponentDesignRef) => designRank(a.library) - designRank(b.library) || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_FAMILY_DESIGNS);
    if (!designs.length) continue;
    candidatesByFamily.set(String(group._id), designs);
    for (const design of designs) candidateIds.push(design.id);
  }

  // Exact acl check EVERY design, not just each family's representative. The
  // aggregation above matched the visibility SUPERSET, which still contains
  // moderation-blocked docs and ones a `-tt:user/<name>` entry excludes this
  // viewer from — so checking only the representative would ship those ids in
  // designs[], and would drop a whole family off the page whenever its
  // top-ranked design is hidden instead of falling back to a visible sibling.
  // Components never carry tt:inherit, so the chain walk adds no extra query.
  const fetched = candidateIds.length
    ? ((await collection.find({ shareId: { $in: candidateIds } } as any).toArray()) as any as ThingDoc[])
    : [];
  const byId = new Map(fetched.map((doc) => [doc.shareId, doc]));
  const visibleFlags = await Promise.all(fetched.map((doc) => canViewInherited(doc, viewer)));
  const viewable = new Set(fetched.filter((_, index) => visibleFlags[index]).map((doc) => doc.shareId));

  const designsByFamily = new Map<string, ComponentDesignRef[]>();
  const visible: ThingDoc[] = [];
  // Map iteration keeps page order (latest desc, _id asc) from the aggregation.
  for (const [familyKey, designs] of candidatesByFamily) {
    const allowed = designs.filter((design) => viewable.has(design.id));
    const representative = allowed.length ? byId.get(allowed[0].id) : null;
    if (!representative) continue;
    designsByFamily.set(familyKey, allowed);
    visible.push(representative);
  }

  // total = family count (capped), first page only — cheap distinct-ish count
  let total: number | null = null;
  if (!cursor) {
    try {
      const counted = (await collection
        .aggregate(
          [
            { $match: match },
            { $group: { _id: { $ifNull: ['$crystal.familyKey', '$shareId'] } } },
            { $count: 'families' }
          ],
          { maxTimeMS: COUNT_MAX_TIME_MS }
        )
        .toArray()) as any[];
      total = Math.min(Number(counted[0]?.families) || 0, COUNT_LIMIT);
    } catch {
      total = null;
    }
  }

  const nextOffset = offset + limit;
  const nextCursor = groups.length > limit && nextOffset <= POPULAR_MAX_OFFSET ? String(nextOffset) : null;
  return { things: await toPublicThings(visible, viewer), nextCursor, total, designsByFamily };
};

// newest/oldest with optional lib/category filters: superset visibility match,
// chrono cursors, exact acl check on the fetched page (superset-then-exact,
// same model as search/feed).
const browseLatest = async (
  viewer: Viewer,
  sort: 'newest' | 'oldest',
  cursor: unknown,
  limit: number,
  lib: string | null,
  category: string | null
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null }> => {
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { things: [], nextCursor: null, total: 0 };

  const collection = await getThingsCollection();
  const cursorDoc = parseChronoCursor(typeof cursor === 'string' ? cursor : undefined);
  const filters: Record<string, unknown>[] = [];
  if (lib) filters.push({ 'crystal.library': lib });
  if (category) filters.push({ 'crystal.category': category });
  const baseMatch = withMatch({ thingtime: 'component' }, ...filters, visibility);
  const match = withMatch(
    baseMatch,
    ...(cursorDoc ? [sort === 'oldest' ? oldestCursorClause(cursorDoc) : chronoCursorClause(cursorDoc)] : [])
  );

  const [docs, total] = await Promise.all([
    collection
      .find(match as any)
      .sort(sort === 'oldest' ? { createdAt: 1, shareId: 1 } : { createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray() as Promise<ThingDoc[]>,
    cappedCount(collection, baseMatch, cursor)
  ]);

  const page = docs.slice(0, limit);
  const visibleFlags = await Promise.all(page.map((doc) => canViewInherited(doc, viewer)));
  const visible = page.filter((_, index) => visibleFlags[index]);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { things: await toPublicThings(visible, viewer), nextCursor, total };
};

// popular: reaction-count ranking over the visibility superset (bounded
// offset window), exact acl check on the fetched page.
const browsePopular = async (
  viewer: Viewer,
  cursor: unknown,
  limit: number,
  lib: string | null,
  category: string | null
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null; totalCapped: boolean }> => {
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { things: [], nextCursor: null, total: 0, totalCapped: false };

  const offset = Math.min(Math.max(0, Number(cursor) || 0), POPULAR_MAX_OFFSET);
  const filters: Record<string, unknown>[] = [];
  if (lib) filters.push({ 'crystal.library': lib });
  if (category) filters.push({ 'crystal.category': category });
  const match = withMatch({ thingtime: 'component' }, ...filters, visibility);

  const collection = await getThingsCollection();
  const [candidates, total] = await Promise.all([
    collection.find(match as any).project({ shareId: 1, createdAt: 1 }).toArray() as Promise<
      { shareId: string; createdAt: Date }[]
    >,
    cappedCount(collection, match, cursor)
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
    totalCapped: total === COUNT_LIMIT
  };
};

// library: the viewer's save things (newest save first) resolved to their
// component targets. Cursor pages over the SAVE docs, so unsave stays stable.
const browseSaved = async (
  viewer: Viewer,
  cursor: unknown,
  limit: number
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null }> => {
  if (!viewer?.id) return fail(401, 'Sign in to see your saved components');
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
    ? ((await collection.find({ shareId: { $in: targetIds }, thingtime: 'component' } as any).toArray()) as any as ThingDoc[])
    : [];
  const byId = new Map(targets.map((doc) => [doc.shareId, doc]));
  const ordered = targetIds.map((id) => byId.get(id)).filter(Boolean) as ThingDoc[];
  const visibleFlags = await Promise.all(ordered.map((doc) => canViewInherited(doc, viewer)));
  const visible = ordered.filter((_, index) => visibleFlags[index]);

  const last = page[page.length - 1];
  const nextCursor = saves.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { things: await toPublicThings(visible, viewer), nextCursor };
};

// mine: the viewer's own components, any audience, chrono cursors.
const browseMine = async (
  viewer: Viewer,
  sort: 'newest' | 'oldest',
  cursor: unknown,
  limit: number
): Promise<Fail | { things: PublicThing[]; nextCursor: string | null; total: number | null }> => {
  if (!viewer?.id) return fail(401, 'Sign in to see your components');
  const collection = await getThingsCollection();

  const cursorDoc = parseChronoCursor(typeof cursor === 'string' ? cursor : undefined);
  const match = withMatch(
    { ownerId: viewer.id, thingtime: 'component' },
    ...(cursorDoc ? [sort === 'oldest' ? oldestCursorClause(cursorDoc) : chronoCursorClause(cursorDoc)] : [])
  );
  const [docs, total] = await Promise.all([
    collection
      .find(match as any)
      .sort(sort === 'oldest' ? { createdAt: 1, shareId: 1 } : { createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray() as Promise<ThingDoc[]>,
    cappedCount(collection, { ownerId: viewer.id, thingtime: 'component' }, cursor)
  ]);

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { things: await toPublicThings(page, viewer), nextCursor, total: typeof total === 'number' ? total : null };
};

export const browseComponents = async (
  viewerInput: string | Viewer,
  query: BrowseComponentsQuery
): Promise<Fail | BrowseComponentsResult> => {
  const viewer = asViewer(viewerInput);
  const limit = clampLimit(query.limit);
  const sortRaw = typeof query.sort === 'string' ? query.sort.trim() : '';
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const lib = libFilterOf(query.lib);
  const category = categoryFilterOf(query.category);

  const finish = async (
    result: Fail | { things: PublicThing[]; nextCursor: string | null; total?: number | null; totalCapped?: boolean }
  ): Promise<Fail | BrowseComponentsResult> => {
    if (isFail(result)) return result;
    return {
      ok: true,
      components: await decorate(viewer, result.things),
      nextCursor: result.nextCursor,
      total: result.total ?? null,
      totalCapped: result.totalCapped ?? result.total === COUNT_LIMIT
    };
  };

  // one family's designs (familyKey or componentKey) — the card switcher and
  // the /components/:key detail page ride this
  const family = familyKeyOf(query.family);
  if (family) {
    return finish(await browseFamily(viewer, family));
  }

  // grouped catalog: one card per family. Only the plain browse path groups —
  // q-search, lib filter, popular, and the personal scopes stay per-design.
  if (query.group === 'family' && !q && !lib && sortRaw !== 'popular' && !truthyFlag(query.library) && !truthyFlag(query.mine)) {
    const result = await browseFamilies(viewer, query.cursor, limit, category);
    if (isFail(result)) return result;
    const decorated = await decorate(viewer, result.things);
    const withDesigns = decorated.map((entry) => {
      const familyKey = typeof entry.crystal?.familyKey === 'string' ? entry.crystal.familyKey : entry.id;
      const designs = result.designsByFamily.get(familyKey);
      return designs && designs.length > 1 ? { ...entry, designs } : entry;
    });
    return {
      ok: true,
      components: withDesigns,
      nextCursor: result.nextCursor,
      total: result.total,
      totalCapped: result.total === COUNT_LIMIT
    };
  }

  if (truthyFlag(query.library)) {
    return finish(await browseSaved(viewer, query.cursor, limit));
  }

  if (truthyFlag(query.mine)) {
    const sort = sortRaw === 'oldest' ? 'oldest' : 'newest';
    return finish(await browseMine(viewer, sort, query.cursor, limit));
  }

  if (sortRaw === 'popular') {
    return finish(await browsePopular(viewer, query.cursor, limit, lib, category));
  }

  // text search rides the hardened search grammar (no lib/category clauses
  // there — the page resets those filters while searching)
  if (q) {
    const sort = sortRaw === 'oldest' ? 'oldest' : sortRaw === 'relevance' ? 'relevance' : sortRaw === 'newest' ? 'newest' : undefined;
    const result = await searchThings(viewer, {
      q,
      thingtime: 'component',
      sort,
      cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      limit
    });
    if (isFail(result)) return result;
    return {
      ok: true,
      components: await decorate(viewer, result.things),
      nextCursor: result.nextCursor,
      total: result.total,
      totalCapped: result.totalCapped
    };
  }

  const sort = sortRaw === 'oldest' ? 'oldest' : 'newest';
  return finish(await browseLatest(viewer, sort, query.cursor, limit, lib, category));
};
