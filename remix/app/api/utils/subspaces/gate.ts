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
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { MAX_SUBSPACE_MEMBERSHIPS_PER_USER, type SubspaceAccessMode, type SubspaceRole } from '~/schemas/registry';
import { flairById, isModeratorRole, subspaceModHoldsPost, type SubspaceFlair } from './subspaceCore';

// re-exported so things.ts keeps its single subspace import boundary (gate.ts)
export { subspaceModHoldsPost };

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// uniqueKeys field namespaces for the family (root uniqueKeys index —
// mongodb/uniqueKeys.ts — never crystal-path unique indexes)
export const SUBSPACE_SLUG_KEY_FIELD = 'subspaceSlug';
export const SUBSPACE_MEMBER_KEY_FIELD = 'subspaceMemberKey';
export const UPDOWN_KEY_FIELD = 'updownKey';

export const subspaceMemberKeyOf = (subspaceId: string, userId: string): string => `${subspaceId}:${userId}`;

export type SubspaceMembership = {
	subspaceId: string;
	role: SubspaceRole;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: Date | null;
	left: boolean;
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
		left: crystal.left === true
	};
};

export const isActiveMember = (membership: SubspaceMembership | null | undefined): boolean => !!membership && !membership.left && !membership.banned;
export const canModerate = (membership: SubspaceMembership | null | undefined): boolean =>
	!!membership && !membership.banned && !membership.left && isModeratorRole(membership.role);

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

export const subspaceIdOfDoc = (doc: any): string | null => {
	const id = doc?.crystal?.subspaceId;
	return typeof id === 'string' && id ? id : null;
};

export const accessOf = (subspace: any): SubspaceAccessMode => {
	const access = subspace?.crystal?.access;
	return access === 'restricted' || access === 'private' ? access : 'public';
};

export const flairsOf = (subspace: any): SubspaceFlair[] => (Array.isArray(subspace?.crystal?.flairs) ? subspace.crystal.flairs : []);

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
// wall. Owners and moderators always may; the access mode decides for the
// rest: public → anyone not banned, restricted → approved posters, private →
// members only.
export const assertSubspacePosting = async (
	ownerId: string,
	subspaceId: string,
	flairId: string | null | undefined,
	preloaded: { subspace?: any; roles?: ViewerSubspaceRoles } = {}
): Promise<PostingGateResult> => {
	const subspace = preloaded.subspace?.shareId === subspaceId ? preloaded.subspace : await findSubspaceById(subspaceId);
	if (!subspace) return fail(404, 'Subspace not found');
	const slug = String(subspace.crystal?.slug || subspaceId);
	const membership = preloaded.roles ? preloaded.roles.get(subspaceId) || null : await membershipOf(subspaceId, ownerId);
	if (membership?.banned) return fail(403, banMessage(slug, membership));
	const moderator = canModerate(membership);
	const access = accessOf(subspace);
	if (!moderator) {
		if (access === 'private' && !isActiveMember(membership)) return fail(403, `s/${slug} is private — only members can post there 🔒`);
		if (access === 'restricted' && !membership?.approved) return fail(403, `Only approved posters can post in s/${slug} — ask a moderator ✋`);
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

// Walk a comment (or comment-on-comment…) up to the post it hangs off. Bounded
// and cycle-safe; returns the doc itself when it is not a comment.
export const resolveRootPost = async (doc: any, maxHops = 64): Promise<any | null> => {
	const things = await getThingsCollection();
	let cursor = doc;
	const seen = new Set<string>();
	for (let hop = 0; hop < maxHops && cursor; hop++) {
		const kinds: string[] = Array.isArray(cursor.thingtime) ? cursor.thingtime : [];
		if (!kinds.includes('comment')) return cursor;
		const targetId = typeof cursor.targetId === 'string' ? cursor.targetId : null;
		if (!targetId || seen.has(targetId)) return null;
		seen.add(targetId);
		cursor = await things.findOne({ shareId: targetId } as any);
	}
	return null;
};

// Comment/vote gate for things attached to subspace posts: banned users may
// not comment or vote there, and locked posts accept no new comments from
// anyone but moderators.
export const assertSubspaceInteraction = async (
	actorId: string,
	target: any,
	kind: 'comment' | 'vote',
	preloaded: { roles?: ViewerSubspaceRoles } = {}
): Promise<Fail | { ok: true }> => {
	const root = await resolveRootPost(target);
	const subspaceId = subspaceIdOfDoc(root);
	if (!root || !subspaceId) return { ok: true };
	const membership = preloaded.roles ? preloaded.roles.get(subspaceId) || null : await membershipOf(subspaceId, actorId);
	if (membership?.banned) {
		const subspace = await findSubspaceById(subspaceId);
		return fail(403, banMessage(String(subspace?.crystal?.slug || subspaceId), membership));
	}
	if (kind === 'comment' && root.subspaceMod?.locked === true && !canModerate(membership)) {
		return fail(423, 'This post is locked — moderators have closed the comments 🔒');
	}
	return { ok: true };
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
	flairs: flairsOf(doc)
});

export const loadSubspaceEmbeds = async (subspaceIds: readonly string[]): Promise<Map<string, SubspaceEmbed>> => {
	const wanted = [...new Set(subspaceIds.filter((id) => typeof id === 'string' && id))];
	const embeds = new Map<string, SubspaceEmbed>();
	if (!wanted.length) return embeds;
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'subspace', shareId: { $in: wanted } } as any)
		.project({ shareId: 1, 'crystal.slug': 1, 'crystal.name': 1, 'crystal.branding': 1, 'crystal.access': 1, 'crystal.nsfw': 1, 'crystal.flairs': 1 })
		.toArray();
	for (const doc of docs) embeds.set(String(doc.shareId), toSubspaceEmbed(doc));
	return embeds;
};
