// Client-side shapes for the subspace APIs. Mirrors the public projections in
// remix/app/api/utils/subspaces/subspaces.ts — the API utils are the source
// of truth; keep this file in sync with them.
import type { FeedAuthor, PublicPost, SubspaceAccess, SubspaceRole } from '~/components/Feed/feedTypes';

export type { SubspaceAccess, SubspaceRole };

export type SubspaceRule = { title: string; text: string | null };
export type SubspaceFlair = { id: string; label: string; emoji: string | null; color: string | null; modOnly: boolean };
export type SubspaceBranding = { icon: string | null; iconUrl: string | null; bannerUrl: string | null; accent: string | null };

export type PublicSubspaceViewer = {
	role: SubspaceRole | null;
	member: boolean;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: string | null;
	canModerate: boolean;
	canPost: boolean;
};

export type PublicSubspace = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	access: SubspaceAccess;
	nsfw: boolean;
	rules: SubspaceRule[];
	flairs: SubspaceFlair[];
	branding: SubspaceBranding;
	ownerId: string;
	memberCount: number;
	postCount?: number;
	createdAt: string;
	updatedAt: string;
	viewer: PublicSubspaceViewer;
};

export type PublicSubspaceMember = {
	userId: string;
	profile: FeedAuthor | null;
	role: SubspaceRole;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: string | null;
	left: boolean;
	joinedAt: string;
};

export type PublicModlogEntry = {
	id: string;
	action: string;
	actor: FeedAuthor | null;
	user: FeedAuthor | null;
	userId: string | null;
	postId: string | null;
	reason: string | null;
	detail: Record<string, unknown> | null;
	createdAt: string;
};

export type SubspaceFeedSort = 'hot' | 'new' | 'top' | 'rising' | 'controversial';
export const SUBSPACE_SORTS: { id: SubspaceFeedSort; label: string; emoji: string }[] = [
	{ id: 'hot', label: 'Hot', emoji: '🔥' },
	{ id: 'new', label: 'New', emoji: '✨' },
	{ id: 'top', label: 'Top', emoji: '🏆' },
	{ id: 'rising', label: 'Rising', emoji: '📈' },
	{ id: 'controversial', label: 'Controversial', emoji: '⚡' }
];
export type TopRange = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
export const TOP_RANGES: { id: TopRange; label: string }[] = [
	{ id: 'hour', label: 'Past hour' },
	{ id: 'day', label: 'Today' },
	{ id: 'week', label: 'This week' },
	{ id: 'month', label: 'This month' },
	{ id: 'year', label: 'This year' },
	{ id: 'all', label: 'All time' }
];

export const ACCESS_META: Record<SubspaceAccess, { label: string; emoji: string; hint: string }> = {
	public: { label: 'Public', emoji: '🌐', hint: 'Anyone can view and post' },
	restricted: { label: 'Restricted', emoji: '✋', hint: 'Anyone can view; approved posters post' },
	private: { label: 'Private', emoji: '🔒', hint: 'Members only — a moderator adds you' }
};

export type SubspaceFeedResponse = { ok: true; subspace: PublicSubspace; posts: PublicPost[]; nextCursor: string | null; sort: SubspaceFeedSort };

// What the composer needs to post INTO a subspace: identity + flairs + rights.
export type SubspaceComposerContext = {
	id: string;
	slug: string;
	name: string;
	flairs: SubspaceFlair[];
	canModerate: boolean;
	canPost: boolean;
	accent?: string | null;
	icon?: string | null;
};

export const composerContextOf = (subspace: PublicSubspace): SubspaceComposerContext => ({
	id: subspace.id,
	slug: subspace.slug,
	name: subspace.name,
	flairs: subspace.flairs,
	canModerate: subspace.viewer.canModerate,
	canPost: subspace.viewer.canPost,
	accent: subspace.branding.accent,
	icon: subspace.branding.icon
});

// the subspace's visual accent (branding.accent or the platform accent)
export const subspaceAccent = (subspace: { branding?: SubspaceBranding | null } | null | undefined): string =>
	subspace?.branding?.accent || 'var(--tt-accent, #7c5cff)';
