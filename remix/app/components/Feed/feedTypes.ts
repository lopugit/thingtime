// Client-side shapes for the feed / algorithms / profile APIs. These mirror the
// public projections in remix/app/api/utils/things + algorithms + auth/users —
// the API utils are the source of truth; keep this file in sync with them.

import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import type { EditorJsDoc } from '~/components/Editor/editorJsValue';
import type { PostMediaLayout } from '~/schemas/registry';

export type { PostMediaLayout };

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
};

// Lean author embed on posts/comments — identity only (the API never sends
// bio/bannerUrl inside feed payloads).
// externalUrl is set ONLY for third-party authors of synced external posts
// (connections feeds) — consumers link there instead of a dead /profile route
export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
  externalUrl?: string | null;
};

export type PostType = 'text' | 'image' | 'marketplace' | 'thingtime';
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

// Comments share the post schema — rich comments are ["post","comment"]
// things, so the payload carries the post vocabulary plus reactions and a
// reply count. Legacy-era comments arrive with the text-only defaults.
export type PostComment = {
  id: string;
  thingtime: string[];
  author: FeedAuthor | null;
  type: PostType;
  text: string;
  richText?: EditorJsDoc | null;
  images: string[];
	attachments: PublicAttachment[];
	// owner-chosen gallery layout for the visual attachments (null = masonry)
	mediaLayout: PostMediaLayout | null;
  listing: MarketplaceListing | null;
  thing: Record<string, any> | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  // up/down votes — the separate focused reaction kind (POST /api/v1/things/updown).
  // Optional while older deployments roll out; treat absence as no votes.
  votes?: PublicUpdownVotes;
  // the author's USER flair in the root post's subspace (null outside
  // subspaces / when they wear none). Optional during rollout.
  authorFlair?: PublicAuthorFlair | null;
  // direct replies — the comment's own /post/:id page shows the thread
  commentCount: number;
  // nested replies (threads ship two levels deep, ≤ 5 per level, oldest →
  // newest; deeper levels arrive empty and load on demand)
  comments?: PostComment[];
  targetId: string | null;
  createdAt: string;
};

export type PublicPost = {
  id: string;
  type: PostType;
  // Thingtime Schema ids applied to the thing, e.g. ['post'] or ['post','share']
  thingtime: string[];
  // tt: permission entries; `visibility` above is the derived legacy name
  acl: string[];
  author: FeedAuthor | null;
  visibility: PostVisibility;
  // owner-only, hidden posts only: the secret behind /post/<id>?key=<linkKey>
  linkKey?: string;
  text: string;
  richText?: EditorJsDoc | null;
  images: string[];
  // Stable metadata only. Content always resolves through the authenticated
  // attachment endpoint; feed payloads never carry S3 keys or signed URLs.
  attachments: PublicAttachment[];
	// owner-chosen gallery layout for the visual attachments (null = masonry)
	mediaLayout: PostMediaLayout | null;
  listing: MarketplaceListing | null;
  // thingtime posts: the free-form structured thing (crystal.thing)
  thing: Record<string, any> | null;
  tags: string[];
  reactionCounts: Record<string, number>;
  // every reaction token the viewer has toggled on this post (multi-react)
  viewerReactions: string[];
  // up/down votes — the separate focused reaction kind beside the emoji
  // reactions (POST /api/v1/things/updown). Optional during rollout.
  votes?: PublicUpdownVotes;
  // Subspace vocabulary (api/utils/subspaces): optional headline (any post may
  // carry one), the subspace embed + flair, and the moderation state — null
  // outside subspaces. Optional during rollout.
  title?: string | null;
  subspace?: PublicPostSubspace | null;
  flair?: PublicPostFlair | null;
  // the author's USER flair in this post's subspace (their pick beside their
  // name — a template or custom text). Optional during rollout.
  authorFlair?: PublicAuthorFlair | null;
  subspaceMod?: PublicSubspaceMod | null;
  commentCount: number;
  // Viewer-relative count layers. Optional while older deployments roll out;
  // commentCount remains the backward-compatible total.
  commentCounts?: { direct: number; replies: number; total: number; loaded: number };
  // latest comments (≤ 20), oldest → newest
  comments: PostComment[];
  shareCount: number;
  // true when this post is a share, even if the original is deleted/hidden
  isShare: boolean;
  // original post when this post is a share (resolved one level deep)
  shareOf: PublicPost | null;
  // public view stats: viewCount = unique viewers (dedup-protected),
  // impressions/avgDwellMs secondary — see api/utils/things/views.ts
  viewCount?: number;
  viewStats?: { impressions: number; avgDwellMs: number };
  // poll posts only: live per-option vote counts + the viewer's own vote
  pollVotes?: PublicPollVotes;
  // logged-in viewers only: has the viewer saved this post to their library?
  // (absent for anonymous projections — the bookmark button hides with it)
  viewerSaved?: boolean;
  // free-form extended JSON; connections posts carry `extended.external`
  // (provider, url, original author, stats) — see api/utils/connections
  extended?: Record<string, any> | null;
  // connections feed only: the viewer's AI feed-filter matches for this post
  feedFilterMatches?: FeedFilterMatch[];
  createdAt: string;
};

// Live poll tally on poll posts (posts whose thing carries question/options):
// per-option counts (index-aligned with the options), the total, and the
// viewer's own option (null = hasn't voted). Mirrors PublicPollVotes in
// api/utils/things/pollCore.ts.
export type PublicPollVotes = { counts: number[]; totalVotes: number; viewerVote: number | null };

// Up/down vote tally carried on posts and comments (mirrors PublicUpdownVotes
// in api/utils/things/updownCore.ts): raw counts, net score, the viewer's
// own vote (null = hasn't voted).
export type UpdownDirection = 'up' | 'down';
export type PublicUpdownVotes = { up: number; down: number; score: number; viewerVote: UpdownDirection | null };
export const EMPTY_VOTES: PublicUpdownVotes = { up: 0, down: 0, score: 0, viewerVote: null };

// Lean subspace embed on subspace posts (mirrors PublicPostSubspace in
// api/utils/things/things.ts) — identity + branding + the viewer's own role.
export type SubspaceAccess = 'public' | 'restricted' | 'private';
export type SubspaceRole = 'owner' | 'moderator' | 'member';
export type PublicPostSubspace = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  accent: string | null;
  access: SubspaceAccess;
  nsfw: boolean;
  viewerRole: SubspaceRole | null;
};
export type PublicPostFlair = { id: string; label: string; emoji: string | null; color: string | null };
// a user flair beside an author's name (mirrors PublicAuthorFlair in
// api/utils/things/things.ts): a template pick (id) or custom text (id null)
export type PublicAuthorFlair = { id: string | null; label: string; emoji: string | null; color: string | null };
export type PublicSubspaceMod = {
  status: 'approved' | 'removed';
  removed: boolean;
  reason: string | null;
  removedAt: string | null;
  pinned: boolean;
  locked: boolean;
  nsfw: boolean;
  spoiler: boolean;
  viewerCanModerate: boolean;
  // moderators only: open reports against the post (the 🚩 badge in the
  // subspace line); absent for everyone else
  reportCount?: number;
};

// Apply one up/down tap to a post or comment optimistically: same direction
// again clears, the other direction flips (both counters move), null clears.
// Idempotent against the FRESHEST snapshot so concurrent reactions on other
// fields are never clobbered — the reaction-toggle pattern.
export const applyUpdownVote = <T extends { votes?: PublicUpdownVotes }>(prev: T, direction: UpdownDirection | null): T => {
  const votes = prev.votes || EMPTY_VOTES;
  const current = votes.viewerVote;
  const next = current === direction ? null : direction;
  if (next === current) return prev;
  let { up, down } = votes;
  if (current === 'up') up -= 1;
  if (current === 'down') down -= 1;
  if (next === 'up') up += 1;
  if (next === 'down') down += 1;
  up = Math.max(0, up);
  down = Math.max(0, down);
  return { ...prev, votes: { up, down, score: up - down, viewerVote: next } };
};

// Comment sort inside a post (round 2 S7): GET /api/v1/things?id=&commentSort=
// ships the page in one of Reddit's three orders; the card paints the SAME
// order over the comments it already holds first (and keeps a fresh comment
// in its place after the server page lands), so this comparator mirrors the
// server's (things/updownCore.ts orderCommentPage): top = net score desc,
// ties older first; new = newest first; old = oldest first.
export const COMMENT_SORTS = ['top', 'new', 'old'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];
export const COMMENT_SORT_META: Record<CommentSort, { label: string; emoji: string; hint: string }> = {
  top: { label: 'Top', emoji: '▲', hint: 'Highest score first' },
  new: { label: 'New', emoji: '✨', hint: 'Newest first' },
  old: { label: 'Old', emoji: '🕰️', hint: 'Oldest first' }
};
export const isCommentSort = (value: unknown): value is CommentSort => (COMMENT_SORTS as readonly string[]).includes(value as string);
const commentTimeOf = (comment: Pick<PostComment, 'createdAt'>): number => {
  const time = new Date(comment.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
};
export const sortCommentPage = <T extends Pick<PostComment, 'id' | 'createdAt' | 'votes'>>(comments: readonly T[], sort: CommentSort | null): T[] => {
  if (!sort) return [...comments];
  return [...comments].sort((a, b) => {
    if (sort === 'top') {
      const scoreDelta = (b.votes?.score ?? 0) - (a.votes?.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
    }
    if (sort === 'new') return commentTimeOf(b) - commentTimeOf(a) || a.id.localeCompare(b.id);
    return commentTimeOf(a) - commentTimeOf(b) || a.id.localeCompare(b.id);
  });
};

// An optimistic comment's provisional id (PostCard's buildPendingComment)
// until the server copy swaps in.
export const isPendingComment = (comment: Pick<PostComment, 'id'>): boolean => comment.id.startsWith('pending-');

// The slice of an ORDERED level a card shows. The default page reveals
// upwards — the LAST `visible`, newest at the bottom next to the composer —
// and a sort reads top-down, the FIRST `visible`. Under a sort the viewer's
// own fresh comments (`pinnedIds`: the ones sent from this list) that fall
// outside the window stay shown, appended after it in order: a new comment
// scores 0 and is the newest, so Top and Old would otherwise bury the comment
// the viewer just posted below the fold with nothing on screen to confirm it
// landed (the optimistic-render rule: paint first).
export const windowCommentPage = <T extends Pick<PostComment, 'id'>>(ordered: readonly T[], sort: CommentSort | null, visible: number, pinnedIds: readonly string[] = []): T[] => {
  if (!sort) return ordered.slice(-visible);
  const shown = ordered.slice(0, visible);
  if (!pinnedIds.length || shown.length === ordered.length) return shown;
  const pinned = new Set(pinnedIds);
  const below = ordered.slice(visible).filter((comment) => pinned.has(comment.id));
  return below.length ? [...shown, ...below] : shown;
};

// A freshly read (sorted) page landing over the comments a card already
// holds. The page wins the order, and the viewer's own comments the page does
// not carry survive it — a pending row (its POST still in flight, so the ack
// still finds it to replace) or a saved one (`keepIds`) written after the read
// or left out of the sorted 20 — appended after the page; everything else the
// card held gives way to the page. `unseen` counts the kept rows the page's
// counts cannot include yet (pending, or created at / after the read started)
// so commentCount stays honest until the next authoritative count lands.
export const mergeCommentPage = <T extends Pick<PostComment, 'id' | 'createdAt'>>(
  page: readonly T[],
  held: readonly T[],
  keepIds: readonly string[],
  readStartedAt: number
): { comments: T[]; unseen: number } => {
  const onPage = new Set(page.map((comment) => comment.id));
  const keep = new Set(keepIds);
  const kept = held.filter((comment) => !onPage.has(comment.id) && (isPendingComment(comment) || keep.has(comment.id)));
  const unseen = kept.filter((comment) => isPendingComment(comment) || commentTimeOf(comment) >= readStartedAt).length;
  return { comments: kept.length ? [...page, ...kept] : [...page], unseen };
};

// A post update bubbled up from a card. A value replaces the post (null removes
// it); a function applies a delta to the FRESHEST post in the list — the form
// optimistic reactions use so concurrent toggles reconcile per-token instead of
// clobbering each other with a stale full snapshot.
export type PostChange = PublicPost | null | ((prev: PublicPost) => PublicPost | null);

export type AlgorithmInterest = {
  kind: 'type' | 'tag' | 'author';
  key: string;
  // resolved display label (e.g. author username) when kind is 'author'
  label?: string;
  weight: number;
};

export type PublicAlgorithm = {
  id: string;
  name: string;
  emoji: string;
  parentId: string | null;
  eventCount: number;
  lastTrainedAt: string | null;
  // "try my feed brain 🧠": the owner-granted branch invitation. The algorithm
  // itself stays private either way — mirrors PublicAlgorithm in
  // api/utils/algorithms/algorithms.ts, which is what this projects.
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  topInterests: AlgorithmInterest[];
};

export type FeedFiltersState = {
  // empty array = no filter (all)
  types: PostType[];
  circles: PostVisibility[];
  from: string | null;
  to: string | null;
};

export type EngagementSignal = 'view' | 'dwell' | 'expand' | 'react' | 'comment' | 'share';

export type EngagementEvent = {
  thingId: string;
  signal: EngagementSignal;
  dwellMs?: number;
};

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'] as const;

export const POST_TYPE_META: Record<PostType, { label: string; emoji: string }> = {
  text: { label: 'Text', emoji: '📝' },
  image: { label: 'Photos', emoji: '🖼️' },
  marketplace: { label: 'Marketplace', emoji: '🏪' },
  // the stored type key stays 'thingtime'; the badge reads "Things"
  thingtime: { label: 'Things', emoji: '📦' }
};

export const CIRCLE_META: Record<PostVisibility, { label: string; emoji: string; hint: string }> = {
  public: { label: 'Public', emoji: '🌐', hint: 'Anyone on Thingtime' },
  friends: { label: 'Friends', emoji: '🤝', hint: 'Your friends circle' },
  family: { label: 'Family', emoji: '🏡', hint: 'Your family circle' },
  private: { label: 'Private', emoji: '🔒', hint: 'Only you' },
  hidden: { label: 'Hidden', emoji: '🕵️', hint: 'Unlisted — only people with its secret link' },
  custom: { label: 'Custom', emoji: '🎭', hint: 'Pick exactly who can read, comment, or edit' }
};

export const MARKETPLACE_CATEGORY_META: Record<MarketplaceCategory, { label: string; emoji: string }> = {
  car: { label: 'Cars', emoji: '🚗' },
  tool: { label: 'Tools', emoji: '🛠️' },
  furniture: { label: 'Furniture', emoji: '🛋️' },
  service: { label: 'Services', emoji: '🧰' },
  other: { label: 'Other', emoji: '📦' }
};

// Tiny relative-time helper (no date lib in this repo) — "just now", "4m", "3h",
// "2d", then a short local date.
export const timeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Append a fetched page onto an existing post list, dropping any post whose id
// is already rendered. Ranked feed pagination re-scores a moving candidate
// window (and training shifts weights between pages), so later pages can
// re-serve ids from earlier pages; cursor pagers can also re-serve a post when
// the window shifts under a fresh insert. Duplicate ids would collide as React
// keys in PostList (and as `[data-thing-id]` view-tracking targets).
//
// `seen` grows as the page is scanned, so a page that carries the same id twice
// is also collapsed — the window that re-serves across pages can just as easily
// repeat within one. Pass an empty `prev` to dedupe a first/reset page, so every
// path into `setPosts` upholds the same "rendered ids are unique" contract.
export const appendPostsDeduped = (prev: PublicPost[], page: PublicPost[]): PublicPost[] => {
  if (!page.length) return prev;
  const seen = new Set(prev.map((post) => post.id));
  const fresh = page.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  });
  return fresh.length ? [...prev, ...fresh] : prev;
};

// The home feed's scope (GET /api/v1/things/feed?scope=): every visible post,
// or only posts from the viewer's ACTIVE subspaces — the "🪐 My subspaces"
// chip beside the algorithm menu. Persisted per browser in the sync
// localCache tier under FEED_SCOPE_CACHE_KEY so the choice paints on first
// render; guests always read `all` (they have no subspaces to scope to).
export type FeedScope = 'all' | 'subspaces';
export const FEED_SCOPE_CACHE_KEY = 'tt-feed-scope';
export const feedScopeOf = (value: unknown, loggedIn: boolean): FeedScope => (loggedIn && value === 'subspaces' ? 'subspaces' : 'all');
