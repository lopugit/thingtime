import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ObjectId, type Binary } from 'mongodb';

import { getHomeThingsCollection, getThingsCollection, getUsersCollection, withMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { findUserByUsername, pushUserRecentReaction, unpackSecure } from '../auth/users';
import {
	CONTROL_PLANE_STORAGE_THINGTIMES,
	StorageMutationError,
	USER_STORAGE_ACCOUNTING_VERSION,
	USER_STORAGE_STATUS,
	currentContentStorageSizeBytes,
	isBillableStorageThing,
	storageSandboxState,
	thingStorageSizeBytes
} from '../storage/storageCore';
import { applyUserStorageDelta } from '../storage/userStorage';
import { userSubscriptionLedgerMatch } from '../subscriptions/subscriptionIdentity';
import { attachmentCascadeCleanupTargets } from '../attachments/attachmentCascadeCore';
import {
	orderAttachmentDocsByStoredSort,
	toAttachmentPublicMetadata,
	type AttachmentPublicMetadata,
	type AttachmentPurpose
} from '../attachments/attachmentCore';
import {
	moderatedContentFingerprint,
	pendingModerationStamp,
	postInsertModerationPlan,
	queueTextModeration,
	screenTextForCreate,
	setModerationReleaseNotifier,
	TEXT_MODERATED_THINGTIMES,
	upsertTextModerationFlag
} from '../moderation/analyzeText';
import { hasModeratedContent, moderatedContentOf } from '../moderation/textModeration';
import { attachmentIsBlocked, attachmentModerationStatus } from '../moderation/moderationCore';
import { sanitizeReactionToken } from '~/utils/reactionTokens';
import { effectiveProfileMediaUrl } from '~/utils/profileMediaUrl';
import {
  ACL_ALL,
  ACL_CUSTOM,
  ACL_EXTACCT_PREFIX,
  ACL_EXT_SOURCED,
  ACL_FAMILY,
  ACL_FRIENDS,
  ACL_GROUP_PREFIX,
  ACL_HIDDEN,
  ACL_INHERIT,
  ACL_OWNER,
  ACL_USER_PREFIX,
  aclCapabilityFor,
	APP_STORAGE_RESERVED_ID_PREFIX,
	CASCADE_CHILD_THINGTIME,
  COLLECTION_SCHEMA_VERSIONS,
	EXTERNAL_RESERVED_ID_PREFIX,
  MAX_TEXT_CHARS,
  MESSENGER_THINGTIME,
	MIGRATION_DIAGNOSTIC_ID_PREFIX,
	MIGRATION_DIAGNOSTIC_THINGTIME,
  POST_TYPES as REGISTRY_POST_TYPES,
  PROTECTED_THINGTIME,
  REACTION_EMOJIS,
  aclAllows,
  aclFromVisibility,
  isProtectedThingtime,
  sanitizeAcl,
  sanitizeExtended,
  validateThingtimeCrystal,
  visibilityFromAcl,
  type FeedScope,
  type NotificationType,
  type PostMediaLayout,
  type ThingVisibility,
  SUBSPACE_THINGTIME,
  UPDOWN_THINGTIME
} from '~/schemas/registry';
import { scorePost, type AlgorithmWeights, type PostFeatures } from './feedRanking';
import { pollShapeOfCrystal, tallyPollVotes, type PollVoteEntry, type PublicPollVotes } from './pollCore';
import { emptyUpdownVotes, orderCommentPage, tallyUpdown, type CommentSort, type PublicUpdownVotes, type UpdownEntry } from './updownCore';
import {
	assertSubspaceInteraction,
	assertSubspacePosting,
	authorFlairKey,
	canModerate as canModerateSubspace,
	isActiveMember as isActiveSubspaceMember,
	loadAuthorFlairs,
	loadOpenReportCounts,
	loadSubspaceEmbeds,
	loadViewerSubspaceRoles,
	membershipOf as subspaceMembershipOf,
	resolveRootPost,
	subspaceFeedClauses,
	subspaceIdOfDoc,
	subspaceModHoldsPost,
	type AuthorFlairs,
	type SubspaceEmbed,
	type ViewerSubspaceRoles
} from '../subspaces/gate';
import { liveUserFlair, toPublicUserFlair, type PublicUserFlair } from '../subspaces/subspaceCore';
import { resolveInheritChain } from './aclChainCore';
import {
  appAclEntry,
  appNamespaceClauses,
  appNamespaceStamp,
	APP_STORAGE_ACCOUNTING_VERSION,
	applyAppStorageDeltaTransaction,
	appStorageCounterFenceMatch,
	appStorageCounterMatch,
  chargeAppStorage,
  filterByLiveAuthors,
  liveSandboxAuthors,
  liveSharingAuthors,
  refundAppStorage,
  sandboxDisplayName
} from '../apps/namespace';
import type { AppNamespaceScope } from '../apps/namespace';
import { scopeCovers } from '../apps/scopes';
import { resolveAppScopedAcl } from '../apps/namespace';
import { resolveViewStats } from './views';
import { emitNotification, emitNotificationsBulk, type NotificationActor } from '../notifications/notifications';
import { emitMentionNotifications } from '../notifications/mentions';
import { followerIdsOf, friendIdsOf, groupIdsOf } from '../users/social';
import { ANONYMOUS_USER_NAME } from '~/utils/userIdentity';

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
export type PostVisibility = 'public' | 'friends' | 'family' | 'private' | 'hidden' | 'custom';
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

// Subspace moderation state (api/utils/subspaces) — server-owned, lives at the
// post ROOT so generic crystal input can never write it. Removed posts are
// redacted for everyone but their author and the subspace's moderators and
// stay out of every feed; locked posts take no new comments.
export type SubspaceModState = {
	status?: 'approved' | 'removed';
	removedById?: string;
	removedAt?: Date;
	approvedById?: string;
	approvedAt?: Date;
	reason?: string | null;
	pinned?: boolean;
	locked?: boolean;
	nsfw?: boolean;
	spoiler?: boolean;
};

export type ThingDoc = {
  _id?: any;
  shareId: string;
  schemaVersion?: number; // absent = v1
  thingtime?: string[];
  crystal?: Record<string, any>;
  // schema-free sidecar: any JSON ≤ EXTENDED_MAX_BYTES, stored untouched inside
  // the platform envelope — never validated, structured-searchable, or
  // interpreted (see sanitizeExtended in schemas/registry.ts)
  extended?: unknown | null;
  ownerId: string;
  acl?: string[]; // v2 — tt: grants/exclusions (see schemas/registry.ts)
  visibility?: ThingVisibility; // v1 residue (mapped onto acl at read time)
  // hidden (unlisted) things: the randomly generated secret that makes the
  // thing viewable to ANYONE presenting it (?key= URLs). Minted whenever the
  // acl enters tt:hidden (fresh each time, so old links never resurrect);
  // inert while the acl says anything else. Owner-only in projections.
  linkKey?: string | null;
  targetId?: string | null;
  // Drive-style organization (v2 only): shareId of a folder thing the SAME
  // owner holds, or null/absent for the root of /things. Containment lives on
  // the child (FUNDAMENTALS §3), so folders never grow with their contents.
  folderId?: string | null;
  tags?: string[];
  // Token grants: tt:token/<id> entries naming the personal-access-token
  // sessions (auth/patTokens.ts) whose sandboxed mutations may touch this
  // thing. The creating token is auto-granted; the owner (or any credential
  // that can update the thing) layers more tokens on by replacing the list.
  // Separate from `acl` on purpose — acl is the VIEW audience, this is the
  // per-credential WRITE surface — and projected to the owner only.
  tokenAcl?: string[];
  // Legacy single-value form of the same grant (round-2 stamp) — read as an
  // implicit tt:token/<id> entry by tokenAclOf; never written anymore.
  createdByTokenId?: string;
	// Server-stamped provenance for Things created by a scoped paired device.
	// Generic callers cannot write this root field.
	sourceDeviceId?: string;
  createdAt: Date;
  updatedAt: Date;
  // App namespace (apps/namespace.ts): things written through an app token
  // carry the server-stamped namespace marker + serialized size (byte-budget
  // ledger), and — for sandbox tokens — the ephemeral TTL/space stamps.
  appId?: string;
  sizeBytes?: number;
	storageClass?: 'content' | 'control';
	expiresAt?: Date;
	storageAccountingVersion?: number;
	// Protected private-S3 attachment envelope. Dedicated attachment utilities
	// are the only writers; generic Thing CRUD rejects the attachment kind.
	attachmentEnvelopeVersion?: number;
	attachmentState?: 'pending' | 'finalizing' | 'ready' | 'deleting';
	objectSizeBytes?: number;
	objectKey?: string;
	objectVersionId?: string;
	attachmentRequestFingerprint?: string;
	attachmentPurpose?: AttachmentPurpose;
	attachmentProfileSlot?: 'avatar' | 'banner';
	attachmentFinalizationLeaseId?: string;
	attachmentPartsIssuedAt?: Date;
	attachmentObjectlessDelete?: true;
	attachmentMpuEmptyVerifiedAt?: Date;
	uploadId?: string;
	attachmentExpiresAt?: Date;
	// Protected current managed-profile references. They live at the user root,
	// never in its public crystal; projections derive same-origin content paths.
	avatarAttachmentId?: string;
	bannerAttachmentId?: string;
	emojiAttachmentId?: string;
  sandboxExpiresAt?: Date;
  sandboxSpace?: string;
  // System kinds only (user/theme/feed-algorithm/waitlist — the collections
  // collapsing into things): generalized uniqueness (multikey unique sparse
  // index; elements are BinData, PII keys hashed) and private state. `secure`
  // is NEVER projected, is unreachable by the search field grammar, and is a
  // single opaque BinData blob so the $** text index cannot tokenize any field
  // inside it. `secureAdmin` is the one queryable flag (a boolean — booleans
  // aren't text-indexed either). `secureRecentReactions` is the reaction MRU
  // pulled OUT of the blob onto the root (auth/users.ts) so the hot toggle write
  // is a targeted atomic $pull/$push instead of a whole-blob CAS; its elements
  // are BinData so the $** text index can't tokenize the emoji tokens.
  uniqueKeys?: Binary[];
  secure?: Binary;
  secureAdmin?: boolean;
  secureRecentReactions?: Binary[];
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
  // Subspace posts (api/utils/subspaces): moderation state at the root, and
  // the private-subspace fence marker stamped when a post lands in a private
  // subspace so feed clauses + canView can keep it members-only.
  subspaceMod?: SubspaceModState;
  subspacePrivate?: boolean;
};

// Lean author embed for feed payloads — identity only, never bio/bannerUrl
// (a data-URI banner would otherwise repeat per post and per comment).
export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
  // set ONLY for third-party authors of synced external posts — the honest
  // discriminator consumers use instead of routing to a dead /profile/<handle>
  externalUrl?: string | null;
};

// Comments share the post schema (rich comments are ["post","comment"]
// things), so the payload carries the post vocabulary: body fields, reactions,
// and a reply count. Legacy-era comments surface with the text-only defaults.
export type PublicComment = {
  id: string;
  thingtime: string[];
  author: FeedAuthor | null;
  type: PostType;
  text: string;
  richText: Record<string, any> | null;
  images: string[];
	attachments: AttachmentPublicMetadata[];
	// owner-chosen gallery layout for the visual attachments (null = masonry)
	mediaLayout: PostMediaLayout | null;
  listing: MarketplaceListing | null;
  thing: Record<string, any> | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  // up/down votes — the separate focused reaction kind (things/updown.ts)
  votes: PublicUpdownVotes;
  // the author's user flair in the ROOT post's subspace (null outside
  // subspaces / when they wear none / when they are no longer a member)
  authorFlair: PublicAuthorFlair | null;
  // direct replies (comments are commentable — their own /post/:id page shows
  // the thread)
  commentCount: number;
  // nested replies (threads ship two levels deep, ≤ REPLIES_PER_LEVEL each,
  // oldest → newest; deeper levels arrive empty and load on demand)
  comments?: PublicComment[];
  targetId: string | null;
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
  // owner-only, hidden things only: the secret behind the shareable
  // /post/<id>?key=<linkKey> URL
  linkKey?: string;
  text: string;
  richText: Record<string, any> | null;
  images: string[];
	attachments: AttachmentPublicMetadata[];
	// owner-chosen gallery layout for the visual attachments (null = masonry)
	mediaLayout: PostMediaLayout | null;
  listing: MarketplaceListing | null;
  // thingtime posts: the free-form structured thing under crystal.thing
  thing: Record<string, any> | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  // up/down votes — the separate focused reaction kind (things/updown.ts);
  // native emoji reactions above are untouched by it
  votes: PublicUpdownVotes;
  // Subspace vocabulary (api/utils/subspaces): optional headline, the
  // subspace embed + the post's flair, and the moderation state. All null
  // outside subspaces except `title`, which any post may carry.
  title: string | null;
  subspace: PublicPostSubspace | null;
  flair: PublicPostFlair | null;
  // the author's USER flair in this post's subspace (api/utils/subspaces —
  // one batched member-row lookup per page); null outside subspaces
  authorFlair: PublicAuthorFlair | null;
  subspaceMod: PublicSubspaceMod | null;
  commentCount: number;
  // Viewer-relative layers: never disclose comments hidden by ACL/moderation.
  // `commentCount` remains the backward-compatible alias of total.
  commentCounts: { direct: number; replies: number; total: number; loaded: number };
  comments: PublicComment[];
  shareCount: number;
  // true whenever this post is a share, even if the original is deleted or
  // not visible to the viewer (shareOf null in that case)
  isShare: boolean;
  shareOf: PublicPost | null;
  // public view stats (see views.ts): viewCount = unique viewer identities
  // (the manipulation-resistant number), impressions/avgDwellMs secondary
  viewCount: number;
  viewStats: { impressions: number; avgDwellMs: number };
  // poll posts only (crystal.thing carries question/options): live per-option
  // vote counts + the viewer's own vote, batch-aggregated from vote things
  pollVotes?: PublicPollVotes;
  // logged-in viewers only: has the viewer saved this post to their library?
  // (batched savedTargetIds lookup — anonymous projections omit the field)
  viewerSaved?: boolean;
  extended: unknown | null;
  createdAt: string;
};

// Lean subspace embed on subspace posts — identity + branding + the viewer's
// own role there (never the member roster).
export type PublicPostSubspace = {
	id: string;
	slug: string;
	name: string;
	icon: string | null;
	iconUrl: string | null;
	accent: string | null;
	access: 'public' | 'restricted' | 'private';
	nsfw: boolean;
	viewerRole: 'owner' | 'moderator' | 'member' | null;
};
export type PublicPostFlair = { id: string; label: string; emoji: string | null; color: string | null };
// a user flair beside an author's name: a template pick (id) or custom text
// (id null) — the post-flair shape with a nullable id
export type PublicAuthorFlair = PublicUserFlair;
export type PublicSubspaceMod = {
	status: 'approved' | 'removed';
	removed: boolean;
	// the removal reason is shown to the author and moderators only
	reason: string | null;
	removedAt: string | null;
	pinned: boolean;
	locked: boolean;
	nsfw: boolean;
	spoiler: boolean;
	viewerCanModerate: boolean;
	// moderators only: open reports against the post (the card's 🚩 badge, the
	// mod page's Reports queue) — one $group per page; absent for everyone else
	reportCount?: number;
};

// Generic projection for non-post things (and the unified read endpoint).
export type PublicThing = {
  id: string;
  thingtime: string[];
  author: FeedAuthor | null;
  // 'app' is the app-lens derived sugar (audience = this app's users) — the
  // same vocabulary the KV surface speaks; first-party projections never emit it
  visibility: ThingVisibility | 'app';
  acl: string[];
  // owner-only, hidden things only: the ?key= secret for the hidden link
  linkKey?: string;
  targetId: string | null;
  folderId: string | null;
  crystal: Record<string, any>;
  extended: unknown | null;
  tags: string[];
  // owner-only: the thing's tt:token/<id> grant list (absent for other
  // viewers and when empty)
  tokenAcl?: string[];
  createdAt: string;
  updatedAt: string;
};

// Who is looking. Routes pass { id, username } from the authed PublicUser;
// internal callers may only have an id (username-specific acl exclusions
// simply can't match then). Plain string ids are accepted for compat.
// When the actor is a personal access token, `pat` rides along: tokenId
// stamps everything the token creates (createdByTokenId), onlyCreatedThings
// sandboxes its mutations to those stamped things, and visibility fences it
// to one audience of things ('public' = world-visible only, 'private' = the
// rest only; 'all'/absent = unrestricted).
// friendIds is the viewer's accepted-friend set, loaded once per request path
// by withFriendIds so sync acl checks can resolve tt:userFriends.
export type Viewer = {
  id: string;
  username?: string | null;
  pat?: { tokenId: string; onlyCreatedThings: boolean; visibility?: 'all' | 'public' | 'private' | 'hidden' } | null;
  friendIds?: ReadonlySet<string>;
  // group memberships behind tt:group/<id> grants, and the hidden-link keys
  // the caller presented (withLinkKeys) — both read by the acl path below
  groupIds?: ReadonlySet<string>;
  linkKeys?: ReadonlySet<string>;
  // the viewer's subspace memberships (api/utils/subspaces/gate.ts), loaded
  // beside friendIds so private-subspace posts resolve for real members
  subspaceRoles?: ViewerSubspaceRoles;
  // synced external posts this viewer sources / external accounts they have
  // linked — loaded lazily by the acl path below (never up front: most reads
  // never meet an external post) and memoised on the viewer object
  extSourcedPostIds?: ReadonlySet<string>;
  extAccountIds?: ReadonlySet<string>;
} | null;
export const asViewer = (value: string | Viewer | null | undefined): Viewer => (typeof value === 'string' ? { id: value } : value || null);

// 32 base64url chars (~192 bits) — the whole security of a hidden link is
// this string being unguessable
const generateLinkKey = (): string => randomBytes(24).toString('base64url');

// Attach presented hidden-link keys to a viewer. Works for logged-out callers
// too: an anonymous key-holder rides an id-less viewer shell (id '' is falsy,
// so every viewer?.id check still reads it as anonymous — the key is its only
// power). No keys = the viewer passes through untouched.
export const withLinkKeys = (viewer: Viewer, keys: readonly string[]): Viewer => {
  const presented = keys.map((key) => key.trim()).filter(Boolean);
  if (!presented.length) return viewer;
  return viewer ? { ...viewer, linkKeys: new Set(presented) } : { id: '', linkKeys: new Set(presented) };
};

// Attach the viewer's accepted-friend set (one indexed query, memoised on the
// viewer object — already-enriched viewers pass straight through). Read paths
// call this before acl evaluation so friends-only things resolve for real
// friends instead of only their owner.
export const withFriendIds = async (viewer: Viewer): Promise<Viewer> => {
  if (!viewer?.id || (viewer.friendIds && viewer.subspaceRoles)) return viewer;
  // the subspace roster rides along (one indexed query, same memo) so the
  // sync canView can fence private-subspace posts and moderators see removed ones
  const [friendIds, subspaceRoles] = await Promise.all([
    viewer.friendIds ? Promise.resolve(viewer.friendIds) : friendIdsOf(viewer.id),
    viewer.subspaceRoles ? Promise.resolve(viewer.subspaceRoles) : loadViewerSubspaceRoles(viewer.id)
  ]);
  return { ...viewer, friendIds, subspaceRoles };
};

export const POST_TYPES: PostType[] = [...REGISTRY_POST_TYPES];
// The DEFAULT circle set: what an unfiltered feed/search covers. 'hidden' and
// 'custom' are deliberately absent — an unlisted thing is reachable by its
// link key, and a custom-audience thing by its baseline or an explicit grant
// (or, for either, by its owner's own-things clause), never by simply not
// filtering.
export const VISIBILITIES: PostVisibility[] = ['public', 'friends', 'family', 'private'];
// What a caller may ASK for. Wider than the default set: 'hidden' and 'custom'
// are real circles the composer, post menu and feed/search filter chips all
// offer (CIRCLE_META drives both menus), so `circles=hidden` / `circles=custom`
// have to survive input validation — dropping one silently widens the query
// back to every default circle, i.e. the opposite filter.
export const REQUESTABLE_VISIBILITIES: PostVisibility[] = [...VISIBILITIES, 'hidden', 'custom'];

const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_SHARE_ID_CHARS = 128;
const MAX_COMMENTS_PER_POST = 500;
// Reactions are open-vocabulary (any emoji / multi-emoji token), so bound them:
// a post holds at most this many DISTINCT tokens, and one user contributes at
// most this many reaction things per post.
const MAX_REACTION_KEYS_PER_POST = 100;
const MAX_REACTIONS_PER_USER_PER_POST = 20;
// Keep content + ledger delete transactions comfortably below MongoDB's
// transaction duration/operation ceilings. Callers may hand us 500+ rows
// (notably app-data cleanup and relationship cascades), so each bounded batch
// commits independently and the returned union preserves candidate order.
const STORAGE_DELETE_TRANSACTION_BATCH = 100;
const MAX_CASCADE_DESCENDANTS = 10_000;
const MAX_CASCADE_DRAIN_PASSES = 8;
const RETURNED_COMMENTS = 20;
// nested replies shipped per comment: REPLIES_PER_LEVEL per parent, and
// SHIPPED_REPLY_LEVELS levels BELOW the direct children (direct + 1 = two
// visible levels per payload — the UI reveals one more depth per expand,
// each made instant by the per-row prefetch of ITS OWN two-level payload)
const REPLIES_PER_LEVEL = 5;
const SHIPPED_REPLY_LEVELS = 1;
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

const storageMutationFail = (error: unknown): Fail | null => (error instanceof StorageMutationError ? fail(error.status, error.message) : null);

const storedThingSizeBytes = (doc: Pick<ThingDoc, 'sizeBytes' | 'crystal' | 'extended' | 'tags'>): number =>
	Number.isSafeInteger(doc.sizeBytes) && Number(doc.sizeBytes) >= 0 ? Number(doc.sizeBytes) : thingStorageSizeBytes(doc);

// Only this exact stamp proves the source row participated in a live ledger.
// Recompute the canonical payload bytes rather than trusting a cached stamp:
// an old/malformed row is migration input, never safe delta arithmetic.
const currentContentSizeBytes = (doc: ThingDoc): number | null => currentContentStorageSizeBytes(doc);

const appStorageScopeForDoc = (doc: ThingDoc): { scope: AppNamespaceScope; sandboxState: ReturnType<typeof storageSandboxState> } | null => {
	if (typeof doc.appId !== 'string' || !doc.appId) return null;
	const sandboxState = storageSandboxState(doc);
	return {
		sandboxState,
		scope: {
			appId: doc.appId,
			ownerId: String(doc.ownerId),
			sharedRead: false,
			scopes: [],
			username: '',
			sandbox: sandboxState === 'sandbox' ? { space: typeof doc.sandboxSpace === 'string' ? doc.sandboxSpace : null } : null
		}
	};
};

export const deletionStorageFenceDecision = (doc: Pick<ThingDoc, 'appId' | 'sandboxExpiresAt'>) => {
	const sandboxState = storageSandboxState(doc);
	return {
		sandboxState,
		fenceAccount: sandboxState === 'invalid',
		fenceAppAndUser: sandboxState === 'invalid' && typeof doc.appId === 'string' && !!doc.appId
	};
};

// Uncertain deletes do not guess at byte deltas. They still have to write the
// current-version ledger inside the delete transaction, even when it was
// already initializing or fenced, so reconciliation cannot race from a stale
// source snapshot and later certify the pre-delete total as ready.
export const uncertainUserStorageLedgerMatch = (ownerId: string): Record<string, unknown> => ({
	...userSubscriptionLedgerMatch(ownerId),
	'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION
});

export const uncertainAppStorageLedgerMatch = (appId: string): Record<string, unknown> => ({
	thingtime: 'app',
	'crystal.clientId': appId,
	'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION
});

export const uncertainAppUserStorageLedgerMatch = (ownerId: string, appId: string): Record<string, unknown> => ({
	...appStorageCounterFenceMatch(ownerId, appId)
});

// Apply exact deltas for documents already known to have been removed inside
// `session`. User ledgers are always locked first, followed by app ledgers, and
// both groups use a deterministic key order. Keeping that order identical for
// every batch prevents avoidable transaction deadlocks during cross-user
// cascades. Sandbox accounting intentionally remains on its existing ephemeral
// path and is refunded after the content transaction commits.
const applyDeletedStorageDeltas = async (docs: ThingDoc[], session: any): Promise<void> => {
	const userBytes = new Map<string, number>();
	const appBytes = new Map<string, { scope: AppNamespaceScope; bytes: number }>();
	const uncertainUsers = new Set<string>();
	const uncertainAppOwners = new Map<string, Set<string>>();

	// Foreign-plane deletes never touch the home account ledger (the mirror of
	// createThing's billable gate); app ledgers below still settle on the
	// active plane so an override DB keeps its own app accounting exact.
	const accountPlaneApplies = !isCustomMongoEndpointActive();
	for (const doc of docs) {
		const accountedBytes = currentContentSizeBytes(doc);
		const ownerId = String(doc.ownerId);
		const deletionDecision = deletionStorageFenceDecision(doc);
		const sandboxState = deletionDecision.sandboxState;
		if (accountPlaneApplies) {
			if (deletionDecision.fenceAccount) {
				uncertainUsers.add(ownerId);
			} else if (isBillableStorageThing(doc)) {
				if (accountedBytes === null) uncertainUsers.add(ownerId);
				else if (accountedBytes > 0) userBytes.set(ownerId, (userBytes.get(ownerId) ?? 0) + accountedBytes);
			}
		}

		const scoped = appStorageScopeForDoc(doc);
		if (scoped && scoped.sandboxState !== 'sandbox') {
			const scope = scoped.scope;
			if (accountedBytes === null || deletionDecision.fenceAppAndUser) {
				const owners = uncertainAppOwners.get(scope.appId) ?? new Set<string>();
				owners.add(scope.ownerId);
				uncertainAppOwners.set(scope.appId, owners);
			} else if (accountedBytes > 0) {
				const key = `${scope.appId}\0${scope.ownerId}`;
				const entry = appBytes.get(key) ?? { scope, bytes: 0 };
				entry.bytes += accountedBytes;
				appBytes.set(key, entry);
			}
		}
	}

	const things = await getThingsCollection();
	const now = new Date();
	const userOwnerIds = [...new Set([...userBytes.keys(), ...uncertainUsers])].sort();
	for (const ownerId of userOwnerIds) {
		const bytes = userBytes.get(ownerId) ?? 0;
		// One uncertain row makes the whole account delta unknowable. Do not
		// partially decrement its exact siblings first: the current total remains
		// conservative and reconciliation will derive the complete post-delete
		// value from source documents.
		if (bytes > 0 && !uncertainUsers.has(ownerId)) await applyUserStorageDelta(ownerId, -bytes, session);
		if (uncertainUsers.has(ownerId)) {
			// Deletion must remain available as the recovery action. An uncertain
			// legacy row is removed, but no guessed decrement is applied; fencing
			// the live ledger makes its exact source-document reconciliation repair
			// the now-smaller corpus before any future positive mutation.
			await things.updateOne(
				uncertainUserStorageLedgerMatch(ownerId),
				{
					$set: {
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
					}
				},
				{ session }
			);
		}
	}

	for (const key of [...appBytes.keys()].sort()) {
		const entry = appBytes.get(key)!;
		const uncertainOwners = uncertainAppOwners.get(entry.scope.appId);
		if (uncertainOwners) {
			// An uncertain row makes the shared app aggregate unknowable, so skip
			// all partial app arithmetic. Every affected per-user counter is fenced
			// too because its exact decrement is intentionally deferred to repair.
			uncertainOwners.add(entry.scope.ownerId);
			continue;
		}
		await applyAppStorageDeltaTransaction(entry.scope, -entry.bytes, session);
	}
	for (const appId of [...uncertainAppOwners.keys()].sort()) {
		await things.updateOne(
			uncertainAppStorageLedgerMatch(appId),
			{
				$set: {
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
					'crystal.storageUpdatedAt': now,
					updatedAt: now
				}
			},
			{ session }
		);
		for (const ownerId of [...uncertainAppOwners.get(appId)!].sort()) {
			await things.updateOne(
				uncertainAppUserStorageLedgerMatch(ownerId, appId),
				{
					$set: {
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
					}
				},
				{ session }
			);
		}
	}
};
export const isFail = (value: unknown): value is Fail => !!value && typeof value === 'object' && !Array.isArray(value) && (value as any).ok === false;

// Route-layer adapter: the authed user (or null) → the Viewer acl evaluation
// expects. Shared so every route passes the same shape. Routes resolving via
// resolveThingsActor pass the pat context so creates stamp provenance and
// sandboxed tokens stay inside their own creations.
export const viewerOf = (
  user: { id: string; username: string } | null,
  pat?: { jti: string; onlyCreatedThings?: boolean; visibility?: 'all' | 'public' | 'private' | 'hidden' } | null
): Viewer =>
  user
    ? {
        id: user.id,
        username: user.username,
        ...(pat
          ? {
              pat: {
                tokenId: pat.jti,
                onlyCreatedThings: pat.onlyCreatedThings === true,
                visibility:
                  pat.visibility === 'public' || pat.visibility === 'private' || pat.visibility === 'hidden' ? pat.visibility : 'all'
              }
            }
          : {})
      }
    : null;

// ---------------------------------------------------------------------------
// Token grants — the tt:token/<id> system. Every thing a PAT creates carries
// its creator's entry in `tokenAcl`; the owner (or any credential that can
// update the thing) layers more tokens on by replacing that list, so several
// sandboxed tokens can overlap on shared things. A sandboxed token
// (auth/patTokens.ts onlyCreatedThings) may only aim mutations/engagement at
// things carrying ITS entry. Session actors and unsandboxed tokens ignore
// tokenAcl entirely — and it never affects visibility (that stays acl's job).

export const TOKEN_ACL_PREFIX = 'tt:token/';
const MAX_TOKEN_ACL_ENTRIES = 32;
// jtis are UUIDs today; the entry grammar accepts a generous id charset so a
// future id format never needs a data migration
const TOKEN_ACL_ENTRY_RE = /^tt:token\/[A-Za-z0-9_-]{1,64}$/;

export const tokenAclEntryFor = (tokenId: string): string => `${TOKEN_ACL_PREFIX}${tokenId}`;

// A doc's token grants. Legacy round-2 docs carried the single-value
// createdByTokenId stamp — read it as an implicit entry so things stamped
// before the tt:token/ list keep honoring their creator (writes only ever
// produce tokenAcl now).
export const tokenAclOf = (doc: ThingDoc): string[] => {
  const entries = Array.isArray(doc.tokenAcl) ? doc.tokenAcl.filter((entry): entry is string => typeof entry === 'string') : [];
  if (doc.createdByTokenId && !entries.includes(tokenAclEntryFor(doc.createdByTokenId))) {
    return [...entries, tokenAclEntryFor(doc.createdByTokenId)];
  }
  return entries;
};

// undefined → no change requested; null → clear; otherwise a strict list of
// tt:token/<id> entries (deduped, bounded). Unknown token ids are allowed —
// an entry for a revoked/dead token is simply inert, and validating existence
// per write would cost a sessions query for no security gain.
const sanitizeTokenAcl = (value: unknown): Fail | string[] | undefined => {
  if (value === undefined) return undefined;
  const list = value === null ? [] : value;
  if (!Array.isArray(list)) {
    return fail(400, 'tokenAcl must be a list of tt:token/<token id> entries');
  }
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !TOKEN_ACL_ENTRY_RE.test(entry)) {
      return fail(400, `tokenAcl entries look like tt:token/<token id> — got ${String(entry).slice(0, 80)}`);
    }
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length > MAX_TOKEN_ACL_ENTRIES) {
    return fail(400, `tokenAcl holds at most ${MAX_TOKEN_ACL_ENTRIES} entries`);
  }
  return out;
};

// Token sandbox: the token id a sandboxed viewer is confined to, or null for
// session actors / unsandboxed tokens.
export const patSandboxOf = (viewer: Viewer): string | null => (viewer?.pat?.onlyCreatedThings ? viewer.pat.tokenId : null);

const patSandboxBlocks = (viewer: Viewer, doc: ThingDoc): boolean => {
  const tokenId = patSandboxOf(viewer);
  return !!tokenId && !tokenAclOf(doc).includes(tokenAclEntryFor(tokenId));
};

const patSandboxFail = (): Fail => fail(403, 'This token is sandboxed — it can only touch things carrying its tt:token grant 🧸');

// ---------------------------------------------------------------------------
// Token visibility fence — the Settings token minter's public-only /
// private-only restriction. Orthogonal to the tt:token sandbox above: the
// sandbox says WHICH things (its own creations), the fence says WHICH
// AUDIENCE ('public' = the inherit-resolved acl carries tt:all, 'private' =
// it doesn't). Unlike the sandbox, the fence applies to READS too — a
// public-only token exists so an agent can hold it without ever seeing
// private data, so out-of-audience things are invisible, not just
// untouchable.

export const patVisibilityOf = (viewer: Viewer): 'public' | 'private' | 'hidden' | null =>
  viewer?.pat?.visibility === 'public' || viewer?.pat?.visibility === 'private' || viewer?.pat?.visibility === 'hidden'
    ? viewer.pat.visibility
    : null;

// Fence check on a CONCRETE acl. tt:inherit means the audience lives on the
// target chain — the inherit-aware paths (canViewInherited, the mutation-site
// patVisibilityBlocksDoc) resolve it first; a direct hit on an unresolved
// inherit acl fails closed. Buckets: 'public' = carries tt:all; 'hidden' =
// carries tt:hidden; 'private' = everything NOT public (hidden included —
// hidden is a species of non-public). Exported for patVisibility.test.ts: this
// one expression IS the fence, so its truth table is pinned rather than left to
// a live stack (same reason visibleRelatedModerationClause is exported).
export const patVisibilityBlocksAcl = (viewer: Viewer, acl: string[]): boolean => {
  const mode = patVisibilityOf(viewer);
  if (!mode) return false;
  if (acl.includes(ACL_INHERIT)) return true;
  if (mode === 'hidden') return !acl.includes(ACL_HIDDEN);
  return acl.includes(ACL_ALL) !== (mode === 'public');
};

const patVisibilityFail = (viewer: Viewer): Fail => {
  const mode = patVisibilityOf(viewer);
  return fail(
    403,
    mode === 'public'
      ? 'This token is public-only — it can only see and touch public things 🌐'
      : mode === 'hidden'
        ? 'This token is hidden-only — it can only see and touch hidden link-key things 🕵️'
        : 'This token is private-only — it can only see and touch private (non-public) things 🔒'
  );
};

// ---------------------------------------------------------------------------
// Era helpers — one place that knows how to read both doc generations.

// Some early relational children (notably attachments) were written with the
// v2 `thingtime` discriminator before their schema-version stamp became
// mandatory. The discriminator is authoritative for those rows: treating one
// as v1 silently projects it as a post and bypasses its attachment-specific
// permalink and recovery behaviour.
const isV2 = (doc: ThingDoc): boolean => (doc.schemaVersion || 1) >= 2 || Array.isArray(doc.thingtime);

const thingtimeOf = (doc: ThingDoc): string[] => {
  if (isV2(doc)) return doc.thingtime || [];
  // v1 docs are always posts; shares are posts with shareOfId
  return doc.shareOfId ? ['post', 'share'] : ['post'];
};

export const isPostThing = (doc: ThingDoc): boolean => thingtimeOf(doc).includes('post');

// Only http(s) links may be projected out of a synced external post's envelope
// — those values become real <a href>/<img src> targets in the feed, and the
// provider behind them can be any RSS feed or fediverse instance a user named.
// Kept local (not imported from api/utils/connections) so the read path never
// depends on the connections module.
const safeExternalLink = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value.trim() : null;
  } catch {
    return null;
  }
};

// Post-like for rendering/interaction surfaces (permalink projection, share
// targets): native posts PLUS synced third-party posts. Deliberately NOT used
// by feed queries — those match kinds explicitly, so external posts never
// enter first-party feeds. New "acts like a post" consumers use this, not a
// per-callsite or-branch.
export const isPostLikeThing = (doc: ThingDoc): boolean => isPostThing(doc) || thingtimeOf(doc).includes('external-post');

const crystalOf = (doc: ThingDoc): Record<string, any> => {
  if (isV2(doc)) return doc.crystal || {};
  return { type: doc.type, text: doc.text || '', images: doc.images || [], listing: doc.listing || null };
};

// crystal.mediaLayout is sanitized on write; surface it as-is (null = masonry)
const mediaLayoutOf = (crystal: Record<string, any>): PostMediaLayout | null =>
	crystal.mediaLayout && typeof crystal.mediaLayout === 'object' && !Array.isArray(crystal.mediaLayout)
		? (crystal.mediaLayout as PostMediaLayout)
		: null;

// shareId of the thing this thing is attached to (comment/reaction/share)
const targetIdOf = (doc: ThingDoc): string | null => {
  if (isV2(doc)) return doc.targetId || null;
  return doc.shareOfId || null;
};

// folder containment (v2 only — v1 predates folders and reads as root)
const folderIdOf = (doc: ThingDoc): string | null => (isV2(doc) ? doc.folderId || null : null);

// Query fragment matching post things across both eras. v2 posts carry
// thingtime:['post',...]; v1 posts carry kind:'post' (migration unsets kind).
// Rich comments are ["post","comment"] things — posts by schema, but they live
// under their target, never in feeds/profiles, so the comment id is excluded.
// (exported for things/trending.ts, which selects its candidate window with
// the exact same era semantics as the feed)
export const postMatch = () => ({ $or: [{ thingtime: 'post' }, { kind: 'post' }], thingtime: { $ne: 'comment' } });

// Any post-shaped thing, including rich comments — for share-original lookups,
// where the target may legitimately be a ["post","comment"] thing.
export const postThingMatch = () => ({ $or: [{ thingtime: 'post' }, { kind: 'post' }] });

// Query fragment for a `thingtime in [...]` filter that stays era-correct: v1
// posts have no thingtime array, so a 'post' filter must also match kind:'post'.
// Shared by listThings and things/search so the two never disagree on which
// legacy posts exist (the single source the era semantics live behind).
export const thingtimeInClause = (thingtime: string[]) =>
  thingtime.includes('post') ? { $or: [{ thingtime: { $in: thingtime } }, { kind: 'post' }] } : { thingtime: { $in: thingtime } };

export const withMatch = (base: Record<string, any>, ...clauses: Record<string, any>[]) => {
  const and = [base, ...clauses].filter((clause) => Object.keys(clause).length);
  return and.length > 1 ? { $and: and } : and[0] || {};
};

// The tag cap counts code points, never bisecting a surrogate pair, and lone
// surrogates are dropped — stored tags must be well-formed UTF-16 so the
// client's encodeURIComponent on a stored tag can never throw during render.
// NFC normalization keeps composed and decomposed spellings of one visible
// tag (NFD 'café' pasted from macOS vs typed NFC) in a single stored bucket.
// components/Feed/hashtags.ts canonicalHashtag and Attachments/
// attachmentUiCore.ts canonicalPostTags mirror this exactly.
const canonicalTag = (value: string): string =>
  Array.from(value.trim().toLowerCase().normalize('NFC'))
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint < 0xd800 || codePoint > 0xdfff;
    })
    .slice(0, MAX_TAG_CHARS)
    .join('');

const sanitizeTags = (value: unknown): string[] | Fail => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail(400, 'tags must be a list');
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const tag = canonicalTag(entry);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
};

// The things v1→v2 migration mints deterministic reaction thing ids under this
// prefix (reactionShareId). Reserving it means a client can never pre-create a
// thing at a migration destination id to hijack or delete migrated data.
export const MIGRATION_RESERVED_ID_PREFIX = 'react-';
// Builtin-schema seed mints shareId `schema-<id>` deterministically — reserve
// the prefix so a client can't pre-claim (and impersonate) a builtin schema.
export const SCHEMA_RESERVED_ID_PREFIX = 'schema-';
// Component library seed mints shareId `component-<slug>` deterministically —
// reserve the prefix so a client can't pre-claim (and impersonate) a seeded
// library component.
export const COMPONENT_RESERVED_ID_PREFIX = 'component-';
// Site webpage seed mints shareId `webpage-route-<key>`/`webpage-<slug>`
// deterministically — reserve the prefix so a client can't pre-claim (and
// impersonate) a seeded site page.
export const WEBPAGE_RESERVED_ID_PREFIX = 'webpage-';
// The action- prefix is reserved for system use the same way: user creates
// refuse it, and the executor mints `action-run-<uuid>` run-record ids
// under it.
export const ACTION_RESERVED_ID_PREFIX = 'action-';
// Subscription tier revisions and user assignments use deterministic ids so
// historical links stay stable. They are protected control-plane destinations
// and cannot be pre-claimed through generic Thing creation.
export const SUBSCRIPTION_RESERVED_ID_PREFIX = 'subscription-';
// Service quota ledgers use quota-<owner>-<service>-<window> ids. Reserving
// their namespace keeps generic Things from pre-claiming an enforcement row.
export const SERVICE_QUOTA_RESERVED_ID_PREFIX = 'quota-';
// The demo/app seed is the one seeder that also mints DATA things: behaviour
// suite samples (`data-demo-<suite>-<n>`) and app content (`data-app-<suite>-…`,
// e.g. data-app-pokeworld-species-25). Its sibling parts already ride reserved
// prefixes — schema-, component-, action-, webpage- — and these two close the
// gap for the fifth kind. Without them a client can pre-create a plain data
// thing at a seed destination, and upsertSystemThings (which requires
// ownerId 'system' to touch a twin) then skips that row FOREVER: re-running
// the seed never reclaims a squatted id, so the public corpus silently loses
// entries. Deliberately the two full namespaces and not a bare `data-`, which
// would refuse ordinary user ids like `data-my-notes`.
export const SEEDED_DATA_SUITE_RESERVED_ID_PREFIX = 'data-demo-';
export const SEEDED_DATA_APP_RESERVED_ID_PREFIX = 'data-app-';

// Seeding passes fixed shareIds for idempotency (and Magic relies on ids
// round-tripping), so client-supplied ids are allowed — but they must be sane
// strings, not arbitrary JSON values (the v1 route stored anything truthy),
// and must not squat the migration's reserved id namespace.
export const sanitizeShareId = (value: unknown): string | null | Fail => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return fail(400, 'shareId must be a string');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SHARE_ID_CHARS || /[$.\s]/.test(trimmed)) {
    return fail(400, 'shareId must be a short id without spaces, dots, or $');
  }
  if (
    trimmed.startsWith('lopu-recording-') ||
    trimmed.startsWith(MIGRATION_RESERVED_ID_PREFIX) ||
    trimmed.startsWith(SCHEMA_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(COMPONENT_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(WEBPAGE_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(ACTION_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(SUBSCRIPTION_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(SERVICE_QUOTA_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(MIGRATION_DIAGNOSTIC_ID_PREFIX) ||
		trimmed.startsWith(APP_STORAGE_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(EXTERNAL_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(SEEDED_DATA_SUITE_RESERVED_ID_PREFIX) ||
		trimmed.startsWith(SEEDED_DATA_APP_RESERVED_ID_PREFIX)
  ) {
		// Deterministic migration, schema, tier-revision, subscription assignment,
		// service-quota, app-storage, external-connection, and seeded suite/app
		// data destinations must never be squatted or impersonated by generic
		// user-created Things.
    return fail(400, 'shareId uses a reserved prefix');
  }
  return trimmed;
};

// ---------------------------------------------------------------------------
// Folders (see folderSchema in schemas/registry.ts): containment is a folderId
// pointer on the child. These helpers are the ONE place folder assignment is
// validated — createThing, updateThing, and the bulk ops all resolve through
// them, so a folder pointer can never reference another user's folder, a
// non-folder thing, or (for folder moves) its own descendant.

// Mechanical children (reactions, saves, poll votes) live under their target
// and never surface as content — filing them is meaningless. Comments/shares/
// posts are authored content and CAN be filed: folderId is pure owner-side
// organization, orthogonal to targetId attachment and inherit visibility.
const FOLDER_UNFILEABLE = ['reaction', 'save', 'vote', UPDOWN_THINGTIME];
// Ancestor-walk bound. Legitimate folder trees are shallow; the walk fails
// closed at the cap so a corrupt chain can never loop the server.
const MAX_FOLDER_DEPTH = 64;

// Validates a raw folderId input for a thing of the given schemas. Returns the
// resolved folder shareId, null for root, or a Fail. Ownership is strict: the
// folder must belong to the same owner (organization is personal).
const resolveFolderAssignment = async (
  ownerId: string,
  rawFolderId: unknown,
  thingtime: string[]
): Promise<{ ok: true; folderId: string | null } | Fail> => {
  if (rawFolderId === undefined || rawFolderId === null || rawFolderId === '') {
    return { ok: true, folderId: null };
  }
  if (typeof rawFolderId !== 'string' || !rawFolderId.trim()) {
    return fail(400, 'folderId must be a folder thing id (or null for the root)');
  }
  if (thingtime.some((id) => FOLDER_UNFILEABLE.includes(id))) {
    return fail(400, `${thingtime.join('+')} things live under their target and cannot be filed in folders`);
  }
  const things = await getThingsCollection();
  const folder = (await things.findOne({
    shareId: rawFolderId.trim(),
    ownerId,
    thingtime: 'folder'
  } as any)) as any as ThingDoc | null;
  if (!folder) return fail(404, 'Folder not found');
  return { ok: true, folderId: folder.shareId };
};

// True when `needleId` appears in the ancestor chain starting AT folderId
// (inclusive). Used to refuse moving a folder into itself/its descendants.
// Cycle-safe (visited set) and depth-capped; anything suspicious reads as
// "contains" so the move fails closed.
const folderAncestryContains = async (ownerId: string, folderId: string, needleId: string): Promise<boolean> => {
  const things = await getThingsCollection();
  const visited = new Set<string>();
  let current: string | null = folderId;
  for (let hop = 0; current && hop < MAX_FOLDER_DEPTH; hop += 1) {
    if (current === needleId) return true;
    if (visited.has(current)) return true; // existing cycle — fail closed
    visited.add(current);
    const doc = (await things.findOne(
      { shareId: current, ownerId, thingtime: 'folder' } as any,
      { projection: { folderId: 1 } } as any
    )) as any as ThingDoc | null;
    if (!doc) return false; // chain ends at root (or a since-deleted parent)
    current = doc.folderId || null;
  }
  return current !== null; // depth cap hit with chain unresolved — fail closed
};

// ---------------------------------------------------------------------------
// Unified creation — the one path every thing kind goes through.

export type CreateThingInput = {
  thingtime?: unknown;
  crystal?: unknown;
  extended?: unknown;
  acl?: unknown;
  visibility?: unknown; // legacy alias, mapped onto acl
  targetId?: unknown;
  folderId?: unknown; // shareId of an owned folder thing (null/omitted = root)
  tags?: unknown;
  // tt:token/<id> grants to seed on the new thing (the creating token's own
  // entry is added automatically when a PAT creates)
  tokenAcl?: unknown;
  // seeding/migration pass fixed ids + timestamps for idempotency
  shareId?: unknown;
  createdAt?: Date;
};

// rootSubspaceId: for a comment / reaction the interaction gate judged, the
// ROOT post's subspace it resolved on the way (null outside subspaces) — the
// caller reuses it instead of walking the reply chain again; absent when the
// gate did not run (standalone things)
type CreateThingResult = Fail | { ok: true; doc: ThingDoc; rootSubspaceId?: string | null };

// Dedicated server features may extend the atomic Thing insert without
// opening their protected fields to generic client input. Hooks run after the
// insert and before commit; throwing rolls back the content row and its ledger
// charge together.
export type CreateThingHooks = {
	postAttachments?: { hasAny: boolean; hasVisual: boolean };
	afterInsert?: (doc: ThingDoc, session: any) => Promise<void>;
	sourceDeviceId?: string;
};

// audience for a new thing: explicit acl > legacy visibility name > default
const resolveInputAcl = (input: { acl?: unknown; visibility?: unknown }): string[] | null | Fail => {
  if (input.acl !== undefined && input.acl !== null) {
    const acl = sanitizeAcl(input.acl);
    if (isFail(acl)) return acl;
    // tt:inherit is SERVER-assigned (createThing stamps it on comments and
    // target-attached things) — never caller-supplied, the same stance the
    // visibility branch below already takes. Accepting it would detach a
    // thing's audience from its own acl: both visibility-fence checks skip
    // inherit acls on the grounds that the target was already judged, so a
    // restricted token could hand itself an unjudged audience, and a
    // standalone thing has no target to resolve — leaving it visible to
    // nobody but its owner and permanently un-editable, since every later
    // acl change 400s on the guard above.
    if (acl.includes(ACL_INHERIT)) {
      return fail(400, 'tt:inherit is set by the server on target-attached things — it cannot be supplied');
    }
    return acl;
  }
  if (input.visibility !== undefined && input.visibility !== null) {
    const acl = aclFromVisibility(input.visibility);
    if (!acl || acl.includes(ACL_INHERIT)) return fail(400, 'Unknown visibility');
    return acl;
  }
  return null;
};

// Data things may carry schema provenance tags (crystal.schema name +
// crystal.schemaId, stamped by the schema form). The stamp drives per-schema
// usage counts, so the server — not the client — is authoritative on EVERY
// write path (create, PATCH, PUT): schemaId must resolve to a schema thing the
// writer can see, and the display name is overwritten from that schema, so no
// client can attribute its data to a schema under a mismatched schemaId/name
// pair. Mutates `crystal` in place; a data thing with no schemaId is untouched.
const resolveDataSchemaProvenance = async (thingtime: string[], crystal: Record<string, unknown>, asOwner: Viewer): Promise<{ ok: true } | Fail> => {
  if (!thingtime.includes('data') || crystal.schemaId === undefined) return { ok: true };
  const rawSchemaId = crystal.schemaId;
  if (typeof rawSchemaId !== 'string' || !rawSchemaId.trim()) {
    return fail(400, 'crystal.schemaId must be a schema thing id');
  }
  const schemaThing = await findViewableThing(rawSchemaId.trim(), asOwner);
  if (!schemaThing || !thingtimeOf(schemaThing).includes('schema')) {
    return fail(400, 'crystal.schemaId does not resolve to a schema you can see');
  }
  crystal.schemaId = schemaThing.shareId;
  const schemaName = (schemaThing.crystal as Record<string, unknown> | undefined)?.name;
  if (typeof schemaName === 'string' && schemaName) crystal.schema = schemaName;
  return { ok: true };
};

export const createThing = async (
  ownerId: string,
  input: CreateThingInput,
  viewer: Viewer = null,
	app: AppLens = null,
	hooks: CreateThingHooks = {}
): Promise<CreateThingResult> => {
  const asOwner = viewer && viewer.id === ownerId ? viewer : { id: ownerId };
	const validated = validateThingtimeCrystal(input.thingtime, input.crystal, {
		postAttachments: hooks.postAttachments
	});
  if (isFail(validated)) return validated;

  // system kinds are written ONLY by their dedicated utils (register, themes,
  // algorithms, waitlist — each a direct insert with the right secure/uniqueKeys
  // shape). The generic path unconditionally refuses them, so nobody can mint a
  // user/theme/algorithm/waitlist thing (or a fake account) through /api/v1/things.
  if (isProtectedThingtime(validated.thingtime)) {
    return fail(403, `${validated.thingtime.join('+')} things are managed by their own endpoints`);
  }

  // saves (the user's personal library) and shares (public social reposting)
  // are first-party surfaces — an app acting as the user must not write into
  // either (shares additionally require a tt:all target, which a namespace
  // thing never is)
  if (app && (validated.thingtime.includes('save') || validated.thingtime.includes('share'))) {
    return fail(403, `${validated.thingtime.join('+')} things are first-party surfaces — not available to app tokens`);
  }

  const provenance = await resolveDataSchemaProvenance(validated.thingtime, validated.crystal, asOwner);
  if (isFail(provenance)) return provenance;

  // subspace posting gate (api/utils/subspaces/gate.ts): membership, ban,
  // access-mode and flair rules run on EVERY post create — the generic route
  // included — and a private subspace stamps the fence the feeds + canView honour
  let subspacePrivate = false;
  const postSubspaceId = validated.thingtime.includes('post') ? subspaceIdOfDoc({ crystal: validated.crystal }) : null;
  if (postSubspaceId) {
    const gate = await assertSubspacePosting(
      ownerId,
      postSubspaceId,
      typeof validated.crystal.flairId === 'string' ? validated.crystal.flairId : null,
      { roles: asOwner.subspaceRoles }
    );
    if (isFail(gate)) return gate;
    if (gate.flairId) validated.crystal.flairId = gate.flairId;
    else delete validated.crystal.flairId;
    subspacePrivate = gate.private;
  }

  const tags = sanitizeTags(input.tags);
  if (isFail(tags)) return tags;

  const shareId = sanitizeShareId(input.shareId);
  if (isFail(shareId)) return shareId;

  // App writes ride the ONE app-acl clamp (namespace.resolveAppScopedAcl):
  // only 'just this user' / 'users of this app' are expressible, widening to
  // the app audience needs the author's app-data.shared grant, and the
  // no-audience default is PRIVATE — never the generic route's public.
  let inputAcl: string[] | null;
  if (app) {
    const clamped = resolveAppScopedAcl(app.appId, input.visibility, input.acl);
    if ('ok' in clamped) return fail(clamped.status, clamped.error);
    if (clamped.shared && !app.sharedRead) {
      return fail(403, 'This token was not granted the app-data.shared scope, so entries stay private');
    }
    inputAcl = clamped.acl ?? [ACL_OWNER];
  } else {
    const resolved = resolveInputAcl(input);
    if (isFail(resolved)) return resolved;
    inputAcl = resolved;
  }

  const extended = sanitizeExtended(input.extended);
  if (isFail(extended)) return extended;

  const requestedTokenAcl = sanitizeTokenAcl(input.tokenAcl);
  if (isFail(requestedTokenAcl)) return requestedTokenAcl;

  // marketplace listings fold their category into tags so filters find them —
  // post crystals only (a free-form data crystal can carry any `listing`
  // value, which must never leak unsanitized into the multikey tags index)
  const listing = validated.thingtime.includes('post') ? (validated.crystal.listing as MarketplaceListing | null | undefined) : null;
  const categoryTag = listing && typeof listing.category === 'string' ? [listing.category] : [];
  const allTags = [...(tags as string[]), ...categoryTag].filter((tag, index, all) => all.indexOf(tag) === index);

  let targetId: string | null = null;
  let target: ThingDoc | null = null;
  if (validated.requiresTarget) {
    // under the app lens the target must sit inside the namespace — an app
    // can never attach things to (or probe the existence of) the user's
    // first-party things
    target = await findViewableThingAs(input.targetId, asOwner, app);
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
    // Sandboxed tokens may only ATTACH to their own creations (comment/react/
    // save/share on a foreign thing is engagement outside the sandbox). For
    // shares this applies to the final root — re-sharing a token-created share
    // of someone else's post would attach to that foreign root, so it blocks.
    if (patSandboxBlocks(viewer, target)) return patSandboxFail();
    // custom audiences gate engagement (comment/react/share) behind the
    // comment capability — saves stay personal and exempt
    if (
      (validated.thingtime.includes('comment') || validated.thingtime.includes('reaction') || validated.thingtime.includes('share')) &&
      (await customEngageBlocks(asOwner, target))
    ) {
      return customEngageFail();
    }
    targetId = target.shareId;
  } else if (input.targetId !== undefined && input.targetId !== null) {
    return fail(400, `thingtime ${validated.thingtime.join('+')} does not take a targetId`);
  }

  // Target-attached things inherit their target's audience dynamically;
  // standalone things default public. Library saves are the exception: a
  // library is personal, so saves are always private to the saver — never
  // the target's audience. Comments ALWAYS inherit — including rich
  // ["post","comment"] things — so a private thread can never leak through a
  // caller-supplied acl on the comment.
  let acl: string[];
  if (validated.thingtime.includes('save')) {
    acl = [ACL_OWNER];
  } else if (validated.thingtime.includes('comment')) {
    acl = [ACL_INHERIT];
  } else if (validated.requiresTarget && !validated.thingtime.includes('post')) {
    acl = [ACL_INHERIT];
  } else if (validated.thingtime.includes('folder')) {
    // organization structure is personal — folders default private, unlike
    // the public default for standalone content things
    acl = inputAcl || [ACL_OWNER];
  } else {
    // fenced tokens' standalone creations default INSIDE their fence — the
    // public default would only ever 403 on the check below (private-only →
    // private; hidden-only → hidden, which mints its secret link)
    const fenceMode = patVisibilityOf(viewer);
    acl = inputAcl || (fenceMode === 'private' ? [ACL_OWNER] : fenceMode === 'hidden' ? [ACL_HIDDEN, ACL_OWNER] : [ACL_ALL]);
  }

  // The token visibility fence on the NEW thing's audience. By-design
  // audiences skip it: saves are always owner-private (a bookmark of the
  // already-fence-checked target), and inherit acls take their target's
  // audience — the findViewableThingAs above judged that target through the
  // fence-aware canView.
  if (!acl.includes(ACL_INHERIT) && !validated.thingtime.includes('save') && patVisibilityBlocksAcl(viewer, acl)) {
    return patVisibilityFail(viewer);
  }

  // hidden things are born with their secret link key — the random URL that
  // makes an unlisted thing reachable (canView honors it while acl says hidden)
  const linkKey = acl.includes(ACL_HIDDEN) ? generateLinkKey() : null;

  const folderAssignment = await resolveFolderAssignment(ownerId, input.folderId, validated.thingtime);
  if (isFail(folderAssignment)) return folderAssignment;

  // subspace rules on attached things: banned users can't comment or react
  // inside the subspace, and locked posts take no new comments (mods excepted).
  // The gate walks to the root post once; its subspace rides the result so
  // addComment never repeats the walk for the fresh comment's authorFlair.
  let rootSubspaceId: string | null | undefined;
  if (target && (validated.thingtime.includes('comment') || validated.thingtime.includes('reaction'))) {
    const interaction = await assertSubspaceInteraction(ownerId, target, validated.thingtime.includes('comment') ? 'comment' : 'vote', {
      roles: asOwner.subspaceRoles
    });
    if (isFail(interaction)) return interaction;
    rootSubspaceId = interaction.rootSubspaceId;
  }

  if (validated.thingtime.includes('comment') && target) {
		// includeBlocked: the cap is a physical doc bound — blocked spam must not
		// free up quota for more child docs under the same post
		const commentCount = await countCommentsOf(target, { includeBlocked: true });
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

  const things = await getThingsCollection();
  const now = input.createdAt instanceof Date ? input.createdAt : new Date();

  const tokenAclDoc = [...(viewer?.pat ? [tokenAclEntryFor(viewer.pat.tokenId)] : []), ...(requestedTokenAcl || [])].filter(
    (entry, index, all) => all.indexOf(entry) === index
  );

	const sizeBytes = thingStorageSizeBytes({
        crystal: validated.crystal,
        extended: extended.value === undefined ? null : extended.value,
        tags: allTags
	});

  const doc: ThingDoc = {
    shareId: (shareId as string | null) || randomUUID(),
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime: validated.thingtime,
    crystal: validated.crystal,
    extended: extended.value === undefined ? null : extended.value,
    ownerId,
    acl,
    targetId,
    folderId: folderAssignment.folderId,
    tags: allTags,
    ...(subspacePrivate ? { subspacePrivate: true } : {}),
    // every PAT-created thing carries its creator's grant (sandboxed or not —
    // free provenance) plus any entries the caller seeded; a sandboxed
    // creator listing peers here is delegation at birth
    ...(tokenAclDoc.length ? { tokenAcl: tokenAclDoc } : {}),
    ...(linkKey ? { linkKey } : {}),
    createdAt: now,
    updatedAt: now,
		...(app ? appNamespaceStamp(app, sizeBytes) : {}),
		...(hooks?.sourceDeviceId ? { sourceDeviceId: hooks.sourceDeviceId } : {})
	};
	// Account storage meters HOME-hosted bytes only. With a data-plane endpoint
	// override active this content lands on the user's own MongoDB: it consumes
	// no Thingtime account storage, gets no home-accounting stamps, and must
	// not touch the home subscription ledger (which a foreign-plane transaction
	// could not reach anyway — sessions are client-bound and the ledger is
	// home-pinned). App ledgers still self-account on the active plane through
	// appNamespaceStamp/applyAppStorageDeltaTransaction below.
	const billable = isBillableStorageThing(doc) && !isCustomMongoEndpointActive();
	if (billable) {
		doc.storageClass = 'content';
		doc.sizeBytes = sizeBytes;
		doc.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION;
	}

	// Registered app content debits all three ledgers (whole account, whole app,
	// app user) in the same transaction as the insert. Sandboxes keep their
	// existing ephemeral/windowed accounting path because they have no real user
	// subscription ledger and their data is TTL-reaped. Even sandbox ATTACHMENTS
	// still transact the insert with their target touch so a concurrent cascade
	// cannot commit an orphan between those two writes.
	const registeredApp = app && !app.sandbox ? app : null;
	if (app?.sandbox) {
		const charge = await chargeAppStorage(app, sizeBytes);
		if (charge.ok === false) return fail(charge.status, charge.error);
	}
	// Hybrid create-time text screen: bounded free omni race. A verdict in
	// time means the doc is BORN stamped (a blocked post never renders
	// anywhere, not even in a feed refresh between insert and async verdict);
	// timeout/outage/off resolves null and the async queue + hourly sweep own
	// it. screenTextForCreate never throws and never exceeds its budget.
	if (thingtimeOf(doc).some((kind) => TEXT_MODERATED_THINGTIMES.has(kind))) {
		const moderatedContent = moderatedContentOf(doc as any);
		if (hasModeratedContent(moderatedContent)) {
			const screen = await screenTextForCreate(moderatedContent);
			if (screen.kind === 'verdict') (doc as any).moderation = screen.stamp;
			// fail-closed: no verdict while the surface is ON → born PENDING
			// (owner-private) until the async queue / hourly cron releases it
			else if (screen.kind === 'unavailable') (doc as any).moderation = pendingModerationStamp(moderatedContent);
			// 'skip' (surface off / custom plane) publishes normally, unstamped
		}
	}

  try {
		if (billable || registeredApp || target || hooks.afterInsert) {
			await withMongoTransaction(async (session) => {
				if (billable) await applyUserStorageDelta(ownerId, sizeBytes, session);
				if (registeredApp) await applyAppStorageDeltaTransaction(registeredApp, sizeBytes, session);
				await things.insertOne(doc as any, { session });
				if (hooks.afterInsert) await hooks.afterInsert(doc, session);
				if (target) {
					const touched = await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } }, { session });
					if (touched.matchedCount === 0) {
						throw new StorageMutationError(409, 'storage_conflict', 'The target changed while this thing was being created — try again');
					}
				}
			});
		} else {
    await things.insertOne(doc as any);
			if (target) {
				await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: now } });
			}
		}
  } catch (err: any) {
		const storageFail = storageMutationFail(err);
		if (storageFail) {
			// The target-conflict error is raised from our transaction callback, so
			// a sandbox insert is known not to have committed and its pre-reserved
			// ephemeral bytes can be returned exactly.
			if (app?.sandbox) await refundAppStorage(app, sizeBytes);
			return storageFail;
		}
    // duplicate-key can come from more than one unique index — only a shareId
    // collision means "this thing already exists" (seeding re-runs pass fixed
    // ids; mirror the registerUser 409 convention so seeds skip idempotently).
    // The reaction (target, owner, token) index races surface as 409 too so
    // toggleReaction keeps treating them as already-reacted.
    if (err?.code === 11000) {
      // A duplicate-key rejection proves the insert did not land. Unknown
      // Mongo errors are ambiguous, so they deliberately keep the reservation
      // rather than risk refunding bytes for a document that was committed.
			if (app?.sandbox) await refundAppStorage(app, sizeBytes);
      const keys = Object.keys(err?.keyPattern || {});
      if (!keys.length || keys.includes('shareId')) return fail(409, 'Post already exists');
      if (keys.includes('crystal.emoji')) return fail(409, 'Post already exists');
      // uniqueKeys collisions (username taken, email registered, …) — the
      // dedicated utils translate this into their own friendlier message
      return fail(409, 'A thing with those unique fields already exists');
    }
    throw err;
  }

	// Post-insert moderation plan (pure helper, unit-tested):
	//   notify     — born-blocked docs are invisible everywhere, so followers
	//                are never notified about content they can't open
	//   inlineFlag — a born-flagged doc's admin moderationFlag lands in the
	//                SAME request as its stamp; only if that write fails does
	//                the flagPending marker + hourly sweep own it
	//   queueAsync — no sync verdict: the ordinary async screen runs as before
	const moderationPlan = postInsertModerationPlan(doc as any);
	if (moderationPlan.notify) {
		// notification side effects — emit* never throws, so a notification
		// hiccup can't fail the write that triggered it
  await emitCreationNotifications(doc, target, asOwner);
	}
	if (moderationPlan.inlineFlag) {
		try {
			const home = await getHomeThingsCollection();
			const flaggedContent = moderatedContentOf(doc as any);
			await upsertTextModerationFlag(
				home,
				doc as any,
				(doc as any).moderation,
				flaggedContent.text.trim() || `[image urls] ${flaggedContent.imageUrls.slice(0, 3).join(' ')}`,
				new Date()
			);
			await things.updateOne({ shareId: doc.shareId, 'moderation.flagPending': true } as any, { $unset: { 'moderation.flagPending': '' } } as any);
		} catch (error) {
			// flagPending stays on the stamp — the hourly sweep retries the flag
			console.warn('[moderation] inline flag write failed; sweep will retry:', (error as Error)?.message || error);
			queueTextModeration(doc.shareId);
		}
	} else if (moderationPlan.queueAsync) {
		queueTextModeration(doc.shareId);
	}
  return { ok: true, doc, ...(rootSubspaceId !== undefined ? { rootSubspaceId } : {}) };
};

// Posts land in followers'/friends' notification feeds, capped — big accounts
// notify their newest FANOUT_CAP connections rather than block the write.
const FANOUT_CAP = 200;

// @mentions may only ring for people who can actually VIEW the text that
// mentions them — a mention notification carries a preview (bell AND
// default-on email), so an ungated emit would leak up to 140 chars of a
// private or friends-only post to an arbitrary user, contradicting the acl
// gate the fan-out below applies. The governing acl is the doc's own for
// posts and the inherit-chain terminal's for comments (a comment is exactly
// as visible as its thread); a broken/cyclic chain fails closed (nobody is
// notified). The gate is the exact per-recipient evaluation reads use
// (canView), so specific-user grants (tt:user/<name>) still notify and
// exclusions still deny. One friendIdsOf query on the TERMINAL owner answers
// the friends circle for every candidate — friendship is mutual, so a
// recipient is inside the owner's friends circle iff the owner's own friend
// set contains them.
//
// Shared by the create funnel (emitCreationNotifications) and updateThing's
// edit pass; `previousText` (edit pass) limits emits to newly ADDED
// usernames. Returns the recipient ids actually notified.
const emitTextMentions = async (
  doc: ThingDoc,
  target: ThingDoc | null,
  actorRef: NotificationActor,
  previousText?: unknown
): Promise<Set<string>> => {
  const isCommentDoc = thingtimeOf(doc).includes('comment');
  // the walk's first hop is almost always the already-fetched target
  const findWithTarget = (shareId: string): Promise<ThingDoc | null> =>
    target && target.shareId === shareId ? Promise.resolve(target) : findThing(shareId);
  const terminal = await resolveInheritChain(doc, (d) => aclOf(d).includes(ACL_INHERIT), findWithTarget);
  if (!terminal) return new Set<string>();
  const terminalAcl = aclOf(terminal);
  const ownerFriends = terminalAcl.some((entry) => entry === ACL_FRIENDS || entry === `-${ACL_FRIENDS}`)
    ? await friendIdsOf(terminal.ownerId)
    : null;
  return emitMentionNotifications({
    text: crystalOf(doc).text,
    previousText,
    actor: actorRef,
    targetId: doc.shareId,
    postId: isCommentDoc && target ? target.shareId : doc.shareId,
    excludeIds: target ? [target.ownerId] : [],
    canRecipientView: (recipient) =>
      canView(terminal, {
        id: recipient.id,
        username: recipient.username,
        friendIds: ownerFriends?.has(recipient.id) ? new Set([terminal.ownerId]) : undefined
      })
  });
};

// Notifications for a freshly created thing. createThing is the single funnel
// for posts, comments (plain + rich), shares AND reaction things, so this one
// hook covers every creation path — dedicated routes and generic POST alike.
export const emitCreationNotifications = async (doc: ThingDoc, target: ThingDoc | null, actor: Viewer): Promise<void> => {
	// A custom endpoint is an untrusted, caller-controlled data plane. Its docs
	// can deliberately collide with home shareIds/ownerIds, so none may trigger
	// bell or email side effects in Thingtime's home identity plane.
	if (isCustomMongoEndpointActive()) return;
  if (!actor?.id) return;
  const kinds = thingtimeOf(doc);
  const actorRef = { id: actor.id, username: actor.username || null };

  // @mentions in the body text notify each mentioned user (posts, comments and
  // share captions — never reactions, whose "text" is an emoji token). The
  // notification is the artifact: no mention doc is stored, the literal
  // @username text re-parses on render (same model as inline #hashtags). The
  // direct target owner is excluded (they already get the comment/reply/share
  // notification for this same doc) and mentioned users are excluded from the
  // post fan-out below, so each person gets exactly one bell entry per event —
  // the most specific one. Emits are visibility-gated (emitTextMentions): a
  // mention only rings for someone who can view the doc that mentions them.
  const mentioned =
    kinds.includes('post') || kinds.includes('comment') ? await emitTextMentions(doc, target, actorRef) : new Set<string>();

  if (target && kinds.includes('reaction')) {
    await emitNotification({
      recipientId: target.ownerId,
      type: 'reaction',
      actor: actorRef,
      targetId: target.shareId,
      postId: target.shareId,
      preview: String(crystalOf(doc).emoji || '')
    });
    return;
  }
  if (target && kinds.includes('comment')) {
    await emitNotification({
      recipientId: target.ownerId,
      // replying to a comment notifies its author as a reply; commenting on a
      // post notifies the post author as a comment
      type: thingtimeOf(target).includes('comment') ? 'reply' : 'comment',
      actor: actorRef,
      targetId: doc.shareId,
      postId: target.shareId,
      preview: String(crystalOf(doc).text || '')
    });
    return;
  }
  if (target && kinds.includes('share')) {
    await emitNotification({
      recipientId: target.ownerId,
      type: 'share',
      actor: actorRef,
      targetId: doc.shareId,
      postId: doc.shareId,
      preview: String(crystalOf(doc).text || '') || String(crystalOf(target).text || '')
    });
    // a share is also a new post — fall through to the fan-out below
  }
  if (!kinds.includes('post') || kinds.includes('comment')) return;

  // fan-out only to audiences that can actually view the post: public → both
  // circles, friends-only → friends; anything narrower skips fan-out.
  const acl = aclOf(doc);
  const isPublic = acl.includes(ACL_ALL);
  if (!isPublic && !acl.includes(ACL_FRIENDS)) return;
  const friends = await friendIdsOf(actor.id);
  const recipients: Array<{ recipientId: string; type: NotificationType }> = [];
  for (const id of friends) {
    if (recipients.length >= FANOUT_CAP) break;
    if (mentioned.has(id)) continue;
    recipients.push({ recipientId: id, type: 'post-from-friend' });
  }
  if (isPublic && recipients.length < FANOUT_CAP) {
    const followers = await followerIdsOf(actor.id, FANOUT_CAP);
    for (const id of followers) {
      if (recipients.length >= FANOUT_CAP) break;
      if (friends.has(id) || mentioned.has(id)) continue;
      recipients.push({ recipientId: id, type: 'post-from-followed' });
    }
  }
  if (!recipients.length) return;
  await emitNotificationsBulk(recipients, {
    actor: actorRef,
    targetId: doc.shareId,
    postId: doc.shareId,
    preview: String(crystalOf(doc).text || '')
  });
};

export type CreatePostInput = {
  type?: unknown;
  text?: unknown;
  richText?: unknown;
  images?: unknown;
  listing?: unknown;
  thing?: unknown;
	mediaLayout?: unknown;
  // subspace vocabulary (api/utils/subspaces): headline, destination, flair
  title?: unknown;
  subspaceId?: unknown;
  flairId?: unknown;
  extended?: unknown;
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
	viewer: Viewer = null,
	hooks: CreateThingHooks = {}
): Promise<CreateResult> => {
  const created = await createThing(
    ownerId,
    {
      thingtime: ['post'],
      crystal: {
			type: input.type,
			text: input.text,
			richText: input.richText,
			images: input.images,
			listing: input.listing,
			thing: input.thing,
			mediaLayout: input.mediaLayout,
			title: input.title,
			subspaceId: input.subspaceId,
			flairId: input.flairId
		},
      extended: input.extended,
      acl: input.acl,
      visibility: input.visibility,
      tags: input.tags,
      shareId: input.shareId,
      createdAt: input.createdAt
    },
		viewer,
		null,
		hooks
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
  displayName: doc.meta?.temporary === true ? ANONYMOUS_USER_NAME : doc.displayName ?? null,
  temporary: doc.meta?.temporary === true,
	avatarUrl: effectiveProfileMediaUrl(doc, 'avatar')
});

export const resolveProfiles = async (userIds: string[]): Promise<Map<string, FeedAuthor>> => {
  const wanted = [...new Set(userIds)].filter((id) => typeof id === 'string' && id.trim());
  if (!wanted.length) return new Map();
  const profiles = new Map<string, FeedAuthor>();

  // things-era users first (shareId = the id every ownerId reference carries).
  // HOME collection: identity lives on the home deployment, so author cards
  // keep resolving while a custom data-plane endpoint override is active.
  const things = await getHomeThingsCollection();
  const userThings = await things
    .find({ thingtime: 'user', shareId: { $in: wanted } } as any)
		.project({ shareId: 1, 'crystal.username': 1, 'crystal.displayName': 1, 'crystal.avatarUrl': 1, avatarAttachmentId: 1, secure: 1 })
    .toArray();
  for (const doc of userThings as any[]) {
    const temporary = unpackSecure(doc.secure).meta?.temporary === true;
    profiles.set(String(doc.shareId), {
      id: String(doc.shareId),
      username: doc.crystal?.username,
      displayName: temporary ? ANONYMOUS_USER_NAME : doc.crystal?.displayName ?? null,
      temporary,
			avatarUrl: effectiveProfileMediaUrl(doc, 'avatar')
    });
  }

  const remaining = wanted.filter((id) => !profiles.has(id) && ObjectId.isValid(id));
  if (remaining.length) {
    const users = await getUsersCollection();
    const docs = await users
      .find({ _id: { $in: remaining.map((id) => new ObjectId(id)) } })
			.project({ username: 1, displayName: 1, avatarUrl: 1, avatarAttachmentId: 1, meta: 1 })
      .toArray();
    for (const doc of docs as any[]) profiles.set(String(doc._id), toFeedAuthor(doc));
  }
  return profiles;
};

// Normalized comment/reaction views over both eras. v2 comment entries carry
// their full doc so the projection can surface post-shaped comment bodies
// (rich ["post","comment"] things); legacy eras have no doc.
type CommentEntry = { id: string; userId: string; text: string; createdAt: Date; doc?: ThingDoc };
type ReactionEntry = { userId: string; emoji: string };

type RelatedThings = {
  commentsByTarget: Map<string, CommentEntry[]>;
  // keyed by post shareId AND (second pass) by comment shareId — a comment's
  // own reactions live here too
  reactionsByTarget: Map<string, ReactionEntry[]>;
  // poll vote things per page-doc shareId (see pollCore.ts) — one query for
  // the whole page, folded into the same fetch as comments/reactions
  votesByTarget: Map<string, PollVoteEntry[]>;
  // up/down vote entries per post AND comment shareId (things/updownCore.ts)
  updownByTarget: Map<string, UpdownEntry[]>;
  shareCountByTarget: Map<string, number>;
  // direct-reply counts per comment shareId
  commentCountByTarget: Map<string, number>;
};

// One batched pass for a page of post docs: standalone comment/reaction
// things for those posts plus live share counts across both eras. Embedded
// v1 residue on each doc is merged in per-post below.
// Field whitelists for the child-thing passes below. These reads are
// unbounded by design — a page's complete comment and reaction set — so what
// is NOT fetched matters more than what is. Un-projected, a viral post drags
// its entire `crystal` (rich comment bodies, image lists, arbitrary `thing`
// payloads) plus `extended` (up to 512KB per doc) and `acl` across the wire to
// render a handful of comment rows and an emoji tally.
//
// Every field here is one the projection's consumers actually read: the
// pass-1/level loops below, mergedCommentsOf/mergedReactionsOf, and
// buildComment + the attachment target pass in toPublicPosts. `_id` rides
// along by default and is what the legacy era keys comments by.
// Exported for the projection-contract test: this is the single field set used
// for direct comments and every eagerly shipped reply level.
export const RELATED_CHILD_PROJECTION = {
  // schemaVersion is LOAD-BEARING and easy to miss: isV2() reads it, and
  // thingtimeOf/crystalOf/targetIdOf all branch on isV2(). Project it away and
  // every doc silently reads as a v1 post — thingtimeOf returns ['post'], so
  // neither the comment nor the reaction branch matches and the whole child
  // set vanishes from the response with no error.
  schemaVersion: 1,
  shareId: 1,
  ownerId: 1,
  targetId: 1,
  createdAt: 1,
  thingtime: 1,
  tags: 1,
  'crystal.text': 1,
  'crystal.richText': 1,
  'crystal.type': 1,
  'crystal.images': 1,
  // Rich comments use the same post crystal as top-level posts. Keeping this
  // field is required for their owner-selected rows/grid layout to survive a
  // feed or permalink reload; without it mediaLayoutOf() silently falls back
  // to masonry.
  'crystal.mediaLayout': 1,
  'crystal.listing': 1,
  'crystal.thing': 1,
  'crystal.emoji': 1,
  // Poll votes ride the same pass-1 query as comments/reactions, and the vote
  // branch reads ONLY this field. Project it away and every tally becomes
  // Number(undefined) — NaN option indexes, so a poll renders zero votes with
  // no error anywhere.
  'crystal.optionIndex': 1,
  // up/down votes ride the same pass; the updown branch reads only this field
  'crystal.direction': 1,
  // v1 residue: the fields thingtimeOf/crystalOf/targetIdOf fall back to for
  // pre-v2 docs, which this collection still legitimately holds.
  shareOfId: 1,
  type: 1,
  text: 1,
  images: 1,
  listing: 1
} as const;

// The interim kind-era docs carry their payload as flat top-level fields.
const RELATED_LEGACY_PROJECTION = {
  schemaVersion: 1,
  parentId: 1,
  kind: 1,
  ownerId: 1,
  commentId: 1,
  createdAt: 1,
  text: 1,
  token: 1
} as const;

// Reactions only ever contribute (userId, emoji) pairs.
const RELATED_REACTION_PROJECTION = { schemaVersion: 1, targetId: 1, ownerId: 1, thingtime: 1, 'crystal.emoji': 1, 'crystal.direction': 1 } as const;

// Related interaction projections must apply the same pending-content rule as
// canView/canViewInherited: blocked content is invisible to everyone, while a
// pending text thing remains visible to its owner. Keeping this as one clause
// prevents post cards/counts from disagreeing with GET ?target=… listings.
export const visibleRelatedModerationClause = (viewerId: string | null): Record<string, any> =>
	viewerId
		? {
				$or: [
					{ 'moderation.status': { $nin: ['blocked', 'pending'] } },
					{ ownerId: viewerId, 'moderation.status': 'pending' }
				]
			}
		: { 'moderation.status': { $nin: ['blocked', 'pending'] } };

const resolveRelated = async (docs: ThingDoc[], viewerId: string | null): Promise<RelatedThings> => {
  const ids = docs.map((doc) => doc.shareId);
  const commentsByTarget = new Map<string, CommentEntry[]>();
  const reactionsByTarget = new Map<string, ReactionEntry[]>();
  const votesByTarget = new Map<string, PollVoteEntry[]>();
  const updownByTarget = new Map<string, UpdownEntry[]>();
  const shareCountByTarget = new Map<string, number>();
  const commentCountByTarget = new Map<string, number>();
  if (!ids.length) return { commentsByTarget, reactionsByTarget, votesByTarget, updownByTarget, shareCountByTarget, commentCountByTarget };

  const things = await getThingsCollection();
	const moderation = visibleRelatedModerationClause(viewerId);
  const [related, legacyRelational, shareCounts] = await Promise.all([
    things
      .find(withMatch({ targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction', 'vote', UPDOWN_THINGTIME] } }, moderation) as any)
      .project(RELATED_CHILD_PROJECTION)
      .sort({ createdAt: 1, shareId: 1 })
      .toArray() as Promise<any[]>,
    // interim relational era: kind:'reaction'/'comment' docs linked by parentId
    // (written by the pre-unification relational model; converted by the things
    // migration, folded here until then)
    things
      .find(withMatch({ kind: { $in: ['comment', 'reaction'] }, parentId: { $in: ids } }, moderation) as any)
      .project(RELATED_LEGACY_PROJECTION)
      .sort({ createdAt: 1 })
      .toArray() as Promise<any[]>,
    things
      .aggregate([
        {
					$match: withMatch(
						{ $or: [{ thingtime: 'share', targetId: { $in: ids } }, { shareOfId: { $in: ids } }] },
						moderation
					)
				},
        { $group: { _id: { $ifNull: ['$targetId', '$shareOfId'] }, count: { $sum: 1 } } }
      ])
      .toArray() as Promise<any[]>
  ]);

  const pushComment = (target: string, entry: CommentEntry) => {
    const list = commentsByTarget.get(target) || [];
    // a doc can surface through more than one pass (a comment page's doc is
    // ALSO its parent's child) — never list the same reply twice
    if (list.some((existing) => existing.id === entry.id)) return;
    list.push(entry);
    commentsByTarget.set(target, list);
  };
  const pushReaction = (target: string, entry: ReactionEntry) => {
    const list = reactionsByTarget.get(target) || [];
    list.push(entry);
    reactionsByTarget.set(target, list);
  };
  const pushUpdown = (target: string, entry: UpdownEntry) => {
    const list = updownByTarget.get(target) || [];
    list.push(entry);
    updownByTarget.set(target, list);
  };

  for (const doc of related as ThingDoc[]) {
    const target = doc.targetId as string;
    if (thingtimeOf(doc).includes('comment')) {
      pushComment(target, {
        id: doc.shareId,
        userId: doc.ownerId,
        text: String(doc.crystal?.text || ''),
        createdAt: new Date(doc.createdAt),
        doc
      });
    } else if (thingtimeOf(doc).includes('reaction')) {
      pushReaction(target, { userId: doc.ownerId, emoji: String(doc.crystal?.emoji || '') });
    } else if (thingtimeOf(doc).includes('vote')) {
      const list = votesByTarget.get(target) || [];
      list.push({ userId: String(doc.ownerId), optionIndex: Number(doc.crystal?.optionIndex) });
      votesByTarget.set(target, list);
    } else if (thingtimeOf(doc).includes(UPDOWN_THINGTIME)) {
      pushUpdown(target, { userId: String(doc.ownerId), direction: doc.crystal?.direction });
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

  // Deeper levels, one batched round-trip per level: threads ship THREE
  // levels of replies (REPLIES_PER_LEVEL per parent per level) so opening any
  // visible thread never needs a fetch — the client lazily fetches level 4+.
  // Each processed level fetches its comments' own reactions; the last level
  // fetches direct reply COUNTS only (no docs). Page docs' own children were
  // already fetched by pass 1 against the page ids, so page ids are excluded
  // (a comment-page doc reappearing as its parent's child once doubled its
  // replies), and seenIds keeps cycles/self-references out.
  const pageIdSet = new Set(ids);
  const seenIds = new Set<string>(ids);
  let levelIds = [...commentsByTarget.values()]
    .flat()
    .map((entry) => entry.id)
    .filter((id) => !pageIdSet.has(id));
  for (let depth = 0; depth <= SHIPPED_REPLY_LEVELS && levelIds.length; depth++) {
    const withDocs = depth < SHIPPED_REPLY_LEVELS;
    const [levelReactions, replyGroups] = await Promise.all([
      things
        .find(withMatch({ targetId: { $in: levelIds }, thingtime: { $in: ['reaction', UPDOWN_THINGTIME] } }, moderation) as any)
        .project(RELATED_REACTION_PROJECTION)
        .sort({ createdAt: 1, shareId: 1 })
        .toArray() as Promise<any[]>,
      // blocked replies neither ship as docs nor inflate per-level counts —
      // this mirrors the first-pass related queries above (a blocked doc must
      // vanish from EVERY thread payload, not just level 1)
      things
        .aggregate(
          withDocs
            ? [
                { $match: withMatch({ targetId: { $in: levelIds }, thingtime: 'comment' }, moderation) },
                { $sort: { createdAt: -1, shareId: 1 } },
                // Project BEFORE the $group: $push accumulates every matching
                // reply into one document, and $group is capped at 100MB with
                // allowDiskUse unset — pushing whole $$ROOT docs made a large
                // enough thread fail the request outright, not merely run slow.
                // Only REPLIES_PER_LEVEL of them survive the $slice anyway.
                { $project: RELATED_CHILD_PROJECTION },
                { $group: { _id: '$targetId', count: { $sum: 1 }, docs: { $push: '$$ROOT' } } },
                { $project: { count: 1, docs: { $slice: ['$docs', REPLIES_PER_LEVEL] } } }
              ]
            : [
                { $match: withMatch({ targetId: { $in: levelIds }, thingtime: 'comment' }, moderation) },
                { $group: { _id: '$targetId', count: { $sum: 1 } } }
              ]
        )
        .toArray() as Promise<any[]>
    ]);
    for (const doc of levelReactions as ThingDoc[]) {
      if (thingtimeOf(doc).includes(UPDOWN_THINGTIME)) {
        pushUpdown(doc.targetId as string, { userId: String(doc.ownerId), direction: doc.crystal?.direction });
      } else {
        pushReaction(doc.targetId as string, { userId: doc.ownerId, emoji: String(doc.crystal?.emoji || '') });
      }
    }
    const nextLevelIds: string[] = [];
    for (const group of replyGroups) {
      commentCountByTarget.set(String(group._id), group.count);
      // stored newest-first for the slice; readers want oldest → newest
      for (const doc of ((group.docs as ThingDoc[]) || []).reverse()) {
        if (seenIds.has(doc.shareId)) continue;
        seenIds.add(doc.shareId);
        nextLevelIds.push(doc.shareId);
        pushComment(String(group._id), {
          id: doc.shareId,
          userId: doc.ownerId,
          text: String(doc.crystal?.text || ''),
          createdAt: new Date(doc.createdAt),
          doc
        });
      }
    }
    levelIds = nextLevelIds;
  }

  return { commentsByTarget, reactionsByTarget, votesByTarget, updownByTarget, shareCountByTarget, commentCountByTarget };
};

// Attachments are relational protected Things. Resolve one bounded query for
// the whole post page (including shared originals), and project only stable
// metadata; private object keys/upload ids never leave this module boundary.
const resolvePostAttachments = async (
	postIds: string[],
	expectedTargets?: ReadonlyMap<string, { ownerId: string; purpose: 'post' | 'comment' }>,
	viewerId?: string | null
): Promise<Map<string, AttachmentPublicMetadata[]>> => {
	const ids = [...new Set(postIds)].filter(Boolean);
	const byTarget = new Map<string, AttachmentPublicMetadata[]>();
	if (!ids.length) return byTarget;
	const things = await getThingsCollection();
	const docs = (await things
		.find({ thingtime: 'attachment', targetId: { $in: ids }, attachmentState: 'ready' } as any)
		.project({ shareId: 1, targetId: 1, ownerId: 1, attachmentPurpose: 1, attachmentSortIndex: 1, crystal: 1, moderation: 1, createdAt: 1 })
		.sort({ createdAt: 1, shareId: 1 })
		.toArray()) as any[];
	// stamped display order wins; legacy unstamped docs keep createdAt order
	for (const doc of orderAttachmentDocsByStoredSort(docs)) {
		const targetId = typeof doc.targetId === 'string' ? doc.targetId : '';
		const expected = expectedTargets?.get(targetId);
		// The owner keeps seeing their own moderation-PENDING media (flagged
		// `pending: true`, mirroring visibleRelatedModerationClause) so an
		// in-analysis image never silently vanishes from their post or its edit
		// composer. Everyone else keeps the fail-closed hide; blocked stays
		// hidden for all.
		const attachment = toAttachmentPublicMetadata(doc.shareId, doc.crystal, doc.moderation, {
			ownerView: !!viewerId && String(doc.ownerId) === viewerId
		});
		if (
			!targetId ||
			!attachment ||
			(expected &&
				(String(doc.ownerId) !== expected.ownerId ||
					(expected.purpose === 'post'
						? doc.attachmentPurpose !== undefined && doc.attachmentPurpose !== 'post'
						: doc.attachmentPurpose !== 'comment')))
		)
			continue;
		const current = byTarget.get(targetId) ?? [];
		current.push(attachment);
		byTarget.set(targetId, current);
	}
	return byTarget;
};

// The trusted attachment context updateThing feeds the crystal validator —
// the PATCH equivalent of the route-inspected postAttachments hook on create.
// Bound attachments are server-authored state, so live presence is exactly as
// trustworthy as the create-time inspection, and an attachment-only post must
// stay editable (its content IS the bound media).
const boundAttachmentPresence = async (ownerId: string, targetId: string): Promise<{ hasAny: boolean; hasVisual: boolean }> => {
	const things = await getThingsCollection();
	const docs = (await things
		.find({ thingtime: 'attachment', targetId, ownerId, attachmentState: 'ready' } as any)
		.project({ 'crystal.mediaKind': 1 })
		.toArray()) as any[];
	return {
		hasAny: docs.length > 0,
		hasVisual: docs.some((doc) => doc?.crystal?.mediaKind === 'image' || doc?.crystal?.mediaKind === 'video')
	};
};

// Total comment count for whole threads (every descendant, not just direct
// children) — one $graphLookup per page of ids, following targetId chains
// through v2 comment things.
const resolveThreadCounts = async (ids: string[], viewerId: string | null): Promise<Map<string, number>> => {
  const totals = new Map<string, number>();
  if (!ids.length) return totals;
  const things = await getThingsCollection();
  const rows = (await things
    .aggregate([
      { $match: { shareId: { $in: ids } } },
      { $project: { shareId: 1 } },
      {
        $graphLookup: {
          from: things.collectionName,
          startWith: '$shareId',
          connectFromField: 'shareId',
          connectToField: 'targetId',
          as: 'thread',
          // blocked comments (and via graph pruning their whole subtrees)
          // don't count — totals must match the visible lists
          restrictSearchWithMatch: withMatch({ thingtime: 'comment' }, visibleRelatedModerationClause(viewerId))
        }
      },
      { $project: { shareId: 1, total: { $size: '$thread' } } }
    ])
    .toArray()) as any[];
  for (const row of rows) totals.set(String(row.shareId), row.total);
  return totals;
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
  return [...embedded, ...standalone].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
};

export const layeredPostCommentCounts = (
	direct: number,
	total: number,
	loaded: number
): PublicPost['commentCounts'] => ({
	direct,
	replies: Math.max(0, total - direct),
	total,
	loaded
});

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

const liveShareCountOf = (doc: ThingDoc, related: RelatedThings): number => related.shareCountByTarget.get(doc.shareId) || 0;

// The root post's subspace for every COMMENT doc on a page that carries no
// crystal.subspaceId of its own: parents are fetched one reply level at a
// time ({ shareId: $in } per hop, bounded), so a page of N comment docs costs
// at most MAX_ROOT_HOPS queries instead of N walks. Docs that are not
// comments, or already carry a subspaceId, are skipped.
const MAX_ROOT_HOPS = 16;
const resolveCommentRootSubspaces = async (things: Awaited<ReturnType<typeof getThingsCollection>>, docs: ThingDoc[]): Promise<Map<string, string | null>> => {
  const roots = new Map<string, string | null>();
  // parentId → the comment docs waiting on it
  let frontier = new Map<string, string[]>();
  const waitOn = (map: Map<string, string[]>, parentId: string, docId: string) => map.set(parentId, [...(map.get(parentId) || []), docId]);
  for (const doc of docs) {
    const parentId = targetIdOf(doc);
    if (parentId && thingtimeOf(doc).includes('comment') && !subspaceIdOfDoc(doc)) waitOn(frontier, parentId, doc.shareId);
  }
  const seen = new Set<string>();
  for (let hop = 0; hop < MAX_ROOT_HOPS && frontier.size; hop++) {
    const parentIds = [...frontier.keys()].filter((id) => !seen.has(id));
    if (!parentIds.length) break;
    parentIds.forEach((id) => seen.add(id));
    const parents = (await things
      .find({ shareId: { $in: parentIds } } as any)
      .project({ shareId: 1, thingtime: 1, targetId: 1, 'crystal.subspaceId': 1 })
      .toArray()) as any[];
    const next = new Map<string, string[]>();
    for (const parent of parents) {
      const waiting = frontier.get(String(parent.shareId)) || [];
      const grandparentId = typeof parent.targetId === 'string' ? parent.targetId : null;
      const subspaceId = subspaceIdOfDoc(parent);
      if (!subspaceId && grandparentId && thingtimeOf(parent).includes('comment')) {
        for (const docId of waiting) waitOn(next, grandparentId, docId);
      } else {
        for (const docId of waiting) roots.set(docId, subspaceId);
      }
    }
    frontier = next;
  }
  return roots;
};

// an author's user flair in one subspace, from the page's batched member-row
// lookup, resolved against the embed's live templates (a renamed template
// updates every wearer; a deleted one keeps its snapshot)
const authorFlairFor = (flairs: AuthorFlairs, embed: SubspaceEmbed | null, subspaceId: string, userId: string): PublicAuthorFlair | null =>
  toPublicUserFlair(liveUserFlair(flairs.get(authorFlairKey(subspaceId, userId)) || null, embed?.userFlairs));

// Per-read projection options. `commentSort` (GET /api/v1/things?id=…&
// commentSort=top|new|old — round 2 S7) re-orders the SHIPPED comment page:
// null keeps the default (the newest RETURNED_COMMENTS, oldest → newest);
// `top` = votes.score desc then older-first, `new` / `old` = by createdAt.
// Level 1 is loaded whole per post (MAX_COMMENTS_PER_POST bounds it), so a
// sorted page is the true best / newest / oldest of the level. The deeper
// shipped levels are DB-sliced to the newest REPLIES_PER_LEVEL per parent
// before any score is known (resolveRelated), so they re-order among the
// replies that already ship rather than re-querying per parent — the
// non-intrusive half the spec allowed; the docs say so.
export type PostProjectionOptions = { commentSort?: CommentSort | null };

export const toPublicPosts = async (docs: ThingDoc[], viewerInput: string | Viewer, options: PostProjectionOptions = {}): Promise<PublicPost[]> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  const viewerId = viewer?.id || null;
  if (!docs.length) return [];
  const commentSort = options.commentSort ?? null;
  // a sorted page can ship ANY of the level's comments, so the legacy
  // embedded entries (a bounded v1 array) all need their authors resolved
  const embeddedPage = (doc: ThingDoc) => (commentSort ? doc.comments || [] : (doc.comments || []).slice(-RETURNED_COMMENTS));
  const things = await getThingsCollection();

  // one level of share resolution
  const shareTargets = [...new Set(docs.map((doc) => targetIdOf(doc)).filter(Boolean))] as string[];
  const originals = shareTargets.length
    ? ((await things.find(withMatch({ shareId: { $in: shareTargets } }, postThingMatch()) as any).toArray()) as any as ThingDoc[])
    : [];
  const originalsById = new Map(originals.map((doc) => [doc.shareId, doc]));

  const allDocs = [...docs, ...originals];
  // One batched pass each: interactions, whole-thread comment totals,
  // protected attachment metadata, and public view stats. Run them together
  // so neither attachments nor views add serial read latency.
	const [related, threadCounts, viewStats, savedIds] = await Promise.all([
    resolveRelated(allDocs, viewerId),
    resolveThreadCounts(allDocs.map((doc) => doc.shareId), viewerId),
    resolveViewStats(allDocs.map((doc) => doc.shareId)),
    // the viewer's library saves across the page (one query, never N+1);
    // anonymous viewers skip the read entirely and get no viewerSaved field
    viewer?.id ? savedTargetIds(viewer, allDocs.map((doc) => doc.shareId)) : Promise.resolve(new Set<string>())
  ]);
	const attachmentTargetIds = [
		...allDocs.map((doc) => doc.shareId),
		...Array.from(related.commentsByTarget.values()).flatMap((entries) => entries.flatMap((entry) => (entry.doc ? [entry.doc.shareId] : [])))
	];
	const expectedAttachmentTargets = new Map<string, { ownerId: string; purpose: 'post' | 'comment' }>(
		allDocs.map((doc) => [doc.shareId, { ownerId: String(doc.ownerId), purpose: 'post' as const }] as const)
	);
	for (const entries of related.commentsByTarget.values()) {
		for (const entry of entries) {
			if (entry.doc) expectedAttachmentTargets.set(entry.doc.shareId, { ownerId: String(entry.doc.ownerId), purpose: 'comment' });
		}
	}
  const userIds: string[] = [];
  [...docs, ...originals].forEach((doc) => {
    userIds.push(doc.ownerId);
    embeddedPage(doc).forEach((comment) => userIds.push(comment.userId));
  });
  // every standalone comment entry across all levels (level-2 replies included)
  for (const entries of related.commentsByTarget.values()) {
    entries.forEach((entry) => userIds.push(entry.userId));
  }
  // Comments wear the ROOT POST's subspace flair. A comment doc projected as
  // a root here (GET ?id=<comment> — a thread drill-down, a comment's own
  // /post/:id page) carries no crystal.subspaceId of its own, so its root
  // post is resolved in bounded batched hops — one $in per level up the
  // reply chain for the whole page, never a per-doc walk.
  const rootSubspaceByDocId = await resolveCommentRootSubspaces(things, allDocs);
  const rootSubspaceOf = (doc: ThingDoc): string | null => subspaceIdOfDoc(doc) ?? rootSubspaceByDocId.get(doc.shareId) ?? null;
  // author flairs: every (subspace, author) pair on the page — the post's
  // author plus every shipped comment level under it — ONE uniqueKeys $in,
  // never per doc
  const flairPairs: { subspaceId: string; userId: string }[] = [];
  const collectCommentAuthors = (parentId: string, subspaceId: string, depth: number) => {
    if (depth > 8) return;
    for (const entry of related.commentsByTarget.get(parentId) || []) {
      flairPairs.push({ subspaceId, userId: entry.userId });
      collectCommentAuthors(entry.id, subspaceId, depth + 1);
    }
  };
  for (const doc of allDocs) {
    const subspaceId = rootSubspaceOf(doc);
    if (!subspaceId) continue;
    flairPairs.push({ subspaceId, userId: doc.ownerId });
    embeddedPage(doc).forEach((comment) => flairPairs.push({ subspaceId, userId: comment.userId }));
    collectCommentAuthors(doc.shareId, subspaceId, 1);
  }
  // open-report counts: only for the subspace posts this viewer MODERATES
  // (the pairs are known from the roster already on the viewer), ONE $group
  // for the page — everyone else's read never touches the report rows
  const reportPairs: { subspaceId: string; postId: string }[] = [];
  for (const doc of allDocs) {
    const subspaceId = subspaceIdOfDoc(doc);
    if (subspaceId && canModerateSubspace(viewer?.subspaceRoles?.get(subspaceId) || null)) reportPairs.push({ subspaceId, postId: doc.shareId });
  }
  // Attachments and profiles both derive from `related`, but NOT from each
  // other — running them together keeps the second off the critical path.
  const [attachmentsByTarget, profiles, subspaces, authorFlairs, openReportCounts] = await Promise.all([
    resolvePostAttachments(attachmentTargetIds, expectedAttachmentTargets, viewerId),
    resolveProfiles(userIds),
    // subspace embeds for the page — one $in over the subspace kind. Keyed by
    // the ROOT subspace (rootSubspaceOf, not the doc's own pointer) so a
    // comment projected as the root still resolves its authorFlair against
    // the live templates: a renamed template follows the wearer on the
    // thread drill-down too, not only on the post page.
    loadSubspaceEmbeds(allDocs.map((doc) => rootSubspaceOf(doc)).filter(Boolean) as string[]),
    loadAuthorFlairs(flairPairs),
    loadOpenReportCounts(reportPairs)
  ]);
  const authorFlairOf = (subspaceId: string | null, userId: string): PublicAuthorFlair | null =>
    subspaceId ? authorFlairFor(authorFlairs, subspaces.get(subspaceId) || null, subspaceId, userId) : null;

  // comments share the post schema — surface the post vocabulary (rich
  // ["post","comment"] bodies, reactions, reply counts); legacy-era entries
  // (no doc) fall back to the text-only defaults. Recurses through the
  // preloaded reply levels (resolveRelated ships two).
  // the sort key of a loaded comment: its relational net score + age
  const sortableOf = (entry: CommentEntry) => ({
    entry,
    id: entry.id,
    createdAtMs: entry.createdAt.getTime(),
    score: commentSort === 'top' ? tallyUpdown(related.updownByTarget.get(entry.id) || [], null).score : 0
  });
  // one level's shipped page in the requested order (null = today's page)
  const pageOf = (entries: CommentEntry[], limit: number): CommentEntry[] =>
    commentSort ? orderCommentPage(entries.map(sortableOf), commentSort, limit).map((row) => row.entry) : entries.slice(-limit);
  const buildComment = (comment: CommentEntry, parentId: string, rootSubspaceId: string | null): PublicComment => {
    const commentCrystal = comment.doc ? crystalOf(comment.doc) : {};
    const commentReactions = related.reactionsByTarget.get(comment.id) || [];
    const loadedReplies = related.commentsByTarget.get(comment.id) || [];
    // every shipped reply stays shipped — a sort only re-orders the level
    const replies = commentSort ? pageOf(loadedReplies, loadedReplies.length) : loadedReplies;
    return {
      id: comment.id,
      thingtime: comment.doc ? thingtimeOf(comment.doc) : ['comment'],
      author: profiles.get(comment.userId) || null,
      type: (commentCrystal.type as PostType) || 'text',
      text: comment.text,
      richText:
        commentCrystal.richText && typeof commentCrystal.richText === 'object' && !Array.isArray(commentCrystal.richText)
          ? (commentCrystal.richText as Record<string, any>)
          : null,
      images: (commentCrystal.images as string[]) || [],
			attachments: attachmentsByTarget.get(comment.id) || [],
			mediaLayout: mediaLayoutOf(commentCrystal),
      listing: (commentCrystal.listing as MarketplaceListing) || null,
      thing:
        commentCrystal.thing && typeof commentCrystal.thing === 'object' && !Array.isArray(commentCrystal.thing)
          ? (commentCrystal.thing as Record<string, any>)
          : null,
      tags: comment.doc?.tags || [],
      reactionCounts: reactionCountsOf(commentReactions),
      viewerReactions: viewerReactionsOf(commentReactions, viewerId),
      votes: tallyUpdown(related.updownByTarget.get(comment.id) || [], viewerId),
      authorFlair: authorFlairOf(rootSubspaceId, comment.userId),
      commentCount: related.commentCountByTarget.get(comment.id) || 0,
      comments: replies.map((reply) => buildComment(reply, comment.id, rootSubspaceId)),
      targetId: parentId,
      createdAt: comment.createdAt.toISOString()
    };
  };

  const project = (doc: ThingDoc, withShare: boolean): PublicPost => {
    const crystal = crystalOf(doc);
    // external posts (api/utils/connections) are owned by 'system' — no
    // Thingtime profile resolves — so their third-party author surfaces from
    // the synced extended.external envelope on every read path (feed,
    // permalink, thread root)
    const external = thingtimeOf(doc).includes('external-post') ? (doc.extended as any)?.external : null;
    const externalAuthor: FeedAuthor | null = external?.author
      ? {
          id: `ext:${external.provider || 'unknown'}:${external.author.handle || external.author.name || 'unknown'}`,
          username: String(external.author.handle || external.author.name || external.providerName || 'external'),
          displayName: external.author.name || external.author.handle || external.providerName || null,
          temporary: false,
          // Scheme-checked on the way out as well as on the way in: the
          // connections sync guards these (connections.ts), but this
          // projection is what PostCard turns into <a href>/<img src>, so a
          // row synced before that guard existed must not be able to render a
          // `javascript:` target. Belt and braces on the boundary that matters.
          avatarUrl: safeExternalLink(external.author.avatarUrl),
          externalUrl: safeExternalLink(external.author.url) || safeExternalLink(external.url)
        }
      : null;
    const allComments = mergedCommentsOf(doc, related);
    const rootSubspaceId = rootSubspaceOf(doc);
    const comments = pageOf(allComments, RETURNED_COMMENTS).map((comment) => buildComment(comment, doc.shareId, rootSubspaceId));
    // the counter reports the WHOLE thread: v2 descendants via $graphLookup
    // plus the legacy-era entries (no doc) that graph traversal can't see
    const totalComments = (threadCounts.get(doc.shareId) ?? 0) + allComments.filter((entry) => !entry.doc).length;
    const reactions = mergedReactionsOf(doc, related);

    const shareTarget = targetIdOf(doc);
    // only SHARES nest their target — a comment doc projected through here
    // (its /post/:id page) must not render its parent as a pseudo-share
    const original = withShare && shareTarget && thingtimeOf(doc).includes('share') ? originalsById.get(shareTarget) : null;

    // subspace vocabulary: embed + flair + moderation state. A REMOVED post is
    // redacted (body, media, title) for everyone but its author and the
    // subspace's moderators — the doc still projects so the card can say
    // "removed by moderators" in place instead of vanishing mid-thread.
    const subspaceId = subspaceIdOfDoc(doc);
    const subspaceEmbed = subspaceId ? subspaces.get(subspaceId) || null : null;
    const subspaceMembership = subspaceId ? viewer?.subspaceRoles?.get(subspaceId) || null : null;
    const viewerCanModerate = canModerateSubspace(subspaceMembership);
    const modState = doc.subspaceMod || null;
    const removed = modState?.status === 'removed';
    const viewerOwns = !!viewerId && doc.ownerId === viewerId;
    const redacted = removed && !viewerOwns && !viewerCanModerate;
    const flairId = typeof crystal.flairId === 'string' ? crystal.flairId : null;
    const flairEntry = subspaceEmbed && flairId ? subspaceEmbed.flairs.find((entry) => entry.id === flairId) || null : null;
    const subspaceMod: PublicSubspaceMod | null = subspaceId
      ? {
          status: removed ? 'removed' : 'approved',
          removed,
          reason: removed && !redacted ? modState?.reason ?? null : null,
          removedAt: removed && modState?.removedAt ? new Date(modState.removedAt).toISOString() : null,
          pinned: modState?.pinned === true,
          locked: modState?.locked === true,
          nsfw: modState?.nsfw === true || subspaceEmbed?.nsfw === true,
          spoiler: modState?.spoiler === true,
          viewerCanModerate,
          // the 🚩 count is the mods' business only
          ...(viewerCanModerate ? { reportCount: openReportCounts.get(doc.shareId) || 0 } : {})
        }
      : null;

    // poll posts carry their live tally (votes were fetched in the same
    // batched resolveRelated pass as comments/reactions — no extra query)
    const pollShape = pollShapeOfCrystal(crystal);
    const pollVotes = pollShape ? tallyPollVotes(pollShape.optionCount, related.votesByTarget.get(doc.shareId) || [], viewerId) : null;

    return {
      id: doc.shareId,
      thingtime: thingtimeOf(doc),
      type: (crystal.type as PostType) || 'text',
      author: externalAuthor || profiles.get(doc.ownerId) || null,
      visibility: visibilityFromAcl(aclOf(doc)) as PostVisibility,
      acl: aclOf(doc),
      text: redacted ? '' : String(crystal.text || ''),
      richText:
        !redacted && crystal.richText && typeof crystal.richText === 'object' && !Array.isArray(crystal.richText)
          ? (crystal.richText as Record<string, any>)
          : null,
      images: redacted ? [] : (crystal.images as string[]) || [],
			attachments: redacted ? [] : attachmentsByTarget.get(doc.shareId) || [],
			mediaLayout: mediaLayoutOf(crystal),
      listing: redacted ? null : (crystal.listing as MarketplaceListing) || null,
      thing: !redacted && crystal.thing && typeof crystal.thing === 'object' && !Array.isArray(crystal.thing) ? (crystal.thing as Record<string, any>) : null,
      tags: doc.tags || [],
      reactionCounts: reactionCountsOf(reactions),
      viewerReactions: viewerReactionsOf(reactions, viewerId),
      votes: tallyUpdown(related.updownByTarget.get(doc.shareId) || [], viewerId),
      title: redacted ? null : typeof crystal.title === 'string' && crystal.title ? crystal.title : null,
      subspace: subspaceEmbed
        ? {
            id: subspaceEmbed.id,
            slug: subspaceEmbed.slug,
            name: subspaceEmbed.name,
            icon: subspaceEmbed.icon,
            iconUrl: subspaceEmbed.iconUrl,
            accent: subspaceEmbed.accent,
            access: subspaceEmbed.access,
            nsfw: subspaceEmbed.nsfw,
            // a pending join request holds no role (same predicate as the
            // subspace detail's viewer.role — never 'member' for a requester)
            viewerRole: isActiveSubspaceMember(subspaceMembership) ? subspaceMembership!.role : null
          }
        : null,
      flair: flairEntry ? { id: flairEntry.id, label: flairEntry.label, emoji: flairEntry.emoji, color: flairEntry.color } : null,
      authorFlair: authorFlairOf(rootSubspaceId, doc.ownerId),
      subspaceMod,
      commentCount: totalComments,
      commentCounts: layeredPostCommentCounts(allComments.length, totalComments, comments.length),
      comments,
      shareCount: liveShareCountOf(doc, related),
      isShare: !!shareTarget && thingtimeOf(doc).includes('share'),
      // only surface originals the viewer is allowed to see
      shareOf: original && canView(original, viewer) ? project(original, false) : null,
      viewCount: viewStats.get(doc.shareId)?.viewCount || 0,
      viewStats: (() => {
        const stats = viewStats.get(doc.shareId);
        return {
          impressions: stats?.impressions || 0,
          avgDwellMs: stats?.viewCount ? Math.round(stats.totalDwellMs / stats.viewCount) : 0
        };
      })(),
      ...(pollVotes ? { pollVotes } : {}),
      // viewer-personalised like viewerReactions — logged-out viewers get no
      // field at all (nothing to bookmark without a library)
      ...(viewerId ? { viewerSaved: savedIds.has(doc.shareId) } : {}),
      extended: doc.extended ?? null,
      createdAt: new Date(doc.createdAt).toISOString()
    };
  };

  return docs.map((doc) => project(doc, true));
};

export const toPublicThings = async (docs: ThingDoc[], viewerInput: string | Viewer): Promise<PublicThing[]> => {
  if (!docs.length) return [];
  const viewer = asViewer(viewerInput);
  const profiles = await resolveProfiles(docs.map((doc) => doc.ownerId));
  return docs.map((doc) => {
    // token grants are owner-facing management data, not audience — only the
    // owner's own credentials (session or their tokens) see them
    const tokenAcl = viewer?.id && viewer.id === doc.ownerId ? tokenAclOf(doc) : [];
    // the hidden-link secret is owner-facing too, and only meaningful while
    // the acl still says hidden
    const linkKey =
      viewer?.id && viewer.id === doc.ownerId && typeof doc.linkKey === 'string' && doc.linkKey && aclOf(doc).includes(ACL_HIDDEN)
        ? doc.linkKey
        : null;
    return {
      id: doc.shareId,
      thingtime: thingtimeOf(doc),
      author: profiles.get(doc.ownerId) || null,
      visibility: visibilityFromAcl(aclOf(doc)),
      acl: aclOf(doc),
      ...(linkKey ? { linkKey } : {}),
      targetId: targetIdOf(doc),
      folderId: folderIdOf(doc),
      crystal: crystalOf(doc),
      extended: doc.extended ?? null,
      tags: doc.tags || [],
      ...(tokenAcl.length ? { tokenAcl } : {}),
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString()
    };
  });
};

// ---------------------------------------------------------------------------
// Permissions: acl entries decide who can view (see schemas/registry.ts for
// the grammar + most-specific-wins evaluation). Owners always see their own
// things. Target-attached things carry ['tt:inherit'] and are as visible as
// their target. v1 residue docs still carry the visibility enum — aclOf maps
// it so one evaluation path serves both eras.

const aclOf = (doc: ThingDoc): string[] => (Array.isArray(doc.acl) && doc.acl.length ? doc.acl : aclFromVisibility(doc.visibility) || [ACL_OWNER]);

export const canView = (doc: ThingDoc, viewer: Viewer): boolean => {
	// Operational diagnostics have a stricter boundary than ordinary private
	// Things: only the dedicated current-admin endpoint may decode/read them.
	if (thingtimeOf(doc).includes(MIGRATION_DIAGNOSTIC_THINGTIME)) return false;
	// Moderation-blocked things vanish from every ordinary read for everyone —
	// owner included, same as blocked attachments. Admins review through the
	// moderationFlag queue (which carries a bounded excerpt), never this path.
	if (attachmentIsBlocked(doc as any)) return false;
	// Text-moderation PENDING = born private: the owner sees their own post
	// while it waits for a verdict (omni outage / async-release mode); nobody
	// else does until the screen releases it. Kind-scoped so in-flight
	// ATTACHMENT analysis (also status pending) keeps today's visibility.
	if (
		attachmentModerationStatus(doc as any) === 'pending' &&
		thingtimeOf(doc).some((kind) => TEXT_MODERATED_THINGTIMES.has(kind)) &&
		doc.ownerId !== viewer?.id
	) {
		return false;
	}
  // The token visibility fence outranks even the owner short-circuit: a
  // public-only token acting AS the owner must still not see the owner's
  // private things (inherit acls are judged on their resolved terminal via
  // canViewInherited; a direct hit on one fails closed).
  if (patVisibilityBlocksAcl(viewer, aclOf(doc))) return false;
  // hidden (unlisted) things: the random link key IS the audience — anyone
  // presenting it may view, logged out included. The key only grants while
  // the acl still says hidden, so un-hiding instantly retires shared links.
  if (
    viewer?.linkKeys?.size &&
    typeof doc.linkKey === 'string' &&
    doc.linkKey &&
    viewer.linkKeys.has(doc.linkKey) &&
    aclOf(doc).includes(ACL_HIDDEN)
  ) {
    return true;
  }
  if (viewer?.id && doc.ownerId === viewer.id) return true;
  // private-subspace posts are fenced to that subspace's active members and
  // moderators (the enriched viewer carries the roster; a bare viewer fails
  // closed — comments/reactions inherit the fence through their chain)
  if (doc.subspacePrivate === true) {
    const subspaceId = subspaceIdOfDoc(doc);
    const membership = subspaceId ? viewer?.subspaceRoles?.get(subspaceId) || null : null;
    if (!isActiveSubspaceMember(membership) && !canModerateSubspace(membership)) return false;
  }
  // the doc's own shareId rides along for the constant tt:extsourced audience,
  // whose membership is per-(post, viewer) rather than per-entry
  return aclAllows(aclOf(doc), viewer, doc.ownerId, doc.shareId);
};

// ---------------------------------------------------------------------------
// Custom audiences — tt:custom flips a thing into capability mode: the acl's
// baseline entries (tt:all / tt:hidden / nothing) say who may READ, and the
// per-user / per-group grants (tt:user/<name>[/comment|/write],
// tt:group/<id>[…]) say who may do MORE. Engagement (comment, react, share)
// needs at least the comment capability; shared editing (PATCH crystal) needs
// write. Saves are exempt — a save is a private bookmark that reveals nothing
// to anyone else. Non-custom things are byte-for-byte unchanged: every
// viewer keeps today's engage-if-you-can-see rule.

const customEngageBlocksAcl = (viewer: Viewer, acl: string[], ownerId: string): boolean => {
  if (!acl.includes(ACL_CUSTOM)) return false;
  const cap = aclCapabilityFor(acl, viewer, ownerId);
  return cap !== 'comment' && cap !== 'write';
};

// engagement targets can be inherit-acl children (replying to a comment under
// a custom post) — judge the chain terminal, with the viewer's friend/group
// sets loaded so grants can match
const customEngageBlocks = async (viewer: Viewer, doc: ThingDoc): Promise<boolean> => {
  const terminal = aclOf(doc).includes(ACL_INHERIT)
    ? await resolveInheritChain(doc, (d) => aclOf(d).includes(ACL_INHERIT), findThing)
    : doc;
  if (!terminal) return true; // broken chain fails closed
  if (!aclOf(terminal).includes(ACL_CUSTOM)) return false;
  const enriched = await withFriendIds(viewer);
  return customEngageBlocksAcl(enriched, aclOf(terminal), String(terminal.ownerId));
};

const customEngageFail = (): Fail =>
  fail(403, 'This thing has a custom audience — you don’t have comment access here 🎭');

// ---------------------------------------------------------------------------
// External-sourced audiences (api/utils/connections). A synced personal
// external post carries the CONSTANT acl entry tt:extsourced: the acl names no
// account, and membership is resolved LIVE per (post, viewer) against the
// viewer's account links → that post's external-post-source rows, so unlinking
// revokes instantly with no grant sweep to run. Rows the
// relational-external-post-sources migration has not reached still carry the
// legacy per-source tt:extacct/<accountId> grants, answered by the viewer's
// linked account ids.
//
// Both answers load lazily (most reads never meet an external post) and
// memoise ON THE VIEWER OBJECT — one request path — so a page of posts, and a
// whole comment chain converging on one external post, cost one links query
// plus one membership probe per post. The memo holds the in-flight PROMISE,
// never a bare "already asked" flag: canView reads the resolved set
// synchronously and an unloaded set denies (deliberately, like friendIds), so
// a second caller arriving mid-query must await the same answer instead of
// evaluating against a set that has not landed yet.

// connections.ts owns these kind names; spelling them out here keeps the acl
// path free of an import cycle (connections.ts imports this module).
const EXTERNAL_LINK_THINGTIME = 'external-account-link';
const EXTERNAL_POST_SOURCE_THINGTIME = 'external-post-source';

type ExtAudienceMemo = { accountIds?: Promise<ReadonlySet<string>>; posts: Map<string, Promise<boolean>> };
const extAudienceMemos = new WeakMap<object, ExtAudienceMemo>();
const extAudienceMemoOf = (viewer: object): ExtAudienceMemo => {
  const existing = extAudienceMemos.get(viewer);
  if (existing) return existing;
  const created: ExtAudienceMemo = { posts: new Map() };
  extAudienceMemos.set(viewer, created);
  return created;
};

const hasExtSourcedAudience = (doc: ThingDoc): boolean => aclOf(doc).includes(ACL_EXT_SOURCED);
const hasExtacctAudience = (doc: ThingDoc): boolean => aclOf(doc).some((entry) => entry.includes(ACL_EXTACCT_PREFIX));

// The external accounts this viewer has linked — HOME collection, because the
// links are authorization records that must not follow a custom data plane.
const ensureExtAccountIds = async (viewer: Viewer): Promise<ReadonlySet<string>> => {
  if (!viewer?.id) return new Set<string>();
  const memo = extAudienceMemoOf(viewer);
  if (!memo.accountIds) {
    memo.accountIds = (async () => {
      const home = await getHomeThingsCollection();
      const links = (await home
        .find({ thingtime: EXTERNAL_LINK_THINGTIME, ownerId: viewer.id } as any, {
          projection: { parentId: 1, 'crystal.accountId': 1 }
        } as any)
        .toArray()) as any[];
      // the account rides both the relational parentId and crystal.accountId
      return new Set(links.map((link) => String(link?.crystal?.accountId || link?.parentId || '')).filter(Boolean));
    })();
  }
  const accountIds = await memo.accountIds;
  viewer.extAccountIds = accountIds;
  return accountIds;
};

// Does this viewer source THIS external post? One membership probe per post,
// shared by every concurrent caller through the memoised promise.
const ensureExtSourced = async (viewer: Viewer, postShareId: string | null | undefined): Promise<void> => {
  if (!viewer?.id || !postShareId) return;
  const memo = extAudienceMemoOf(viewer);
  let answer = memo.posts.get(postShareId);
  if (!answer) {
    answer = (async () => {
      const accountIds = await ensureExtAccountIds(viewer);
      // links are the authorization: no links, no membership, no probe
      if (!accountIds.size) return false;
      const things = await getThingsCollection();
      const row = await things.findOne(
        {
          targetId: postShareId,
          thingtime: EXTERNAL_POST_SOURCE_THINGTIME,
          parentId: { $in: [...accountIds] }
        } as any,
        { projection: { _id: 1 } } as any
      );
      return !!row;
    })();
    memo.posts.set(postShareId, answer);
  }
  if (await answer) primeExtSourcedPostIds(viewer, [postShareId]);
};

// The connections feed pages the membership rows itself, so it already knows
// the viewer sources every post on the page — priming the viewer with that
// answer keeps acl evaluation query-free on the way out.
export const primeExtSourcedPostIds = (viewer: Viewer, postShareIds: readonly string[]): void => {
  if (!viewer?.id || !postShareIds.length) return;
  const sourced = new Set(viewer.extSourcedPostIds || []);
  const memo = extAudienceMemoOf(viewer);
  for (const postShareId of postShareIds) {
    if (!postShareId) continue;
    sourced.add(postShareId);
    memo.posts.set(postShareId, Promise.resolve(true));
  }
  viewer.extSourcedPostIds = sourced;
};

// Target-attached things resolve visibility through their inherit chain (see
// aclChainCore for the cycle-safe walk — legitimate deep comment chains must
// never be cut off, only cycles and broken/missing targets fail closed). The
// sole exception is an unrestricted owner opening their own orphaned media:
// the object remains private to its owner, but must stay recoverable from its
// direct permalink when a historic parent has disappeared. No audience or PAT
// session can use that recovery path.
// `findByShareId` is injectable so page-sized callers can share a batched
// lookup; the default stays the plain per-hop findOne.
export const canViewInherited = async (
  doc: ThingDoc,
  viewer: Viewer,
  findByShareId: (shareId: string) => Promise<ThingDoc | null> = findThing
): Promise<boolean> => {
	// the blocked/pending gates apply to the doc ITSELF, not just its inherit
	// terminal — a blocked or born-private comment under a clean post must
	// vanish for non-owners too
	if (attachmentIsBlocked(doc as any)) return false;
	if (
		attachmentModerationStatus(doc as any) === 'pending' &&
		thingtimeOf(doc).some((kind) => TEXT_MODERATED_THINGTIMES.has(kind)) &&
		doc.ownerId !== viewer?.id
	) {
		return false;
	}
  const terminal = await resolveInheritChain(doc, (d) => aclOf(d).includes(ACL_INHERIT), findByShareId);
  if (terminal) {
    // tt:extsourced / legacy tt:extacct/ audiences (synced external posts and
    // their comment chains) resolve live against the viewer's connections —
    // loaded lazily here and memoised on the viewer object for the request path
    if (hasExtSourcedAudience(terminal)) await ensureExtSourced(viewer, terminal.shareId);
    if (hasExtacctAudience(terminal)) await ensureExtAccountIds(viewer);
    return canView(terminal, viewer);
  }

  // Attachments are independently stored media objects. If a parent was
  // deleted or a legacy migration left the relation dangling, preserve an
  // owner-only recovery route rather than turning the original bytes into an
  // inaccessible orphan. Keep all other inherited children fail-closed and
  // never bypass a visibility-scoped personal access token.
  return (
    thingtimeOf(doc).includes('attachment') &&
    !!viewer?.id &&
    doc.ownerId === viewer.id &&
    !patVisibilityOf(viewer)
  );
};

// Mutation-site visibility-fence check with the inherit chain resolved —
// updateThing and deleteThing load their target by ownership (never through
// canView), so they ask this directly. Free for unrestricted viewers; broken
// chains fail closed like canViewInherited.
const patVisibilityBlocksDoc = async (viewer: Viewer, doc: ThingDoc): Promise<boolean> => {
  if (!patVisibilityOf(viewer)) return false;
  const terminal = await resolveInheritChain(doc, (d) => aclOf(d).includes(ACL_INHERIT), findThing);
  return !terminal || patVisibilityBlocksAcl(viewer, aclOf(terminal));
};

// Coalescing, memoised shareId lookup for one request: every lookup issued in
// the same microtask tick collapses into a single $in query, and results
// (including misses) cache for the request's lifetime. A listing page checking
// N attached things therefore costs one round trip per chain LEVEL instead of
// one per doc×hop — the per-doc walks were fine locally but timed the /things
// function out in production, where each Mongo round trip crosses regions
// (~200ms Vercel iad1 ↔ Atlas Sydney).
export const batchedThingLookup = (): ((shareId: string) => Promise<ThingDoc | null>) => {
  const cache = new Map<string, Promise<ThingDoc | null>>();
  let pending: { ids: Set<string>; promise: Promise<Map<string, ThingDoc>> } | null = null;
  return (shareId: string) => {
    const hit = cache.get(shareId);
    if (hit) return hit;
    if (!pending) {
      const batch = { ids: new Set<string>() } as { ids: Set<string>; promise: Promise<Map<string, ThingDoc>> };
      batch.promise = Promise.resolve().then(async () => {
        // the microtask runs after every same-tick caller has added its id
        pending = null;
        const things = await getThingsCollection();
        const docs = (await things.find({ shareId: { $in: [...batch.ids] } } as any).toArray()) as any as ThingDoc[];
        return new Map(docs.map((doc) => [doc.shareId, doc]));
      });
      pending = batch;
    }
    pending.ids.add(shareId);
    const result = pending.promise.then((map) => map.get(shareId) || null);
    cache.set(shareId, result);
    return result;
  };
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
      // $nin on an array field means "contains none of these". ACL_HIDDEN and
      // ACL_CUSTOM are excluded too: neither carries a broad grant, so without
      // them every unlisted 🕵️ and custom-audience 🎭 thing would ALSO answer
      // the 'private' chip — each is its own circle below.
      return {
        $or: [{ acl: { $exists: true, $nin: [ACL_ALL, ACL_FRIENDS, ACL_FAMILY, ACL_HIDDEN, ACL_CUSTOM] } }, { visibility: 'private' }]
      };
    case 'hidden':
      // v2-only (no legacy enum era) — reachable only by explicit circle
      // filters; 'hidden' is deliberately NOT in the default VISIBILITIES set
      return { acl: ACL_HIDDEN };
    case 'custom':
      // v2-only, explicit-filter-only, exactly like hidden
      return { acl: ACL_CUSTOM };
  }
};

// DB-level fence for visibility-restricted tokens — a coarse superset like
// every clause here (exact judgement stays with canView/canViewInherited on
// the fetched page). Inherit-acl children pass the public fence explicitly so
// their terminal can be judged in memory; they pass the private $nor
// naturally (they never carry tt:all themselves). Exported so the test can pin
// the clause against patVisibilityBlocksAcl: if this coarse tier ever stops
// covering what the exact tier admits, listings silently lose rows.
export const patVisibilityMatchClause = (viewer: Viewer): Record<string, any> | null => {
  const mode = patVisibilityOf(viewer);
  if (!mode) return null;
  if (mode === 'hidden') return { $or: [{ acl: ACL_HIDDEN }, { acl: ACL_INHERIT }] };
  return mode === 'public' ? { $or: [circleClause('public'), { acl: ACL_INHERIT }] } : { $nor: [circleClause('public')] };
};

export const visibilityQueryFor = (viewer: Viewer, circles: PostVisibility[]) => {
  const wanted = circles.length ? circles : VISIBILITIES;
  const publicWanted = wanted.includes('public');

  const clauses: any[] = [];
  if (publicWanted) clauses.push(circleClause('public'));
  // friends-only posts from users the viewer is an accepted friend of — the
  // DB match is a superset; exact evaluation (exclusions etc.) stays with
  // canView on the fetched page. Requires an enriched viewer (withFriendIds).
  if (viewer?.id && viewer.friendIds?.size && wanted.includes('friends')) {
    clauses.push({ $and: [{ ownerId: { $in: [...viewer.friendIds] } }, circleClause('friends')] });
  }
  // The unnarrowed shortcut is only sound when the caller asked for NO filter,
  // or asked for every circle they could ask for. A bare length comparison
  // would also fire for a same-sized but different selection (say
  // public+friends+family+hidden), silently pulling the viewer's private
  // things back into a feed they filtered them out of — and covering only the
  // DEFAULT set has the same shape of bug one circle over: ticking exactly
  // public+friends+family+private (i.e. everything except 🕵️ Hidden) would
  // take the shortcut and hand back the hidden things the caller just
  // excluded. An omitted circle must always really be omitted, so only the two
  // genuinely unfiltered cases skip narrowing (fleet review fix, extended for
  // 🎭).
  const unfiltered = !circles.length || REQUESTABLE_VISIBILITIES.every((circle) => wanted.includes(circle));
  const narrowToWanted = (clause: Record<string, any>) =>
    unfiltered ? clause : { $and: [clause, { $or: wanted.map((circle) => circleClause(circle)) }] };
  if (viewer?.id) {
    // the viewer's own things, optionally narrowed to the requested circles
    clauses.push(
      unfiltered ? { ownerId: viewer.id } : { ownerId: viewer.id, $or: wanted.map((circle) => circleClause(circle)) }
    );
  }
  // Things granted to the viewer BY NAME or through a group (custom
  // audiences: tt:user/<name>[/cap], tt:group/<id>[/cap]) land in their feed
  // too — the DB match is a superset; canView judges the fetched page exactly.
  // Gated on the circle filter like every other clause above: an unfiltered
  // feed carries grants, but once the caller narrows, grants ride the 🎭
  // Custom chip alone (every granted thing is a tt:custom thing), so omitting
  // that circle really omits them instead of leaking them back in. The clause
  // that survives that gate is then narrowed to the requested circles for the
  // same reason the own-things clause is: a grant must not smuggle a 🎭 thing
  // into a 🌐-only filter.
  const grantsWanted = !circles.length || wanted.includes('custom');
  if (viewer?.id && grantsWanted && (viewer.username || viewer.groupIds?.size)) {
    const grantEntries: string[] = [];
    if (viewer.username) {
      const base = `${ACL_USER_PREFIX}${viewer.username.toLowerCase()}`;
      grantEntries.push(base, `${base}/comment`, `${base}/write`);
    }
    for (const groupId of viewer.groupIds || []) {
      const base = `${ACL_GROUP_PREFIX}${groupId}`;
      grantEntries.push(base, `${base}/comment`, `${base}/write`);
    }
    if (grantEntries.length) clauses.push(narrowToWanted({ acl: { $in: grantEntries } }));
  }
  // nothing requested that the viewer could ever see
  if (!clauses.length) return null;
  const query = clauses.length === 1 ? clauses[0] : { $or: clauses };
  const fence = patVisibilityMatchClause(viewer);
  return fence ? { $and: [query, fence] } : query;
};

const findThing = async (shareId: unknown): Promise<ThingDoc | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const things = await getThingsCollection();
  return (await things.findOne({ shareId: shareId.trim() } as any)) as any as ThingDoc | null;
};

// exported for the dedicated engagement utils that live outside this module
// (things/vote.ts) — the ONE visibility gate every interaction path shares
export const findViewableThing = async (shareId: unknown, viewer: Viewer): Promise<ThingDoc | null> => {
  const doc = await findThing(shareId);
  // friend enrichment happens here so every interaction path (react, comment,
  // share, save, view) resolves friends-only targets for real friends
  if (!doc || !(await canViewInherited(doc, await withFriendIds(viewer)))) return null;
  return doc;
};

// ---------------------------------------------------------------------------
// The app lens (full-power app namespaces — apps/namespace.ts owns the
// semantics). When a things read/write is driven by an app token, an
// AppNamespaceScope rides along and REPLACES the first-party visibility
// model: membership is the server-stamped root appId (never inferred from
// acl), the owner short-circuit applies only inside the namespace, cross-user
// docs additionally need a live sharing author, and projections are shaped by
// each author's own consent grant. First-party calls pass no lens and are
// byte-for-byte unchanged.

export type AppLens = AppNamespaceScope | null | undefined;

// Namespace membership only (appId + sandbox fence) — audience judged apart,
// because inherit-acl children derive their audience from their terminal
// ancestor, exactly like the first-party model.
const appMembershipOk = (app: AppNamespaceScope, doc: ThingDoc): boolean => {
  if (!doc || doc.appId !== app.appId) return false;
  const own = String(doc.ownerId) === app.ownerId;
  if (app.sandbox) {
    const pooled = !!app.sandbox.space && doc.sandboxSpace === app.sandbox.space;
    if (!own && !pooled) return false;
  } else if (doc.sandboxExpiresAt !== undefined && doc.sandboxExpiresAt !== null) {
    return false; // sandbox junk written under a real clientId
  }
  return true;
};

// Exact namespace verdict WITHOUT the author-liveness gate: membership, then
// audience resolved through the inherit chain (a comment on a shared app
// thing is as visible as that thing; a chain that escapes the namespace or
// breaks fails closed).
const appNamespaceVerdict = async (app: AppNamespaceScope, doc: ThingDoc): Promise<boolean> => {
	// moderation-blocked docs are invisible under app lenses too — this path
	// never reaches canView, so it needs its own gate; born-pending docs are
	// visible only when the lens acts for their owner
	if (attachmentIsBlocked(doc as any)) return false;
	if (
		attachmentModerationStatus(doc as any) === 'pending' &&
		thingtimeOf(doc).some((kind) => TEXT_MODERATED_THINGTIMES.has(kind)) &&
		String(doc.ownerId) !== app.ownerId
	) {
		return false;
	}
  if (!appMembershipOk(app, doc)) return false;
  let judged: ThingDoc = doc;
  if (aclOf(doc).includes(ACL_INHERIT)) {
    const terminal = await resolveInheritChain(doc, (d) => aclOf(d).includes(ACL_INHERIT), findThing);
    if (!terminal || !appMembershipOk(app, terminal)) return false;
    judged = terminal;
  }
  if (String(doc.ownerId) === app.ownerId && String(judged.ownerId) === app.ownerId) return true;
  // anything cross-user (the doc or its terminal) needs the shared grant and
  // an app-audience terminal (or a terminal the acting user owns)
  if (!app.sharedRead) return false;
  return String(judged.ownerId) === app.ownerId || aclOf(judged).includes(appAclEntry(app.appId));
};

// Single-doc verdict under the lens: namespace verdict, then (for another
// user's doc) the author-liveness gate.
const appCanViewLive = async (app: AppNamespaceScope, doc: ThingDoc): Promise<boolean> => {
  if (!(await appNamespaceVerdict(app, doc))) return false;
  if (String(doc.ownerId) === app.ownerId) return true;
  return (await filterByLiveAuthors(app, [doc])).length > 0;
};

const findViewableThingAs = async (shareId: unknown, viewer: Viewer, app: AppLens): Promise<ThingDoc | null> => {
  if (!app) return findViewableThing(shareId, viewer);
  const doc = await findThing(shareId);
  if (!doc || !(await appCanViewLive(app, doc))) return null;
  return doc;
};

// Page-level verdict: exact namespace verdict per doc (inherit chains
// resolved), then ONE batched author-liveness gate for the page.
export const appVisiblePage = async (app: AppNamespaceScope, page: ThingDoc[]): Promise<ThingDoc[]> => {
  const verdicts = await Promise.all(page.map((doc) => appNamespaceVerdict(app, doc)));
  return filterByLiveAuthors(
    app,
    page.filter((_, index) => verdicts[index])
  );
};

// The Mongo conjunction every app-lens query carries — the coarse tier
// (namespace.appNamespaceClauses is the single source; the exact tier is
// appVisiblePage / appCanViewLive above).
export const appMatchClauses = appNamespaceClauses;

// Post-process projections for app consumers: every author (the acting user
// included) is shaped by the relevant grant — id + username always,
// displayName/avatar only when that author granted them (the exact
// /oauth/userinfo + KV-shared-feed consent model) — and the raw acl narrows
// to the entries the app may know about (its own audience entry, the owner
// marker, inherit), so an app can never enumerate which OTHER apps its user
// runs.
export const appShapeProjections = async (
  app: AppNamespaceScope,
  docs: ThingDoc[],
  items: Array<{ author: FeedAuthor | null; acl?: string[]; visibility?: string }>
): Promise<void> => {
  const crossIds = [...new Set(docs.map((doc) => String(doc.ownerId)).filter((id) => id !== app.ownerId))];
  let scopesById = new Map<string, string[]>();
  const sandboxNames = new Map<string, string>();
  if (crossIds.length) {
    if (app.sandbox) {
      if (app.sandbox.space) {
        const live = await liveSandboxAuthors(app.appId, app.sandbox.space, crossIds);
        for (const [id, info] of live) {
          scopesById.set(id, info.scopes);
          sandboxNames.set(id, info.username);
        }
      }
    } else {
      scopesById = await liveSharingAuthors(app.appId, crossIds);
    }
  }

  const ownEntry = appAclEntry(app.appId);
  docs.forEach((doc, index) => {
    const item = items[index];
    if (!item) return;
    const ownerId = String(doc.ownerId);
    const self = ownerId === app.ownerId;
    const scopes = self ? app.scopes : scopesById.get(ownerId) || [];
		const username = self ? app.username : sandboxNames.get(ownerId) ?? item.author?.username;
    item.author = username
      ? {
          id: ownerId,
          username,
          displayName: scopeCovers(scopes, 'profile.displayName')
            ? sandboxNames.has(ownerId) || (self && app.sandbox)
              ? sandboxDisplayName(username)
							: item.author?.displayName ?? null
            : null,
					avatarUrl: scopeCovers(scopes, 'profile.avatar') ? item.author?.avatarUrl ?? null : null
        }
      : null;
    if (Array.isArray(item.acl)) {
      // the wire visibility matches the KV surface's derived sugar: 'app'
      // when the acl carries this app's audience entry, else 'private'
      // ('inherit' passes through for attached things)
      if (item.visibility !== 'inherit') {
        item.visibility = item.acl.includes(ownEntry) ? 'app' : 'private';
      }
      item.acl = item.acl.filter((entry) => entry === ACL_OWNER || entry === ACL_INHERIT || entry === ownEntry);
    }
  });
};

const countCommentsOf = async (
	target: ThingDoc,
	options: { includeBlocked?: boolean; viewerId?: string | null } = {}
): Promise<number> => {
  const things = await getThingsCollection();
	// visible counts must match what the read paths render (blocked comments
	// are excluded everywhere); the comment CAP passes includeBlocked because
	// it doubles as a physical per-post doc bound
	const blockedClause = options.includeBlocked ? {} : visibleRelatedModerationClause(options.viewerId ?? null);
  const [standalone, legacyRelational] = await Promise.all([
    things.countDocuments(withMatch({ targetId: target.shareId, thingtime: 'comment' }, blockedClause) as any),
    things.countDocuments(withMatch({ kind: 'comment', parentId: target.shareId }, blockedClause) as any)
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
    (await things.countDocuments({ targetId: targetShareId, thingtime: 'reaction', 'crystal.emoji': token } as any, { limit: 1 })) ||
    (await things.countDocuments({ kind: 'reaction', parentId: targetShareId, token } as any, { limit: 1 }));
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
  // public tag feeds (claude-todo/10 ✨): narrow to posts carrying one tag.
  // Normalized like sanitizeTags (trim/lowercase/cap) so the filter always
  // speaks the stored vocabulary.
  tag?: string | null;
  from?: Date | null;
  to?: Date | null;
  cursor?: string | null;
  limit?: number;
  weights?: AlgorithmWeights | null;
  // 'subspaces' narrows to posts from the viewer's ACTIVE subspaces (a
  // guest / non-member gets an empty page); default 'all'. The route
  // validates the raw param — an unknown scope is its 400.
  scope?: FeedScope | null;
};

// The subspace ids an enriched viewer is an ACTIVE member of — what
// scope=subspaces narrows the home feed to (pending / left / banned rows
// are not memberships, same predicate as the private-subspace fence).
export const activeSubspaceIdsOf = (viewer: Viewer): string[] =>
  viewer?.subspaceRoles ? [...viewer.subspaceRoles.values()].filter(isActiveSubspaceMember).map((membership) => membership.subspaceId) : [];

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
export const typeClause = (types: PostType[]) => (types.length ? { $or: [{ 'crystal.type': { $in: types } }, { type: { $in: types } }] } : {});

export const getFeed = async (
  viewerInput: string | Viewer,
  query: FeedQuery
): Promise<{ ok: true; posts: PublicPost[]; nextCursor: string | null; ranked: boolean; scope: FeedScope } | Fail> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  const scope: FeedScope = query.scope === 'subspaces' ? 'subspaces' : 'all';
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const types = (query.types || []).filter((type) => POST_TYPES.includes(type));
  // REQUESTABLE, not the default set — 'hidden' and 'custom' are chips the
  // filter menu offers, and a dropped circle reads as "no filter" downstream
  const circles = (query.circles || []).filter((circle) => REQUESTABLE_VISIBILITIES.includes(circle));
  // same normalization sanitizeTags applies at write time — the stored tags
  // are already trimmed/lowercased/capped, so an un-normalized filter could
  // never match anything
  const tag = typeof query.tag === 'string' ? query.tag.trim().toLowerCase().slice(0, MAX_TAG_CHARS) : '';

  const visibility = visibilityQueryFor(viewer, circles);
  if (!visibility) return { ok: true, posts: [], nextCursor: null, ranked: false, scope };

  // "My subspaces": only posts from the viewer's ACTIVE subspaces, on top of
  // (never instead of) every fence below — removed posts stay out, private
  // subspaces still need the membership. Nobody to scope to → an empty page,
  // not the whole feed.
  const scopedSubspaceIds = scope === 'subspaces' ? activeSubspaceIdsOf(viewer) : null;
  if (scopedSubspaceIds && !scopedSubspaceIds.length) return { ok: true, posts: [], nextCursor: null, ranked: false, scope };

  const range: any = {};
  if (query.from || query.to) {
    range.createdAt = {};
    if (query.from) range.createdAt.$gte = query.from;
    if (query.to) range.createdAt.$lte = query.to;
  }
  const match = withMatch(
    postMatch(),
    visibility,
    typeClause(types),
    tag ? { tags: tag } : {},
    range,
    scopedSubspaceIds ? { 'crystal.subspaceId': { $in: scopedSubspaceIds } } : {},
    ...subspaceFeedClauses(viewer)
  );

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
    return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor, ranked: false, scope };
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
        b.score - a.score || new Date(b.doc.createdAt).getTime() - new Date(a.doc.createdAt).getTime() || a.doc.shareId.localeCompare(b.doc.shareId)
    );

  const pageIds = scored.slice(offset, offset + limit).map((entry) => entry.doc.shareId);
  const pageDocs = pageIds.length
    ? ((await things.find(withMatch({ shareId: { $in: pageIds } }, postMatch()) as any).toArray()) as any as ThingDoc[])
    : [];
  const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
  const page = pageIds.map((id) => docsById.get(id)).filter(Boolean) as ThingDoc[];
  const visible = page.filter((doc) => canView(doc, viewer));
  const nextCursor = offset + limit < scored.length ? String(offset + limit) : null;
  return { ok: true, posts: await toPublicPosts(visible, viewer), nextCursor, ranked: true, scope };
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
  const viewer = await withFriendIds(asViewer(viewerInput));
  if (typeof username !== 'string' || !username.trim()) return fail(400, 'username is required');
  // dual-era: findUserByUsername resolves user things first, legacy second —
  // a bare users.findOne would 404 every things-era + migrated account
  const user = await findUserByUsername(username.trim());
  if (!user) return fail(404, 'User not found');

  const ownerId = String(user._id);
  const own = viewer?.id === ownerId;
  // a friend browsing this profile also sees the owner's friends-circle posts
  const friendOfOwner = !!viewer?.friendIds?.has(ownerId);
  const baseMatch = own
    ? withMatch(postMatch(), { ownerId })
    : friendOfOwner
      ? withMatch(postMatch(), { ownerId }, { $or: [circleClause('public'), circleClause('friends')] })
      : withMatch(postMatch(), { ownerId }, circleClause('public'));
  // visibility-restricted tokens: conjoin the audience fence the same way
  // listThings does. Not just paging hygiene (without it a public-only token
  // pages an owner's mostly-private profile in near-empty slices while the
  // cursor advances) — postCount below is computed from this match, so an
  // unfenced match would report the owner's private posts to a token that
  // must never learn they exist.
  const fence = patVisibilityMatchClause(viewer);
  // subspace fences (removed / private-subspace posts) apply to every visitor
  // but the owner, who keeps seeing their own removed posts on their profile
  const match = withMatch(baseMatch, fence || {}, ...(own ? [] : subspaceFeedClauses(viewer)));

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
// generic PublicThing. Comments (rich or plain) project as posts too, so their
// /post/:id deep-link pages render as full cards; for them the thread context
// comes along: parent = the thing commented on, root = the top of the thread
// (each null when deleted or not visible to the viewer).
export const getThing = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  app: AppLens = null,
  options: PostProjectionOptions = {}
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null; parent: PublicPost | null; root: PublicPost | null }> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  const doc = await findViewableThingAs(shareId, viewer, app);
  if (!doc) return fail(404, 'Thing not found');
  const thing = (await toPublicThings([doc], viewer))[0];

  // App consumers get the generic thing shape only: the PublicPost projection
  // batch-embeds comments/reactions across ALL viewers (scope-blind), so it
  // must never ride an app response — apps read children relationally via
  // GET /api/v1/things?target=… inside their namespace instead.
  if (app) {
    await appShapeProjections(app, [doc], [thing]);
    return { ok: true, thing, post: null, parent: null, root: null };
  }

  const isComment = thingtimeOf(doc).includes('comment');
	// Media attachments are Things with their own /media/:id page: the
	// post-shaped projection carries their reactions, comments, and view
	// aggregates (those resolvers are target-generic), and the parent walk
	// links the page back to the post the media is bound to.
	const isMediaAttachment = thingtimeOf(doc).includes('attachment');
	const post = isPostThing(doc) || isComment || isMediaAttachment ? (await toPublicPosts([doc], viewer, options))[0] : null;

  let parent: PublicPost | null = null;
  let root: PublicPost | null = null;
	if ((isComment || isMediaAttachment) && targetIdOf(doc)) {
    // walk up the thread — depth is unbounded, no rail: the visited set is
    // the only terminator (finite db + no revisits), and the loop is
    // iterative so chain length never touches the call stack
    const chain: ThingDoc[] = [];
    let cursor: ThingDoc = doc;
    const seenChain = new Set<string>(doc.shareId ? [doc.shareId] : []);
    while (true) {
      const up = targetIdOf(cursor) ? await findThing(targetIdOf(cursor)) : null;
      if (!up || !up.shareId || seenChain.has(up.shareId)) break;
      seenChain.add(up.shareId);
      chain.push(up);
      if (!thingtimeOf(up).includes('comment')) break;
      cursor = up;
    }
    // Each canViewInherited re-walks that entry's own ACL chain, so checking
    // them one at a time with no shared lookup cost n + n(n-1)/2 sequential
    // round trips for a comment at depth n — 15 at depth 5, 55 at depth 10,
    // on top of the walk above that already fetched these same documents.
    // Nesting is uncapped, so this was a tail-latency cliff on deep threads.
    // One shared batched lookup, checks concurrent: one round trip per chain
    // LEVEL, matching listThings and the search path.
    const lookup = batchedThingLookup();
    const verdicts = await Promise.all(chain.map((entry) => canViewInherited(entry, viewer, lookup)));
    const visibleChain = chain.filter((_, index) => verdicts[index]);
    if (visibleChain.length) {
      const projected = await toPublicPosts([...new Map(visibleChain.map((entry) => [entry.shareId, entry])).values()], viewer, options);
      const byId = new Map(projected.map((entry) => [entry.id, entry]));
      parent = byId.get(chain[0]?.shareId) || null;
      const last = chain[chain.length - 1];
      root = last ? byId.get(last.shareId) || null : null;
    }
  }
  return { ok: true, thing, post, parent, root };
};

export type ListThingsQuery = {
  thingtime?: string[];
  targetId?: string | null;
  // folder browse (own-things mode only): 'root' = things not filed anywhere,
  // a folder shareId = that folder's direct children, absent = everything
  folder?: string | null;
  cursor?: string | null;
  limit?: number;
  // First-party browsing of ONE app's namespace (the in-Thingtime "what has
  // this app stored for me" surface): own-things mode narrowed to root appId.
  appId?: string | null;
};

// Unified list. Two modes:
// - targetId set: things attached to a viewable target (comments/reactions of
//   a post) — inherit visibility from the target.
// - no targetId: the viewer's OWN things (any schema), newest first.
// Under the app lens both modes are namespace-conjoined and liveness-gated.
export const listThings = async (
  viewerInput: string | Viewer,
  query: ListThingsQuery,
  app: AppLens = null
): Promise<Fail | { ok: true; things: PublicThing[]; nextCursor: string | null }> => {
  const viewer = await withFriendIds(asViewer(viewerInput));
  const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_LIMIT), MAX_FEED_LIMIT);
  const thingtime = (query.thingtime || []).filter((id) => typeof id === 'string' && id.trim());

  let match: Record<string, any>;
  if (query.targetId) {
    if (query.folder) return fail(400, 'folder filtering applies to your own things, not a target listing');
    const target = await findViewableThingAs(query.targetId, viewer, app);
    if (!target) return fail(404, 'Thing not found');
    // under the app lens, children are namespace things too — the owner's
    // first-party comments on an app thing (no appId) never surface here
    match = app ? withMatch({ targetId: target.shareId }, ...appMatchClauses(app)) : { targetId: target.shareId };
  } else if (app) {
    match = withMatch({}, ...appMatchClauses(app));
  } else {
    if (!viewer?.id) return fail(401, 'Unauthorized');
    // your OWN things, but not your account/theme/algorithm/waitlist things —
    // those are managed by their dedicated endpoints and would otherwise show
    // up as inert, non-editable entries (edit/delete 403) in the data browser.
    // Messenger plumbing (chats, memberships, messages…) stays out for the
    // same reason — /messages is its browser.
    match = {
      ownerId: viewer.id,
      thingtime: { $nin: [...PROTECTED_THINGTIME, ...MESSENGER_THINGTIME, ...SUBSPACE_THINGTIME, UPDOWN_THINGTIME] },
      $or: [{ thingtime: { $exists: true } }, { kind: 'post' }]
    };
    const folder = typeof query.folder === 'string' ? query.folder.trim() : '';
    if (folder) {
      // Folder browse: mechanical children (reactions, saves) are unfileable —
      // they'd otherwise flood the root level (no folderId reads as root) with
      // rows the browser hides anyway, wasting whole pages and one inherit
      // walk each. Excluded server-side so folder pages carry real content.
      match.thingtime = { $nin: [...PROTECTED_THINGTIME, ...FOLDER_UNFILEABLE] };
    }
    if (folder === 'root') {
      // v1 docs and pre-folder v2 docs have no folderId at all — both read as root
      match.folderId = { $in: [null] };
    } else if (folder) {
      const assignment = await resolveFolderAssignment(viewer.id, folder, []);
      if (isFail(assignment)) return assignment;
      match.folderId = assignment.folderId;
    }
    // narrow to one app's namespace (session-auth data browser)
    if (typeof query.appId === 'string' && query.appId.trim()) {
      match = withMatch(match, { appId: query.appId.trim() });
    }
  }
  if (thingtime.length) {
    match = withMatch(match, thingtimeInClause(thingtime));
  }
  if (!app) {
    // visibility-restricted tokens: conjoin the audience fence so pages stay
    // full instead of being trimmed to nothing in memory (the per-doc
    // canViewInherited below remains the exact gate)
    const fence = patVisibilityMatchClause(viewer);
    if (fence) match = withMatch(match, fence);
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
  let visible: ThingDoc[];
  if (app) {
    visible = await appVisiblePage(app, page);
  } else {
    // The checks run concurrently over one shared batched lookup, so a page of
    // attached things costs one round trip per chain level, not one per doc.
    const lookup = batchedThingLookup();
    const verdicts = await Promise.all(page.map((doc) => canViewInherited(doc, viewer, lookup)));
    visible = page.filter((_, index) => verdicts[index]);
  }
  const projected = await toPublicThings(visible, viewer);
  if (app) await appShapeProjections(app, visible, projected);
  return { ok: true, things: projected, nextCursor };
};

// Copy a target's LEGACY embedded reactions/comments into standalone v2 things
// (once) and clear the embedded fields, so a legacy post becomes fully
// relational on its first write. No-op for new or already-claimed posts.
//
// The claim AND deterministic child upserts are one transaction: exactly one
// concurrent writer migrates, a delete conflicts on the same target write, and
// a failed upsert automatically restores the embedded source. Deterministic
// shareIds remain idempotent with the admin migration. Mutates `doc` only after
// that transaction commits.
const emojiHex = (emoji: string) => [...emoji].map((char) => char.codePointAt(0)!.toString(16)).join('');
const safeIdPart = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
export const reactionShareId = (targetId: string, userId: string, emoji: string) =>
  `react-${safeIdPart(targetId)}-${safeIdPart(userId)}-${emojiHex(emoji)}`;

type LegacyReactionConversion = {
	shareId: string;
	ownerId: string;
	emoji: string;
	createdAt: Date;
};

type LegacyCommentConversion = {
	shareId: string;
	ownerId: string;
	text: string;
	createdAt: Date;
};

export type LegacyInteractionConversionPlan =
	| {
			ok: true;
			ownerIds: string[];
			reactions: LegacyReactionConversion[];
			comments: LegacyCommentConversion[];
	  }
	| { ok: false; reason: string };

const owns = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isPlainLegacyRecord = (value: unknown): value is Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};
const legacyDate = (value: unknown): Date | null => {
	if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
};
const malformedLegacyInteractions = (reason: string): LegacyInteractionConversionPlan => ({ ok: false, reason });

// Parse the complete embedded residue before it can be claimed. Skipping one
// malformed array member would silently erase source data while creating only
// a subset of its billable children, so every value and every deterministic
// destination must be valid and collision-free or the write fails closed.
export const validateLegacyInteractionResidue = (doc: Partial<ThingDoc> & Record<string, unknown>): LegacyInteractionConversionPlan => {
	if (typeof doc.shareId !== 'string' || !doc.shareId.trim()) return malformedLegacyInteractions('invalid parent shareId');

	const owners = new Set<string>();
	const destinations = new Set<string>();
	const reactions: LegacyReactionConversion[] = [];
	const comments: LegacyCommentConversion[] = [];
	const rawReactions = owns(doc, 'reactions') ? doc.reactions : null;
	const rawComments = owns(doc, 'comments') ? doc.comments : null;

	if (rawReactions !== null) {
		if (!isPlainLegacyRecord(rawReactions)) return malformedLegacyInteractions('reactions must be an object');
		const createdAt = legacyDate(doc.createdAt);
		for (const [emoji, rawOwnerIds] of Object.entries(rawReactions)) {
			if (sanitizeReactionToken(emoji) !== emoji) return malformedLegacyInteractions('reaction token is invalid');
			if (!Array.isArray(rawOwnerIds)) return malformedLegacyInteractions('reaction owners must be an array');
			if (!createdAt && rawOwnerIds.length) return malformedLegacyInteractions('reaction parent createdAt is invalid');
			for (const rawOwnerId of rawOwnerIds) {
				if (typeof rawOwnerId !== 'string' || !rawOwnerId.trim() || rawOwnerId.trim() !== rawOwnerId) {
					return malformedLegacyInteractions('reaction ownerId is invalid');
				}
				const shareId = reactionShareId(doc.shareId, rawOwnerId, emoji);
				if (destinations.has(shareId)) return malformedLegacyInteractions('interaction destination is duplicated');
				destinations.add(shareId);
				owners.add(rawOwnerId);
				reactions.push({ shareId, ownerId: rawOwnerId, emoji, createdAt: createdAt! });
			}
		}
	}

	if (rawComments !== null) {
		if (!Array.isArray(rawComments)) return malformedLegacyInteractions('comments must be an array');
		for (const rawComment of rawComments) {
			if (!isPlainLegacyRecord(rawComment)) return malformedLegacyInteractions('comment must be an object');
			const sanitizedId = sanitizeShareId(rawComment.id);
			const ownerId = rawComment.userId;
			const createdAt = legacyDate(rawComment.createdAt);
			if (typeof sanitizedId !== 'string' || sanitizedId !== rawComment.id) {
				return malformedLegacyInteractions('comment shareId is invalid');
			}
			if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.trim() !== ownerId) {
				return malformedLegacyInteractions('comment ownerId is invalid');
			}
			if (typeof rawComment.text !== 'string') return malformedLegacyInteractions('comment text is invalid');
			if (!createdAt) return malformedLegacyInteractions('comment createdAt is invalid');
			if (destinations.has(sanitizedId)) return malformedLegacyInteractions('interaction destination is duplicated');
			destinations.add(sanitizedId);
			owners.add(ownerId);
			comments.push({ shareId: sanitizedId, ownerId, text: rawComment.text, createdAt });
		}
	}

	return { ok: true, ownerIds: [...owners].sort(), reactions, comments };
};

class LegacyInteractionResidueError extends Error {
	constructor() {
		super('Legacy interactions are malformed and require admin migration or cleanup before this write can continue');
		this.name = 'LegacyInteractionResidueError';
	}
}

export const legacyInteractionLazyConversionIsSafe = (plan: LegacyInteractionConversionPlan): boolean =>
	plan.ok === true && plan.ownerIds.length === 0;

const migrateThingInteractions = async (doc: ThingDoc): Promise<Fail | null> => {
	if (!owns(doc, 'reactions') && !owns(doc, 'comments')) return null;

	const preflight = validateLegacyInteractionResidue(doc as ThingDoc & Record<string, unknown>);
	if (!preflight.ok) return fail(503, new LegacyInteractionResidueError().message);

	// Any non-empty lazy conversion could race the global migration between a
	// readiness precheck and the transaction, publishing unstamped child Things
	// after an owner's account ledger became ready. Only empty residue is safe
	// to claim/unset here; billable children are created exclusively by the
	// globally leased migration, which stamps and reconciles before publication.
	if (!legacyInteractionLazyConversionIsSafe(preflight)) {
		return fail(503, 'Legacy interactions require the storage migration to finish before this write can continue');
	}
  const things = await getThingsCollection();

	try {
		await withMongoTransaction(async (session) => {
			const claimMatch: Record<string, unknown> = {
      shareId: doc.shareId,
				createdAt: doc.createdAt,
				reactions: owns(doc, 'reactions') ? doc.reactions : { $exists: false },
				comments: owns(doc, 'comments') ? doc.comments : { $exists: false }
			};
			const claimed = (await things.findOneAndUpdate(claimMatch as any, { $unset: { reactions: '', comments: '' } } as any, {
				session,
				returnDocument: 'before'
			})) as any as ThingDoc | null;
			if (!claimed) return; // another writer already claimed this exact residue

			const plan = validateLegacyInteractionResidue(claimed as ThingDoc & Record<string, unknown>);
			if (!plan.ok) throw new LegacyInteractionResidueError();

  const ops: any[] = [];
			for (const reaction of plan.reactions) {
				const expected = {
					shareId: reaction.shareId,
              schemaVersion: THINGS_SCHEMA_VERSION,
              thingtime: ['reaction'],
					crystal: { emoji: reaction.emoji },
					ownerId: reaction.ownerId,
              acl: [ACL_INHERIT],
              targetId: doc.shareId,
              tags: [],
					createdAt: reaction.createdAt,
					updatedAt: reaction.createdAt
				};
				ops.push({
					updateOne: {
						// Matching only shareId would silently accept a pre-existing
						// unrelated Thing and then erase the embedded source. The full
						// expected envelope makes a squat/mismatch hit the unique index,
						// aborting this transaction and restoring the residue.
						filter: expected,
						update: { $setOnInsert: expected },
          upsert: true
        }
      });
    }
			for (const comment of plan.comments) {
				const expected = {
					shareId: comment.shareId,
            schemaVersion: THINGS_SCHEMA_VERSION,
            thingtime: ['comment'],
            crystal: { text: comment.text },
					ownerId: comment.ownerId,
            acl: [ACL_INHERIT],
            targetId: doc.shareId,
            tags: [],
					createdAt: comment.createdAt,
					updatedAt: comment.createdAt
				};
				ops.push({
					updateOne: {
						filter: expected,
						update: { $setOnInsert: expected },
        upsert: true
      }
    });
  }
			if (ops.length) await things.bulkWrite(ops, { ordered: false, session });
		});
	} catch (error) {
		if (error instanceof LegacyInteractionResidueError) return fail(503, error.message);
		if (
			(error as any)?.code === 11000 ||
			(Array.isArray((error as any)?.writeErrors) && (error as any).writeErrors.some((entry: any) => entry?.code === 11000))
		) {
			return fail(503, 'A legacy interaction destination conflicts with an existing Thing and requires admin cleanup');
    }
		throw error;
  }

	// Reflect the committed clear locally regardless of who won, so response
	// aggregation reads only standalone data (never double-folds the copy).
	delete doc.reactions;
	delete doc.comments;
	return null;
};

// ---------------------------------------------------------------------------
// Social actions. Every action re-checks visibility so a URL-guessed private
// thing can't be interacted with.

export const toggleReaction = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  emoji: unknown,
  app: AppLens = null
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
  const target = await findViewableThingAs(shareId, viewer, app);
  if (!target) return fail(404, 'Post not found');
  // guard the REMOVE path too — createThing only covers the add
  if (patSandboxBlocks(viewer, target)) return patSandboxFail();
  // custom audiences: reacting needs the comment capability (both directions)
  if (await customEngageBlocks(viewer, target)) return customEngageFail();

  // the reaction unique index exists before any insert: it is created at
  // instance boot (server/plugins/mongo-warmup) and awaited during register,
  // which every authed viewer's database has necessarily already run
  const things = await getThingsCollection();
  let recentReactions: string[] | undefined;

  if (token) {
    // first write claims any legacy embedded residue into standalone things
    // (namespace targets are always v2 — nothing to claim under the app lens)
		if (!app) {
			const migrationFail = await migrateThingInteractions(target);
			if (migrationFail) return migrationFail;
		}

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
			try {
      const removed = await deleteThingsAtomically([existingV2, existingKind].filter(Boolean) as ThingDoc[]);
      await refundDeletedNamespaceDocs(removed);
			} catch (error) {
				const storageFail = storageMutationFail(error);
				if (storageFail) return storageFail;
				throw error;
			}
    } else {
      // createThing enforces the per-user + per-post reaction caps (single
      // source of truth, so the generic POST path is bounded the same way);
      // under the app lens it also stamps the namespace + charges the budget
      const created = await createThing(viewerId, { thingtime: ['reaction'], crystal: { emoji: token }, targetId: target.shareId }, viewer, app);
      // 409 = the unique (target, owner, token) index raced another add of the
      // same token — that reaction already exists, which is what we wanted
      if (isFail(created) && created.status !== 409) return created;
      // the personal emoji-picker MRU is first-party state — an app reacting
      // on the user's behalf must not rewrite their recents
      if (!app) recentReactions = await pushUserRecentReaction(viewerId, token);
    }
    await things.updateOne({ shareId: target.shareId } as any, { $set: { updatedAt: new Date() } });
  }

  if (app) {
    // Namespace-fenced counts: only this app's reaction things (the owner's
    // first-party reactions on the same doc never leak into app responses),
    // liveness-gated like every cross-user app read.
    const reactionDocs = (await things
      .find(withMatch({ targetId: target.shareId, thingtime: 'reaction' }, ...appMatchClauses(app)) as any)
      .project({
        shareId: 1,
        targetId: 1, // the inherit-chain walk needs the link (fails closed without it)
        'crystal.emoji': 1,
        ownerId: 1,
        appId: 1,
        acl: 1,
        sandboxExpiresAt: 1,
        sandboxSpace: 1
      })
      .toArray()) as any as ThingDoc[];
    const live = await appVisiblePage(app, reactionDocs);
    const reactionCounts: Record<string, number> = {};
    const viewerReactions: string[] = [];
    for (const doc of live) {
      const reactionToken = String(doc.crystal?.emoji || '');
      if (!reactionToken) continue;
      reactionCounts[reactionToken] = (reactionCounts[reactionToken] || 0) + 1;
      if (String(doc.ownerId) === viewerId && !viewerReactions.includes(reactionToken)) {
        viewerReactions.push(reactionToken);
      }
    }
    return { ok: true, reactionCounts, viewerReactions };
  }

  // recompute merged state for this target
  const related = await resolveRelated([target], viewerId);
  const entries = mergedReactionsOf(target, related);
  return {
    ok: true,
    reactionCounts: reactionCountsOf(entries),
    viewerReactions: viewerReactionsOf(entries, viewerId),
    recentReactions
  };
};

// "Add to my library": toggle a private save thing pointing at the target
// (FUNDAMENTALS §3 — accumulating per-user state is a relational child doc).
// Saves carry acl ['tt:user'] (createThing special-cases the save crystal),
// so a library is personal by construction. A create/create race can mint a
// duplicate save doc; toggle-off deletes ALL matching docs, so it self-heals.
export const toggleSave = async (viewerInput: string | Viewer, shareId: unknown): Promise<Fail | { ok: true; saved: boolean }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const target = await findViewableThing(shareId, viewer);
  if (!target) return fail(404, 'Thing not found');
  // guard the UNSAVE path too — createThing only covers the save
  if (patSandboxBlocks(viewer, target)) return patSandboxFail();

  const things = await getThingsCollection();
  const existing = await things
    .find({ targetId: target.shareId, thingtime: 'save', ownerId: viewer.id } as any)
		.project({ _id: 1, shareId: 1 })
    .toArray();
  if (existing.length) {
		try {
			await deleteThingsAtomically(existing as any as ThingDoc[]);
		} catch (error) {
			const storageFail = storageMutationFail(error);
			if (storageFail) return storageFail;
			throw error;
		}
    return { ok: true, saved: false };
  }
  const created = await createThing(viewer.id, { thingtime: ['save'], targetId: target.shareId }, viewer);
  if (isFail(created)) return created;
  return { ok: true, saved: true };
};

// Which of these targets has the viewer saved? Batch (one query per page).
export const savedTargetIds = async (viewer: Viewer, targetIds: string[]): Promise<Set<string>> => {
  if (!viewer?.id || !targetIds.length) return new Set();
  const things = await getThingsCollection();
  const docs = await things
    .find({ ownerId: viewer.id, thingtime: 'save', targetId: { $in: targetIds } } as any)
    .project({ targetId: 1 })
    .toArray();
  return new Set(docs.map((doc: any) => String(doc.targetId)));
};

export type AddCommentInput =
  | string
  | {
      text?: unknown;
      richText?: unknown;
      // any of these makes it a RICH comment — a full ["post","comment"] thing
      // with the whole post vocabulary (photos, listing, thingtime thing)
      type?: unknown;
      images?: unknown;
      listing?: unknown;
      thing?: unknown;
			mediaLayout?: unknown;
      tags?: unknown;
			shareId?: unknown;
	  };

export type AddCommentOptions = {
	attachments?: AttachmentPublicMetadata[];
	attachmentIds?: readonly string[];
	createHooks?: CreateThingHooks;
};

const sameStringSet = (left: readonly string[], right: readonly string[]): boolean => {
	if (left.length !== right.length) return false;
	const expected = [...right].sort();
	return [...left].sort().every((entry, index) => entry === expected[index]);
    };

const transactionOutcomeUnknown = (error: unknown): boolean =>
	Array.isArray((error as { errorLabels?: unknown } | null)?.errorLabels) &&
	((error as { errorLabels: unknown[] }).errorLabels.includes('UnknownTransactionCommitResult') ||
		(error as { errorLabels: unknown[] }).errorLabels.includes('TransientTransactionError'));

// the commenter's own user flair in a subspace, for the single fresh comment
// addComment answers with (one membership read — the viewer's preloaded
// roster when withFriendIds already ran — plus the subspace embed only when
// they actually wear one)
const freshCommentAuthorFlair = async (viewer: NonNullable<Viewer>, subspaceId: string | null): Promise<PublicAuthorFlair | null> => {
  if (!subspaceId || !viewer.id) return null;
  const membership = viewer.subspaceRoles ? viewer.subspaceRoles.get(subspaceId) || null : await subspaceMembershipOf(subspaceId, viewer.id);
  if (!membership?.userFlair || !isActiveSubspaceMember(membership)) return null;
  const embeds = await loadSubspaceEmbeds([subspaceId]);
  return toPublicUserFlair(liveUserFlair(membership.userFlair, embeds.get(subspaceId)?.userFlairs));
};

export const addComment = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  input: AddCommentInput,
	app: AppLens = null,
	options: AddCommentOptions = {}
): Promise<Fail | { ok: true; comment: PublicComment; commentCount: number }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const viewerId = viewer.id;
  const target = await findViewableThingAs(shareId, viewer, app);
  if (!target) return fail(404, 'Post not found');
  // fail before the residue migration + count queries (createThing would
  // catch it anyway — this is the earlier, cheaper exit)
  if (patSandboxBlocks(viewer, target)) return patSandboxFail();
  // custom audiences: commenting needs the comment capability
  if (await customEngageBlocks(viewer, target)) return customEngageFail();

  // first write claims any legacy embedded residue into standalone things
  // (namespace targets are always v2 — nothing to claim under the app lens)
	if (!app) {
		const migrationFail = await migrateThingInteractions(target);
		if (migrationFail) return migrationFail;
	}

  const body = typeof input === 'string' ? { text: input } : input && typeof input === 'object' ? input : {};
  // comments share the post schema — post fields upgrade the comment to a
  // ["post","comment"] thing (validated by the post crystal sanitizer)
	const rich =
		body.type !== undefined ||
		body.richText !== undefined ||
		body.images !== undefined ||
		body.listing !== undefined ||
		body.thing !== undefined ||
		body.mediaLayout !== undefined ||
		options.createHooks?.postAttachments?.hasAny === true;

	const createInput: CreateThingInput = rich
      ? {
          thingtime: ['post', 'comment'],
          crystal: {
				type: body.type ?? 'text',
				text: body.text,
				richText: body.richText,
				images: body.images,
				listing: body.listing,
				thing: body.thing,
				mediaLayout: body.mediaLayout
			},
          tags: body.tags,
				shareId: body.shareId,
          targetId: target.shareId
        }
      : {
          thingtime: ['comment'],
          crystal: { text: body.text },
				shareId: body.shareId,
          targetId: target.shareId
		  };

	const reconcileCommittedComment = async (): Promise<ThingDoc | null> => {
		if (typeof body.shareId !== 'string' || !body.shareId.trim()) return null;
		const things = await getThingsCollection();
		const existing = (await things.findOne({ shareId: body.shareId.trim() } as any)) as ThingDoc | null;
		if (
			!existing ||
			String(existing.ownerId) !== viewerId ||
			targetIdOf(existing) !== target.shareId ||
			!isDeepStrictEqual(thingtimeOf(existing), createInput.thingtime)
		) {
			return null;
		}

		const validated = validateThingtimeCrystal(createInput.thingtime, createInput.crystal, {
			postAttachments: options.createHooks?.postAttachments
		});
		if (isFail(validated) || !isDeepStrictEqual(crystalOf(existing), validated.crystal)) return null;
		const tags = sanitizeTags(createInput.tags);
		if (isFail(tags)) return null;
		const listing = validated.thingtime.includes('post') ? (validated.crystal.listing as MarketplaceListing | null | undefined) : null;
		const expectedTags = [...tags, ...(listing?.category ? [listing.category] : [])].filter((tag, index, all) => all.indexOf(tag) === index);
		if (!isDeepStrictEqual(existing.tags || [], expectedTags) || !isDeepStrictEqual(aclOf(existing), [ACL_INHERIT])) return null;

		const attachmentDocs = await things
			.find(
				{
					thingtime: 'attachment',
					targetId: existing.shareId,
					ownerId: viewerId,
					attachmentState: 'ready',
					attachmentPurpose: 'comment'
				} as any,
				{ projection: { shareId: 1 } }
			)
			.toArray();
		return sameStringSet(
			attachmentDocs.map((doc: any) => String(doc.shareId)),
			options.attachmentIds || []
		)
			? existing
			: null;
	};

	let created: CreateThingResult;
	try {
		created = await createThing(viewerId, createInput, viewer, app, options.createHooks);
	} catch (error) {
		if (!transactionOutcomeUnknown(error)) throw error;
		const committed = await reconcileCommittedComment();
		if (!committed) throw error;
		created = { ok: true, doc: committed };
	}
	if (isFail(created) && created.status === 409) {
		const committed = await reconcileCommittedComment();
		if (committed) created = { ok: true, doc: committed };
	}
  if (isFail(created)) return created;

  const doc = created.doc;
  const crystal = crystalOf(doc);
  // the fresh comment wears the author's user flair in the ROOT post's
  // subspace (the same resolution the page projection runs). createThing's
  // interaction gate already walked to the root — reuse its answer; only a
  // comment reconciled after an unknown transaction outcome (no gate result
  // on that path) walks again.
  const rootSubspaceId = created.rootSubspaceId !== undefined ? created.rootSubspaceId : subspaceIdOfDoc((await resolveRootPost(target)).root);
  const [profiles, authorFlair] = await Promise.all([resolveProfiles([viewerId]), freshCommentAuthorFlair(viewer, rootSubspaceId)]);
  const comment: PublicComment = {
    id: doc.shareId,
    thingtime: thingtimeOf(doc),
    author: profiles.get(viewerId) || null,
    type: (crystal.type as PostType) || 'text',
    text: String(crystal.text || ''),
    richText:
      crystal.richText && typeof crystal.richText === 'object' && !Array.isArray(crystal.richText)
        ? (crystal.richText as Record<string, any>)
        : null,
    images: (crystal.images as string[]) || [],
		attachments: options.attachments || [],
		mediaLayout: mediaLayoutOf(crystal),
    listing: (crystal.listing as MarketplaceListing) || null,
    thing: crystal.thing && typeof crystal.thing === 'object' && !Array.isArray(crystal.thing) ? (crystal.thing as Record<string, any>) : null,
    tags: doc.tags || [],
    reactionCounts: {},
    viewerReactions: [],
    votes: emptyUpdownVotes(),
    authorFlair,
    commentCount: 0,
    targetId: target.shareId,
    createdAt: new Date(doc.createdAt).toISOString()
  };

  if (app) {
    // self-author shaped by the acting grant; count fenced to the namespace
    await appShapeProjections(app, [doc], [comment]);
    const things = await getThingsCollection();
    const commentCount = await things.countDocuments(
			withMatch(
				{ targetId: target.shareId, thingtime: 'comment' },
				visibleRelatedModerationClause(viewerId),
				...appMatchClauses(app)
			) as any
		);
    return { ok: true, comment, commentCount };
  }

  return {
    ok: true,
    comment,
    commentCount: await countCommentsOf(target, { viewerId }) // includes the owner's pending comment
  };
};

export const sharePost = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  input: { text?: unknown; tags?: unknown; visibility?: unknown; acl?: unknown }
): Promise<Fail | { ok: true; post: PublicPost }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const viewerId = viewer.id;
  const original = await findViewableThing(shareId, viewer);
  // external posts share like posts (the tt:all-only gate below still keeps
  // personal external posts unshareable)
  if (!original || !isPostLikeThing(original)) return fail(404, 'Post not found');
  if (patSandboxBlocks(viewer, original)) return patSandboxFail();
  // custom audiences: sharing is amplification — comment capability required
  if (await customEngageBlocks(viewer, original)) return customEngageFail();
  if (original.ownerId !== viewerId && !aclOf(original).includes(ACL_ALL)) {
    return fail(403, 'Only public posts can be shared');
  }

  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT_CHARS) : '';
  // the quoter's own tags (the client harvests inline #hashtags from the
  // caption, exactly like the composer) — without these, a linkified caption
  // tag's search would exclude the very quote post it was tapped on
  const inputTags = sanitizeTags(input.tags);
  if (isFail(inputTags)) return inputTags;
  const originalCrystal = crystalOf(original);

  const created = await createThing(
    viewerId,
    {
      thingtime: ['post', 'share'],
      crystal: { type: originalCrystal.type || 'text', text, images: [], listing: null },
      acl: input.acl,
      visibility: input.visibility,
      // caption tags first so the quoter's intent survives the MAX_TAGS cap;
      // createThing dedupes the merge. Never carry a non-public original's
      // tags to audiences that can't view it.
      tags: [...inputTags, ...(aclOf(original).includes(ACL_ALL) ? original.tags || [] : [])],
      targetId: original.shareId
    },
    viewer
  );
  if (isFail(created)) return created;

  return { ok: true, post: (await toPublicPosts([created.doc], viewer))[0] };
};

// Registered namespace refunds now commit with content deletion inside
// deleteThingsAtomically/deleteThing. Sandbox ledgers intentionally stay on
// their existing ephemeral path, so callers invoke this after the content
// transaction commits to refund only TTL-scoped data.
export const refundDeletedNamespaceDocs = async (docs: ThingDoc[]): Promise<void> => {
	const totals = new Map<string, { ownerId: string; appId: string; bytes: number; sandbox: { space: string | null } }>();
  for (const doc of docs) {
		if (!doc?.appId || storageSandboxState(doc) !== 'sandbox') continue;
		const bytes = storedThingSizeBytes(doc);
    if (!(bytes > 0)) continue;
		const sandbox = { space: typeof doc.sandboxSpace === 'string' ? doc.sandboxSpace : null };
		const key = `${doc.ownerId}\0${doc.appId}\0${sandbox.space ?? ''}`;
    const entry = totals.get(key) || { ownerId: String(doc.ownerId), appId: doc.appId, bytes: 0, sandbox };
    entry.bytes += bytes;
    totals.set(key, entry);
  }
  for (const { ownerId, appId, bytes, sandbox } of totals.values()) {
    await refundAppStorage({ appId, ownerId, sharedRead: false, scopes: [], username: '', sandbox }, bytes);
  }
};

const cascadeAttachmentFilter = (parentIds: string[]) => ({
	$or: [
		{
			targetId: { $in: parentIds },
			// A malformed multi-kind Thing must never turn a share into cascade
			// garbage: shares intentionally survive their original disappearing.
			// Poll votes cascade for the same reason: a vote carries acl
			// ['tt:inherit'] and exists only for the poll it targets, so it is
			// visible exactly when the poll is and must go when the poll goes.
			thingtime: { $in: [...CASCADE_CHILD_THINGTIME, 'vote'], $nin: ['share'] }
		},
		{
			parentId: { $in: parentIds },
			kind: { $in: ['comment', 'reaction'] },
			thingtime: { $nin: ['share'] }
		}
	]
});

const cascadeNodeKey = (doc: ThingDoc): string => ((doc as any)._id ? `id:${String((doc as any)._id)}` : `share:${String(doc.shareId || '')}`);

// Interim relational comments did not consistently carry shareId. Their
// commentId (and, defensively, stringified Mongo id) can be a child's parentId,
// so all stable aliases participate in both traversal and race checks.
const cascadeLinkIdsOf = (doc: ThingDoc): string[] =>
	[doc.shareId, doc.commentId, (doc as any)._id ? String((doc as any)._id) : null].filter(
		(value, index, all): value is string => typeof value === 'string' && !!value && all.indexOf(value) === index
	);

const cascadeParentIdsOf = (doc: ThingDoc): string[] => {
	const parents = new Set<string>();
	const thingtime = Array.isArray(doc.thingtime) ? doc.thingtime : [];
	if (
		thingtime.some((entry) => (CASCADE_CHILD_THINGTIME as readonly string[]).includes(entry) || entry === 'vote') &&
		!thingtime.includes('share') &&
		typeof doc.targetId === 'string' &&
		doc.targetId
	) {
		parents.add(doc.targetId);
	}
	if ((doc.kind === 'comment' || doc.kind === 'reaction') && !thingtime.includes('share') && typeof doc.parentId === 'string' && doc.parentId) {
		parents.add(doc.parentId);
	}
	return [...parents];
};

// Discover the complete attachment closure while the root still exists. The
// cursor fetch size, frontier width, and total node count are all bounded; the
// seen set makes corrupt self-links/cycles terminate. Every query is sorted so
// repeated attempts build the same candidate order from the same committed
// graph state.
const discoverCascadeDescendants = async (root: ThingDoc): Promise<ThingDoc[]> => {
  const things = await getThingsCollection();
	const seenNodes = new Set<string>([cascadeNodeKey(root)]);
	const seenParentIds = new Set(cascadeLinkIdsOf(root));
	const frontier = [...seenParentIds].sort();
	const descendants: ThingDoc[] = [];

	for (let offset = 0; offset < frontier.length; ) {
		const parents = frontier.slice(offset, offset + STORAGE_DELETE_TRANSACTION_BATCH);
		offset += parents.length;
		const cursor = things
			.find(cascadeAttachmentFilter(parents) as any)
			.project({ _id: 1, shareId: 1, commentId: 1, targetId: 1, parentId: 1, thingtime: 1, kind: 1 })
			.sort({ shareId: 1, commentId: 1, _id: 1 })
			.batchSize(STORAGE_DELETE_TRANSACTION_BATCH);
		for await (const raw of cursor) {
			const doc = raw as any as ThingDoc;
			const nodeKey = cascadeNodeKey(doc);
			if (!nodeKey || seenNodes.has(nodeKey)) continue;
			if (descendants.length >= MAX_CASCADE_DESCENDANTS) {
				await cursor.close();
				throw new StorageMutationError(
					409,
					'storage_invariant',
					`Thing has more than ${MAX_CASCADE_DESCENDANTS} attached descendants — run the admin cleanup before deleting it`
				);
			}
			seenNodes.add(nodeKey);
			descendants.push(doc);
			for (const linkId of cascadeLinkIdsOf(doc)) {
				if (seenParentIds.has(linkId)) continue;
				seenParentIds.add(linkId);
				frontier.push(linkId);
			}
		}
	}
	return descendants;
};

// Build child-before-parent batches. Strongly connected components keep a
// corrupt attachment cycle in ONE transaction; the condensation graph is a
// DAG, so a deterministic leaf-first topological order makes every normal
// batch independently retryable without orphaning undiscovered descendants.
const cascadeDeletionBatches = (docs: ThingDoc[]): ThingDoc[][] => {
	const byId = new Map(docs.map((doc) => [cascadeNodeKey(doc), doc]));
	const ids = [...byId.keys()].sort();
	const nodesByAlias = new Map<string, Set<string>>();
	for (const [nodeId, doc] of byId) {
		for (const alias of cascadeLinkIdsOf(doc)) {
			const nodes = nodesByAlias.get(alias) ?? new Set<string>();
			nodes.add(nodeId);
			nodesByAlias.set(alias, nodes);
		}
	}
	const children = new Map(ids.map((id) => [id, new Set<string>()]));
	const parents = new Map(ids.map((id) => [id, new Set<string>()]));
	for (const [childId, doc] of byId) {
		for (const parentId of cascadeParentIdsOf(doc)) {
			for (const parentNodeId of nodesByAlias.get(parentId) ?? []) {
				children.get(parentNodeId)!.add(childId);
				parents.get(childId)!.add(parentNodeId);
			}
		}
	}

	// Iterative Kosaraju avoids blowing the JS stack on a deliberately deep
	// comment chain while still grouping cycles exactly.
	const visited = new Set<string>();
	const finishOrder: string[] = [];
	for (const start of ids) {
		if (visited.has(start)) continue;
		visited.add(start);
		const stack: Array<{ id: string; next: number; edges: string[] }> = [{ id: start, next: 0, edges: [...children.get(start)!].sort() }];
		while (stack.length) {
			const frame = stack[stack.length - 1]!;
			if (frame.next < frame.edges.length) {
				const child = frame.edges[frame.next++]!;
				if (visited.has(child)) continue;
				visited.add(child);
				stack.push({ id: child, next: 0, edges: [...children.get(child)!].sort() });
			} else {
				finishOrder.push(frame.id);
				stack.pop();
			}
		}
	}

	const componentOf = new Map<string, number>();
	const components: string[][] = [];
	for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
		const start = finishOrder[index]!;
		if (componentOf.has(start)) continue;
		const componentId = components.length;
		const component: string[] = [];
		const stack = [start];
		componentOf.set(start, componentId);
		while (stack.length) {
			const id = stack.pop()!;
			component.push(id);
			for (const parent of [...parents.get(id)!].sort().reverse()) {
				if (componentOf.has(parent)) continue;
				componentOf.set(parent, componentId);
				stack.push(parent);
			}
		}
		component.sort();
		if (component.length > STORAGE_DELETE_TRANSACTION_BATCH) {
			throw new StorageMutationError(
				409,
				'storage_invariant',
				`Attachment cycle contains more than ${STORAGE_DELETE_TRANSACTION_BATCH} Things — run the admin cleanup before deleting it`
			);
		}
		components.push(component);
	}

	const componentChildren = components.map(() => new Set<number>());
	const componentParents = components.map(() => new Set<number>());
	for (const [parentId, childIds] of children) {
		const parentComponent = componentOf.get(parentId)!;
		for (const childId of childIds) {
			const childComponent = componentOf.get(childId)!;
			if (parentComponent === childComponent) continue;
			componentChildren[parentComponent]!.add(childComponent);
			componentParents[childComponent]!.add(parentComponent);
		}
	}

	const remainingChildren = componentChildren.map((entries) => entries.size);
	const componentKey = (componentId: number) => components[componentId]![0]!;
	const ready = components
		.map((_, componentId) => componentId)
		.filter((componentId) => remainingChildren[componentId] === 0)
		.sort((left, right) => componentKey(left).localeCompare(componentKey(right)));
	const orderedComponents: number[] = [];
	while (ready.length) {
		const componentId = ready.shift()!;
		orderedComponents.push(componentId);
		for (const parentComponent of componentParents[componentId]!) {
			remainingChildren[parentComponent] -= 1;
			if (remainingChildren[parentComponent] === 0) {
				ready.push(parentComponent);
				ready.sort((left, right) => componentKey(left).localeCompare(componentKey(right)));
			}
		}
	}

	const batches: ThingDoc[][] = [];
	let batch: ThingDoc[] = [];
	for (const componentId of orderedComponents) {
		const componentDocs = components[componentId]!.map((id) => byId.get(id)!);
		if (batch.length && batch.length + componentDocs.length > STORAGE_DELETE_TRANSACTION_BATCH) {
			batches.push(batch);
			batch = [];
		}
		batch.push(...componentDocs);
	}
	if (batch.length) batches.push(batch);
	return batches;
};

const deleteThingCandidatesInSession = async (docs: ThingDoc[], session: any): Promise<ThingDoc[]> => {
	const things = await getThingsCollection();
	const deleted: ThingDoc[] = [];
	// Mongo sessions do not permit parallel operations. Sequential before-image
	// deletes also make it unambiguous which exact version this transaction freed.
	for (const doc of docs) {
		const mongoId = (doc as any)._id;
		const removed = (await things.findOneAndDelete((mongoId ? { _id: mongoId } : { shareId: doc.shareId }) as any, {
			session
		})) as any as ThingDoc | null;
		if (removed) deleted.push(removed);
	}
	return deleted;
};

// Delete known candidates and their account/app-ledger bytes in the same
// bounded transaction for each batch. Only exact findOneAndDelete winners are
// charged, so competing deletes and concurrent size-changing updates can never
// double-refund a ledger.
export const deleteThingsAtomically = async (docs: ThingDoc[]): Promise<ThingDoc[]> => {
  const candidates = [
    ...new Map(
      docs
        .map((doc) => {
          const mongoId = (doc as any)?._id;
          const key = mongoId ? `id:${String(mongoId)}` : doc?.shareId ? `share:${doc.shareId}` : '';
          return key ? ([key, doc] as const) : null;
        })
        .filter((entry): entry is readonly [string, ThingDoc] => entry !== null)
    ).values()
  ];
	if (!candidates.length) return [];
  const deleted: ThingDoc[] = [];
	for (let offset = 0; offset < candidates.length; offset += STORAGE_DELETE_TRANSACTION_BATCH) {
		const batch = candidates.slice(offset, offset + STORAGE_DELETE_TRANSACTION_BATCH);
		const batchDeleted = await withMongoTransaction(async (session) => {
			const winners = await deleteThingCandidatesInSession(batch, session);
			await applyDeletedStorageDeltas(winners, session);
			return winners;
		});
		deleted.push(...batchDeleted);
	}
	return deleted;
};

type CascadeDeleteBatchResult = { blocked: boolean; deleted: ThingDoc[] };

// A batch is deleted only when every live cascade child of its members is also
// in this same batch (children in earlier leaf-first batches are already gone).
// If a child committed after discovery, the read returns `blocked` and the
// caller re-walks. If it races after this snapshot, createThing's transactional
// target touch conflicts with our parent delete, so Mongo retries one side.
const deleteCascadeBatchAtomically = async (batch: ThingDoc[], rootMongoId: unknown): Promise<CascadeDeleteBatchResult> => {
	const things = await getThingsCollection();
	const parentIds = [...new Set(batch.flatMap(cascadeLinkIdsOf))].sort();
	// The root may itself point back into a corrupt descendant cycle. It is the
	// durable retry anchor and is deleted last, so allow that one known edge;
	// every other live child must be in this atomic batch or block it.
	const mongoIds = [...batch.map((doc) => (doc as any)._id), rootMongoId].filter(Boolean);
	return withMongoTransaction(async (session) => {
		const externalChild = await things.findOne(
			{
				...cascadeAttachmentFilter(parentIds),
				...(mongoIds.length ? { _id: { $nin: mongoIds } } : {})
			} as any,
			{ session, projection: { _id: 1 } }
    );
		if (externalChild) return { blocked: true, deleted: [] };
		const deleted = await deleteThingCandidatesInSession(batch, session);
		await applyDeletedStorageDeltas(deleted, session);
		return { blocked: false, deleted };
	});
};

type RootDeleteResult = { state: 'blocked' | 'missing' } | { state: 'deleted'; doc: ThingDoc };

// Root deletion is the final bounded transaction. The no-child check and root
// before-image delete share one snapshot; target-attached creates also write
// the root, so a concurrent attachment either becomes visible on transaction
// retry or loses to the deletion and aborts cleanly.
const deleteDrainedRootAtomically = async (deleteFilter: Record<string, any>): Promise<RootDeleteResult> => {
	const things = await getThingsCollection();
	return withMongoTransaction(async (session) => {
		const root = (await things.findOne(deleteFilter as any, { session })) as any as ThingDoc | null;
		if (!root) return { state: 'missing' };
		const child = await things.findOne({ ...cascadeAttachmentFilter(cascadeLinkIdsOf(root)), _id: { $ne: (root as any)._id } } as any, {
			session,
			projection: { _id: 1 }
		});
		if (child) return { state: 'blocked' };
		const deleted = (await things.findOneAndDelete({ _id: (root as any)._id } as any, {
			session
		})) as any as ThingDoc | null;
		if (!deleted) return { state: 'missing' };
		await applyDeletedStorageDeltas([deleted], session);
		return { state: 'deleted', doc: deleted };
	});
};

// Subspace report rows hang off the ROOT post by crystal.postId (targetId =
// the subspace), so the targetId cascade never sees them; they are plumbing
// rows with nothing to refund. A deleted subspace post takes every report
// against it. A deleted COMMENT under a subspace post (with the replies that
// went with it) takes the rows that flagged one of those comments — left
// behind, the queue would keep asking the mods to judge a comment that no
// longer exists ("(a comment ↗)" 404s, and Remove would hit the innocent
// parent post). A reported comment's other rows (the post itself, other
// comments) stay.
const clearSubspaceReportsFor = async (root: ThingDoc, deletedCommentIds: ReadonlySet<string>): Promise<void> => {
	const things = await getThingsCollection();
	const kinds = thingtimeOf(root);
	if (kinds.includes('comment')) {
		const commentIds = [...new Set([root.shareId, ...deletedCommentIds])].filter(Boolean);
		// an unresolved chain leaves any rows alone (nothing to file them under)
		const { root: post } = await resolveRootPost(root);
		const subspaceId = subspaceIdOfDoc(post);
		if (!post?.shareId || !subspaceId || !commentIds.length) return;
		await things.deleteMany({ thingtime: 'subspace-report', targetId: subspaceId, 'crystal.postId': post.shareId, 'crystal.commentId': { $in: commentIds } } as any);
		return;
	}
	const subspaceId = kinds.includes('post') ? subspaceIdOfDoc(root) : null;
	if (subspaceId) await things.deleteMany({ thingtime: 'subspace-report', targetId: subspaceId, 'crystal.postId': root.shareId } as any);
};

export type DeleteThingHooks = {
	// External objects must become inaccessible before their protected source
	// Things are removed and quota is refunded. A failure leaves the root and
	// conservative charge intact for a safe retry.
	beforeCascade?: (root: ThingDoc) => Promise<Fail | { ok: true }>;
	// Optional optimistic-concurrency precondition used by previewed agent
	// mutations. It is checked against the exact root before any descendant or
	// attachment cleanup begins, so a stale preview can never delete new state.
	expectedUpdatedAt?: unknown;
};

export const deleteThing = async (
	viewerInput: string | Viewer,
	shareId: unknown,
	app: AppLens = null,
	hooks: DeleteThingHooks = {}
): Promise<Fail | { ok: true }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  // system kinds (a user's own account thing!) are never deletable through the
  // generic DELETE — $nin on the multikey array excludes them atomically. Their
  // dedicated endpoints (themes, algorithms) own deletion. Messenger kinds are
  // excluded too: a chat/community doc is one doc standing in for every
  // MEMBER's data, so owner-may-delete does not apply — their family owns the
  // whole lifecycle (leave, decline, soft delete, emoji retire). Under the app
  // lens the filter additionally carries the namespace stamp, so an app can
  // only ever delete what it stored; sandboxed tokens add their grant stamp to
  // the same atomic filter — no check-then-delete race either way.
  const sandboxTokenId = patSandboxOf(viewer);
	const deleteFilter = {
    shareId: shareId.trim(),
    ownerId: viewer.id,
    thingtime: { $nin: [...PROTECTED_THINGTIME, ...MESSENGER_THINGTIME, ...SUBSPACE_THINGTIME, UPDOWN_THINGTIME] },
    ...(app ? { appId: app.appId } : {}),
    ...(sandboxTokenId ? { $or: [{ tokenAcl: tokenAclEntryFor(sandboxTokenId) }, { createdByTokenId: sandboxTokenId }] } : {})
	};

	const initial = (await things.findOne(deleteFilter as any)) as any as ThingDoc | null;
	if (!initial) {
    if (sandboxTokenId && (await things.findOne({ shareId: shareId.trim(), ownerId: viewer.id } as any))) {
      return patSandboxFail();
    }
    return fail(404, 'Thing not found');
  }
	if (hooks.expectedUpdatedAt !== undefined && hooks.expectedUpdatedAt !== null) {
		if (typeof hooks.expectedUpdatedAt !== 'string' || Number.isNaN(new Date(hooks.expectedUpdatedAt).getTime())) {
			return fail(400, 'expectedUpdatedAt must be an ISO timestamp');
		}
		const currentUpdatedAt = new Date(initial.updatedAt);
		if (Number.isNaN(currentUpdatedAt.getTime()) || currentUpdatedAt.getTime() !== new Date(hooks.expectedUpdatedAt).getTime()) {
			return fail(409, 'Thing changed after the preview — build a new preview before deleting');
		}
	}
  // visibility fence — same judgement the update path makes: out-of-audience
  // things are untouchable (inherit acls resolve through the target chain)
  if (await patVisibilityBlocksDoc(viewer, initial)) return patVisibilityFail(viewer);
	// Pin the physical root identity across the multi-transaction drain. If a
	// competing deleter wins and a caller later reuses the same public shareId,
	// this in-flight request must never delete that replacement Thing (ABA).
	const anchoredDeleteFilter = {
		...deleteFilter,
		_id: (initial as any)._id,
		...(hooks.expectedUpdatedAt !== undefined && hooks.expectedUpdatedAt !== null ? { updatedAt: initial.updatedAt } : {})
	};

	try {
		if (hooks.beforeCascade) {
			const prepared = await hooks.beforeCascade(initial);
			if (prepared.ok === false) return prepared;
		} else {
			// Defense in depth for future/internal callers: generic cascade deletion
			// must never refund a protected attachment Thing before its external S3
			// version is permanently deleted. Home routes provide beforeCascade;
			// custom data planes cannot own private attachments.
			const attachmentChild = await things.findOne(
				{
					ownerId: initial.ownerId,
					thingtime: 'attachment',
					attachmentState: { $in: ['pending', 'finalizing', 'ready', 'deleting'] },
					targetId: { $in: cascadeLinkIdsOf(initial) }
				} as any,
				{ projection: { _id: 1 } }
			);
			if (attachmentChild) return fail(409, 'Attachment cleanup must finish before this Thing can be deleted');
		}
		// the comments deleted along the way (a reported comment takes the rows
		// that flagged it — clearSubspaceReportsFor below)
		const deletedCommentIds = new Set<string>();
		// Descendants commit leaf-first in deterministic <=100-row transactions;
		// the root remains as a durable retry anchor until the closure is empty.
		// Each batch uses exact findOneAndDelete before-images, so Mongo callback
		// retries, competing deleters, and caller retries debit transactional
		// account/app ledgers at most once. Sandbox refunds happen immediately
		// after each commit; an ambiguous sandbox failure stays conservatively
		// over-counted for its existing reconciliation path to repair.
		for (let pass = 0; pass < MAX_CASCADE_DRAIN_PASSES; pass += 1) {
			const anchoredRoot = (await things.findOne(anchoredDeleteFilter as any)) as any as ThingDoc | null;
			if (!anchoredRoot) {
				const oldRootStillExists = await things.findOne({ _id: (initial as any)._id } as any);
				return oldRootStillExists ? fail(409, 'Thing changed while it was being deleted — try again') : { ok: true };
			}
			const descendants = await discoverCascadeDescendants(anchoredRoot);
			const attachmentTargets = attachmentCascadeCleanupTargets(descendants);
			if (attachmentTargets.length) {
				if (!hooks.beforeCascade) {
					return fail(409, 'Attachment cleanup must finish before this Thing can be deleted');
				}
				// Comment/reply attachments can be deeper than the requested root. Remove
				// every exact S3 version before allowing Mongo cascade accounting to see
				// its protected attachment row, then re-walk the now-changed closure.
				for (const target of attachmentTargets) {
					const prepared = await hooks.beforeCascade(target as ThingDoc);
					if (prepared.ok === false) return prepared;
				}
				continue;
			}
			let rewalk = false;
			for (const batch of cascadeDeletionBatches(descendants)) {
				const result = await deleteCascadeBatchAtomically(batch, (initial as any)._id);
				if (result.blocked) {
					rewalk = true;
					break;
				}
				await refundDeletedNamespaceDocs(result.deleted);
				for (const gone of result.deleted) if (thingtimeOf(gone).includes('comment') && gone.shareId) deletedCommentIds.add(gone.shareId);
			}
			if (rewalk) continue;

			const rootResult = await deleteDrainedRootAtomically(anchoredDeleteFilter);
			if (rootResult.state === 'blocked') continue;
			if (rootResult.state === 'deleted') {
				await refundDeletedNamespaceDocs([rootResult.doc]);
				await clearSubspaceReportsFor(rootResult.doc, deletedCommentIds);
				// deleting a folder never deletes what's inside it — contents (and
				// subfolders) re-parent to the deleted folder's own parent, so the
				// worst a folder delete can do to your things is flatten them one level
				if (thingtimeOf(rootResult.doc).includes('folder')) {
					await things.updateMany(
						{ ownerId: viewer.id, folderId: rootResult.doc.shareId } as any,
						{ $set: { folderId: rootResult.doc.folderId || null, updatedAt: new Date() } } as any
					);
				}
  return { ok: true };
			}

			// Another authorized deleter won the root before-image. Treat the desired
			// absent state as success unless a still-live row merely stopped matching
			// our immutable authorization fence.
			const stillExists = await things.findOne({ _id: (initial as any)._id } as any);
			if (!stillExists) return { ok: true };
			return fail(409, 'Thing changed while it was being deleted — try again');
		}
		return fail(409, 'Thing kept receiving new attachments while it was being deleted — try again');
	} catch (error) {
		const storageFail = storageMutationFail(error);
		if (storageFail) return storageFail;
		throw error;
	}
};

export const deletePost = deleteThing;

export type UpdateThingInput = {
  crystal?: unknown;
  extended?: unknown;
  acl?: unknown;
  visibility?: unknown; // legacy alias, mapped onto acl
  folderId?: unknown; // move: an owned folder's shareId, or null for the root
  tags?: unknown;
  // tt:token/<id> grants — replaced whole when provided (null clears)
  tokenAcl?: unknown;
};

// Own-thing update. PATCH semantics by default: crystal patches merge over the
// existing crystal; with replaceCrystal (PUT) the crystal is taken whole. Both
// re-validate against the thing's schemas. v1 posts are upgraded to v2 shape
// on write (their embedded comments/reactions residue stays until migration).
export const updateThing = async (
  viewerInput: string | Viewer,
  shareId: unknown,
  input: UpdateThingInput,
  options: { replaceCrystal?: boolean; expectedUpdatedAt?: unknown } = {},
  app: AppLens = null
): Promise<Fail | { ok: true; thing: PublicThing; post: PublicPost | null }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Thing id is required');
  const things = await getThingsCollection();
  const doc = (await things.findOne({ shareId: shareId.trim() } as any)) as any as ThingDoc | null;
  if (!doc || (!isV2(doc) && !isPostThing(doc))) return fail(404, 'Thing not found');
  if (String(doc.ownerId) !== viewer.id) {
    // Shared editing — custom audiences may grant WRITE to picked users or
    // groups. Everything else stays a plain 404 (no existence oracle), and
    // apps never edit outside the acting user's own things. Writers touch
    // CONTENT only (crystal/extended/tags): audience, folder, and token
    // grants remain the owner's alone. Storage deltas keep billing the
    // OWNER (doc.ownerId drives every ledger below) — granting write shares
    // your quota with your writers.
    if (app) return fail(404, 'Thing not found');
    const enriched = await withFriendIds(viewer);
    if (!aclOf(doc).includes(ACL_CUSTOM) || !(await canViewInherited(doc, enriched))) {
      return fail(404, 'Thing not found');
    }
    if (aclCapabilityFor(aclOf(doc), enriched, String(doc.ownerId)) !== 'write') {
      return fail(403, 'This thing has a custom audience — you don’t have edit access 🎭');
    }
    if (input.acl !== undefined || input.visibility !== undefined || input.folderId !== undefined || input.tokenAcl !== undefined) {
      return fail(403, 'Only the owner can change a thing’s audience, folder, or token grants');
    }
  }
  if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== null) {
    if (typeof options.expectedUpdatedAt !== 'string' || Number.isNaN(new Date(options.expectedUpdatedAt).getTime())) {
      return fail(400, 'expectedUpdatedAt must be an ISO timestamp');
    }
    const currentUpdatedAt = new Date(doc.updatedAt);
    if (Number.isNaN(currentUpdatedAt.getTime()) || currentUpdatedAt.getTime() !== new Date(options.expectedUpdatedAt).getTime()) {
      return fail(409, 'Thing changed after the preview — build a new preview before updating');
    }
  }
  // app writes stay inside the namespace: a thing the acting user owns but
  // that this app didn't store is a plain 404 (no existence oracle)
  if (app && doc.appId !== app.appId) return fail(404, 'Thing not found');
  if (patSandboxBlocks(viewer, doc)) return patSandboxFail();
  // visibility fence: the thing being edited must sit inside the token's
  // audience (inherit acls resolve through the target chain)
  if (await patVisibilityBlocksDoc(viewer, doc)) return patVisibilityFail(viewer);
	const storedSandboxState = storageSandboxState(doc);
	if (doc.appId && storedSandboxState === 'invalid') {
		return fail(503, 'Thing has an invalid storage namespace marker and must be reconciled before it can be updated');
	}

  // Namespace things remain quota-accounted even when their end-user owner
  // edits them through the first-party things API instead of through an app
  // token. Root appId is server-authored, so synthesizing this storage-only
  // scope cannot let a caller enter another namespace; it simply prevents a
  // first-party update from growing app data without reserving either ledger.
  const storageScope: AppNamespaceScope | null =
    app ??
    (doc.appId
      ? {
          appId: doc.appId,
          ownerId: doc.ownerId,
          sharedRead: false,
          scopes: [],
          username: '',
					sandbox: storedSandboxState === 'sandbox' ? { space: typeof doc.sandboxSpace === 'string' ? doc.sandboxSpace : null } : null
        }
      : null);

  const thingtime = thingtimeOf(doc);
  // system kinds mutate only through their dedicated utils (profile update,
  // themes, algorithms) — never the generic PATCH/PUT surface
  if (isProtectedThingtime(thingtime)) {
    return fail(403, `${thingtime.join('+')} things are managed by their own endpoints`);
  }
  const patch = input.crystal && typeof input.crystal === 'object' && !Array.isArray(input.crystal) ? (input.crystal as Record<string, unknown>) : {};
  const nextCrystal = options.replaceCrystal ? patch : { ...crystalOf(doc), ...patch };
  // A plain-text client editing a rich-text post intentionally replaces the
  // body. Clear the old document so it cannot override the newly supplied text.
  if (
    thingtime.includes('post') &&
    Object.prototype.hasOwnProperty.call(patch, 'text') &&
    !Object.prototype.hasOwnProperty.call(patch, 'richText')
  ) {
    nextCrystal.richText = null;
  }
	// Post edits validate with the same trusted attachment context creates get:
	// an attachment-only post's crystal has no text/images, and without this
	// the sanitizer would reject every edit of it with "Say something first".
	const postAttachments =
		thingtime.includes('post') && !isCustomMongoEndpointActive() ? await boundAttachmentPresence(doc.ownerId, doc.shareId) : undefined;
	const validated = validateThingtimeCrystal(thingtime, nextCrystal, { postAttachments });
  if (isFail(validated)) return validated;

  // Re-run the createThing provenance check ONLY when this write changes the
  // schema attribution. Re-validating an unchanged (already-validated)
  // schemaId would lock the owner out of editing their own data thing if the
  // schema's author later hid or deleted it — an action outside the owner's
  // control. A changed/new schemaId must still prove the writer can see it.
  const prevSchemaId =
    typeof (crystalOf(doc) as Record<string, unknown>)?.schemaId === 'string'
      ? ((crystalOf(doc) as Record<string, unknown>).schemaId as string)
      : undefined;
  if (validated.crystal.schemaId !== undefined && validated.crystal.schemaId !== prevSchemaId) {
    const provenance = await resolveDataSchemaProvenance(validated.thingtime, validated.crystal, viewer);
    if (isFail(provenance)) return provenance;
  }

  // subspace re-gate: a write that enters/changes a subspace or its flair
  // proves posting rights again (the private fence follows the destination);
  // leaving a subspace drops the moderation state and the fence with it
  const prevSubspaceId = thingtime.includes('post') ? subspaceIdOfDoc(doc) : null;
  const nextSubspaceId = thingtime.includes('post') ? subspaceIdOfDoc({ crystal: validated.crystal }) : null;
  const subspaceChanged = prevSubspaceId !== nextSubspaceId;
  // ...but a live moderator action holds the post where it is: the drop below
  // is what makes the state subspace-local, so without this an author could
  // PATCH a removed/locked post out of its subspace and back in to land it
  // clean. Every other edit of the post still goes through.
  if (subspaceChanged && prevSubspaceId && subspaceModHoldsPost(doc.subspaceMod)) {
    return fail(403, 'Moderators have actioned this post — it can’t be moved out of its subspace 🔒');
  }
  const prevFlairId = typeof crystalOf(doc).flairId === 'string' ? (crystalOf(doc).flairId as string) : null;
  const nextFlairId = typeof validated.crystal.flairId === 'string' ? (validated.crystal.flairId as string) : null;
  let nextSubspacePrivate: boolean | null = null; // null = leave the stamp as is
  if (nextSubspaceId && (subspaceChanged || prevFlairId !== nextFlairId)) {
    const gate = await assertSubspacePosting(doc.ownerId, nextSubspaceId, nextFlairId, { roles: viewer.subspaceRoles });
    if (isFail(gate)) return gate;
    if (gate.flairId) validated.crystal.flairId = gate.flairId;
    else delete validated.crystal.flairId;
    if (subspaceChanged) nextSubspacePrivate = gate.private;
  } else if (!nextSubspaceId && prevSubspaceId) {
    nextSubspacePrivate = false;
  }

  // post crystals only — see the identical guard in createThing
  const patchedListing = thingtime.includes('post') ? (validated.crystal.listing as MarketplaceListing | null | undefined) : null;
  const categoryTag = patchedListing && typeof patchedListing.category === 'string' ? [patchedListing.category] : [];

  let tags = doc.tags || [];
  if (input.tags !== undefined) {
    const sanitized = sanitizeTags(input.tags);
    if (isFail(sanitized)) return sanitized;
    tags = [...sanitized, ...categoryTag].filter((tag, index, all) => all.indexOf(tag) === index);
  } else if (categoryTag.length) {
    // a listing PATCH that changes the category without resending tags SWAPS
    // the folded category tag — never accumulates stale categories, never
    // grows the list past the create-time fold's bound. Keyed on the category
    // actually changing (not tag membership: the new category may coincide
    // with a user tag, and the old one must STILL come out then).
		const previousCategory = thingtime.includes('post') ? (crystalOf(doc).listing as MarketplaceListing | null | undefined)?.category ?? null : null;
    if (previousCategory !== categoryTag[0]) {
      tags = [...tags.filter((tag) => tag !== previousCategory), ...categoryTag].filter((tag, index, all) => all.indexOf(tag) === index);
    }
  }

  let acl = aclOf(doc);
  if (input.acl !== undefined || input.visibility !== undefined) {
    if (acl.includes(ACL_INHERIT)) return fail(400, 'Attached things inherit their target audience');
    if (app) {
      // same clamp as create: only this user / this app's audience, and
      // widening needs the author's app-data.shared grant
      const clamped = resolveAppScopedAcl(app.appId, input.visibility, input.acl);
      if ('ok' in clamped) return fail(clamped.status, clamped.error);
      if (clamped.shared && !app.sharedRead) {
        return fail(403, 'This token was not granted the app-data.shared scope, so entries stay private');
      }
      if (clamped.acl) acl = clamped.acl;
    } else {
      const nextAcl = resolveInputAcl(input);
      if (isFail(nextAcl)) return nextAcl;
      if (nextAcl) acl = nextAcl;
    }
  }
  // …and the audience it ends up with must sit inside the token's fence too —
  // a restricted token can never move a thing across the public/private
  // boundary in either direction (publishing private data, or hiding public)
  if (!acl.includes(ACL_INHERIT) && patVisibilityBlocksAcl(viewer, acl)) return patVisibilityFail(viewer);

  // Entering hidden mints a FRESH link key — links that circulated during an
  // earlier hidden period must never resurrect on re-hide. Leaving hidden
  // keeps the field (inert: canView only honors it while acl says hidden).
  const wasHidden = aclOf(doc).includes(ACL_HIDDEN);
  const nowHidden = acl.includes(ACL_HIDDEN);
  const nextLinkKey = nowHidden && (!wasHidden || typeof doc.linkKey !== 'string' || !doc.linkKey) ? generateLinkKey() : undefined;

  // extended replaces as a whole value only when provided (undefined leaves it
  // untouched, null clears it) — both PATCH and PUT, since deep-merging
  // arbitrary JSON is ambiguous
  const extended = sanitizeExtended(input.extended);
  if (isFail(extended)) return extended;
  const hasExtendedChange = input.extended !== undefined;

  // Move: folderId only when provided (undefined leaves the thing where it is,
  // null files it back at the root). Moving a folder additionally refuses any
  // destination inside its own subtree — re-parenting must never mint a cycle.
  const hasFolderChange = input.folderId !== undefined;
  let nextFolderId = folderIdOf(doc);
  if (hasFolderChange) {
    const assignment = await resolveFolderAssignment(viewer.id, input.folderId, thingtime);
    if (isFail(assignment)) return assignment;
    if (
      assignment.folderId &&
      thingtime.includes('folder') &&
      (await folderAncestryContains(viewer.id, assignment.folderId, doc.shareId))
    ) {
      return fail(400, 'A folder cannot be moved into itself or its own subfolders');
    }
    nextFolderId = assignment.folderId;
  }

  // token grants replace whole too (merging grant lists is ambiguous; null
  // clears). The sandbox guard above already ran, so a sandboxed token can
  // only re-grant on things it holds a grant on — and it may lock itself out
  // by dropping its own entry, like chmod.
  const nextTokenAcl = sanitizeTokenAcl(input.tokenAcl);
  if (isFail(nextTokenAcl)) return nextTokenAcl;

	const nextExtended = hasExtendedChange ? extended.value : doc.extended ?? null;
	const newSize = thingStorageSizeBytes({ crystal: validated.crystal, extended: nextExtended, tags });
	// Same home-plane rule as createThing: under a data-plane endpoint override
	// this row lives on the user's own MongoDB — account accounting (and its
	// content stamps) never applies, even to synced-in rows that carry stamps.
	const accountPlaneApplies = !isCustomMongoEndpointActive();
	const wasBillable = isBillableStorageThing(doc) && accountPlaneApplies;
	const nextStorageDoc: ThingDoc = {
		...doc,
		schemaVersion: THINGS_SCHEMA_VERSION,
		thingtime,
      crystal: validated.crystal,
		extended: nextExtended,
      tags
	};
	const isBillable = isBillableStorageThing(nextStorageDoc) && accountPlaneApplies;
	const registeredStorageScope = storageScope && !storageScope.sandbox ? storageScope : null;
	const currentSourceBytes = currentContentSizeBytes(doc);
	if ((wasBillable || registeredStorageScope) && currentSourceBytes === null) {
		// Never turn an uncertain legacy baseline into a current-looking stamp by
		// applying only new-old. Even before a ledger is published ready, racing
		// migration activation could otherwise certify a total which omitted the
		// old row. The idempotent storage migration is the sole baseline writer.
		return fail(503, 'Thing requires the current storage migration before it can be updated');
	}
	const oldStorageBytes = currentSourceBytes ?? storedThingSizeBytes(doc);
	const accountDelta = (isBillable ? newSize : 0) - (wasBillable ? oldStorageBytes : 0);
	const appDelta = storageScope ? newSize - oldStorageBytes : 0;
	const storageTracked = wasBillable || isBillable || !!storageScope;

	// Sandbox namespaces retain their ephemeral/windowed pre-reservation path.
	// Real account + registered-app deltas are applied below inside one Mongo
	// transaction with the document CAS.
	if (storageScope?.sandbox && appDelta > 0) {
		const charge = await chargeAppStorage(storageScope, appDelta);
      if (charge.ok === false) return fail(charge.status, charge.error);
    }

  const now = new Date();
  const set: Record<string, any> = {
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime,
    crystal: validated.crystal,
    ...(hasExtendedChange ? { extended: extended.value } : {}),
    ...(nextTokenAcl !== undefined ? { tokenAcl: nextTokenAcl } : {}),
    targetId: targetIdOf(doc),
    ...(hasFolderChange ? { folderId: nextFolderId } : {}),
    tags,
    acl,
    ...(nextLinkKey ? { linkKey: nextLinkKey } : {}),
    updatedAt: now,
    ...(nextSubspacePrivate === true ? { subspacePrivate: true } : {}),
		...(storageScope ? { appId: storageScope.appId } : {}),
		...(isBillable || storageScope ? { sizeBytes: newSize } : {}),
		...(isBillable
			? {
					storageClass: 'content',
					storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
				}
			: {})
  };
  // upgrading a v1 post in place — clear the legacy crystal-at-root fields the
  // v2 shape replaces (embedded comments/reactions stay for the migration).
  // A tokenAcl replacement also clears the legacy round-2 stamp, so a removed
  // grant can't resurrect through the tokenAclOf back-compat read.
  const unset: Record<string, any> = {
    kind: '',
    type: '',
    text: '',
    images: '',
    listing: '',
    shareOfId: '',
    shareCount: '',
    visibility: '',
    ...(nextSubspacePrivate === false ? { subspacePrivate: '' } : {}),
    ...(subspaceChanged ? { subspaceMod: '' } : {}),
		...(nextTokenAcl !== undefined ? { createdByTokenId: '' } : {}),
		...(!isBillable ? { storageClass: '', storageAccountingVersion: '' } : {}),
		...(!isBillable && !storageScope ? { sizeBytes: '' } : {})
  };
	const expectedSize = storageTracked
    ? Object.prototype.hasOwnProperty.call(doc, 'sizeBytes')
      ? { sizeBytes: doc.sizeBytes }
      : { sizeBytes: { $exists: false } }
    : {};
  let writeResult;
  try {
		if (wasBillable || isBillable || registeredStorageScope) {
			await withMongoTransaction(async (session) => {
				if (accountDelta !== 0) await applyUserStorageDelta(doc.ownerId, accountDelta, session);
				if (registeredStorageScope && appDelta !== 0) {
					await applyAppStorageDeltaTransaction(registeredStorageScope, appDelta, session);
				}
				writeResult = await things.updateOne(
					{
						_id: (doc as any)._id,
						...expectedSize,
						...(options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== null ? { updatedAt: doc.updatedAt } : {})
					} as any,
					{ $set: set, $unset: unset } as any,
					{ session }
				);
				if (writeResult.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Thing changed while it was being updated — try again');
				}
			});
		} else {
    writeResult = await things.updateOne(
      {
        _id: (doc as any)._id,
        ...expectedSize,
        ...(options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== null ? { updatedAt: doc.updatedAt } : {})
      } as any,
      { $set: set, $unset: unset } as any
    );
  }
	} catch (error) {
		const storageFail = storageMutationFail(error);
		if (storageFail) return storageFail;
		// Sandbox accounting deliberately retains a positive reservation after an
		// ambiguous result; its existing reconciliation path repairs over-counting.
		throw error;
	}
	if (writeResult.matchedCount === 0) {
		if (storageScope?.sandbox && appDelta > 0) await refundAppStorage(storageScope, appDelta);
    return fail(409, 'Thing changed while it was being updated — try again');
  }
	if (storageScope?.sandbox && appDelta < 0) await refundAppStorage(storageScope, -appDelta);

  const updated = { ...doc, ...set } as ThingDoc;
  delete (updated as any).kind;
  delete (updated as any).type;
  delete (updated as any).text;
  delete (updated as any).images;
  delete (updated as any).listing;
  delete (updated as any).shareOfId;
  delete (updated as any).shareCount;
  delete (updated as any).visibility;
  if (nextTokenAcl !== undefined) delete (updated as any).createdByTokenId;
  if (subspaceChanged) delete (updated as any).subspaceMod;
  if (nextSubspacePrivate === false) delete (updated as any).subspacePrivate;
	if (!isBillable) {
		delete updated.storageClass;
		delete updated.storageAccountingVersion;
		if (!storageScope) delete updated.sizeBytes;
	}

  // A text-changing edit notifies newly ADDED @mentions (posts + comments):
  // the composer autocomplete and PostCard linkification treat edited text
  // exactly like created text, so the notification contract must too. Same
  // grammar, exclusions, and visibility gate as the create pass
  // (emitTextMentions), with the pre-edit text as the baseline — names
  // already present never re-ring. Custom data planes never ring the home
  // bell (same rule as emitCreationNotifications); emit* never throws, so a
  // notification hiccup can't fail the update that carried it.
  if (!isCustomMongoEndpointActive() && (thingtime.includes('post') || thingtime.includes('comment'))) {
    const previousText = crystalOf(doc).text;
    const nextText = crystalOf(updated).text;
    if (typeof nextText === 'string' && nextText !== previousText) {
      const parentId = targetIdOf(updated);
      const parent = parentId ? await findThing(parentId) : null;
      await emitTextMentions(updated, parent, { id: viewer.id, username: viewer.username || null }, previousText);
    }
  }

	// Edited moderated content (prose, listing text, tags, image URLs) gets
	// re-screened: the old verdict describes content that no longer exists
	// (emptied content clears a stale pipeline stamp). The analyzer refuses to
	// overwrite admin review stamps and no-ops on custom data planes.
	if (
		thingtimeOf(updated).some((kind) => TEXT_MODERATED_THINGTIMES.has(kind)) &&
		moderatedContentFingerprint(moderatedContentOf(updated as any)) !== moderatedContentFingerprint(moderatedContentOf(doc as any))
	) {
		queueTextModeration(doc.shareId);
	}

  const thing = (await toPublicThings([updated], viewer))[0];
  if (app) {
    await appShapeProjections(app, [updated], [thing]);
    return { ok: true, thing, post: null };
  }
  const post = isPostThing(updated) ? (await toPublicPosts([updated], viewer))[0] : null;
  return { ok: true, thing, post };
};

// PUT semantics: create the thing at a caller-chosen id when it doesn't exist,
// otherwise replace the owned thing's crystal (and any provided audience/tags).
export const upsertThing = async (
  ownerId: string,
  input: CreateThingInput,
  viewer: Viewer = null,
  app: AppLens = null
): Promise<Fail | { ok: true; created: boolean; thing: PublicThing; post: PublicPost | null }> => {
  const shareId = sanitizeShareId(input.shareId);
  if (isFail(shareId)) return shareId;
  if (!shareId) return fail(400, 'Upserts need an id (the shareId to create or replace)');

  const existing = await findThing(shareId);
  if (!existing) {
    const created = await createThing(ownerId, { ...input, shareId }, viewer, app);
    if (isFail(created)) return created;
    const projectViewer = viewer && viewer.id === ownerId ? viewer : { id: ownerId };
    const thing = (await toPublicThings([created.doc], projectViewer))[0];
    if (app) {
      await appShapeProjections(app, [created.doc], [thing]);
      return { ok: true, created: true, thing, post: null };
    }
    const post = isPostThing(created.doc) ? (await toPublicPosts([created.doc], projectViewer))[0] : null;
    return { ok: true, created: true, thing, post };
  }

  if (existing.ownerId !== ownerId) return fail(404, 'Thing not found');
  // same 404 as the ownership miss — a PUT against a thing outside this
  // app's namespace must not read differently than "no such thing"
  if (app && existing.appId !== app.appId) return fail(404, 'Thing not found');
  // A thing's schemas are immutable, but an omitted/empty thingtime is the
  // schema-less default (['data']) — treat those as "no change requested" so
  // re-PUTting a data thing without repeating thingtime isn't a false conflict.
  // A non-array, non-empty thingtime is a real (rejected) attempt to change it.
  const thingtimeProvided =
    input.thingtime !== undefined && input.thingtime !== null && !(Array.isArray(input.thingtime) && input.thingtime.length === 0);
  if (thingtimeProvided) {
    const wanted = Array.isArray(input.thingtime) ? [...input.thingtime].sort().join(',') : String(input.thingtime);
    if (wanted !== [...thingtimeOf(existing)].sort().join(',')) {
      return fail(400, 'A thing’s thingtime schemas can’t be changed');
    }
  }
  const updated = await updateThing(viewer || ownerId, shareId, input as UpdateThingInput, { replaceCrystal: true }, app);
  if (isFail(updated)) return updated;
  return { ok: true, created: false, thing: updated.thing, post: updated.post };
};

// ---------------------------------------------------------------------------
// Bulk operations for /things multi-select: move / copy / delete / share up to
// MAX_BULK_IDS things in one request. Each item goes through the SAME
// single-item path the app uses everywhere else (updateThing / createThing /
// deleteThing) — bulk is a loop, never a second code path, so every ownership,
// protected-kind, folder, cycle, and validation rule holds identically
// (DECISIONS.md: test == live == direct API). Folder copies and recursive
// shares walk the subtree through those same per-item paths, bounded by
// MAX_FOLDER_TREE_THINGS so a runaway tree fails loudly instead of half-applying.

export const MAX_BULK_IDS = 100;
const BULK_OPS = ['move', 'copy', 'delete', 'share'] as const;
export type BulkOp = (typeof BULK_OPS)[number];

export type BulkThingsInput = {
  op?: unknown;
  ids?: unknown;
  folderId?: unknown; // move/copy destination (null/omitted = root)
  acl?: unknown; // share: the audience to apply
  visibility?: unknown; // share: legacy circle alias, mapped onto acl
  recursive?: unknown; // share: folders also apply the acl to everything inside
};

export type BulkItemResult = {
  id: string;
  ok: boolean;
  error?: string;
  newId?: string;
  // recursive folder ops: how many descendants were copied / acl-updated and
  // how many were skipped (uncopyable kinds, inherit-locked audiences)
  copied?: number;
  applied?: number;
  skipped?: number;
};

// Kinds that can't be duplicated: attached children live under their target
// (a copy would dangle). Folders CAN be copied — the whole subtree is walked
// through the same per-item create path, skipping these kinds inside.
const UNCOPYABLE = ['comment', 'reaction', 'save', 'share', 'vote', UPDOWN_THINGTIME];

// Recursive folder op bound (copy / recursive share): the subtree walk fails
// loudly past this many things instead of silently truncating.
export const MAX_FOLDER_TREE_THINGS = 500;

// Breadth-first subtree collection for recursive folder ops. Parents come
// before their children (copy needs the new parent id first), cycle-safe via
// the visited set, and honest about overflow: `truncated` means the caller
// must refuse the op, never half-apply it.
const collectFolderTree = async (
  ownerId: string,
  rootFolderId: string
): Promise<{ docs: ThingDoc[]; truncated: boolean }> => {
  const things = await getThingsCollection();
  const docs: ThingDoc[] = [];
  const visitedFolders = new Set<string>([rootFolderId]);
  let frontier = [rootFolderId];
  for (let depth = 0; frontier.length && depth < MAX_FOLDER_DEPTH; depth += 1) {
    const children = (await things
      .find({ ownerId, folderId: { $in: frontier } } as any)
      .limit(MAX_FOLDER_TREE_THINGS + 1)
      .toArray()) as any as ThingDoc[];
    const nextFrontier: string[] = [];
    for (const child of children) {
      if (docs.length >= MAX_FOLDER_TREE_THINGS) return { docs, truncated: true };
      docs.push(child);
      if (thingtimeOf(child).includes('folder') && !visitedFolders.has(child.shareId)) {
        visitedFolders.add(child.shareId);
        nextFrontier.push(child.shareId);
      }
    }
    frontier = nextFrontier;
  }
  return { docs, truncated: frontier.length > 0 };
};

export const bulkThings = async (
  viewerInput: string | Viewer,
  input: BulkThingsInput
): Promise<Fail | { ok: true; op: BulkOp; results: BulkItemResult[]; succeeded: number; failed: number }> => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');

  const op = typeof input.op === 'string' ? (input.op as BulkOp) : null;
  if (!op || !BULK_OPS.includes(op)) return fail(400, 'op must be move, copy, or delete');

  if (!Array.isArray(input.ids) || !input.ids.length) return fail(400, 'ids must be a non-empty list of thing ids');
  const ids: string[] = [];
  for (const entry of input.ids) {
    if (typeof entry !== 'string' || !entry.trim()) return fail(400, 'ids must be a non-empty list of thing ids');
    const id = entry.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_BULK_IDS) return fail(400, `At most ${MAX_BULK_IDS} things per bulk request`);

  // move/copy destination validated once up front so a bad folder fails the
  // whole request loudly instead of 100 identical per-item errors
  let folderId: string | null = null;
  if (op === 'move' || op === 'copy') {
    const assignment = await resolveFolderAssignment(viewer.id, input.folderId, []);
    if (isFail(assignment)) return assignment;
    folderId = assignment.folderId;
  }
  // share audience validated the same way (updateThing revalidates per item —
  // this just makes an empty/garbage acl fail the whole batch loudly)
  const recursive = input.recursive === true;
  if (op === 'share') {
    if (input.acl === undefined && input.visibility === undefined) {
      return fail(400, 'share needs an acl (or a legacy visibility circle)');
    }
    const parsed = resolveInputAcl({ acl: input.acl, visibility: input.visibility });
    if (isFail(parsed)) return parsed;
    if (!parsed) return fail(400, 'share needs an acl (or a legacy visibility circle)');
  }
  const sharePatch = { acl: input.acl, visibility: input.visibility } as UpdateThingInput;

  // copy one doc through the real create path (validation, acl defaults,
  // provenance re-checks, storage accounting all apply). `nameHint` adds the
  // Drive-style "Copy of" prefix to any NAMED top-level copy (crystal.name is
  // metadata — data, folder, schema, …) so a copy is never indistinguishable
  // from its original. Inner (subtree) names keep; unnamed kinds like posts
  // keep their content untouched (title/text is content, not a filename).
  const copyOne = async (doc: ThingDoc, destination: string | null, nameHint: boolean) => {
    const thingtime = thingtimeOf(doc);
    const crystal: Record<string, any> = { ...crystalOf(doc) };
    if (nameHint && typeof crystal.name === 'string' && crystal.name.trim()) {
      crystal.name = `Copy of ${crystal.name}`.slice(0, 120);
    }
    return createThing(
      viewer.id,
      {
        thingtime,
        crystal,
        extended: doc.extended ?? undefined,
        acl: aclOf(doc),
        tags: doc.tags || [],
        folderId: destination
      },
      viewer
    );
  };

  const things = await getThingsCollection();
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    if (op === 'delete') {
      const result = await deleteThing(viewer, id);
      results.push('error' in result ? { id, ok: false, error: result.error } : { id, ok: true });
      continue;
    }
    if (op === 'move') {
      const result = await updateThing(viewer, id, { folderId });
      results.push('error' in result ? { id, ok: false, error: result.error } : { id, ok: true });
      continue;
    }

    // copy/share both need the doc (kind checks, folder recursion)
    const doc = (await things.findOne({ shareId: id, ownerId: viewer.id } as any)) as any as ThingDoc | null;
    if (!doc || (!isV2(doc) && !isPostThing(doc))) {
      results.push({ id, ok: false, error: 'Thing not found' });
      continue;
    }
    const thingtime = thingtimeOf(doc);
    const isFolderDoc = thingtime.includes('folder');

    if (op === 'share') {
      const result = await updateThing(viewer, id, sharePatch);
      if ('error' in result) {
        results.push({ id, ok: false, error: result.error });
        continue;
      }
      if (!recursive || !isFolderDoc) {
        results.push({ id, ok: true });
        continue;
      }
      // recursive folder share: the same acl flows to everything inside via
      // the same updateThing path. Inherit-locked things (attached comments/
      // shares) refuse audience changes — counted as skipped, never silently
      // changed. Oversized trees refuse before touching anything below.
      const tree = await collectFolderTree(viewer.id, doc.shareId);
      if (tree.truncated) {
        results.push({ id, ok: true, applied: 0, skipped: 0, error: `Folder audience applied, but it holds more than ${MAX_FOLDER_TREE_THINGS} things — share the subfolders directly` });
        continue;
      }
      let applied = 0;
      let skipped = 0;
      let firstError: string | undefined;
      for (const child of tree.docs) {
        const childResult = await updateThing(viewer, child.shareId, sharePatch);
        if ('error' in childResult) {
          skipped += 1;
          if (!firstError) firstError = childResult.error;
        } else {
          applied += 1;
        }
      }
      results.push({ id, ok: true, applied, skipped, ...(skipped && firstError ? { error: firstError } : {}) });
      continue;
    }

    // copy — mint NEW things through the real create path. Folders copy their
    // whole subtree (bounded), skipping uncopyable kinds with honest counts.
    const blocked = UNCOPYABLE.find((kind) => thingtime.includes(kind));
    if (blocked) {
      results.push({ id, ok: false, error: `${blocked} things can’t be copied` });
      continue;
    }
    if (!isFolderDoc) {
      const created = await copyOne(doc, folderId, true);
      results.push('error' in created ? { id, ok: false, error: created.error } : { id, ok: true, newId: created.doc.shareId });
      continue;
    }
    const tree = await collectFolderTree(viewer.id, doc.shareId);
    if (tree.truncated) {
      results.push({ id, ok: false, error: `Folders with more than ${MAX_FOLDER_TREE_THINGS} things inside can’t be copied in one go` });
      continue;
    }
    const rootCopy = await copyOne(doc, folderId, true);
    if ('error' in rootCopy) {
      results.push({ id, ok: false, error: rootCopy.error });
      continue;
    }
    // old folder id → its copy's id; children whose parent copy failed are
    // skipped (never re-rooted somewhere surprising)
    const idMap = new Map<string, string>([[doc.shareId, rootCopy.doc.shareId]]);
    let copied = 0;
    let skipped = 0;
    for (const child of tree.docs) {
      const childKinds = thingtimeOf(child);
      const parentNewId = child.folderId ? idMap.get(child.folderId) : undefined;
      if (!parentNewId || childKinds.some((kind) => UNCOPYABLE.includes(kind)) || (!isV2(child) && !isPostThing(child))) {
        skipped += 1;
        continue;
      }
      const childCopy = await copyOne(child, parentNewId, false);
      if ('error' in childCopy) {
        skipped += 1;
      } else {
        copied += 1;
        if (childKinds.includes('folder')) idMap.set(child.shareId, childCopy.doc.shareId);
      }
    }
    results.push({ id, ok: true, newId: rootCopy.doc.shareId, copied, skipped });
  }

  const succeeded = results.filter((entry) => entry.ok).length;
  return { ok: true, op, results, succeeded, failed: results.length - succeeded };
};

// Public post count for a profile header — kept here so no route touches the
// things collection directly.
export const countPublicPosts = async (ownerId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments(withMatch(postMatch(), { ownerId }, circleClause('public')) as any);
};

// Activity heatmap window: exactly the days the client's 53-column
// Sunday-first UTC grid renders — 52 full weeks plus the current partial week
// (52*7 + todayDow + 1 days including today), cut at UTC midnight. Matching
// the grid keeps the caption total equal to the sum of visible cells: no
// zero-rendered cells older than the window, no counted days the grid never
// draws, and the oldest day is a full day, not a rolling-instant partial.
const ACTIVITY_MS_DAY = 86_400_000;
export const activityWindowStart = (nowMs = Date.now()): Date => {
  const todayMs = nowMs - (nowMs % ACTIVITY_MS_DAY); // UTC midnight today
  return new Date(todayMs - (364 + new Date(todayMs).getUTCDay()) * ACTIVITY_MS_DAY);
};

// What counts as "activity" for the profile heatmap: every thing the user
// authored (posts, comments, reactions, saves, folders, schemas, data
// things…) INCLUDING poll votes — explicit user actions are activity even
// though votes bill as control-plane plumbing. Everything else on the
// control-plane list (user/friend/notification/subscription/messenger
// index rows, app-storage counters, migration diagnostics…) is server-minted
// platform overhead and would inflate the graph meaninglessly, so the
// storage classification's judgment is reused wholesale minus the vote
// carve-out.
const ACTIVITY_EXCLUDED_THINGTIMES: string[] = CONTROL_PLANE_STORAGE_THINGTIMES.filter((kind) => kind !== 'vote');

// Day-bucketed counts of a user's viewer-visible things over the last year —
// the profile contribution heatmap. COUNTS ONLY: no content, no kind
// breakdown, so the response is privacy-cheap by construction. Visibility
// reuses listUserPosts' exact DB tiering for this viewer (owners see every
// circle, friends see public+friends, everyone else public only). Like
// countPublicPosts (the profile header's count), the aggregation stays at the
// DB tier — the coarse circle superset — without the per-doc in-memory canView
// refinement a fetched page gets, so per-user acl grants/exclusions round to
// their circle. Kept here so no route touches the things collection directly.
export const getUserActivity = async (
  viewerInput: string | Viewer,
  username: string
): Promise<{ ok: true; days: Record<string, number>; total: number; firstDayUtc: string } | Fail> => {
  if (typeof username !== 'string' || !username.trim()) return fail(400, 'username is required');
  const viewer = await withFriendIds(asViewer(viewerInput));
  const user = await findUserByUsername(username.trim());
  if (!user) return fail(404, 'User not found');

  const ownerId = String(user._id);
  const own = viewer?.id === ownerId;
  // a friend browsing this profile also sees the owner's friends-circle
  // activity — the same audience tiers as listUserPosts
  const friendOfOwner = !!viewer?.friendIds?.has(ownerId);
  const audience = own ? {} : friendOfOwner ? { $or: [circleClause('public'), circleClause('friends')] } : circleClause('public');

  // index-friendly: ownerId + createdAt lead the match (ownerId-prefixed
  // index), and $gte on a Date only ever matches BSON dates — so the
  // $dateToString below never sees a null/absent createdAt
  const start = activityWindowStart();
  const match = withMatch({ ownerId, createdAt: { $gte: start } }, { thingtime: { $nin: ACTIVITY_EXCLUDED_THINGTIMES } }, audience);

  const things = await getThingsCollection();
  // one bounded pipeline: match (indexed superset) → group by UTC day string
  const rows = (await things
    .aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }])
    .toArray()) as { _id: string; count: number }[];

  const days: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    days[row._id] = row.count;
    total += row.count;
  }
  return { ok: true, days, total, firstDayUtc: start.toISOString().slice(0, 10) };
};

// Existence probe for idempotent seeding: which of these shareIds already have
// a things doc. One indexed query instead of a per-item create→409 round trip,
// so a time-boxed serverless seed run spends its budget creating, not
// re-walking skips. Kept here so no script touches the collection directly.
export const listExistingThingShareIds = async (shareIds: string[]): Promise<Set<string>> => {
  const wanted = [...new Set(shareIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (!wanted.length) return new Set();
  const things = await getThingsCollection();
  const docs = await things
    .find({ shareId: { $in: wanted } } as any)
    .project({ shareId: 1 })
    .toArray();
  return new Set(docs.map((doc) => String(doc.shareId)));
};

// Feature lookup used by algorithm training — only returns posts the engaging
// user can actually see.
export const getPostFeatures = async (viewerInput: string | Viewer, shareIds: string[]): Promise<Map<string, PostFeatures>> => {
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

// Registered at module scope: when the moderation pipeline RELEASES a
// born-pending doc (verdict clear/nsfw), its creation notifications fire now —
// followers hear about a post at the moment it becomes visible to them.
setModerationReleaseNotifier((shareId) => {
	void (async () => {
		const doc = await findThing(shareId);
		if (!doc) return;
		const target = (doc as any).targetId ? await findThing(String((doc as any).targetId)) : null;
		await emitCreationNotifications(doc, target, asViewer(String(doc.ownerId)));
	})().catch((error) => console.warn('[moderation] release notification failed:', (error as Error)?.message || error));
});
