import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { ensureIndexes, getThingsCollection, getUsersCollection } from '../mongodb/collections';
import {
  COLLECTION_SCHEMA_VERSIONS,
  MAX_TEXT_CHARS,
  REACTION_EMOJIS,
  validateThingtimeCrystal,
  type ThingVisibility
} from '~/schemas/registry';
import { scorePost, type AlgorithmWeights, type PostFeatures } from './feedRanking';

// Everything in thingtime.things is a thing (see app/schemas/registry.ts):
// one root Thing schema, sub-schemas applied via the `thingtime` array of
// schema ids, sub-schema payload under `crystal`. Posts, comments, reactions,
// and shares are all the same root shape; shareId is the only id clients ever
// see, matching the themes convention.
//
// v1 residue: docs written before schemaVersion 2 are posts with kind:'post',
// crystal fields at the root, comments EMBEDDED as an array, reactions
// EMBEDDED as an emoji → userId[] map, and shares as posts with shareOfId.
// Writes are always v2; reads merge both eras so the app works before and
// after the admin migration (things v1→v2) explodes the residue into
// standalone things.

export { REACTION_EMOJIS };

export type PostType = 'text' | 'image' | 'marketplace';
export type PostVisibility = 'public' | 'friends' | 'family' | 'private';
export type MarketplaceCategory = 'car' | 'tool' | 'furniture' | 'service' | 'other';

export type MarketplaceListing = {
  title: string;
  price: number;
  currency: string;
  category: MarketplaceCategory;
  condition: 'new' | 'used' | null;
  location: string | null;
  sold: boolean;
};

export type PostCommentDoc = {
  id: string;
  userId: string;
  text: string;
  createdAt: Date;
};

export type ThingDoc = {
  _id?: any;
  shareId: string;
  schemaVersion?: number; // absent = v1
  thingtime?: string[];
  crystal?: Record<string, any>;
  ownerId: string;
  visibility: ThingVisibility;
  targetId?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  // v1 residue fields (unset by the things v1→v2 migration)
  kind?: 'post';
  type?: PostType;
  text?: string;
  images?: string[];
  listing?: MarketplaceListing | null;
  reactions?: Record<string, string[]>;
  comments?: PostCommentDoc[];
  shareOfId?: string | null;
  shareCount?: number;
};

// Lean author embed for feed payloads — identity only, never bio/bannerUrl
// (a data-URI banner would otherwise repeat per post and per comment).
export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type PublicComment = {
  id: string;
  author: FeedAuthor | null;
  text: string;
  createdAt: string;
};

export type PublicPost = {
  id: string;
  thingtime: string[];
  type: PostType;
  author: FeedAuthor | null;
  visibility: PostVisibility;
  text: string;
  images: string[];
  listing: MarketplaceListing | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  viewerReaction: string | null;
  commentCount: number;
  comments: PublicComment[];
  shareCount: number;
  // true whenever this post is a share, even if the original is deleted or
  // not visible to the viewer (shareOf null in that case)
  isShare: boolean;
  shareOf: PublicPost | null;
  createdAt: string;
};

// Generic projection for non-post things (and the unified read endpoint).
export type PublicThing = {
  id: string;
  thingtime: string[];
  author: FeedAuthor | null;
  visibility: ThingVisibility;
  targetId: string | null;
  crystal: Record<string, any>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const POST_TYPES: PostType[] = ['text', 'image', 'marketplace'];
const VISIBILITIES: PostVisibility[] = ['public', 'friends', 'family', 'private'];

const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_SHARE_ID_CHARS = 128;
const MAX_COMMENTS_PER_POST = 500;
const RETURNED_COMMENTS = 20;
const MAX_FEED_LIMIT = 50;
const DEFAULT_FEED_LIMIT = 20;
// Ranked feeds score the newest N filter-matching posts, then page within
// that window by offset — deterministic for a fixed dataset + timestamp.
const RANKED_CANDIDATE_WINDOW = 400;

const THINGS_SCHEMA_VERSION = COLLECTION_SCHEMA_VERSIONS.things;

// Lean projection for scoring/training paths — never drags comment arrays or
// reaction maps over the wire just to read a post's features. Covers both eras.
const FEATURE_PROJECTION = {
  shareId: 1,
  thingtime: 1,
  crystal: 1,
  schemaVersion: 1,
  type: 1,
  tags: 1,
  ownerId: 1,
  createdAt: 1,
  visibility: 1
};

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isFail = (value: unknown): value is Fail =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as any).ok === false;

// ---------------------------------------------------------------------------
// Era helpers — one place that knows how to read both doc generations.

const isV2 = (doc: ThingDoc): boolean => (doc.schemaVersion || 1) >= 2;

const thingtimeOf = (doc: ThingDoc): string[] => {
  if (isV2(doc)) return doc.thingtime || [];
  // v1 docs are always posts; shares are posts with shareOfId
  return doc.shareOfId ? ['post', 'share'] : ['post'];
};

const isPostThing = (doc: ThingDoc): boolean => thingtimeOf(doc).includes('post');

const crystalOf = (doc: ThingDoc): Record<string, any> => {
  if (isV2(doc)) return doc.crystal || {};
  return { type: doc.type, text: doc.text || '', images: doc.images || [], listing: doc.listing || null };
};

// shareId of the thing this thing is attached to (comment/reaction/share)
const targetIdOf = (doc: ThingDoc): string | null => {
  if (isV2(doc)) return doc.targetId || null;
  return doc.shareOfId || null;
};

// Query fragment matching post things across both eras. v2 posts carry
// thingtime:['post',...]; v1 posts carry kind:'post' (migration unsets kind).
const postMatch = () => ({ $or: [{ thingtime: 'post' }, { kind: 'post' }] });

const withMatch = (base: Record<string, any>, ...clauses: Record<string, any>[]) => {
  const and = [base, ...clauses].filter((clause) => Object.keys(clause).length);
  return and.length > 1 ? { $and: and } : and[0] || {};
};

const sanitizeTags = (value: unknown): string[] | Fail => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail(400, 'tags must be a list');
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim().toLowerCase().slice(0, MAX_TAG_CHARS);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
};

// Seeding passes fixed shareIds for idempotency (and Magic relies on ids
// round-tripping), so client-supplied ids are allowed — but they must be sane
// strings, not arbitrary JSON values (the v1 route stored anything truthy).
const sanitizeShareId = (value: unknown): string | null | Fail => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(400, 'shareId must be a string');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SHARE_ID_CHARS || /[$.\s]/.test(trimmed)) {
    return fail(400, 'shareId must be a short id without spaces, dots, or $');
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// Unified creation — the one path every thing kind goes through.

export type CreateThingInput = {
  thingtime?: unknown;
  crystal?: unknown;
  visibility?: unknown;
  targetId?: unknown;
  tags?: unknown;
  // seeding/migration pass fixed ids + timestamps for idempotency
  shareId?: unknown;
  createdAt?: Date;
};

type CreateThingResult = Fail | { ok: true; doc: ThingDoc };

export const createThing = async (ownerId: string, input: CreateThingInput): Promise<CreateThingResult> => {
  const validated = validateThingtimeCrystal(input.thingtime, input.crystal);
  if (isFail(validated)) return validated;

  const tags = sanitizeTags(input.tags);
  if (isFail(tags)) return tags;

  const shareId = sanitizeShareId(input.shareId);
  if (isFail(shareId)) return shareId;

  // marketplace listings fold their category into tags so filters find them
  const listing = validated.crystal.listing as MarketplaceListing | null | undefined;
  const allTags = [...(tags as string[]), ...(listing ? [listing.category] : [])].filter(
    (tag, index, all) => all.indexOf(tag) === index
  );

  let targetId: string | null = null;
  let target: ThingDoc | null = null;
  if (validated.requiresTarget) {
    target = await findViewableThing(input.targetId, ownerId);
    if (!target) return fail(404, 'Post not found');
    if (validated.thingtime.includes('share')) {
      // viewable ≠ shareable: non-public things can only be shared by their owner
      if (target.visibility !== 'public' && target.ownerId !== ownerId) {
        return fail(403, 'Only public posts can be shared');
      }
      // re-shares point at the ROOT post (Facebook-style) — shares only resolve
      // one level deep, so nesting a share would render with no content
      const rootId = thingtimeOf(target).includes('share') ? targetIdOf(target) : null;
      if (rootId) {
        const root = await findThing(rootId);
        if (root) target = root;
      }
    }
    targetId = target.shareId;
  } else if (input.targetId !== undefined && input.targetId !== null) {
    return fail(400, `thingtime ${validated.thingtime.join('+')} does not take a targetId`);
  }

  // Target-attached things inherit their target's visibility dynamically;
  // standalone things default public.
  let visibility: ThingVisibility;
  if (validated.requiresTarget && !validated.thingtime.includes('post')) {
    visibility = 'inherit';
  } else {
    visibility = VISIBILITIES.includes(input.visibility as PostVisibility)
      ? (input.visibility as PostVisibility)
      : 'public';
  }

  if (validated.thingtime.includes('comment') && target) {
    const commentCount = await countCommentsOf(target);
    if (commentCount >= MAX_COMMENTS_PER_POST) return fail(400, 'This post has reached its comment limit');
  }

  await ensureIndexes();
  const things = await getThingsCollection();
  const now = input.createdAt instanceof Date ? input.createdAt : new Date();

  const doc: ThingDoc = {
    shareId: (shareId as string | null) || randomUUID(),
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime: validated.thingtime,
    crystal: validated.crystal,
    ownerId,
    visibility,
    targetId,
    tags: allTags,
    createdAt: now,
    updatedAt: now
  };

  try {
    await things.insertOne(doc as any);
  } catch (err: any) {
    // duplicate shareId (seeding re-runs pass fixed ids) — mirror the
    // registerUser 409 convention so seeds can skip idempotently
    if (err?.code === 11000) return fail(409, 'Post already exists');
    throw err;
  }

  if (target) {
    await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } });
  }
  return { ok: true, doc };
};

export type CreatePostInput = {
  type?: unknown;
  text?: unknown;
  images?: unknown;
  listing?: unknown;
  visibility?: unknown;
  tags?: unknown;
  // seeding passes a fixed shareId for idempotency
  shareId?: unknown;
  createdAt?: Date;
};

type CreateResult = Fail | { ok: true; post: PublicPost };

// Legacy-shaped convenience wrapper — same unified path underneath.
export const createPost = async (ownerId: string, input: CreatePostInput): Promise<CreateResult> => {
  const created = await createThing(ownerId, {
    thingtime: ['post'],
    crystal: { type: input.type, text: input.text, images: input.images, listing: input.listing },
    visibility: input.visibility,
    tags: input.tags,
    shareId: input.shareId,
    createdAt: input.createdAt
  });
  if (isFail(created)) return created;
  return { ok: true, post: (await toPublicPosts([created.doc], ownerId))[0] };
};

// ---------------------------------------------------------------------------
// Projection: batch-resolve related things (comments, reactions, shares,
// shared originals) and authors, then map docs to the public shapes.

const toFeedAuthor = (doc: any): FeedAuthor => ({
  id: String(doc._id),
  username: doc.username,
  displayName: doc.displayName ?? null,
  avatarUrl: typeof doc.avatarUrl === 'string' ? doc.avatarUrl : null
});

const resolveProfiles = async (userIds: string[]): Promise<Map<string, FeedAuthor>> => {
  const valid = [...new Set(userIds)].filter((id) => ObjectId.isValid(id));
  if (!valid.length) return new Map();
  const users = await getUsersCollection();
  const docs = await users
    .find({ _id: { $in: valid.map((id) => new ObjectId(id)) } })
    .project({ username: 1, displayName: 1, avatarUrl: 1 })
    .toArray();
  return new Map(docs.map((doc: any) => [String(doc._id), toFeedAuthor(doc)]));
};

// Normalized comment/reaction views over both eras.
type CommentEntry = { id: string; userId: string; text: string; createdAt: Date };
type ReactionEntry = { userId: string; emoji: string };

type RelatedThings = {
  commentsByTarget: Map<string, CommentEntry[]>;
  reactionsByTarget: Map<string, ReactionEntry[]>;
  shareCountByTarget: Map<string, number>;
};

// One batched pass for a page of post docs: standalone comment/reaction
// things for those posts plus live share counts across both eras. Embedded
// v1 residue on each doc is merged in per-post below.
const resolveRelated = async (docs: ThingDoc[]): Promise<RelatedThings> => {
  const ids = docs.map((doc) => doc.shareId);
  const commentsByTarget = new Map<string, CommentEntry[]>();
  const reactionsByTarget = new Map<string, ReactionEntry[]>();
  const shareCountByTarget = new Map<string, number>();
  if (!ids.length) return { commentsByTarget, reactionsByTarget, shareCountByTarget };

  const things = await getThingsCollection();
  const [related, shareCounts] = await Promise.all([
    things
      .find({ targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction'] } } as any)
      .sort({ createdAt: 1, shareId: 1 })
      .toArray() as Promise<any[]>,
    things
      .aggregate([
        { $match: { $or: [{ thingtime: 'share', targetId: { $in: ids } }, { shareOfId: { $in: ids } }] } },
        { $group: { _id: { $ifNull: ['$targetId', '$shareOfId'] }, count: { $sum: 1 } } }
      ])
      .toArray() as Promise<any[]>
  ]);

  for (const doc of related as ThingDoc[]) {
    const target = doc.targetId as string;
    if (thingtimeOf(doc).includes('comment')) {
      const list = commentsByTarget.get(target) || [];
      list.push({
        id: doc.shareId,
        userId: doc.ownerId,
        text: String(doc.crystal?.text || ''),
        createdAt: new Date(doc.createdAt)
      });
      commentsByTarget.set(target, list);
    } else if (thingtimeOf(doc).includes('reaction')) {
      const list = reactionsByTarget.get(target) || [];
      list.push({ userId: doc.ownerId, emoji: String(doc.crystal?.emoji || '') });
      reactionsByTarget.set(target, list);
    }
  }
  for (const row of shareCounts) shareCountByTarget.set(String(row._id), row.count);

  return { commentsByTarget, reactionsByTarget, shareCountByTarget };
};

// Merge a post's v1 embedded comments with its standalone comment things.
const mergedCommentsOf = (doc: ThingDoc, related: RelatedThings): CommentEntry[] => {
  const embedded: CommentEntry[] = (doc.comments || []).map((comment) => ({
    id: comment.id,
    userId: comment.userId,
    text: comment.text,
    createdAt: new Date(comment.createdAt)
  }));
  const standalone = related.commentsByTarget.get(doc.shareId) || [];
  return [...embedded, ...standalone].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
};

// Merge a post's v1 embedded reaction map with standalone reaction things.
// A user's standalone reaction supersedes their embedded residue (toggles
// always write standalone and clean the residue, but stay defensive).
const mergedReactionsOf = (doc: ThingDoc, related: RelatedThings): ReactionEntry[] => {
  const standalone = related.reactionsByTarget.get(doc.shareId) || [];
  const standaloneUsers = new Set(standalone.map((entry) => entry.userId));
  const merged = [...standalone];
  Object.entries(doc.reactions || {}).forEach(([emoji, userIds]) => {
    (userIds || []).forEach((userId) => {
      if (!standaloneUsers.has(userId)) merged.push({ userId, emoji });
    });
  });
  return merged;
};

const reactionCountsOf = (entries: ReactionEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  entries.forEach((entry) => {
    if (entry.emoji) counts[entry.emoji] = (counts[entry.emoji] || 0) + 1;
  });
  return counts;
};

const viewerReactionOf = (entries: ReactionEntry[], viewerId: string | null): string | null => {
  if (!viewerId) return null;
  return entries.find((entry) => entry.userId === viewerId)?.emoji || null;
};

const liveShareCountOf = (doc: ThingDoc, related: RelatedThings): number =>
  related.shareCountByTarget.get(doc.shareId) || 0;

export const toPublicPosts = async (docs: ThingDoc[], viewerId: string | null): Promise<PublicPost[]> => {
  if (!docs.length) return [];
  const things = await getThingsCollection();

  // one level of share resolution
  const shareTargets = [...new Set(docs.map((doc) => targetIdOf(doc)).filter(Boolean))] as string[];
  const originals = shareTargets.length
    ? ((await things
        .find(withMatch({ shareId: { $in: shareTargets } }, postMatch()) as any)
        .toArray()) as any as ThingDoc[])
    : [];
  const originalsById = new Map(originals.map((doc) => [doc.shareId, doc]));

  const related = await resolveRelated([...docs, ...originals]);

  const userIds: string[] = [];
  [...docs, ...originals].forEach((doc) => {
    userIds.push(doc.ownerId);
    mergedCommentsOf(doc, related)
      .slice(-RETURNED_COMMENTS)
      .forEach((comment) => userIds.push(comment.userId));
  });
  const profiles = await resolveProfiles(userIds);

  const project = (doc: ThingDoc, withShare: boolean): PublicPost => {
    const crystal = crystalOf(doc);
    const allComments = mergedCommentsOf(doc, related);
    const comments = allComments.slice(-RETURNED_COMMENTS).map((comment) => ({
      id: comment.id,
      author: profiles.get(comment.userId) || null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString()
    }));
    const reactions = mergedReactionsOf(doc, related);

    const shareTarget = targetIdOf(doc);
    const original = withShare && shareTarget ? originalsById.get(shareTarget) : null;

    return {
      id: doc.shareId,
      thingtime: thingtimeOf(doc),
      type: (crystal.type as PostType) || 'text',
      author: profiles.get(doc.ownerId) || null,
      visibility: doc.visibility as PostVisibility,
      text: String(crystal.text || ''),
      images: (crystal.images as string[]) || [],
      listing: (crystal.listing as MarketplaceListing) || null,
      tags: doc.tags || [],
      reactionCounts: reactionCountsOf(reactions),
      viewerReaction: viewerReactionOf(reactions, viewerId),
      commentCount: allComments.length,
      comments,
      shareCount: liveShareCountOf(doc, related),
      isShare: !!shareTarget && thingtimeOf(doc).includes('share'),
      // only surface originals the viewer is allowed to see
      shareOf: original && canView(original, viewerId) ? project(original, false) : null,
      createdAt: new Date(doc.createdAt).toISOString()
    };
  };

  return docs.map((doc) => project(doc, true));
};

export const toPublicThings = async (docs: ThingDoc[], _viewerId: string | null): Promise<PublicThing[]> => {
  if (!docs.length) return [];
  const profiles = await resolveProfiles(docs.map((doc) => doc.ownerId));
  return docs.map((doc) => ({
    id: doc.shareId,
    thingtime: thingtimeOf(doc),
    author: profiles.get(doc.ownerId) || null,
    visibility: doc.visibility,
    targetId: targetIdOf(doc),
    crystal: crystalOf(doc),
    tags: doc.tags || [],
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString()
  }));
};

// ---------------------------------------------------------------------------
// Visibility: no relationship graph exists yet, so friends/family/private
// things are only visible to their owner; public is visible to everyone.
// Target-attached things ('inherit') are as visible as their target.

const canView = (doc: ThingDoc, viewerId: string | null): boolean =>
  doc.visibility === 'public' || (!!viewerId && doc.ownerId === viewerId);

const canViewInherited = async (doc: ThingDoc, viewerId: string | null, depth = 0): Promise<boolean> => {
  if (doc.visibility !== 'inherit') return canView(doc, viewerId);
  // comment-on-comment chains resolve through their targets, bounded so a
  // pathological cycle can't loop forever
  if (depth >= 4) return false;
  const target = doc.targetId ? await findThing(doc.targetId) : null;
  return !!target && (await canViewInherited(target, viewerId, depth + 1));
};

const visibilityQueryFor = (viewerId: string | null, circles: PostVisibility[]) => {
  const wanted = circles.length ? circles : VISIBILITIES;
  const publicWanted = wanted.includes('public');
  const ownCircles = viewerId ? wanted : [];

  const clauses: any[] = [];
  if (publicWanted) clauses.push({ visibility: 'public' });
  if (viewerId && ownCircles.length) clauses.push({ ownerId: viewerId, visibility: { $in: ownCircles } });
  // nothing requested that the viewer could ever see
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

const findThing = async (shareId: unknown): Promise<ThingDoc | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const things = await getThingsCollection();
  return (await things.findOne({ shareId: shareId.trim() } as any)) as any as ThingDoc | null;
};

const findViewableThing = async (shareId: unknown, viewerId: string | null): Promise<ThingDoc | null> => {
  const doc = await findThing(shareId);
  if (!doc || !(await canViewInherited(doc, viewerId))) return null;
  return doc;
};

const countCommentsOf = async (target: ThingDoc): Promise<number> => {
  const things = await getThingsCollection();
  const standalone = await things.countDocuments({ targetId: target.shareId, thingtime: 'comment' } as any);
  return standalone + (target.comments || []).length;
};

// ---------------------------------------------------------------------------
// Reads.

export type FeedQuery = {
  types?: PostType[];
  circles?: PostVisibility[];
  from?: Date | null;
  to?: Date | null;
  cursor?: string | null;
  limit?: number;
  weights?: AlgorithmWeights | null;
};

const parseChronoCursor = (cursor: string | null | undefined): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const [ms, id] = cursor.split('_');
  const time = Number(ms);
  if (!Number.isFinite(time) || !id) return null;
  return { createdAt: new Date(time), id };
};

const chronoCursorClause = (cursor: { createdAt: Date; id: string }) => ({
  $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }]
});

// type filter must match both eras: v2 keeps type in crystal, v1 at the root
const typeClause = (types: PostType[]) =>
  types.length ? { $or: [{ 'crystal.type': { $in: types } }, { type: { $in: types } }] } : {};

export const getFeed = async (
  viewerId: string | null,
  query: FeedQuery
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; ranked: boolean } | Fail> => {
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const types = (query.types || []).filter((type) => POST_TYPES.includes(type));
  const circles = (query.circles || []).filter((circle) => VISIBILITIES.includes(circle));

  const visibility = visibilityQueryFor(viewerId, circles);
  if (!visibility) return { ok: true, posts: [], nextCursor: null, ranked: false };

  const range: any = {};
  if (query.from || query.to) {
    range.createdAt = {};
    if (query.from) range.createdAt.$gte = query.from;
    if (query.to) range.createdAt.$lte = query.to;
  }
  const match = withMatch(postMatch(), visibility, typeClause(types), range);

  const things = await getThingsCollection();
  const weights = query.weights || null;

  if (!weights) {
    // chronological: stable (createdAt, shareId) cursor pagination
    const cursor = parseChronoCursor(query.cursor);
    const pageMatch = cursor ? withMatch(match, chronoCursorClause(cursor)) : match;

    const docs = (await things
      .find(pageMatch as any)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray()) as any as ThingDoc[];

    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
    return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, ranked: false };
  }

  // ranked: score a lean projection of the newest candidate window, page by
  // offset within it, then fetch full docs only for the page slice
  const offset = Math.max(0, Number(query.cursor) || 0);
  const candidates = (await things
    .find(match as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(RANKED_CANDIDATE_WINDOW)
    .project(FEATURE_PROJECTION)
    .toArray()) as any as ThingDoc[];

  const now = new Date();
  const scored = candidates
    .map((doc) => ({
      doc,
      score: scorePost(weights, featuresOf(doc), now)
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        new Date(b.doc.createdAt).getTime() - new Date(a.doc.createdAt).getTime() ||
        a.doc.shareId.localeCompare(b.doc.shareId)
    );

  const pageIds = scored.slice(offset, offset + limit).map((entry) => entry.doc.shareId);
  const pageDocs = pageIds.length
    ? ((await things
        .find(withMatch({ shareId: { $in: pageIds } }, postMatch()) as any)
        .toArray()) as any as ThingDoc[])
    : [];
  const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
  const page = pageIds.map((id) => docsById.get(id)).filter(Boolean) as ThingDoc[];
  const nextCursor = offset + limit < scored.length ? String(offset + limit) : null;
  return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, ranked: true };
};

export const featuresOf = (doc: ThingDoc): PostFeatures => ({
  type: ((isV2(doc) ? doc.crystal?.type : doc.type) as PostType) || 'text',
  tags: doc.tags || [],
  ownerId: doc.ownerId,
  createdAt: new Date(doc.createdAt)
});

export const listUserPosts = async (
  viewerId: string | null,
  username: string,
  cursor: string | null,
  limit = DEFAULT_FEED_LIMIT
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; postCount?: number } | Fail> => {
  if (typeof username !== 'string' || !username.trim()) return fail(400, 'username is required');
  const users = await getUsersCollection();
  const user = await users.findOne({ username: username.trim().toLowerCase() });
  if (!user) return fail(404, 'User not found');

  const ownerId = String(user._id);
  const own = viewerId === ownerId;
  const match = withMatch(postMatch(), { ownerId, ...(own ? {} : { visibility: 'public' }) });

  const things = await getThingsCollection();
  const parsed = parseChronoCursor(cursor);
  // the profile header only needs the total once — skip the count on
  // subsequent pages
  const postCount = parsed ? undefined : await things.countDocuments(match as any);
  const pageMatch = parsed ? withMatch(match, chronoCursorClause(parsed)) : match;

  const capped = Math.min(Math.max(1, limit), MAX_FEED_LIMIT);
  const docs = (await things
    .find(pageMatch as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(capped + 1)
    .toArray()) as any as ThingDoc[];

  const page = docs.slice(0, capped);
  const last = page[page.length - 1];
  const nextCursor = docs.length > capped && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, postCount };
};

// Unified single read — posts project as PublicPost, everything else as the
// generic PublicThing.
export const getThing = async (
  viewerId: string | null,
  shareId: unknown
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null }> => {
  const doc = await findViewableThing(shareId, viewerId);
  if (!doc) return fail(404, 'Thing not found');
  const thing = (await toPublicThings([doc], viewerId))[0];
  const post = isPostThing(doc) ? (await toPublicPosts([doc], viewerId))[0] : null;
  return { ok: true, thing, post };
};

export type ListThingsQuery = {
  thingtime?: string[];
  targetId?: string | null;
  cursor?: string | null;
  limit?: number;
};

// Unified list. Two modes:
// - targetId set: things attached to a viewable target (comments/reactions of
//   a post) — inherit visibility from the target.
// - no targetId: the viewer's OWN things (any schema), newest first.
export const listThings = async (
  viewerId: string | null,
  query: ListThingsQuery
): Promise<Fail | { ok: true; things: PublicThing[]; nextCursor: string | null }> => {
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const thingtime = (query.thingtime || []).filter((id) => typeof id === 'string' && id.trim());

  let match: Record<string, any>;
  if (query.targetId) {
    const target = await findViewableThing(query.targetId, viewerId);
    if (!target) return fail(404, 'Thing not found');
    match = { targetId: target.shareId };
  } else {
    if (!viewerId) return fail(401, 'Unauthorized');
    match = { ownerId: viewerId, $or: [{ thingtime: { $exists: true } }, { kind: 'post' }] };
  }
  if (thingtime.length) {
    // v1 posts have no thingtime array — a 'post' filter must match them too
    const clause = thingtime.includes('post')
      ? { $or: [{ thingtime: { $in: thingtime } }, { kind: 'post' }] }
      : { thingtime: { $in: thingtime } };
    match = withMatch(match, clause);
  }

  const parsed = parseChronoCursor(query.cursor);
  const pageMatch = parsed ? withMatch(match, chronoCursorClause(parsed)) : match;

  const things = await getThingsCollection();
  const docs = (await things
    .find(pageMatch as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(limit + 1)
    .toArray()) as any as ThingDoc[];

  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { ok: true, things: await toPublicThings(page, viewerId), nextCursor };
};

// ---------------------------------------------------------------------------
// Social actions. Every action re-checks visibility so a URL-guessed private
// thing can't be interacted with.

export const toggleReaction = async (
  viewerId: string,
  shareId: unknown,
  emoji: unknown
): Promise<Fail | { ok: true; reactionCounts: Record<string, number>; viewerReaction: string | null }> => {
  if (emoji !== null && (typeof emoji !== 'string' || !REACTION_EMOJIS.includes(emoji))) {
    return fail(400, 'Unsupported reaction');
  }
  const target = await findViewableThing(shareId, viewerId);
  if (!target) return fail(404, 'Post not found');

  const things = await getThingsCollection();
  const existing = (await things.findOne({
    targetId: target.shareId,
    thingtime: 'reaction',
    ownerId: viewerId
  } as any)) as any as ThingDoc | null;

  const embeddedPrevious = Object.entries(target.reactions || {}).find(([, userIds]) =>
    (userIds || []).includes(viewerId)
  )?.[0];
  const previous = existing?.crystal?.emoji || embeddedPrevious || null;
  // reacting with the same emoji again clears it (toggle), a different one replaces
  const next = typeof emoji === 'string' && emoji !== previous ? emoji : null;

  const now = new Date();
  const ops: Promise<any>[] = [];
  // clear every standalone reaction this viewer has on the target (defensive
  // against duplicates) before writing the replacement
  if (existing) ops.push(things.deleteMany({ targetId: target.shareId, thingtime: 'reaction', ownerId: viewerId } as any));
  if (embeddedPrevious) {
    // clean the v1 residue for this user so cleared/replaced reactions don't
    // resurface from the embedded map
    ops.push(
      things.updateOne({ shareId: target.shareId } as any, {
        $pull: { [`reactions.${embeddedPrevious}`]: viewerId },
        $set: { updatedAt: now }
      } as any)
    );
  }
  await Promise.all(ops);

  if (next) {
    const created = await createThing(viewerId, {
      thingtime: ['reaction'],
      crystal: { emoji: next },
      targetId: target.shareId
    });
    if (isFail(created)) return created;
  } else {
    await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } });
  }

  // recompute merged state for this target
  const residue: Record<string, string[]> = {};
  Object.entries(target.reactions || {}).forEach(([key, userIds]) => {
    const rest = (userIds || []).filter((id) => id !== viewerId);
    if (rest.length) residue[key] = rest;
  });
  const standalone = (await things
    .find({ targetId: target.shareId, thingtime: 'reaction' } as any)
    .toArray()) as any as ThingDoc[];
  const entries = mergedReactionsOf(
    { ...target, reactions: residue },
    {
      commentsByTarget: new Map(),
      reactionsByTarget: new Map([[target.shareId, standalone.map((doc) => ({ userId: doc.ownerId, emoji: String(doc.crystal?.emoji || '') }))]]),
      shareCountByTarget: new Map()
    }
  );
  return { ok: true, reactionCounts: reactionCountsOf(entries), viewerReaction: viewerReactionOf(entries, viewerId) };
};

export const addComment = async (
  viewerId: string,
  shareId: unknown,
  text: unknown
): Promise<Fail | { ok: true; comment: PublicComment; commentCount: number }> => {
  const target = await findViewableThing(shareId, viewerId);
  if (!target) return fail(404, 'Post not found');

  const created = await createThing(viewerId, {
    thingtime: ['comment'],
    crystal: { text },
    targetId: target.shareId
  });
  if (isFail(created)) return created;

  const profiles = await resolveProfiles([viewerId]);
  return {
    ok: true,
    comment: {
      id: created.doc.shareId,
      author: profiles.get(viewerId) || null,
      text: String(created.doc.crystal?.text || ''),
      createdAt: new Date(created.doc.createdAt).toISOString()
    },
    commentCount: (await countCommentsOf(target)) // includes the new comment
  };
};

export const sharePost = async (
  viewerId: string,
  shareId: unknown,
  input: { text?: unknown; visibility?: unknown }
): Promise<Fail | { ok: true; post: PublicPost }> => {
  const original = await findViewableThing(shareId, viewerId);
  if (!original || !isPostThing(original)) return fail(404, 'Post not found');
  if (original.visibility !== 'public' && original.ownerId !== viewerId) {
    return fail(403, 'Only public posts can be shared');
  }

  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  const originalCrystal = crystalOf(original);

  const created = await createThing(viewerId, {
    thingtime: ['post', 'share'],
    crystal: { type: originalCrystal.type || 'text', text, images: [], listing: null },
    visibility: input.visibility,
    // never carry a non-public original's tags to audiences that can't view it
    tags: original.visibility === 'public' ? original.tags || [] : [],
    targetId: original.shareId
  });
  if (isFail(created)) return created;

  return { ok: true, post: (await toPublicPosts([created.doc], viewerId))[0] };
};

export const deleteThing = async (viewerId: string, shareId: unknown): Promise<Fail | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  const deleted = (await things.findOneAndDelete({
    shareId: shareId.trim(),
    ownerId: viewerId
  } as any)) as any as ThingDoc | null;
  if (!deleted) return fail(404, 'Thing not found');
  // comments/reactions attached to the deleted thing go with it; share things
  // survive so they can render their 'original unavailable' placeholder
  await things.deleteMany({ targetId: deleted.shareId, thingtime: { $in: ['comment', 'reaction'] } } as any);
  return { ok: true };
};

export const deletePost = deleteThing;

export type UpdateThingInput = {
  crystal?: unknown;
  visibility?: unknown;
  tags?: unknown;
};

// Own-thing update: crystal patches merge over the existing crystal and are
// re-validated against the thing's schemas. v1 posts are upgraded to v2 shape
// on write (their embedded comments/reactions residue stays until migration).
export const updateThing = async (
  viewerId: string,
  shareId: unknown,
  input: UpdateThingInput
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  const doc = (await things.findOne({ shareId: shareId.trim(), ownerId: viewerId } as any)) as any as ThingDoc | null;
  if (!doc || (!isV2(doc) && !isPostThing(doc))) return fail(404, 'Thing not found');

  const thingtime = thingtimeOf(doc);
  const patch =
    input.crystal && typeof input.crystal === 'object' && !Array.isArray(input.crystal)
      ? (input.crystal as Record<string, unknown>)
      : {};
  const validated = validateThingtimeCrystal(thingtime, { ...crystalOf(doc), ...patch });
  if (isFail(validated)) return validated;

  let tags = doc.tags || [];
  if (input.tags !== undefined) {
    const sanitized = sanitizeTags(input.tags);
    if (isFail(sanitized)) return sanitized;
    const listing = validated.crystal.listing as MarketplaceListing | null | undefined;
    tags = [...sanitized, ...(listing ? [listing.category] : [])].filter((tag, index, all) => all.indexOf(tag) === index);
  }

  let visibility = doc.visibility;
  if (input.visibility !== undefined) {
    if (doc.visibility === 'inherit') return fail(400, 'Attached things inherit their target visibility');
    if (!VISIBILITIES.includes(input.visibility as PostVisibility)) return fail(400, 'Unknown visibility');
    visibility = input.visibility as PostVisibility;
  }

  const now = new Date();
  const set: Record<string, any> = {
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime,
    crystal: validated.crystal,
    targetId: targetIdOf(doc),
    tags,
    visibility,
    updatedAt: now
  };
  // upgrading a v1 post in place — clear the legacy crystal-at-root fields the
  // v2 shape replaces (embedded comments/reactions stay for the migration)
  const unset: Record<string, any> = { kind: '', type: '', text: '', images: '', listing: '', shareOfId: '', shareCount: '' };
  await things.updateOne({ shareId: doc.shareId } as any, { $set: set, $unset: unset } as any);

  const updated = { ...doc, ...set } as ThingDoc;
  delete (updated as any).kind;
  delete (updated as any).type;
  delete (updated as any).text;
  delete (updated as any).images;
  delete (updated as any).listing;
  delete (updated as any).shareOfId;
  delete (updated as any).shareCount;

  const thing = (await toPublicThings([updated], viewerId))[0];
  const post = isPostThing(updated) ? (await toPublicPosts([updated], viewerId))[0] : null;
  return { ok: true, thing, post };
};

// Public post count for a profile header — kept here so no route touches the
// things collection directly.
export const countPublicPosts = async (ownerId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments(withMatch(postMatch(), { ownerId, visibility: 'public' }) as any);
};

// Feature lookup used by algorithm training — only returns posts the engaging
// user can actually see.
export const getPostFeatures = async (
  viewerId: string,
  shareIds: string[]
): Promise<Map<string, PostFeatures>> => {
  const wanted = [...new Set(shareIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (!wanted.length) return new Map();
  const things = await getThingsCollection();
  const docs = (await things
    .find(withMatch({ shareId: { $in: wanted } }, postMatch()) as any)
    .project(FEATURE_PROJECTION)
    .toArray()) as any as ThingDoc[];
  return new Map(docs.filter((doc) => canView(doc, viewerId)).map((doc) => [doc.shareId, featuresOf(doc)]));
};
