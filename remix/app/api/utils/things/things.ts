import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { sanitizeExtended } from '../crud/validation';
import { ensureIndexes, getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { scorePost, type AlgorithmWeights, type PostFeatures } from './feedRanking';

// Feed posts are things (thingtime.things) with kind:'post'. shareId is the
// only id clients ever see, matching the themes convention.

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

export type FeedPostDoc = {
  _id?: any;
  shareId: string;
  kind: 'post';
  type: PostType;
  ownerId: string;
  visibility: PostVisibility;
  text: string;
  images: string[];
  listing: MarketplaceListing | null;
  tags: string[];
  reactions: Record<string, string[]>;
  comments: PostCommentDoc[];
  shareOfId: string | null;
  shareCount: number;
  // schema-free extensible data (see api/utils/crud/validation.ts) — any JSON
  // an app wants to ride along with the post; never validated or interpreted
  extended?: unknown | null;
  createdAt: Date;
  updatedAt: Date;
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
  extended: unknown | null;
  createdAt: string;
};

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const POST_TYPES: PostType[] = ['text', 'image', 'marketplace'];
const VISIBILITIES: PostVisibility[] = ['public', 'friends', 'family', 'private'];
const MARKETPLACE_CATEGORIES: MarketplaceCategory[] = ['car', 'tool', 'furniture', 'service', 'other'];

const MAX_TEXT_CHARS = 5000;
const MAX_IMAGES = 8;
const MAX_IMAGE_URL_CHARS = 2048;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_COMMENT_CHARS = 1000;
const MAX_COMMENTS_PER_POST = 500;
const RETURNED_COMMENTS = 20;
const MAX_FEED_LIMIT = 50;
const DEFAULT_FEED_LIMIT = 20;
// Ranked feeds score the newest N filter-matching posts, then page within
// that window by offset — deterministic for a fixed dataset + timestamp.
const RANKED_CANDIDATE_WINDOW = 400;

// Lean projection for scoring/training paths — never drags comment arrays or
// reaction maps over the wire just to read a post's features.
const FEATURE_PROJECTION = { shareId: 1, type: 1, tags: 1, ownerId: 1, createdAt: 1, visibility: 1 };

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isFail = (value: unknown): value is Fail =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as any).ok === false;

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const sanitizeImages = (value: unknown): string[] | Fail => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail(400, 'images must be a list of URLs');
  if (value.length > MAX_IMAGES) return fail(400, `A post can have at most ${MAX_IMAGES} images`);
  const images: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return fail(400, 'images must be a list of URLs');
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_IMAGE_URL_CHARS || !isHttpUrl(trimmed)) {
      return fail(400, 'Images must be http(s) URLs');
    }
    images.push(trimmed);
  }
  return images;
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

const sanitizeListing = (value: unknown): MarketplaceListing | Fail => {
  if (!value || typeof value !== 'object') return fail(400, 'Marketplace posts need listing details');
  const input = value as Record<string, unknown>;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
  if (!title) return fail(400, 'Listing title is required');
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
    return fail(400, 'Listing price must be a non-negative number');
  }
  const currency =
    typeof input.currency === 'string' && /^[A-Za-z]{3}$/.test(input.currency.trim())
      ? input.currency.trim().toUpperCase()
      : 'AUD';
  const category = MARKETPLACE_CATEGORIES.includes(input.category as MarketplaceCategory)
    ? (input.category as MarketplaceCategory)
    : 'other';
  const condition = input.condition === 'new' || input.condition === 'used' ? input.condition : null;
  const location = typeof input.location === 'string' ? input.location.trim().slice(0, 120) || null : null;
  return { title, price: Math.round(price * 100) / 100, currency, category, condition, location, sold: !!input.sold };
};

export type CreatePostInput = {
  type?: unknown;
  text?: unknown;
  images?: unknown;
  listing?: unknown;
  visibility?: unknown;
  tags?: unknown;
  extended?: unknown;
  // seeding passes a fixed shareId for idempotency; the API route never does
  shareId?: string;
  createdAt?: Date;
};

type CreateResult = Fail | { ok: true; post: PublicPost };

export const createPost = async (ownerId: string, input: CreatePostInput): Promise<CreateResult> => {
  const type = POST_TYPES.includes(input.type as PostType) ? (input.type as PostType) : null;
  if (!type) return fail(400, 'Post type must be text, image, or marketplace');

  const visibility = VISIBILITIES.includes(input.visibility as PostVisibility)
    ? (input.visibility as PostVisibility)
    : 'public';

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > MAX_TEXT_CHARS) return fail(400, `Post text is too long (max ${MAX_TEXT_CHARS})`);

  const images = sanitizeImages(input.images);
  if (isFail(images)) return images;

  const tags = sanitizeTags(input.tags);
  if (isFail(tags)) return tags;

  let listing: MarketplaceListing | null = null;
  if (type === 'marketplace') {
    const parsed = sanitizeListing(input.listing);
    if (isFail(parsed)) return parsed;
    listing = parsed;
  }

  if (type === 'text' && !text) return fail(400, 'Say something first ✍️');
  if (type === 'image' && !images.length) return fail(400, 'Image posts need at least one image');

  const extended = sanitizeExtended(input.extended);
  if (isFail(extended)) return extended;

  await ensureIndexes();
  const things = await getThingsCollection();
  const now = input.createdAt instanceof Date ? input.createdAt : new Date();

  const doc: FeedPostDoc = {
    shareId: input.shareId || randomUUID(),
    kind: 'post',
    type,
    ownerId,
    visibility,
    text,
    images: images as string[],
    listing,
    tags: [...(tags as string[]), ...(listing ? [listing.category] : [])].filter(
      (tag, index, all) => all.indexOf(tag) === index
    ),
    reactions: {},
    comments: [],
    shareOfId: null,
    shareCount: 0,
    extended: extended.value === undefined ? null : extended.value,
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
  return { ok: true, post: (await toPublicPosts([doc], ownerId))[0] };
};

// ---------------------------------------------------------------------------
// Projection: batch-resolve authors (posts + comments + shared originals) in
// one users query, then map docs to the public shape.

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

const reactionCountsOf = (doc: FeedPostDoc): Record<string, number> => {
  const counts: Record<string, number> = {};
  Object.entries(doc.reactions || {}).forEach(([emoji, userIds]) => {
    if (Array.isArray(userIds) && userIds.length) counts[emoji] = userIds.length;
  });
  return counts;
};

const viewerReactionOf = (doc: FeedPostDoc, viewerId: string | null): string | null => {
  if (!viewerId) return null;
  for (const [emoji, userIds] of Object.entries(doc.reactions || {})) {
    if (Array.isArray(userIds) && userIds.includes(viewerId)) return emoji;
  }
  return null;
};

export const toPublicPosts = async (docs: FeedPostDoc[], viewerId: string | null): Promise<PublicPost[]> => {
  if (!docs.length) return [];
  const things = await getThingsCollection();

  // one level of share resolution
  const shareIds = [...new Set(docs.map((doc) => doc.shareOfId).filter(Boolean))] as string[];
  const originals = shareIds.length
    ? ((await things.find({ shareId: { $in: shareIds }, kind: 'post' } as any).toArray()) as any as FeedPostDoc[])
    : [];
  const originalsById = new Map(originals.map((doc) => [doc.shareId, doc]));

  const userIds: string[] = [];
  [...docs, ...originals].forEach((doc) => {
    userIds.push(doc.ownerId);
    (doc.comments || []).slice(-RETURNED_COMMENTS).forEach((comment) => userIds.push(comment.userId));
  });
  const profiles = await resolveProfiles(userIds);

  const project = (doc: FeedPostDoc, withShare: boolean): PublicPost => {
    const comments = (doc.comments || []).slice(-RETURNED_COMMENTS).map((comment) => ({
      id: comment.id,
      author: profiles.get(comment.userId) || null,
      text: comment.text,
      createdAt: new Date(comment.createdAt).toISOString()
    }));

    const original = withShare && doc.shareOfId ? originalsById.get(doc.shareOfId) : null;

    return {
      id: doc.shareId,
      type: doc.type,
      author: profiles.get(doc.ownerId) || null,
      visibility: doc.visibility,
      text: doc.text,
      images: doc.images || [],
      listing: doc.listing || null,
      tags: doc.tags || [],
      reactionCounts: reactionCountsOf(doc),
      viewerReaction: viewerReactionOf(doc, viewerId),
      commentCount: (doc.comments || []).length,
      comments,
      shareCount: doc.shareCount || 0,
      isShare: !!doc.shareOfId,
      // only surface originals the viewer is allowed to see
      shareOf: original && canView(original, viewerId) ? project(original, false) : null,
      extended: doc.extended ?? null,
      createdAt: new Date(doc.createdAt).toISOString()
    };
  };

  return docs.map((doc) => project(doc, true));
};

// ---------------------------------------------------------------------------
// Visibility: no relationship graph exists yet, so friends/family/private
// posts are only visible to their owner; public is visible to everyone.

const canView = (doc: FeedPostDoc, viewerId: string | null): boolean =>
  doc.visibility === 'public' || (!!viewerId && doc.ownerId === viewerId);

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

export const getFeed = async (
  viewerId: string | null,
  query: FeedQuery
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; ranked: boolean } | Fail> => {
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const types = (query.types || []).filter((type) => POST_TYPES.includes(type));
  const circles = (query.circles || []).filter((circle) => VISIBILITIES.includes(circle));

  const visibility = visibilityQueryFor(viewerId, circles);
  if (!visibility) return { ok: true, posts: [], nextCursor: null, ranked: false };

  const match: any = { kind: 'post', ...visibility };
  if (types.length) match.type = { $in: types };
  if (query.from || query.to) {
    match.createdAt = {};
    if (query.from) match.createdAt.$gte = query.from;
    if (query.to) match.createdAt.$lte = query.to;
  }

  const things = await getThingsCollection();
  const weights = query.weights || null;

  if (!weights) {
    // chronological: stable (createdAt, _id) cursor pagination
    const cursor = parseChronoCursor(query.cursor);
    const pageMatch = cursor
      ? {
          ...match,
          $and: [
            ...(match.$and || []),
            {
              $or: [
                { createdAt: { $lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }
              ]
            }
          ]
        }
      : match;

    const docs = (await things
      .find(pageMatch)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray()) as any as FeedPostDoc[];

    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
    return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, ranked: false };
  }

  // ranked: score a lean projection of the newest candidate window, page by
  // offset within it, then fetch full docs only for the page slice
  const offset = Math.max(0, Number(query.cursor) || 0);
  const candidates = (await things
    .find(match)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(RANKED_CANDIDATE_WINDOW)
    .project(FEATURE_PROJECTION)
    .toArray()) as any as FeedPostDoc[];

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
    ? ((await things.find({ shareId: { $in: pageIds }, kind: 'post' } as any).toArray()) as any as FeedPostDoc[])
    : [];
  const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
  const page = pageIds.map((id) => docsById.get(id)).filter(Boolean) as FeedPostDoc[];
  const nextCursor = offset + limit < scored.length ? String(offset + limit) : null;
  return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, ranked: true };
};

export const featuresOf = (doc: FeedPostDoc): PostFeatures => ({
  type: doc.type,
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
  const match: any = { kind: 'post', ownerId, ...(own ? {} : { visibility: 'public' }) };

  const things = await getThingsCollection();
  const parsed = parseChronoCursor(cursor);
  // the profile header only needs the total once — skip the count on
  // subsequent pages
  const postCount = parsed ? undefined : await things.countDocuments(match);
  const pageMatch = parsed
    ? {
        ...match,
        $or: [{ createdAt: { $lt: parsed.createdAt } }, { createdAt: parsed.createdAt, shareId: { $gt: parsed.id } }]
      }
    : match;

  const capped = Math.min(Math.max(1, limit), MAX_FEED_LIMIT);
  const docs = (await things
    .find(pageMatch)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(capped + 1)
    .toArray()) as any as FeedPostDoc[];

  const page = docs.slice(0, capped);
  const last = page[page.length - 1];
  const nextCursor = docs.length > capped && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
  return { ok: true, posts: await toPublicPosts(page, viewerId), nextCursor, postCount };
};

// ---------------------------------------------------------------------------
// Social actions. Every action re-checks visibility so a URL-guessed private
// post can't be interacted with.

const findViewablePost = async (shareId: unknown, viewerId: string | null) => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const things = await getThingsCollection();
  const doc = (await things.findOne({ shareId: shareId.trim(), kind: 'post' } as any)) as any as FeedPostDoc | null;
  if (!doc || !canView(doc, viewerId)) return null;
  return doc;
};

export const toggleReaction = async (
  viewerId: string,
  shareId: unknown,
  emoji: unknown
): Promise<Fail | { ok: true; reactionCounts: Record<string, number>; viewerReaction: string | null }> => {
  if (emoji !== null && (typeof emoji !== 'string' || !REACTION_EMOJIS.includes(emoji))) {
    return fail(400, 'Unsupported reaction');
  }
  const doc = await findViewablePost(shareId, viewerId);
  if (!doc) return fail(404, 'Post not found');

  const previous = viewerReactionOf(doc, viewerId);
  // reacting with the same emoji again clears it (toggle), a different one replaces
  const next = typeof emoji === 'string' && emoji !== previous ? emoji : null;

  // targeted update — never rewrites other users' reaction arrays
  const update: Record<string, any> = { $set: { updatedAt: new Date() } };
  if (previous) update.$pull = { [`reactions.${previous}`]: viewerId };
  if (next) update.$addToSet = { [`reactions.${next}`]: viewerId };

  const things = await getThingsCollection();
  if (previous || next) {
    await things.updateOne({ shareId: doc.shareId } as any, update);
  }

  const reactions: Record<string, string[]> = {};
  Object.entries(doc.reactions || {}).forEach(([key, userIds]) => {
    const rest = (userIds || []).filter((id) => id !== viewerId);
    if (rest.length) reactions[key] = rest;
  });
  if (next) reactions[next] = [...(reactions[next] || []), viewerId];

  const updated: FeedPostDoc = { ...doc, reactions };
  return { ok: true, reactionCounts: reactionCountsOf(updated), viewerReaction: viewerReactionOf(updated, viewerId) };
};

export const addComment = async (
  viewerId: string,
  shareId: unknown,
  text: unknown
): Promise<Fail | { ok: true; comment: PublicComment; commentCount: number }> => {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return fail(400, 'Comment text is required');
  if (body.length > MAX_COMMENT_CHARS) return fail(400, `Comment is too long (max ${MAX_COMMENT_CHARS})`);

  const doc = await findViewablePost(shareId, viewerId);
  if (!doc) return fail(404, 'Post not found');
  if ((doc.comments || []).length >= MAX_COMMENTS_PER_POST) return fail(400, 'This post has reached its comment limit');

  const comment: PostCommentDoc = { id: randomUUID(), userId: viewerId, text: body, createdAt: new Date() };
  const things = await getThingsCollection();
  await things.updateOne(
    { shareId: doc.shareId } as any,
    { $push: { comments: comment }, $set: { updatedAt: new Date() } } as any
  );

  const profiles = await resolveProfiles([viewerId]);
  return {
    ok: true,
    comment: {
      id: comment.id,
      author: profiles.get(viewerId) || null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString()
    },
    commentCount: (doc.comments || []).length + 1
  };
};

export const sharePost = async (
  viewerId: string,
  shareId: unknown,
  input: { text?: unknown; visibility?: unknown }
): Promise<Fail | { ok: true; post: PublicPost }> => {
  const original = await findViewablePost(shareId, viewerId);
  if (!original) return fail(404, 'Post not found');
  if (original.visibility !== 'public' && original.ownerId !== viewerId) {
    return fail(403, 'Only public posts can be shared');
  }

  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  const visibility = VISIBILITIES.includes(input.visibility as PostVisibility)
    ? (input.visibility as PostVisibility)
    : 'public';

  await ensureIndexes();
  const things = await getThingsCollection();
  const now = new Date();
  // re-shares point at the ROOT post (Facebook-style) — shares only resolve
  // one level deep, so nesting a share would render with no content
  const rootId = original.shareOfId || original.shareId;
  const doc: FeedPostDoc = {
    shareId: randomUUID(),
    kind: 'post',
    type: original.type,
    ownerId: viewerId,
    visibility,
    text,
    images: [],
    listing: null,
    // never carry a non-public original's tags to audiences that can't view it
    tags: original.visibility === 'public' ? original.tags || [] : [],
    reactions: {},
    comments: [],
    shareOfId: rootId,
    shareCount: 0,
    createdAt: now,
    updatedAt: now
  };
  await things.insertOne(doc as any);
  await things.updateOne({ shareId: rootId } as any, { $inc: { shareCount: 1 }, $set: { updatedAt: now } });

  return { ok: true, post: (await toPublicPosts([doc], viewerId))[0] };
};

export const deletePost = async (viewerId: string, shareId: unknown): Promise<Fail | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Post id is required');
  const things = await getThingsCollection();
  const deleted = (await things.findOneAndDelete({
    shareId: shareId.trim(),
    kind: 'post',
    ownerId: viewerId
  } as any)) as any as FeedPostDoc | null;
  if (!deleted) return fail(404, 'Post not found');
  // deleting a share gives the original its count back
  if (deleted.shareOfId) {
    await things.updateOne(
      { shareId: deleted.shareOfId, kind: 'post', shareCount: { $gt: 0 } } as any,
      { $inc: { shareCount: -1 }, $set: { updatedAt: new Date() } }
    );
  }
  return { ok: true };
};

// Public post count for a profile header — kept here so no route touches the
// things collection directly.
export const countPublicPosts = async (ownerId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments({ kind: 'post', ownerId, visibility: 'public' });
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
    .find({ shareId: { $in: wanted }, kind: 'post' } as any)
    .project(FEATURE_PROJECTION)
    .toArray()) as any as FeedPostDoc[];
  return new Map(docs.filter((doc) => canView(doc, viewerId)).map((doc) => [doc.shareId, featuresOf(doc)]));
};
