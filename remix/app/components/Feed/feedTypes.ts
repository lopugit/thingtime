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
export type FeedAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
};

export type PostType = 'text' | 'image' | 'marketplace' | 'thingtime';
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
  createdAt: string;
};

// Live poll tally on poll posts (posts whose thing carries question/options):
// per-option counts (index-aligned with the options), the total, and the
// viewer's own option (null = hasn't voted). Mirrors PublicPollVotes in
// api/utils/things/pollCore.ts.
export type PublicPollVotes = { counts: number[]; totalVotes: number; viewerVote: number | null };

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
  private: { label: 'Private', emoji: '🔒', hint: 'Only you' }
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
