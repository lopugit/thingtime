// The subspace posting/visibility gate — the small, things.ts-safe half of the
// subspace family. things.ts imports THIS module (never subspaces.ts, which
// imports things.ts for projections), so everything here talks to the
// collection directly and stays cycle-free.
//
// What lives here: membership lookups, the "may this author post here with
// this flair" decision every post write runs, the feed clauses that hide
// removed and private-subspace posts, and the root-post walk comment writes
// use to honour post locks and bans.
import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKeyFilter, thingUniqueKeysFilter } from '../mongodb/uniqueKeys';
import { MAX_SUBSPACE_MEMBERSHIPS_PER_USER, type SubspaceAccessMode, type SubspaceRole } from '~/schemas/registry';
import {
	canPostIn,
	flairById,
	isActiveMembershipState,
	isModeratorRole,
	subspaceModHoldsPost,
	userFlairOfCrystal,
	type SubspaceFlair,
	type SubspaceUserFlair
} from './subspaceCore';

// re-exported so things.ts keeps its single subspace import boundary (gate.ts)
export { subspaceModHoldsPost };

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// uniqueKeys field namespaces for the family (root uniqueKeys index —
// mongodb/uniqueKeys.ts — never crystal-path unique indexes)
export const SUBSPACE_SLUG_KEY_FIELD = 'subspaceSlug';
export const SUBSPACE_MEMBER_KEY_FIELD = 'subspaceMemberKey';
export const UPDOWN_KEY_FIELD = 'updownKey';
export const SUBSPACE_REPORT_KEY_FIELD = 'subspaceReportKey';

export const subspaceMemberKeyOf = (subspaceId: string, userId: string): string => `${subspaceId}:${userId}`;
// one report per (post, reporter) — the root post's id, never a comment's
export const subspaceReportKeyOf = (postId: string, reporterId: string): string => `${postId}:${reporterId}`;

export type SubspaceMembership = {
	subspaceId: string;
	role: SubspaceRole;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: Date | null;
	left: boolean;
	// a join request awaiting a moderator (private subspaces): the row exists
	// so the request can be listed/accepted/denied, but it is NOT a membership
	pending: boolean;
	// an active member of a restricted subspace asking for posting approval
	approvalRequested: boolean;
	// the flair worn beside the member's name here (template snapshot or
	// custom text) — resolved against the live templates on read
	userFlair: SubspaceUserFlair | null;
};
export type ViewerSubspaceRoles = ReadonlyMap<string, SubspaceMembership>;

const roleOf = (value: unknown): SubspaceRole => (value === 'owner' || value === 'moderator' ? value : 'member');

// Normalizes a member doc. A temporary ban whose banUntil has passed reads as
// not banned (the doc is healed lazily on the next join/mod action).
export const membershipOfDoc = (doc: any, nowMs = Date.now()): SubspaceMembership => {
	const crystal = doc?.crystal || {};
	const banUntil = crystal.banUntil instanceof Date ? crystal.banUntil : typeof crystal.banUntil === 'string' ? new Date(crystal.banUntil) : null;
	const banExpired = !!banUntil && Number.isFinite(banUntil.getTime()) && banUntil.getTime() <= nowMs;
	return {
		subspaceId: String(doc?.targetId || ''),
		role: roleOf(crystal.role),
		approved: crystal.approved === true,
		banned: crystal.banned === true && !banExpired,
		banReason: typeof crystal.banReason === 'string' ? crystal.banReason : null,
		banUntil: banUntil && Number.isFinite(banUntil.getTime()) ? banUntil : null,
		left: crystal.left === true,
		pending: crystal.pending === true,
		approvalRequested: crystal.approvalRequested === true,
		userFlair: userFlairOfCrystal(crystal)
	};
};

// row exists && !left && !banned && !pending — a pending join request is not
// a membership (it can't read a private feed, post, or count as a member)
export const isActiveMember = (membership: SubspaceMembership | null | undefined): boolean => isActiveMembershipState(membership);
export const canModerate = (membership: SubspaceMembership | null | undefined): boolean => isActiveMember(membership) && isModeratorRole(membership!.role);

export const findSubspaceById = async (id: unknown): Promise<any | null> => {
	if (typeof id !== 'string' || !id.trim()) return null;
	const things = await getThingsCollection();
	return things.findOne({ thingtime: 'subspace', shareId: id.trim() } as any);
};

export const findSubspaceBySlug = async (slug: unknown): Promise<any | null> => {
	if (typeof slug !== 'string' || !slug.trim()) return null;
	const things = await getThingsCollection();
	return things.findOne({ thingtime: 'subspace', ...thingUniqueKeyFilter(SUBSPACE_SLUG_KEY_FIELD, slug.trim().toLowerCase()) } as any);
};

// id OR slug, whichever the caller has (routes accept both)
export const findSubspace = async (ref: { id?: unknown; slug?: unknown }): Promise<any | null> =>
	(await findSubspaceById(ref.id)) || (await findSubspaceBySlug(ref.slug));

export const findSubspaceMemberDoc = async (subspaceId: string, userId: string): Promise<any | null> => {
	const things = await getThingsCollection();
	return things.findOne({ thingtime: 'subspace-member', ...thingUniqueKeyFilter(SUBSPACE_MEMBER_KEY_FIELD, subspaceMemberKeyOf(subspaceId, userId)) } as any);
};

export const membershipOf = async (subspaceId: string, userId: string | null | undefined): Promise<SubspaceMembership | null> => {
	if (!userId) return null;
	const doc = await findSubspaceMemberDoc(subspaceId, userId);
	return doc ? membershipOfDoc(doc) : null;
};

// Every membership row of one user — ONE indexed query, bounded by the
// per-user membership cap. Read paths hang the result on the Viewer so the
// sync acl checks (canView) can resolve private-subspace posts.
//
// The result is a bounded SNAPSHOT, not a complete roster: the cap bounds
// ACTIVE memberships (membershipCount in subspaces.ts counts `left != true`),
// while kicked and banned rows keep their doc forever and a moderator `add`
// mints one without re-checking the cap. So a miss means "not in the
// snapshot", NOT "not a member" — see membershipFor below.
export const loadViewerSubspaceRoles = async (userId: string | null | undefined): Promise<ViewerSubspaceRoles> => {
	const roles = new Map<string, SubspaceMembership>();
	if (!userId) return roles;
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'subspace-member', ownerId: userId } as any)
		.project({ targetId: 1, crystal: 1 })
		.limit(MAX_SUBSPACE_MEMBERSHIPS_PER_USER)
		.toArray();
	const now = Date.now();
	for (const doc of docs) {
		const membership = membershipOfDoc(doc, now);
		if (membership.subspaceId) roles.set(membership.subspaceId, membership);
	}
	return roles;
};

// Authoritative membership for ONE decision, given an optionally-preloaded
// snapshot. A hit is exact; a miss falls back to the indexed single-row
// lookup instead of being read as "no membership".
//
// Read surfaces (subspaceFeedClauses, canView, the mod flags on a projection)
// may use the snapshot alone: every one of them fails CLOSED on a miss —
// posts stay hidden, mod hats disappear. Anything that fails OPEN on a
// missing row must come through here, because the row a truncated snapshot
// dropped could be the ban that denies the write. One extra indexed findOne
// on a write path is the same query the un-preloaded path already runs.
export const membershipFor = async (
	subspaceId: string,
	userId: string | null | undefined,
	roles?: ViewerSubspaceRoles
): Promise<SubspaceMembership | null> => roles?.get(subspaceId) ?? (await membershipOf(subspaceId, userId));

export const subspaceIdOfDoc = (doc: any): string | null => {
	const id = doc?.crystal?.subspaceId;
	return typeof id === 'string' && id ? id : null;
};

export const accessOf = (subspace: any): SubspaceAccessMode => {
	const access = subspace?.crystal?.access;
	return access === 'restricted' || access === 'private' ? access : 'public';
};

export const flairsOf = (subspace: any): SubspaceFlair[] => (Array.isArray(subspace?.crystal?.flairs) ? subspace.crystal.flairs : []);
export const userFlairsOf = (subspace: any): SubspaceFlair[] => (Array.isArray(subspace?.crystal?.userFlairs) ? subspace.crystal.userFlairs : []);

// The author flairs a projected page needs — ONE indexed query for every
// (subspace, author) pair across the page's posts, shared originals and every
// shipped comment level (never per doc): the pairs become subspaceMemberKey
// uniqueKeys and ride the root uniqueKeys index. Only ACTIVE members wear a
// flair (a kicked / banned / pending row's pick stays stored but hidden).
export type AuthorFlairs = ReadonlyMap<string, SubspaceUserFlair>;
export const authorFlairKey = subspaceMemberKeyOf;
export const loadAuthorFlairs = async (pairs: readonly { subspaceId: string; userId: string }[]): Promise<AuthorFlairs> => {
	const flairs = new Map<string, SubspaceUserFlair>();
	const keys = [...new Set(pairs.filter((pair) => pair.subspaceId && pair.userId).map((pair) => subspaceMemberKeyOf(pair.subspaceId, pair.userId)))];
	if (!keys.length) return flairs;
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'subspace-member', ...thingUniqueKeysFilter(SUBSPACE_MEMBER_KEY_FIELD, keys), 'crystal.userFlair': { $type: 'object' } } as any)
		.project({ targetId: 1, ownerId: 1, crystal: 1 })
		.limit(keys.length)
		.toArray();
	const now = Date.now();
	for (const doc of docs) {
		const membership = membershipOfDoc(doc, now);
		if (!membership.userFlair || !isActiveMember(membership)) continue;
		flairs.set(subspaceMemberKeyOf(membership.subspaceId, String(doc.ownerId)), membership.userFlair);
	}
	return flairs;
};

// Open-report counts for the posts a projected page's viewer MODERATES — ONE
// $group per page over the subspace-report kind, keyed by the root post id
// (never per doc). Only moderators are ever asked for (the projection passes
// the (subspace, post) pairs it already knows the viewer can moderate), so a
// plain member's read never touches the report rows. The filter carries the
// subspace ids too so the (thingtime, targetId) shape stays index-friendly.
export type OpenReportCounts = ReadonlyMap<string, number>;
export const loadOpenReportCounts = async (pairs: readonly { subspaceId: string; postId: string }[]): Promise<OpenReportCounts> => {
	const counts = new Map<string, number>();
	const subspaceIds = [...new Set(pairs.map((pair) => pair.subspaceId).filter(Boolean))];
	const postIds = [...new Set(pairs.map((pair) => pair.postId).filter(Boolean))];
	if (!subspaceIds.length || !postIds.length) return counts;
	const things = await getThingsCollection();
	const rows = (await things
		.aggregate([
			{ $match: { thingtime: 'subspace-report', targetId: { $in: subspaceIds }, 'crystal.postId': { $in: postIds }, 'crystal.status': 'open' } },
			{ $group: { _id: '$crystal.postId', count: { $sum: 1 } } }
		])
		.toArray()) as any[];
	for (const row of rows) counts.set(String(row._id), Number(row.count) || 0);
	return counts;
};

const banMessage = (slug: string, membership: SubspaceMembership): string => {
	const until = membership.banUntil ? ` until ${membership.banUntil.toISOString().slice(0, 10)}` : '';
	const reason = membership.banReason ? ` (${membership.banReason})` : '';
	return `You are banned from s/${slug}${until}${reason} 🚫`;
};

export type PostingGateResult =
	| Fail
	| { ok: true; subspace: any; membership: SubspaceMembership | null; flairId: string | null; private: boolean; moderator: boolean };

// May `ownerId` publish a post into `subspaceId` carrying `flairId`? Runs on
// every post create AND every PATCH that touches subspaceId/flairId so the
// generic things route can never smuggle a post past a ban or a private
// wall. The decision is subspaceCore's canPostIn — the SAME predicate the
// subspace detail advertises as viewer.canPost — so the server and the UI
// can never disagree: owners and moderators always may; the access mode
// decides for the rest: public → anyone not banned, restricted → approved
// ACTIVE members, private → active members. A kicked (left) or pending row
// is not a member whatever its approved flag says.
export const assertSubspacePosting = async (
	ownerId: string,
	subspaceId: string,
	flairId: string | null | undefined,
	preloaded: { subspace?: any; roles?: ViewerSubspaceRoles } = {}
): Promise<PostingGateResult> => {
	const subspace = preloaded.subspace?.shareId === subspaceId ? preloaded.subspace : await findSubspaceById(subspaceId);
	if (!subspace) return fail(404, 'Subspace not found');
	const slug = String(subspace.crystal?.slug || subspaceId);
	const membership = await membershipFor(subspaceId, ownerId, preloaded.roles);
	if (membership?.banned) return fail(403, banMessage(slug, membership));
	const moderator = canModerate(membership);
	const access = accessOf(subspace);
	if (!canPostIn(access, membership)) {
		if (access === 'private') return fail(403, `s/${slug} is private — only members can post there 🔒`);
		if (access === 'restricted') return fail(403, `Only approved posters can post in s/${slug} — ask a moderator ✋`);
		return fail(403, `You can’t post in s/${slug} right now`);
	}
	let resolvedFlairId: string | null = null;
	if (flairId) {
		const flair = flairById(flairsOf(subspace), flairId);
		if (!flair) return fail(400, `s/${slug} has no flair "${flairId}"`);
		if (flair.modOnly && !moderator) return fail(403, `The "${flair.label}" flair is moderator-only`);
		resolvedFlairId = flair.id;
	}
	return { ok: true, subspace, membership, flairId: resolvedFlairId, private: access === 'private', moderator };
};

// Runaway rail for the root-post walk. Comment nesting is deliberately
// uncapped in things.ts (MAX_COMMENTS_PER_POST bounds DIRECT replies to one
// thing, not thread depth), so this is a work bound, not a depth policy: real
// threads exit at the first non-comment ancestor after a hop or two. A chain
// long enough to hit it is pathological, and the walk reports that rather than
// pretending it reached the top.
export const MAX_ROOT_POST_HOPS = 512;

// Walk a comment (or comment-on-comment…) up to the post it hangs off; returns
// the doc itself when it is not a comment.
//
// `truncated` separates "could not reach the top" (a cycle, or the rail above)
// from "there is no post up there" (the parent was deleted, so the chain
// simply ends). Callers must not read the first as the second: an unresolved
// chain says nothing about whether a subspace rule applies, while a genuinely
// orphaned comment has no subspace and nothing to enforce. Matches the
// fail-closed-on-truncation convention of things.ts's folderAncestryContains.
export const resolveRootPost = async (doc: any, maxHops = MAX_ROOT_POST_HOPS): Promise<{ root: any | null; truncated: boolean }> => {
	const things = await getThingsCollection();
	let cursor = doc;
	const seen = new Set<string>();
	for (let hop = 0; hop < maxHops; hop++) {
		if (!cursor) return { root: null, truncated: false }; // chain ends — nothing above
		const kinds: string[] = Array.isArray(cursor.thingtime) ? cursor.thingtime : [];
		if (!kinds.includes('comment')) return { root: cursor, truncated: false };
		const targetId = typeof cursor.targetId === 'string' ? cursor.targetId : null;
		if (!targetId) return { root: null, truncated: false }; // detached comment
		if (seen.has(targetId)) return { root: null, truncated: true }; // cycle — unresolvable
		seen.add(targetId);
		cursor = await things.findOne({ shareId: targetId } as any);
	}
	return { root: null, truncated: true }; // rail hit with the chain unresolved
};

// The one answer every caller of resolveRootPost gives to an unresolved chain:
// nothing about the thread's subspace can be decided, so nothing is allowed.
export const truncatedThreadFail = (): Fail => fail(409, 'This thread is nested too deep to check its subspace rules — reply higher up 🌀');

// Comment/vote gate for things attached to subspace posts: banned users may
// not comment or vote there, and locked posts accept no new comments from
// anyone but moderators. Answers the ROOT post's subspace it resolved (null
// outside subspaces) so the caller never walks the reply chain a second time
// — addComment reuses it for the fresh comment's authorFlair.
export const assertSubspaceInteraction = async (
	actorId: string,
	target: any,
	kind: 'comment' | 'vote',
	preloaded: { roles?: ViewerSubspaceRoles } = {}
): Promise<Fail | { ok: true; rootSubspaceId: string | null }> => {
	const { root, truncated } = await resolveRootPost(target);
	// an unresolved chain must never read as "not in a subspace" — that is the
	// difference between a ban/lock that holds at every depth and one that stops
	// applying below the rail
	if (truncated) return truncatedThreadFail();
	const subspaceId = subspaceIdOfDoc(root);
	if (!root || !subspaceId) return { ok: true, rootSubspaceId: null };
	const membership = await membershipFor(subspaceId, actorId, preloaded.roles);
	if (membership?.banned) {
		const subspace = await findSubspaceById(subspaceId);
		return fail(403, banMessage(String(subspace?.crystal?.slug || subspaceId), membership));
	}
	if (kind === 'comment' && root.subspaceMod?.locked === true && !canModerate(membership)) {
		return fail(423, 'This post is locked — moderators have closed the comments 🔒');
	}
	return { ok: true, rootSubspaceId: subspaceId };
};

// Feed-level clauses (sync, given an enriched viewer): removed posts stay out
// of every list, and private-subspace posts show only to that subspace's
// active members. The projection layer redacts as defense in depth for any
// surface that can't run these clauses.
export const subspaceFeedClauses = (viewer: { id?: string | null; subspaceRoles?: ViewerSubspaceRoles } | null): Record<string, any>[] => {
	const memberIds = viewer?.subspaceRoles ? [...viewer.subspaceRoles.values()].filter(isActiveMember).map((membership) => membership.subspaceId) : [];
	return [
		{ 'subspaceMod.status': { $ne: 'removed' } },
		memberIds.length ? { $or: [{ subspacePrivate: { $ne: true } }, { 'crystal.subspaceId': { $in: memberIds } }] } : { subspacePrivate: { $ne: true } }
	];
};

// Lean embed the post projection carries per subspace post — one $in for the
// whole page.
export type SubspaceEmbed = {
	id: string;
	slug: string;
	name: string;
	icon: string | null;
	iconUrl: string | null;
	accent: string | null;
	access: SubspaceAccessMode;
	nsfw: boolean;
	flairs: SubspaceFlair[];
	// user-flair templates, so a member's template pick projects its CURRENT
	// label/emoji/color beside their name
	userFlairs: SubspaceFlair[];
};

export const toSubspaceEmbed = (doc: any): SubspaceEmbed => ({
	id: String(doc.shareId),
	slug: String(doc.crystal?.slug || ''),
	name: String(doc.crystal?.name || doc.crystal?.slug || 'Subspace'),
	icon: doc.crystal?.branding?.icon ?? null,
	iconUrl: doc.crystal?.branding?.iconUrl ?? null,
	accent: doc.crystal?.branding?.accent ?? null,
	access: accessOf(doc),
	nsfw: doc.crystal?.nsfw === true,
	flairs: flairsOf(doc),
	userFlairs: userFlairsOf(doc)
});

export const loadSubspaceEmbeds = async (subspaceIds: readonly string[]): Promise<Map<string, SubspaceEmbed>> => {
	const wanted = [...new Set(subspaceIds.filter((id) => typeof id === 'string' && id))];
	const embeds = new Map<string, SubspaceEmbed>();
	if (!wanted.length) return embeds;
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'subspace', shareId: { $in: wanted } } as any)
		.project({ shareId: 1, 'crystal.slug': 1, 'crystal.name': 1, 'crystal.branding': 1, 'crystal.access': 1, 'crystal.nsfw': 1, 'crystal.flairs': 1, 'crystal.userFlairs': 1 })
		.toArray();
	for (const doc of docs) embeds.set(String(doc.shareId), toSubspaceEmbed(doc));
	return embeds;
};
