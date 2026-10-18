import { buildGroup, csvList, parseDate, parseCount, searchOwnerScope, textLengthExpr, MAX_TEXT_QUERY_CHARS, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, MAX_RANKED_OFFSET, ENGAGEMENT_CANDIDATE_WINDOW, MAX_AUTHOR_CHARS, GENERIC_SEARCH_EXCLUDED_THINGTIME, type SearchQuery } from './searchGrammar';
import { parseGeo, geoRadiusClause } from '~/schemas/geo';
import { findUserByUsername } from '../auth/users';
import { getThingsCollection } from '../mongodb/collections';
import { legacyThingReadsRequired } from '../mongodb/legacyThingLayout';
import { fetchCappedTotal } from '../mongodb/cappedTotal';
import {
  ACL_INHERIT,
  MAX_TEXT_CHARS
} from '~/schemas/registry';
import {
  POST_TYPES,
  REQUESTABLE_VISIBILITIES,
  appMatchClauses,
  appShapeProjections,
  appVisiblePage,
  asViewer,
  batchedThingLookup,
  canViewInherited,
  chronoCursorClause,
  fail,
  isFail,
  isPostThing,
  oldestCursorClause,
  parseChronoCursor,
  thingtimeInClause,
  toPublicPosts,
  toPublicThings,
  typeClause,
  visibilityQueryFor,
  withMatch,
  type AppLens,
  type Fail,
  type PostType,
  type PostVisibility,
  type PublicPost,
  type PublicThing,
  type ThingDoc,
  type Viewer
} from './things';
import { subspaceFeedClauses } from '../subspaces/gate';
import { attachRankScores, type RankedSearchSource } from './searchRanking';

export { SEARCH_OPERATORS } from './searchGrammar';
export type { SearchOperator, SearchCondition, SearchGroup, SearchQuery } from './searchGrammar';

// Structured search over the things collection — the API behind /search.
//
// Callers describe conditions in a small whitelisted grammar (field + operator
// + primitive value); we compile it into a MongoDB filter. NOTHING from the
// request reaches Mongo verbatim: field paths are validated segment-by-segment
// (no $, no NUL, bounded depth), operators map through an explicit whitelist,
// values must be bounded primitives (objects are rejected, which is what closes
// the operator-injection door), and user text never becomes a raw regex — only
// escaped literals via contains/startsWith/endsWith. Visibility is enforced the
// same way as the feed: a DB-level superset (public + own) plus the exact
// per-doc acl check before projection.

export type SearchResult = {
  ok: true;
  things: Array<PublicThing & { rankScore?: number }>;
  // post projections for result things that are posts, keyed by thing id, so
  // the UI can render full post cards without a second round-trip
  posts: Record<string, PublicPost>;
  nextCursor: string | null;
  // capped count of matching docs (null when the count timed out)
  total: number | null;
  totalCapped: boolean;
  ranked: boolean;
};

// Exact per-doc ACL projection for one page of search results: keep only the
// docs the viewer may actually see (the DB match is a superset — canViewInherited
// is the authoritative check), then project the public thing + post shapes. This
// is the shared tail of BOTH paging paths (engagement window + chrono/ranked), so
// a visibility fix can never accidentally patch one branch and leak from the other.
const projectVisiblePage = async (
  page: ThingDoc[],
  viewer: Viewer,
  app: AppLens = null
): Promise<{ things: Array<PublicThing & { rankScore?: number }>; posts: Record<string, PublicPost> }> => {
  // App lens: namespace verdict + author-liveness batch replace the acl walk,
  // authors/acl are consent-shaped, and the PublicPost projection (scope-blind
  // child aggregation) never rides an app response — generic things only.
  if (app) {
    const visible = await appVisiblePage(app, page);
    const things = await toPublicThings(visible, viewer);
    await appShapeProjections(app, visible, things);
    return { things: attachRankScores(things, visible as RankedSearchSource[]), posts: {} };
  }
  // One shared batched lookup for the whole page, matching listThings: a page
  // of attached things (comments, reactions, shares — anything carrying
  // tt:inherit) then costs one round trip per chain LEVEL instead of one per
  // doc. Unbatched, a 50-result page of depth-1 comments issued 50 findOnes
  // against a 10-connection pool, draining as 5 serial pool waves.
  const lookup = batchedThingLookup();
  const verdicts = await Promise.all(page.map((doc) => canViewInherited(doc, viewer, lookup)));
  const visible = page.filter((_, index) => verdicts[index]);
  const things = await toPublicThings(visible, viewer);
  const postDocs = visible.filter((doc) => isPostThing(doc));
  const reactionTargets = await Promise.all(
    visible.map(async (doc) =>
      Array.isArray(doc.thingtime) && doc.thingtime.includes('reaction') && typeof doc.targetId === 'string'
        ? lookup(doc.targetId)
        : null
    )
  );
  const targetPosts = reactionTargets.filter((doc): doc is ThingDoc => !!doc && isPostThing(doc));
  const uniquePostDocs = [...new Map([...postDocs, ...targetPosts].map((doc) => [doc.shareId, doc])).values()];
  const postProjections = uniquePostDocs.length ? await toPublicPosts(uniquePostDocs, viewer) : [];
  const posts: Record<string, PublicPost> = {};
  for (const post of postProjections) posts[post.id] = post;
  visible.forEach((doc, index) => {
    const target = reactionTargets[index];
    if (target && posts[target.shareId]) posts[doc.shareId] = posts[target.shareId];
  });
  return { things: attachRankScores(things, visible as RankedSearchSource[]), posts };
};

export const searchThings = async (
  viewerInput: string | Viewer,
  query: SearchQuery,
  app: AppLens = null
): Promise<Fail | SearchResult> => {
  const viewer = asViewer(viewerInput);
  const ownerScope = searchOwnerScope(query.scope, viewer?.id);
  if (isFail(ownerScope)) return ownerScope;
  const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT);

  const q = typeof query.q === 'string' ? query.q.trim().slice(0, MAX_TEXT_QUERY_CHARS) : '';
  const sort =
    query.sort === 'newest' || query.sort === 'oldest' || query.sort === 'relevance'
      ? query.sort
      : q
        ? 'relevance'
        : 'newest';
  if (sort === 'relevance' && !q) return fail(400, 'Relevance sorting needs a text query (q)');

  const clauses: Record<string, any>[] = [];
  if (ownerScope.ownerId) clauses.push(ownerScope);
  if (query.near !== undefined) {
    const point = parseGeo(query.near);
    const radius = query.radiusKm === undefined ? 50 : query.radiusKm;
    if (!point || typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > 1000) return fail(400, 'near requires lat/lng and radiusKm must be greater than 0 and at most 1000');
    clauses.push(geoRadiusClause(point, radius));
  }

  if (query.conditions !== undefined && query.conditions !== null) {
    if (!Array.isArray(query.conditions)) return fail(400, 'conditions must be a list');
    if (query.conditions.length) {
      const group = buildGroup(
        { mode: query.mode === 'any' ? 'any' : 'all', conditions: query.conditions },
        1,
        { total: 0 }
      );
      if (isFail(group)) return group;
      clauses.push(group);
    }
  }

  const thingtime = csvList(query.thingtime);
  if (thingtime.length) {
    clauses.push(await thingtimeInClause(thingtime));
  }

  // Protected system kinds are NOT discoverable through the generic search:
  // user things are public but belong on the dedicated /api/v1/users/search
  // (which caps + requires a query, so this endpoint can't be a bulk directory
  // scrape / account-existence + user-count oracle); theme/feed-algorithm/
  // waitlist things are owner-private and never meant to be searched. schema
  // things stay searchable — the schema browser relies on it.
  clauses.push({ thingtime: { $nin: GENERIC_SEARCH_EXCLUDED_THINGTIME } });

  const tags = csvList(query.tags).map((tag) => tag.toLowerCase());
  if (tags.length) clauses.push({ tags: { $in: tags } });

  const from = parseDate(query.from);
  if (isFail(from)) return from;
  const to = parseDate(query.to);
  if (isFail(to)) return to;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    clauses.push({ createdAt: range });
  }

  // -- shortcut filters (feed/profile Advanced panel) -----------------------

  const emptyResult: SearchResult = { ok: true, things: [], posts: {}, nextCursor: null, total: 0, totalCapped: false, ranked: false };

  // post types, era-aware (v2 crystal.type / v1 root type)
  const types = csvList(query.types).filter((entry): entry is PostType => POST_TYPES.includes(entry as PostType));
  if (types.length) clauses.push(typeClause(types));

  // audience circles narrow the visibility superset below — validate against
  // the REQUESTABLE set so 'hidden' survives (a dropped circle silently reads
  // as "no circle filter", which widens rather than narrows)
  const circles = csvList(query.circles).filter((entry): entry is PostVisibility =>
    REQUESTABLE_VISIBILITIES.includes(entry as PostVisibility)
  );

  // author: one username → ownerId. An unknown username matches nothing —
  // that's an empty result, not an error (filters are exploratory). Dual-era:
  // findUserByUsername resolves user things first, legacy users second, and
  // its adapter's _id IS the ownerId posts carry in either era.
  if (query.author !== undefined && query.author !== null && query.author !== '') {
    if (typeof query.author !== 'string' || query.author.trim().length > MAX_AUTHOR_CHARS) {
      return fail(400, 'author must be a username');
    }
    const authorDoc = await findUserByUsername(query.author.trim());
    if (!authorDoc) return emptyResult;
    clauses.push({ ownerId: String(authorDoc._id) });
  }

  // text length bounds — $expr per matched doc, same cost class as the
  // grammar's regex operators
  const minTextChars = parseCount(query.minTextChars, 'minTextChars', MAX_TEXT_CHARS);
  if (isFail(minTextChars)) return minTextChars;
  const maxTextChars = parseCount(query.maxTextChars, 'maxTextChars', MAX_TEXT_CHARS);
  if (isFail(maxTextChars)) return maxTextChars;
  if (minTextChars !== null || maxTextChars !== null) {
    // $let binds the length once so $strLenCP runs a single time per doc even
    // when both bounds are set
    const bounds: Record<string, any>[] = [];
    if (minTextChars !== null) bounds.push({ $gte: ['$$textLen', minTextChars] });
    if (maxTextChars !== null) bounds.push({ $lte: ['$$textLen', maxTextChars] });
    clauses.push({
      $expr: {
        $let: {
          vars: { textLen: textLengthExpr() },
          in: bounds.length === 1 ? bounds[0] : { $and: bounds }
        }
      }
    });
  }

  const minReactions = parseCount(query.minReactions, 'minReactions', 1_000_000);
  if (isFail(minReactions)) return minReactions;
  const minComments = parseCount(query.minComments, 'minComments', 1_000_000);
  if (isFail(minComments)) return minComments;
  const engagement = minReactions !== null || minComments !== null;

  // Same audience model as the feed: the DB match is a superset (public things
  // + the viewer's own), the exact acl verdict happens per doc below. Things
  // carrying ['tt:inherit'] (comments/reactions) only surface for their owner —
  // matching listThings, attached things aren't independently discoverable.
  // Under the app lens the audience superset IS the namespace conjunction —
  // server-injected, never expressible from the client grammar (appId/acl stay
  // out of SEARCHABLE_ROOT_FIELDS).
  const directVisibility = app ? withMatch({}, ...appMatchClauses(app)) : visibilityQueryFor(viewer, circles);
  // Inherited children (notably reactions) need their parent ACL evaluated by
  // canViewInherited below; include them in this coarse DB-level superset.
  const visibility =
    !app && directVisibility && circles.length === 0
      ? { $or: [directVisibility, { acl: ACL_INHERIT }] }
      : directVisibility;
  if (!visibility) return emptyResult;

  // subspace fences (removed / private-subspace posts) — same clauses the feeds use
  const baseMatch = withMatch(visibility, ...clauses, ...subspaceFeedClauses(viewer));
  const ranked = sort === 'relevance';

  // A cursor is minted for one paging mode and is meaningless in another: offset
  // modes (engagement filters, relevance ranking) mint a plain integer offset,
  // chrono modes mint `${ms}_${shareId}`. Silently coercing across modes —
  // Number(chronoCursor) is NaN → offset 0, or parseChronoCursor(offset) → null —
  // resurfaces page one and duplicates results once the client appends. Reject a
  // cursor that doesn't match the active mode so the client restarts cleanly.
  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    const cursorStr = typeof query.cursor === 'string' ? query.cursor : '';
    const validForMode = engagement || ranked ? /^\d+$/.test(cursorStr) : parseChronoCursor(cursorStr) !== null;
    if (!validForMode) {
      return fail(400, 'This cursor doesn’t match the current sort or filters — start a new search');
    }
  }

  // $text must sit in a top-level $and (withMatch provides exactly that)
  const textClause = q ? { $text: { $search: q } } : null;
  const match = textClause ? withMatch(textClause, visibility, ...clauses) : baseMatch;

  const things = await getThingsCollection();

  // -- engagement-window mode ------------------------------------------------
  // Reaction/comment counts are aggregated from child things at read time
  // (never stored on the parent), so they can't be part of the indexed match.
  // Instead: take a bounded window of the newest (or best-matching) candidates,
  // batch-count their children (one $group per era — never N+1), filter by the
  // thresholds, and page by offset within the filtered window. Counts sum raw
  // docs across eras (embedded residue + interim kind docs + v2 things) with
  // NO (user, token) dedup, unlike the cards' mergedReactionsOf — so a post
  // holding the same reaction in two era representations can over-count a
  // filter verdict until the things v1→v2 admin migration collapses the
  // residue. Exact dedup would mean shipping every (owner, token) pair for up
  // to 400 posts over the wire; a threshold heuristic doesn't justify that.
  if (engagement) {
    const offset = Math.min(Math.max(0, Number(query.cursor) || 0), ENGAGEMENT_CANDIDATE_WINDOW);
    const windowSort = ranked
      ? { score: { $meta: 'textScore' }, createdAt: -1, shareId: 1 }
      : sort === 'oldest'
        ? { createdAt: 1, shareId: 1 }
        : { createdAt: -1, shareId: 1 };

    const candidates = (await things
      .aggregate([
        { $match: match },
        { $sort: windowSort },
        { $limit: ENGAGEMENT_CANDIDATE_WINDOW },
        {
          $project: {
            shareId: 1,
            ...(ranked ? { score: { $meta: 'textScore' } } : {}),
            embeddedComments: { $size: { $ifNull: ['$comments', []] } },
            embeddedReactions: {
              $sum: {
                $map: {
                  input: { $objectToArray: { $ifNull: ['$reactions', {}] } },
                  as: 'entry',
                  in: { $size: { $ifNull: ['$$entry.v', []] } }
                }
              }
            }
          }
        }
      ])
      .toArray()) as any as {
        shareId: string;
        score?: number;
        embeddedComments: number;
        embeddedReactions: number;
      }[];

    const ids = candidates.map((candidate) => candidate.shareId);
    const [v2Counts, legacyCounts] = ids.length
      ? await Promise.all([
          things
            .aggregate([
              { $match: { targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction'] } } },
              {
                $group: {
                  _id: '$targetId',
                  comments: { $sum: { $cond: [{ $in: ['comment', { $ifNull: ['$thingtime', []] }] }, 1, 0] } },
                  reactions: { $sum: { $cond: [{ $in: ['reaction', { $ifNull: ['$thingtime', []] }] }, 1, 0] } }
                }
              }
            ])
            .toArray() as Promise<any[]>,
          await legacyThingReadsRequired() ? things
            .aggregate([
              { $match: { parentId: { $in: ids }, kind: { $in: ['comment', 'reaction'] } } },
              {
                $group: {
                  _id: '$parentId',
                  comments: { $sum: { $cond: [{ $eq: ['$kind', 'comment'] }, 1, 0] } },
                  reactions: { $sum: { $cond: [{ $eq: ['$kind', 'reaction'] }, 1, 0] } }
                }
              }
            ])
            .toArray() as Promise<any[]> : Promise.resolve([])
        ])
      : [[], []];

    const countsById = new Map<string, { comments: number; reactions: number }>();
    const bump = (id: string, comments: number, reactions: number) => {
      const entry = countsById.get(id) || { comments: 0, reactions: 0 };
      entry.comments += comments;
      entry.reactions += reactions;
      countsById.set(id, entry);
    };
    for (const row of v2Counts) bump(String(row._id), row.comments || 0, row.reactions || 0);
    for (const row of legacyCounts) bump(String(row._id), row.comments || 0, row.reactions || 0);
    for (const candidate of candidates) bump(candidate.shareId, candidate.embeddedComments || 0, candidate.embeddedReactions || 0);

    const filtered = candidates.filter((candidate) => {
      const counts = countsById.get(candidate.shareId) || { comments: 0, reactions: 0 };
      if (minReactions !== null && counts.reactions < minReactions) return false;
      if (minComments !== null && counts.comments < minComments) return false;
      return true;
    });

    const pageIds = filtered.slice(offset, offset + limit).map((candidate) => candidate.shareId);
    const pageDocs = pageIds.length
      ? ((await things.find({ shareId: { $in: pageIds } } as any).toArray()) as any as ThingDoc[])
      : [];
    const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
    const scoreById = new Map(candidates.map((candidate) => [candidate.shareId, candidate.score]));
    const page = pageIds
      .map((id) => {
        const doc = docsById.get(id);
        if (!doc) return null;
        const score = scoreById.get(id);
        return typeof score === 'number' ? ({ ...doc, score } as ThingDoc) : doc;
      })
      .filter(Boolean) as ThingDoc[];

    const { things: publicThings, posts } = await projectVisiblePage(page, viewer, app);

    return {
      ok: true,
      things: publicThings,
      posts,
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      // the window bounds the count — when the window itself filled up, there
      // may be more matches beyond it
      total: filtered.length,
      totalCapped: candidates.length >= ENGAGEMENT_CANDIDATE_WINDOW,
      ranked
    };
  }

  const fetchPage = async (): Promise<{ docs: ThingDoc[]; nextCursor: string | null }> => {
    if (ranked) {
      const offset = Math.min(Math.max(0, Number(query.cursor) || 0), MAX_RANKED_OFFSET);
      const docs = (await things
        .find(match as any, { projection: { score: { $meta: 'textScore' } } } as any)
        .sort({ score: { $meta: 'textScore' }, createdAt: -1, shareId: 1 } as any)
        .skip(offset)
        .limit(limit + 1)
        .toArray()) as any as ThingDoc[];
      // the clamp allows offsets up to and including MAX_RANKED_OFFSET
      const nextOffset = offset + limit;
      return { docs, nextCursor: docs.length > limit && nextOffset <= MAX_RANKED_OFFSET ? String(nextOffset) : null };
    }
    const parsed = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
    const cursorClause = parsed ? (sort === 'oldest' ? oldestCursorClause(parsed) : chronoCursorClause(parsed)) : null;
    const pageMatch = cursorClause ? withMatch(match, cursorClause) : match;
    const docs = (await things
      .find(pageMatch as any)
      .sort(sort === 'oldest' ? { createdAt: 1, shareId: 1 } : { createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray()) as any as ThingDoc[];
    const last = docs.slice(0, limit)[Math.min(docs.length, limit) - 1];
    return {
      docs,
      nextCursor: docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null
    };
  };

  // Capped count for the "N things match" readout — only on the FIRST page
  // (load-more keeps the total it already has), concurrent with the page find,
  // and approximate by design: it counts the DB visibility superset, so
  // circle-restricted docs the exact acl pass rejects may be included. Shared
  // with the schema browser via fetchCappedTotal so both stay in lockstep.
  const [{ docs, nextCursor }, { total, totalCapped }] = await Promise.all([
    fetchPage(),
    fetchCappedTotal(things, match, query.cursor)
  ]);
  const page = docs.slice(0, limit);

  // exact acl evaluation — the DB match is only a superset; the cursor advances
  // over the raw page so filtered docs are skipped, not resurfaced.
  const { things: publicThings, posts } = await projectVisiblePage(page, viewer, app);

  return { ok: true, things: publicThings, posts, nextCursor, total, totalCapped, ranked };
};
