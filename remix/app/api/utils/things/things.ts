import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { ensureIndexes, getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { pushUserRecentReaction } from '../auth/users';
import { sanitizeReactionToken } from '~/utils/reactionTokens';
import {
  ACL_ALL,
  ACL_FAMILY,
  ACL_FRIENDS,
  ACL_INHERIT,
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_TEXT_CHARS,
  POST_TYPES as REGISTRY_POST_TYPES,
  REACTION_EMOJIS,
  aclAllows,
  aclFromVisibility,
  sanitizeAcl,
  validateThingtimeCrystal,
  visibilityFromAcl,
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

// derived from the registry's whitelist so the validation gate and the feed's
// type filters can never drift
export type PostType = (typeof REGISTRY_POST_TYPES)[number];
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
  acl?: string[]; // v2 — tt: grants/exclusions (see schemas/registry.ts)
  visibility?: ThingVisibility; // v1 residue (mapped onto acl at read time)
  targetId?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  // v1 residue fields (unset by the things v1→v2 migration). kind 'reaction'
  // and 'comment' cover the interim relational era (parentId/token/commentId
  // docs) written by main's pre-unification model — read + migrated like the
  // embedded residue.
  kind?: 'post' | 'reaction' | 'comment';
  parentId?: string;
  token?: string;
  commentId?: string;
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
  // legacy name derived from acl so old clients keep working
  visibility: PostVisibility;
  acl: string[];
  text: string;
  images: string[];
  listing: MarketplaceListing | null;
  // thingtime posts: the free-form structured thing under crystal.thing
  thing: Record<string, any> | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
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
  acl: string[];
  targetId: string | null;
  crystal: Record<string, any>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

// Who is looking. Routes pass { id, username } from the authed PublicUser;
// internal callers may only have an id (username-specific acl exclusions
// simply can't match then). Plain string ids are accepted for compat.
export type Viewer = { id: string; username?: string | null } | null;
export const asViewer = (value: string | Viewer | null | undefined): Viewer =>
  typeof value === 'string' ? { id: value } : value || null;

export const POST_TYPES: PostType[] = [...REGISTRY_POST_TYPES];
export const VISIBILITIES: PostVisibility[] = ['public', 'friends', 'family', 'private'];

const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_SHARE_ID_CHARS = 128;
const MAX_COMMENTS_PER_POST = 500;
// Reactions are open-vocabulary (any emoji / multi-emoji token), so bound them:
// a post holds at most this many DISTINCT tokens, and one user contributes at
// most this many reaction things per post.
const MAX_REACTION_KEYS_PER_POST = 100;
const MAX_REACTIONS_PER_USER_PER_POST = 20;
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
  acl: 1,
  visibility: 1
};

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
export const isFail = (value: unknown): value is Fail =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as any).ok === false;

// Route-layer adapter: the authed user (or null) → the Viewer acl evaluation
// expects. Shared so every route passes the same shape.
export const viewerOf = (user: { id: string; username: string } | null): Viewer =>
  user ? { id: user.id, username: user.username } : null;

// ---------------------------------------------------------------------------
// Era helpers — one place that knows how to read both doc generations.

const isV2 = (doc: ThingDoc): boolean => (doc.schemaVersion || 1) >= 2;

const thingtimeOf = (doc: ThingDoc): string[] => {
  if (isV2(doc)) return doc.thingtime || [];
  // v1 docs are always posts; shares are posts with shareOfId
  return doc.shareOfId ? ['post', 'share'] : ['post'];
};

export const isPostThing = (doc: ThingDoc): boolean => thingtimeOf(doc).includes('post');

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

export const withMatch = (base: Record<string, any>, ...clauses: Record<string, any>[]) => {
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

// The things v1→v2 migration mints deterministic reaction thing ids under this
// prefix (reactionShareId). Reserving it means a client can never pre-create a
// thing at a migration destination id to hijack or delete migrated data.
export const MIGRATION_RESERVED_ID_PREFIX = 'react-';

// Seeding passes fixed shareIds for idempotency (and Magic relies on ids
// round-tripping), so client-supplied ids are allowed — but they must be sane
// strings, not arbitrary JSON values (the v1 route stored anything truthy),
// and must not squat the migration's reserved id namespace.
const sanitizeShareId = (value: unknown): string | null | Fail => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(400, 'shareId must be a string');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SHARE_ID_CHARS || /[$.\s]/.test(trimmed)) {
    return fail(400, 'shareId must be a short id without spaces, dots, or $');
  }
  if (trimmed.startsWith(MIGRATION_RESERVED_ID_PREFIX)) {
    return fail(400, 'shareId uses a reserved prefix');
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// Unified creation — the one path every thing kind goes through.

export type CreateThingInput = {
  thingtime?: unknown;
  crystal?: unknown;
  acl?: unknown;
  visibility?: unknown; // legacy alias, mapped onto acl
  targetId?: unknown;
  tags?: unknown;
  // seeding/migration pass fixed ids + timestamps for idempotency
  shareId?: unknown;
  createdAt?: Date;
};

type CreateThingResult = Fail | { ok: true; doc: ThingDoc };

// audience for a new thing: explicit acl > legacy visibility name > default
const resolveInputAcl = (input: { acl?: unknown; visibility?: unknown }): string[] | null | Fail => {
  if (input.acl !== undefined && input.acl !== null) {
    const acl = sanitizeAcl(input.acl);
    if (isFail(acl)) return acl;
    return acl;
  }
  if (input.visibility !== undefined && input.visibility !== null) {
    const acl = aclFromVisibility(input.visibility);
    if (!acl || acl.includes(ACL_INHERIT)) return fail(400, 'Unknown visibility');
    return acl;
  }
  return null;
};

export const createThing = async (
  ownerId: string,
  input: CreateThingInput,
  viewer: Viewer = null
): Promise<CreateThingResult> => {
  const asOwner = viewer && viewer.id === ownerId ? viewer : { id: ownerId };
  const validated = validateThingtimeCrystal(input.thingtime, input.crystal);
  if (isFail(validated)) return validated;

  const tags = sanitizeTags(input.tags);
  if (isFail(tags)) return tags;

  const shareId = sanitizeShareId(input.shareId);
  if (isFail(shareId)) return shareId;

  const inputAcl = resolveInputAcl(input);
  if (isFail(inputAcl)) return inputAcl;

  // marketplace listings fold their category into tags so filters find them —
  // post crystals only (a free-form data crystal can carry any `listing`
  // value, which must never leak unsanitized into the multikey tags index)
  const listing = validated.thingtime.includes('post')
    ? (validated.crystal.listing as MarketplaceListing | null | undefined)
    : null;
  const categoryTag = listing && typeof listing.category === 'string' ? [listing.category] : [];
  const allTags = [...(tags as string[]), ...categoryTag].filter((tag, index, all) => all.indexOf(tag) === index);

  let targetId: string | null = null;
  let target: ThingDoc | null = null;
  if (validated.requiresTarget) {
    target = await findViewableThing(input.targetId, asOwner);
    if (!target) return fail(404, 'Post not found');
    if (validated.thingtime.includes('share')) {
      // viewable ≠ shareable: only tt:all things (or your own) can be shared
      if (target.ownerId !== ownerId && !aclOf(target).includes(ACL_ALL)) {
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

  // Target-attached things inherit their target's audience dynamically;
  // standalone things default public.
  let acl: string[];
  if (validated.requiresTarget && !validated.thingtime.includes('post')) {
    acl = [ACL_INHERIT];
  } else {
    acl = inputAcl || [ACL_ALL];
  }

  if (validated.thingtime.includes('comment') && target) {
    const commentCount = await countCommentsOf(target);
    if (commentCount >= MAX_COMMENTS_PER_POST) return fail(400, 'This post has reached its comment limit');
  }

  // Reaction caps apply to EVERY creation path (dedicated toggle + generic
  // POST /api/v1/things), so an attacker can't mint unbounded reaction things
  // by skipping the toggle route. The unique (targetId, ownerId, crystal.emoji)
  // index dedupes the same (user, token) pair; this bounds distinct tokens.
  if (validated.thingtime.includes('reaction') && target) {
    const capped = await enforceReactionCaps(target.shareId, ownerId, String(validated.crystal.emoji || ''));
    if (capped) return capped;
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
    acl,
    targetId,
    tags: allTags,
    createdAt: now,
    updatedAt: now
  };

  try {
    await things.insertOne(doc as any);
  } catch (err: any) {
    // duplicate-key can come from more than one unique index — only a shareId
    // collision means "this thing already exists" (seeding re-runs pass fixed
    // ids; mirror the registerUser 409 convention so seeds skip idempotently).
    // The reaction (target, owner, token) index races surface as 409 too so
    // toggleReaction keeps treating them as already-reacted.
    if (err?.code === 11000) {
      const keys = Object.keys(err?.keyPattern || {});
      if (!keys.length || keys.includes('shareId')) return fail(409, 'Post already exists');
      if (keys.includes('crystal.emoji')) return fail(409, 'Post already exists');
      return fail(409, 'A thing with those unique fields already exists');
    }
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
  thing?: unknown;
  acl?: unknown;
  visibility?: unknown;
  tags?: unknown;
  // seeding passes a fixed shareId for idempotency
  shareId?: unknown;
  createdAt?: Date;
};

type CreateResult = Fail | { ok: true; post: PublicPost };

// Legacy-shaped convenience wrapper — same unified path underneath.
export const createPost = async (
  ownerId: string,
  input: CreatePostInput,
  viewer: Viewer = null
): Promise<CreateResult> => {
  const created = await createThing(
    ownerId,
    {
      thingtime: ['post'],
      crystal: { type: input.type, text: input.text, images: input.images, listing: input.listing, thing: input.thing },
      acl: input.acl,
      visibility: input.visibility,
      tags: input.tags,
      shareId: input.shareId,
      createdAt: input.createdAt
    },
    viewer
  );
  if (isFail(created)) return created;
  return { ok: true, post: (await toPublicPosts([created.doc], viewer || ownerId))[0] };
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
  const [related, legacyRelational, shareCounts] = await Promise.all([
    things
      .find({ targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction'] } } as any)
      .sort({ createdAt: 1, shareId: 1 })
      .toArray() as Promise<any[]>,
    // interim relational era: kind:'reaction'/'comment' docs linked by parentId
    // (written by the pre-unification relational model; converted by the things
    // migration, folded here until then)
    things
      .find({ kind: { $in: ['comment', 'reaction'] }, parentId: { $in: ids } } as any)
      .sort({ createdAt: 1 })
      .toArray() as Promise<any[]>,
    things
      .aggregate([
        { $match: { $or: [{ thingtime: 'share', targetId: { $in: ids } }, { shareOfId: { $in: ids } }] } },
        { $group: { _id: { $ifNull: ['$targetId', '$shareOfId'] }, count: { $sum: 1 } } }
      ])
      .toArray() as Promise<any[]>
  ]);

  const pushComment = (target: string, entry: CommentEntry) => {
    const list = commentsByTarget.get(target) || [];
    list.push(entry);
    commentsByTarget.set(target, list);
  };
  const pushReaction = (target: string, entry: ReactionEntry) => {
    const list = reactionsByTarget.get(target) || [];
    list.push(entry);
    reactionsByTarget.set(target, list);
  };

  for (const doc of related as ThingDoc[]) {
    const target = doc.targetId as string;
    if (thingtimeOf(doc).includes('comment')) {
      pushComment(target, {
        id: doc.shareId,
        userId: doc.ownerId,
        text: String(doc.crystal?.text || ''),
        createdAt: new Date(doc.createdAt)
      });
    } else if (thingtimeOf(doc).includes('reaction')) {
      pushReaction(target, { userId: doc.ownerId, emoji: String(doc.crystal?.emoji || '') });
    }
  }
  for (const doc of legacyRelational as ThingDoc[]) {
    const target = doc.parentId as string;
    if (doc.kind === 'comment') {
      pushComment(target, {
        id: String(doc.commentId || doc._id),
        userId: doc.ownerId,
        text: String((doc as any).text || ''),
        createdAt: new Date(doc.createdAt)
      });
    } else if (doc.kind === 'reaction') {
      pushReaction(target, { userId: doc.ownerId, emoji: String(doc.token || '') });
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

// Merge a post's v1 embedded reaction map with standalone reaction things
// (v2 thingtime things + interim kind docs, already folded by resolveRelated).
// Users can hold several tokens at once, so dedupe by exact (user, token) pair.
const mergedReactionsOf = (doc: ThingDoc, related: RelatedThings): ReactionEntry[] => {
  const merged: ReactionEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: ReactionEntry) => {
    if (!entry.emoji) return;
    const key = `${entry.userId}\u0000${entry.emoji}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(entry);
  };
  (related.reactionsByTarget.get(doc.shareId) || []).forEach(push);
  Object.entries(doc.reactions || {}).forEach(([emoji, userIds]) => {
    (userIds || []).forEach((userId) => push({ userId, emoji }));
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

const viewerReactionsOf = (entries: ReactionEntry[], viewerId: string | null): string[] => {
  if (!viewerId) return [];
  return entries.filter((entry) => entry.userId === viewerId).map((entry) => entry.emoji);
};

const liveShareCountOf = (doc: ThingDoc, related: RelatedThings): number =>
  related.shareCountByTarget.get(doc.shareId) || 0;

export const toPublicPosts = async (docs: ThingDoc[], viewerInput: string | Viewer): Promise<PublicPost[]> => {
  const viewer = asViewer(viewerInput);
  const viewerId = viewer?.id || null;
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
      visibility: visibilityFromAcl(aclOf(doc)) as PostVisibility,
      acl: aclOf(doc),
      text: String(crystal.text || ''),
      images: (crystal.images as string[]) || [],
      listing: (crystal.listing as MarketplaceListing) || null,
      thing:
        crystal.thing && typeof crystal.thing === 'object' && !Array.isArray(crystal.thing)
          ? (crystal.thing as Record<string, any>)
          : null,
      tags: doc.tags || [],
      reactionCounts: reactionCountsOf(reactions),
      viewerReactions: viewerReactionsOf(reactions, viewerId),
      commentCount: allComments.length,
      comments,
      shareCount: liveShareCountOf(doc, related),
      isShare: !!shareTarget && thingtimeOf(doc).includes('share'),
      // only surface originals the viewer is allowed to see
      shareOf: original && canView(original, viewer) ? project(original, false) : null,
      createdAt: new Date(doc.createdAt).toISOString()
    };
  };

  return docs.map((doc) => project(doc, true));
};

export const toPublicThings = async (docs: ThingDoc[], _viewer: string | Viewer): Promise<PublicThing[]> => {
  if (!docs.length) return [];
  const profiles = await resolveProfiles(docs.map((doc) => doc.ownerId));
  return docs.map((doc) => ({
    id: doc.shareId,
    thingtime: thingtimeOf(doc),
    author: profiles.get(doc.ownerId) || null,
    visibility: visibilityFromAcl(aclOf(doc)),
    acl: aclOf(doc),
    targetId: targetIdOf(doc),
    crystal: crystalOf(doc),
    tags: doc.tags || [],
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString()
  }));
};

// ---------------------------------------------------------------------------
// Permissions: acl entries decide who can view (see schemas/registry.ts for
// the grammar + most-specific-wins evaluation). Owners always see their own
// things. Target-attached things carry ['tt:inherit'] and are as visible as
// their target. v1 residue docs still carry the visibility enum — aclOf maps
// it so one evaluation path serves both eras.

const aclOf = (doc: ThingDoc): string[] =>
  Array.isArray(doc.acl) && doc.acl.length ? doc.acl : aclFromVisibility(doc.visibility) || [ACL_OWNER];

const canView = (doc: ThingDoc, viewer: Viewer): boolean => {
  if (viewer?.id && doc.ownerId === viewer.id) return true;
  return aclAllows(aclOf(doc), viewer, doc.ownerId);
};

export const canViewInherited = async (doc: ThingDoc, viewer: Viewer, depth = 0): Promise<boolean> => {
  if (!aclOf(doc).includes(ACL_INHERIT)) return canView(doc, viewer);
  // comment-on-comment chains resolve through their targets, bounded so a
  // pathological cycle can't loop forever
  if (depth >= 4) return false;
  const target = doc.targetId ? await findThing(doc.targetId) : null;
  return !!target && (await canViewInherited(target, viewer, depth + 1));
};

// Coarse DB-level audience match per requested circle, covering both eras.
// Exact acl evaluation (exclusions, specific-user grants) happens in-memory on
// the fetched page via canView — the query only has to be a superset.
const circleClause = (circle: PostVisibility) => {
  switch (circle) {
    case 'public':
      return { $or: [{ acl: ACL_ALL }, { visibility: 'public' }] };
    case 'friends':
      return { $or: [{ acl: ACL_FRIENDS }, { visibility: 'friends' }] };
    case 'family':
      return { $or: [{ acl: ACL_FAMILY }, { visibility: 'family' }] };
    case 'private':
      // $nin on an array field means "contains none of these"
      return {
        $or: [
          { acl: { $exists: true, $nin: [ACL_ALL, ACL_FRIENDS, ACL_FAMILY] } },
          { visibility: 'private' }
        ]
      };
  }
};

export const visibilityQueryFor = (viewer: Viewer, circles: PostVisibility[]) => {
  const wanted = circles.length ? circles : VISIBILITIES;
  const publicWanted = wanted.includes('public');

  const clauses: any[] = [];
  if (publicWanted) clauses.push(circleClause('public'));
  if (viewer?.id) {
    // the viewer's own things, optionally narrowed to the requested circles
    clauses.push(
      wanted.length === VISIBILITIES.length
        ? { ownerId: viewer.id }
        : { ownerId: viewer.id, $or: wanted.map((circle) => circleClause(circle)) }
    );
  }
  // nothing requested that the viewer could ever see
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

const findThing = async (shareId: unknown): Promise<ThingDoc | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const things = await getThingsCollection();
  return (await things.findOne({ shareId: shareId.trim() } as any)) as any as ThingDoc | null;
};

const findViewableThing = async (shareId: unknown, viewer: Viewer): Promise<ThingDoc | null> => {
  const doc = await findThing(shareId);
  if (!doc || !(await canViewInherited(doc, viewer))) return null;
  return doc;
};

const countCommentsOf = async (target: ThingDoc): Promise<number> => {
  const things = await getThingsCollection();
  const [standalone, legacyRelational] = await Promise.all([
    things.countDocuments({ targetId: target.shareId, thingtime: 'comment' } as any),
    things.countDocuments({ kind: 'comment', parentId: target.shareId } as any)
  ]);
  return standalone + legacyRelational + (target.comments || []).length;
};

// Reaction caps, enforced BEFORE a new reaction thing is created so every
// creation path is bounded (the dedicated toggle route AND the generic
// POST /api/v1/things path both funnel through createThing). Counts across
// both eras: v2 crystal.emoji reaction things and interim kind:'reaction' docs.
const enforceReactionCaps = async (targetShareId: string, ownerId: string, token: string): Promise<Fail | null> => {
  const things = await getThingsCollection();
  const [ownV2, ownKind] = await Promise.all([
    things.countDocuments({ targetId: targetShareId, thingtime: 'reaction', ownerId } as any),
    things.countDocuments({ kind: 'reaction', parentId: targetShareId, ownerId } as any)
  ]);
  if (ownV2 + ownKind >= MAX_REACTIONS_PER_USER_PER_POST) {
    return fail(400, `You can add at most ${MAX_REACTIONS_PER_USER_PER_POST} reactions to a post`);
  }
  const tokenAlreadyOnPost =
    (await things.countDocuments(
      { targetId: targetShareId, thingtime: 'reaction', 'crystal.emoji': token } as any,
      { limit: 1 }
    )) || (await things.countDocuments({ kind: 'reaction', parentId: targetShareId, token } as any, { limit: 1 }));
  if (!tokenAlreadyOnPost) {
    const [v2Tokens, kindTokens] = await Promise.all([
      things.distinct('crystal.emoji', { targetId: targetShareId, thingtime: 'reaction' } as any),
      things.distinct('token', { kind: 'reaction', parentId: targetShareId } as any)
    ]);
    if (new Set([...v2Tokens, ...kindTokens]).size >= MAX_REACTION_KEYS_PER_POST) {
      return fail(400, 'This post has reached its reaction limit');
    }
  }
  return null;
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

export const parseChronoCursor = (cursor: string | null | undefined): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const [ms, id] = cursor.split('_');
  const time = Number(ms);
  if (!Number.isFinite(time) || !id) return null;
  return { createdAt: new Date(time), id };
};

export const chronoCursorClause = (cursor: { createdAt: Date; id: string }) => ({
  $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }]
});

// oldest-first pagination inverts the createdAt comparison (search's oldest
// sort) — kept beside its mirror so the cursor grammar lives in one file
export const oldestCursorClause = (cursor: { createdAt: Date; id: string }) => ({
  $or: [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: cursor.id } }]
});

// type filter must match both eras: v2 keeps type in crystal, v1 at the root
// (exported so /search's shortcut filters share the exact same era handling)
export const typeClause = (types: PostType[]) =>
  types.length ? { $or: [{ 'crystal.type': { $in: types } }, { type: { $in: types } }] } : {};

export const getFeed = async (
  viewerInput: string | Viewer,
  query: FeedQuery
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; ranked: boolean } | Fail> => {
  const viewer = asViewer(viewerInput);
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const types = (query.types || []).filter((type) => POST_TYPES.includes(type));
  const circles = (query.circles || []).filter((circle) => VISIBILITIES.includes(circle));

  const visibility = visibilityQueryFor(viewer, circles);
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
    // exact acl evaluation (exclusions, specific-user grants) — the DB match
    // is only a superset; the cursor advances over the raw page so filtered
    // docs are skipped, not resurfaced
    const visible = page.filter((doc) => canView(doc, viewer));
    return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor, ranked: false };
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
  const visible = page.filter((doc) => canView(doc, viewer));
  const nextCursor = offset + limit < scored.length ? String(offset + limit) : null;
  return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor, ranked: true };
};

export const featuresOf = (doc: ThingDoc): PostFeatures => ({
  type: ((isV2(doc) ? doc.crystal?.type : doc.type) as PostType) || 'text',
  tags: doc.tags || [],
  ownerId: doc.ownerId,
  createdAt: new Date(doc.createdAt)
});

export const listUserPosts = async (
  viewerInput: string | Viewer,
  username: string,
  cursor: string | null,
  limit = DEFAULT_FEED_LIMIT
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; postCount?: number } | Fail> => {
  const viewer = asViewer(viewerInput);
  if (typeof username !== 'string' || !username.trim()) return fail(400, 'username is required');
  const users = await getUsersCollection();
  const user = await users.findOne({ username: username.trim().toLowerCase() });
  if (!user) return fail(404, 'User not found');

  const ownerId = String(user._id);
  const own = viewer?.id === ownerId;
  const match = own
    ? withMatch(postMatch(), { ownerId })
    : withMatch(postMatch(), { ownerId }, circleClause('public'));

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
  const visible = page.filter((doc) => canView(doc, viewer));
  return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor, postCount };
};

// Unified single read — posts project as PublicPost, everything else as the
// generic PublicThing.
export const getThing = async (
  viewerInput: string | Viewer,
  shareId: unknown
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null }> => {
  const viewer = asViewer(viewerInput);
  const doc = await findViewableThing(shareId, viewer);
  if (!doc) return fail(404, 'Thing not found');
  const thing = (await toPublicThings([doc], viewer))[0];
  const post = isPostThing(doc) ? (await toPublicPosts([doc], viewer))[0] : null;
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
  viewerInput: string | Viewer,
  query: ListThingsQuery
): Promise<Fail | { ok: true; things: PublicThing[]; nextCursor: string | null }> => {
  const viewer = asViewer(viewerInput);
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const thingtime = (query.thingtime || []).filter((id) => typeof id === 'string' && id.trim());

  let match: Record<string, any>;
  if (query.targetId) {
    const target = await findViewableThing(query.targetId, viewer);
    if (!target) return fail(404, 'Thing not found');
    match = { targetId: target.shareId };
  } else {
    if (!viewer?.id) return fail(401, 'Unauthorized');
    match = { ownerId: viewer.id, $or: [{ thingtime: { $exists: true } }, { kind: 'post' }] };
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
  // Per-doc audience check before projecting. Comments/reactions carry
  // ['tt:inherit'] and short-circuit to the already-viewable target, but a
  // thing attached to a target can carry its OWN acl (e.g. a private share:
  // thingtime ['post','share'], targetId=original) — those must be judged on
  // their own acl, never disclosed just because their target is viewable.
  const visible: ThingDoc[] = [];
  for (const doc of page) {
    if (await canViewInherited(doc, viewer)) visible.push(doc);
  }
  return { ok: true, things: await toPublicThings(visible, viewer), nextCursor };
};

// Copy a target's LEGACY embedded reactions/comments into standalone v2 things
// (once) and clear the embedded fields, so a legacy post becomes fully
// relational on its first write. No-op for new or already-claimed posts.
//
// The claim is ATOMIC: findOneAndUpdate unsets the embedded fields and returns
// the before-image, so exactly ONE concurrent writer migrates (losers see the
// fields already gone and skip). Deterministic shareIds make the inserts
// idempotent with the admin migration. Mutates `doc` to reflect the clear.
const emojiHex = (emoji: string) => [...emoji].map((char) => char.codePointAt(0)!.toString(16)).join('');
const safeIdPart = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
export const reactionShareId = (targetId: string, userId: string, emoji: string) =>
  `react-${safeIdPart(targetId)}-${safeIdPart(userId)}-${emojiHex(emoji)}`;

const migrateThingInteractions = async (doc: ThingDoc): Promise<void> => {
  if (!doc.reactions && !doc.comments) return;
  const things = await getThingsCollection();

  const claimed = (await things.findOneAndUpdate(
    {
      shareId: doc.shareId,
      $or: [{ reactions: { $exists: true } }, { comments: { $exists: true } }]
    } as any,
    { $unset: { reactions: '', comments: '' } } as any,
    { returnDocument: 'before' }
  )) as any as ThingDoc | null;

  // Reflect the clear locally regardless of who won, so response aggregation
  // reads only standalone data (never double-folds the embedded copy).
  delete doc.reactions;
  delete doc.comments;
  if (!claimed) return; // another writer already claimed this post

  const ops: any[] = [];
  for (const [token, userIds] of Object.entries(claimed.reactions || {})) {
    for (const ownerId of userIds || []) {
      const shareId = reactionShareId(doc.shareId, ownerId, token);
      ops.push({
        updateOne: {
          filter: { shareId },
          update: {
            $setOnInsert: {
              shareId,
              schemaVersion: THINGS_SCHEMA_VERSION,
              thingtime: ['reaction'],
              crystal: { emoji: token },
              ownerId,
              acl: [ACL_INHERIT],
              targetId: doc.shareId,
              tags: [],
              createdAt: new Date(claimed.createdAt),
              updatedAt: new Date(claimed.createdAt)
            }
          },
          upsert: true
        }
      });
    }
  }
  for (const comment of claimed.comments || []) {
    ops.push({
      updateOne: {
        filter: { shareId: comment.id },
        update: {
          $setOnInsert: {
            shareId: comment.id,
            schemaVersion: THINGS_SCHEMA_VERSION,
            thingtime: ['comment'],
            crystal: { text: comment.text },
            ownerId: comment.userId,
            acl: [ACL_INHERIT],
            targetId: doc.shareId,
            tags: [],
            createdAt: new Date(comment.createdAt),
            updatedAt: new Date(comment.createdAt)
          }
        },
        upsert: true
      }
    });
  }
  if (ops.length) {
    try {
      await things.bulkWrite(ops, { ordered: false });
    } catch (err) {
      // The claim already committed the $unset, so the embedded copy is the
      // only remaining source of this legacy data. Restore it so the NEXT
      // write re-claims (upserts are idempotent) instead of losing it forever.
      await things.updateOne(
        { shareId: doc.shareId } as any,
        { $set: { reactions: claimed.reactions ?? {}, comments: claimed.comments ?? [] } } as any
      );
      throw err;
    }
  }
};

// ---------------------------------------------------------------------------
// Social actions. Every action re-checks visibility so a URL-guessed private
// thing can't be interacted with.

export const toggleReaction = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  emoji: unknown
): Promise<
  | Fail
  | {
      ok: true;
      reactionCounts: Record<string, number>;
      viewerReactions: string[];
      recentReactions?: string[];
    }
> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const viewerId = viewer.id;
  // Any emoji or multi-emoji group is a valid reaction token (open vocabulary),
  // validated by the shared emoji-only helper the picker UI also uses.
  const token = sanitizeReactionToken(emoji);
  if (emoji !== null && token === null) {
    return fail(400, 'Unsupported reaction');
  }
  const target = await findViewableThing(shareId, viewer);
  if (!target) return fail(404, 'Post not found');

  await ensureIndexes(); // the reaction unique index must exist before insert
  const things = await getThingsCollection();
  let recentReactions: string[] | undefined;

  if (token) {
    // first write claims any legacy embedded residue into standalone things
    await migrateThingInteractions(target);

    // toggling is an insert/delete of ONE (viewer, token) thing — checked
    // across both the v2 shape and the interim kind:'reaction' era
    const [existingV2, existingKind] = await Promise.all([
      things.findOne({
        targetId: target.shareId,
        thingtime: 'reaction',
        ownerId: viewerId,
        'crystal.emoji': token
      } as any),
      things.findOne({ kind: 'reaction', parentId: target.shareId, ownerId: viewerId, token } as any)
    ]);
    if (existingV2 || existingKind) {
      const ids = [existingV2?._id, existingKind?._id].filter(Boolean);
      await things.deleteMany({ _id: { $in: ids } } as any);
    } else {
      // createThing enforces the per-user + per-post reaction caps (single
      // source of truth, so the generic POST path is bounded the same way)
      const created = await createThing(
        viewerId,
        { thingtime: ['reaction'], crystal: { emoji: token }, targetId: target.shareId },
        viewer
      );
      // 409 = the unique (target, owner, token) index raced another add of the
      // same token — that reaction already exists, which is what we wanted
      if (isFail(created) && created.status !== 409) return created;
      recentReactions = await pushUserRecentReaction(viewerId, token);
    }
    await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: new Date() } });
  }

  // recompute merged state for this target
  const related = await resolveRelated([target]);
  const entries = mergedReactionsOf(target, related);
  return {
    ok: true,
    reactionCounts: reactionCountsOf(entries),
    viewerReactions: viewerReactionsOf(entries, viewerId),
    recentReactions
  };
};

export const addComment = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  text: unknown
): Promise<Fail | { ok: true; comment: PublicComment; commentCount: number }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const viewerId = viewer.id;
  const target = await findViewableThing(shareId, viewer);
  if (!target) return fail(404, 'Post not found');

  // first write claims any legacy embedded residue into standalone things
  await migrateThingInteractions(target);

  const created = await createThing(
    viewerId,
    {
      thingtime: ['comment'],
      crystal: { text },
      targetId: target.shareId
    },
    viewer
  );
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
  viewerInput: string | Viewer,
  shareId: unknown,
  input: { text?: unknown; visibility?: unknown; acl?: unknown }
): Promise<Fail | { ok: true; post: PublicPost }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const viewerId = viewer.id;
  const original = await findViewableThing(shareId, viewer);
  if (!original || !isPostThing(original)) return fail(404, 'Post not found');
  if (original.ownerId !== viewerId && !aclOf(original).includes(ACL_ALL)) {
    return fail(403, 'Only public posts can be shared');
  }

  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  const originalCrystal = crystalOf(original);

  const created = await createThing(
    viewerId,
    {
      thingtime: ['post', 'share'],
      crystal: { type: originalCrystal.type || 'text', text, images: [], listing: null },
      acl: input.acl,
      visibility: input.visibility,
      // never carry a non-public original's tags to audiences that can't view it
      tags: aclOf(original).includes(ACL_ALL) ? original.tags || [] : [],
      targetId: original.shareId
    },
    viewer
  );
  if (isFail(created)) return created;

  return { ok: true, post: (await toPublicPosts([created.doc], viewer))[0] };
};

export const deleteThing = async (viewerInput: string | Viewer, shareId: unknown): Promise<Fail | { ok: true }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  const deleted = (await things.findOneAndDelete({
    shareId: shareId.trim(),
    ownerId: viewer.id
  } as any)) as any as ThingDoc | null;
  if (!deleted) return fail(404, 'Thing not found');
  // comments/reactions attached to the deleted thing go with it (v2 things AND
  // interim kind docs); share things survive so they can render their
  // 'original unavailable' placeholder
  await things.deleteMany({
    $or: [
      { targetId: deleted.shareId, thingtime: { $in: ['comment', 'reaction'] } },
      { parentId: deleted.shareId, kind: { $in: ['comment', 'reaction'] } }
    ]
  } as any);
  return { ok: true };
};

export const deletePost = deleteThing;

export type UpdateThingInput = {
  crystal?: unknown;
  acl?: unknown;
  visibility?: unknown; // legacy alias, mapped onto acl
  tags?: unknown;
};

// Own-thing update. PATCH semantics by default: crystal patches merge over the
// existing crystal; with replaceCrystal (PUT) the crystal is taken whole. Both
// re-validate against the thing's schemas. v1 posts are upgraded to v2 shape
// on write (their embedded comments/reactions residue stays until migration).
export const updateThing = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  input: UpdateThingInput,
  options: { replaceCrystal?: boolean } = {}
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  const doc = (await things.findOne({ shareId: shareId.trim(), ownerId: viewer.id } as any)) as any as ThingDoc | null;
  if (!doc || (!isV2(doc) && !isPostThing(doc))) return fail(404, 'Thing not found');

  const thingtime = thingtimeOf(doc);
  const patch =
    input.crystal && typeof input.crystal === 'object' && !Array.isArray(input.crystal)
      ? (input.crystal as Record<string, unknown>)
      : {};
  const nextCrystal = options.replaceCrystal ? patch : { ...crystalOf(doc), ...patch };
  const validated = validateThingtimeCrystal(thingtime, nextCrystal);
  if (isFail(validated)) return validated;

  // post crystals only — see the identical guard in createThing
  const patchedListing = thingtime.includes('post')
    ? (validated.crystal.listing as MarketplaceListing | null | undefined)
    : null;
  const categoryTag = patchedListing && typeof patchedListing.category === 'string' ? [patchedListing.category] : [];

  let tags = doc.tags || [];
  if (input.tags !== undefined) {
    const sanitized = sanitizeTags(input.tags);
    if (isFail(sanitized)) return sanitized;
    tags = [...sanitized, ...categoryTag].filter((tag, index, all) => all.indexOf(tag) === index);
  } else if (categoryTag.length && !tags.includes(categoryTag[0])) {
    // a listing PATCH that changes the category without resending tags must
    // still fold the new category in, or category filters mis-file the post
    // (the old category tag stays, matching create-time folding semantics)
    tags = [...tags, ...categoryTag];
  }

  let acl = aclOf(doc);
  if (input.acl !== undefined || input.visibility !== undefined) {
    if (acl.includes(ACL_INHERIT)) return fail(400, 'Attached things inherit their target audience');
    const nextAcl = resolveInputAcl(input);
    if (isFail(nextAcl)) return nextAcl;
    if (nextAcl) acl = nextAcl;
  }

  const now = new Date();
  const set: Record<string, any> = {
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime,
    crystal: validated.crystal,
    targetId: targetIdOf(doc),
    tags,
    acl,
    updatedAt: now
  };
  // upgrading a v1 post in place — clear the legacy crystal-at-root fields the
  // v2 shape replaces (embedded comments/reactions stay for the migration)
  const unset: Record<string, any> = {
    kind: '',
    type: '',
    text: '',
    images: '',
    listing: '',
    shareOfId: '',
    shareCount: '',
    visibility: ''
  };
  await things.updateOne({ shareId: doc.shareId } as any, { $set: set, $unset: unset } as any);

  const updated = { ...doc, ...set } as ThingDoc;
  delete (updated as any).kind;
  delete (updated as any).type;
  delete (updated as any).text;
  delete (updated as any).images;
  delete (updated as any).listing;
  delete (updated as any).shareOfId;
  delete (updated as any).shareCount;
  delete (updated as any).visibility;

  const thing = (await toPublicThings([updated], viewer))[0];
  const post = isPostThing(updated) ? (await toPublicPosts([updated], viewer))[0] : null;
  return { ok: true, thing, post };
};

// PUT semantics: create the thing at a caller-chosen id when it doesn't exist,
// otherwise replace the owned thing's crystal (and any provided audience/tags).
export const upsertThing = async (
  ownerId: string,
  input: CreateThingInput,
  viewer: Viewer = null
): Promise<Fail | { ok: true; created: boolean; thing: PublicThing; post: PublicPost | null }> => {
  const shareId = sanitizeShareId(input.shareId);
  if (isFail(shareId)) return shareId;
  if (!shareId) return fail(400, 'Upserts need an id (the shareId to create or replace)');

  const existing = await findThing(shareId);
  if (!existing) {
    const created = await createThing(ownerId, { ...input, shareId }, viewer);
    if (isFail(created)) return created;
    const projectViewer = viewer && viewer.id === ownerId ? viewer : { id: ownerId };
    const thing = (await toPublicThings([created.doc], projectViewer))[0];
    const post = isPostThing(created.doc) ? (await toPublicPosts([created.doc], projectViewer))[0] : null;
    return { ok: true, created: true, thing, post };
  }

  if (existing.ownerId !== ownerId) return fail(404, 'Thing not found');
  if (input.thingtime !== undefined) {
    const wanted = Array.isArray(input.thingtime) ? [...input.thingtime].sort().join(',') : '';
    if (wanted !== [...thingtimeOf(existing)].sort().join(',')) {
      return fail(400, 'A thing’s thingtime schemas can’t be changed');
    }
  }
  const updated = await updateThing(viewer || ownerId, shareId, input as UpdateThingInput, { replaceCrystal: true });
  if (isFail(updated)) return updated;
  return { ok: true, created: false, thing: updated.thing, post: updated.post };
};

// Public post count for a profile header — kept here so no route touches the
// things collection directly.
export const countPublicPosts = async (ownerId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments(withMatch(postMatch(), { ownerId }, circleClause('public')) as any);
};

// Feature lookup used by algorithm training — only returns posts the engaging
// user can actually see.
export const getPostFeatures = async (
  viewerInput: string | Viewer,
  shareIds: string[]
): Promise<Map<string, PostFeatures>> => {
  const viewer = asViewer(viewerInput);
  const wanted = [...new Set(shareIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (!wanted.length) return new Map();
  const things = await getThingsCollection();
  const docs = (await things
    .find(withMatch({ shareId: { $in: wanted } }, postMatch()) as any)
    .project(FEATURE_PROJECTION)
    .toArray()) as any as ThingDoc[];
  return new Map(docs.filter((doc) => canView(doc, viewer)).map((doc) => [doc.shareId, featuresOf(doc)]));
};
