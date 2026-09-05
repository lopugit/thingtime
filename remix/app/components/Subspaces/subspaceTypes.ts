// Client-side shapes for the subspace APIs. Mirrors the public projections in
// remix/app/api/utils/subspaces/subspaces.ts — the API utils are the source
// of truth; keep this file in sync with them.
import type { FeedAuthor, PublicAuthorFlair, PublicPost, SubspaceAccess, SubspaceRole } from '~/components/Feed/feedTypes';

export type { PublicAuthorFlair, SubspaceAccess, SubspaceRole };

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
	// an open join request to a private subspace (not a member yet)
	pending: boolean;
	// asked the mods for posting approval (restricted subspaces)
	approvalRequested: boolean;
	// the flair the viewer wears here (active members only)
	userFlair: PublicAuthorFlair | null;
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
	// user flairs: the templates members wear beside their name + the two
	// self-service switches (moderators are bound by neither)
	userFlairs: SubspaceFlair[];
	userFlairSelfAssign: boolean;
	allowCustomUserFlair: boolean;
	branding: SubspaceBranding;
	ownerId: string;
	memberCount: number;
	postCount?: number;
	// moderators only (detail): sizes of the Requests queues
	pendingCount?: number;
	approvalRequestCount?: number;
	createdAt: string;
	updatedAt: string;
	viewer: PublicSubspaceViewer;
};

// open requests a moderator sees (badge on Mod tools 🎩 / the Requests tab)
export const openRequestCount = (subspace: Pick<PublicSubspace, 'pendingCount' | 'approvalRequestCount'> | null | undefined): number =>
	(subspace?.pendingCount || 0) + (subspace?.approvalRequestCount || 0);

export type PublicSubspaceMember = {
	userId: string;
	profile: FeedAuthor | null;
	role: SubspaceRole;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: string | null;
	left: boolean;
	pending: boolean;
	approvalRequested: boolean;
	// the flair they wear here (null when none)
	userFlair: PublicAuthorFlair | null;
	joinedAt: string;
};

// what a viewer may do about their own flair here: pick a template (any
// non-modOnly one while self-assign is on), type custom text (while allowed),
// or nothing but clear. Moderators are bound by neither switch.
export const userFlairChoices = (subspace: Pick<PublicSubspace, 'userFlairs' | 'userFlairSelfAssign' | 'allowCustomUserFlair' | 'viewer'>) => {
	const moderator = subspace.viewer.canModerate;
	const templates = moderator ? subspace.userFlairs : subspace.userFlairSelfAssign ? subspace.userFlairs.filter((flair) => !flair.modOnly) : [];
	return { templates, custom: moderator || (subspace.userFlairSelfAssign && subspace.allowCustomUserFlair) };
};

// POST /api/v1/subspaces/join — joined: true for public/restricted;
// pending: true when a PRIVATE subspace filed a join request instead
export type SubspaceJoinResponse = { ok: true; subspace: PublicSubspace; joined: boolean; pending: boolean };
export type SubspaceMemberResponse = { ok: true; member: PublicSubspaceMember };

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

// POST /api/v1/subspaces/transfer — the subspace as the (now moderator)
// caller sees it + the new owner's member row
export type SubspaceTransferResponse = { ok: true; subspace: PublicSubspace; newOwner: PublicSubspaceMember };
// POST /api/v1/subspaces/delete — how many posts left the subspace
// (releasedPosts), how many of those stayed private to their authors
// (privatePosts: posts of a private subspace + posts the mods had removed —
// the owner's click never publishes them) and how many member rows (incl.
// ban records) were removed
export type SubspaceDeleteResponse = { ok: true; releasedPosts: number; privatePosts: number; removedMembers: number };

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
	private: { label: 'Private', emoji: '🔒', hint: 'Members only — request to join, a moderator lets you in' }
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
