import { getThingsCollection } from '../mongodb/collections';
import { resolveViewStats } from './views';
import {
  asViewer,
  canViewInherited,
  postMatch,
  toPublicPosts,
  visibilityQueryFor,
  withFriendIds,
  withMatch,
  type Fail,
  type PublicPost,
  type ThingDoc,
  type Viewer
} from './things';

// Trending — the engine behind GET /api/v1/things/trending and /explore.
//
// Candidates are PUBLIC (tt:all) posts from the last week only: the surface is
// guest-visible, so nothing circle- or viewer-scoped may ever enter the pool
// (the viewer only personalises projections — viewerReactions, poll
// viewerVote — never selection). Selection mirrors the feed's ranked mode: a
// bounded lean candidate window, in-memory scoring, then full docs + the exact
// per-doc acl check for just the winning slice, projected through the same
// batched toPublicPosts pass as the feed so cards render identically.

// How far back a post can be born and still trend.
const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Newest-N public posts inside the window that get scored (indexed
// createdAt-desc scan, capped — the whole pipeline is bounded by this).
const TRENDING_CANDIDATE_WINDOW = 300;
// Page size of the returned board.
const TRENDING_LIMIT = 30;
// Extra winners fetched so exact acl evaluation (exclusions like
// -tt:user/<viewer>) can drop docs without shorting the board.
const TRENDING_ACL_BUFFER = 10;

type EngagementCounts = { reactions: number; comments: number; votes: number };

// One batched pass over the candidate ids: reaction/comment/vote child things
// counted per target (never N+1). thingtime can be a string or an array
// (["post","comment"] rich comments), so it is normalised before grouping;
// the interim relational era (kind + parentId) is folded in the same way
// resolveRelated folds it.
const resolveEngagementCounts = async (ids: string[]): Promise<Map<string, EngagementCounts>> => {
  const counts = new Map<string, EngagementCounts>();
  if (!ids.length) return counts;
  const bump = (target: string, kind: string, count: number) => {
    const entry = counts.get(target) || { reactions: 0, comments: 0, votes: 0 };
    if (kind === 'reaction') entry.reactions += count;
    else if (kind === 'comment') entry.comments += count;
    else if (kind === 'vote') entry.votes += count;
    counts.set(target, entry);
  };

  const things = await getThingsCollection();
  const [v2Rows, legacyRows] = await Promise.all([
    things
      .aggregate([
        { $match: { targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction', 'vote'] } } },
        { $project: { targetId: 1, kinds: { $cond: [{ $isArray: '$thingtime' }, '$thingtime', ['$thingtime']] } } },
        { $unwind: '$kinds' },
        { $match: { kinds: { $in: ['comment', 'reaction', 'vote'] } } },
        { $group: { _id: { target: '$targetId', kind: '$kinds' }, count: { $sum: 1 } } }
      ])
      .toArray() as Promise<any[]>,
    things
      .aggregate([
        { $match: { kind: { $in: ['comment', 'reaction'] }, parentId: { $in: ids } } },
        { $group: { _id: { target: '$parentId', kind: '$kind' }, count: { $sum: 1 } } }
      ])
      .toArray() as Promise<any[]>
  ]);
  for (const row of [...v2Rows, ...legacyRows]) bump(String(row._id.target), String(row._id.kind), row.count);
  return counts;
};

// Engagement over recency with time decay: comments weigh most (they cost the
// most effort), then reactions, then poll votes; views are a light thumb on
// the scale. +1 keeps zero-engagement newborns rankable, and the (hours+2)^1.4
// denominator makes fresh engagement outrank stale piles — a day-old post
// needs roughly 9× the engagement of a brand-new one to hold its spot.
const trendingScoreOf = (counts: EngagementCounts, viewCount: number, createdAt: Date, now: number): number => {
  const hoursOld = Math.max(0, (now - createdAt.getTime()) / 3_600_000);
  const engagement = counts.reactions * 3 + counts.comments * 4 + counts.votes * 2 + viewCount * 0.25 + 1;
  return engagement / Math.pow(hoursOld + 2, 1.4);
};

export const getTrendingPosts = async (
  viewerInput: string | Viewer
): Promise<{ ok: true; posts: PublicPost[]; generatedAt: string } | Fail> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  const things = await getThingsCollection();

  // public circle only, regardless of viewer — an anonymous null viewer makes
  // visibilityQueryFor emit exactly the coarse public superset clause
  const match = withMatch(postMatch(), visibilityQueryFor(null, ['public']), {
    createdAt: { $gte: new Date(Date.now() - TRENDING_WINDOW_MS) }
  });

  const candidates = (await things
    .find(match as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(TRENDING_CANDIDATE_WINDOW)
    .project({ shareId: 1, createdAt: 1 })
    .toArray()) as any as Pick<ThingDoc, 'shareId' | 'createdAt'>[];
  if (!candidates.length) return { ok: true, posts: [], generatedAt: new Date().toISOString() };

  const ids = candidates.map((doc) => doc.shareId);
  const [engagement, viewStats] = await Promise.all([resolveEngagementCounts(ids), resolveViewStats(ids)]);

  const now = Date.now();
  const winners = candidates
    .map((doc) => ({
      id: doc.shareId,
      score: trendingScoreOf(
        engagement.get(doc.shareId) || { reactions: 0, comments: 0, votes: 0 },
        viewStats.get(doc.shareId)?.viewCount || 0,
        new Date(doc.createdAt),
        now
      ),
      createdAt: new Date(doc.createdAt).getTime()
    }))
    .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, TRENDING_LIMIT + TRENDING_ACL_BUFFER);

  // full docs for the winning slice only, kept in score order
  const winnerIds = winners.map((entry) => entry.id);
  const fullDocs = (await things
    .find(withMatch({ shareId: { $in: winnerIds } }, postMatch()) as any)
    .toArray()) as any as ThingDoc[];
  const docsById = new Map(fullDocs.map((doc) => [doc.shareId, doc]));

  // exact acl evaluation with the REAL viewer — the DB match was only a
  // superset, so exclusions and edits since the scan drop out here
  const visible: ThingDoc[] = [];
  for (const entry of winners) {
    if (visible.length >= TRENDING_LIMIT) break;
    const doc = docsById.get(entry.id);
    if (doc && (await canViewInherited(doc, viewer))) visible.push(doc);
  }

  return { ok: true, posts: await toPublicPosts(visible, viewer), generatedAt: new Date().toISOString() };
};
