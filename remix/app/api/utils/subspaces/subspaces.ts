// Subspaces — Reddit-style communities as things (see subspaceSchema and
// friends in schemas/registry.ts). A subspace thing owns its branding, rules,
// flairs and access mode; membership is one relational subspace-member doc per
// (subspace, user) carrying role/approval/ban state; moderation writes an
// append-only subspace-modlog trail. Posts join a subspace through
// crystal.subspaceId (validated by gate.ts on every write) and carry their
// moderation state on the server-owned root `subspaceMod` field.
//
// This module is the ONLY writer of the family. None of its kinds have a
// generic crystal sanitizer, so /api/v1/things refuses them outright, and
// things.ts excludes them from own-things listings and generic DELETE the way
// the messenger family is excluded.
import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { deleteAccountedThing, insertAccountedThing, updateAccountedThing, updateAccountedThings, withAccountedThingsTransaction } from '../storage/accountedThings';
import { StorageMutationError } from '../storage/storageCore';
import { findUserByUsername } from '../auth/users';
import { emitNotification, emitNotificationsBulk } from '../notifications/notifications';
import {
	COLLECTION_SCHEMA_VERSIONS,
	MAX_SUBSPACE_MEMBERSHIPS_PER_USER,
	MAX_SUBSPACES_PER_USER,
	SUBSPACE_ROLES,
	subspaceNotificationPreview,
	type SubspaceAccessMode,
	type SubspaceFeedSort,
	type SubspaceRole
} from '~/schemas/registry';
import {
	asViewer,
	canView,
	chronoCursorClause,
	fail,
	isFail,
	oldestCursorClause,
	parseChronoCursor,
	postMatch,
	postThingMatch,
	resolveProfiles,
	toPublicPosts,
	visibilityQueryFor,
	withFriendIds,
	withMatch,
	type Fail,
	type FeedAuthor,
	type PublicPost,
	type ThingDoc,
	type Viewer
} from '../things/things';
import { updownTalliesFor } from '../things/updown';
import {
	accessOf,
	canModerate,
	findSubspace,
	findSubspaceMemberDoc,
	flairsOf,
	isActiveMember,
	loadViewerSubspaceRoles,
	membershipOf,
	membershipOfDoc,
	SUBSPACE_MEMBER_KEY_FIELD,
	SUBSPACE_SLUG_KEY_FIELD,
	subspaceMemberKeyOf,
	type SubspaceMembership
} from './gate';
import {
	canPostIn,
	confirmSlugMatches,
	flairById,
	privatizedPostUpdate,
	rankSubspacePosts,
	releaseKindFor,
	releasedPostUpdate,
	sanitizeAccess,
	sanitizeBranding,
	sanitizeDescription,
	sanitizeFlairs,
	sanitizeName,
	sanitizeReason,
	sanitizeRules,
	sanitizeSlug,
	sanitizeSort,
	sanitizeTopRange,
	slugHoldState,
	topRangeSince,
	type RankCandidate,
	type SubspaceBranding,
	type SubspaceFlair,
	type SubspaceRule
} from './subspaceCore';

export type { SubspaceMembership } from './gate';

const THINGS_SCHEMA_VERSION = COLLECTION_SCHEMA_VERSIONS.things;
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
const MAX_MODERATORS_LISTED = 50;
const MAX_PINNED = 5;
// Ranked sorts score the newest N posts of the subspace, then page within that
// window by offset — deterministic for a fixed dataset + timestamp (the ranked
// home-feed pattern; keeps votes relational, no denormalized score field)
const RANKED_WINDOW = 400;
const MAX_QUERY_CHARS = 60;
const MAX_BAN_DAYS = 3650;
// "the mods" as notification recipients = active owner + moderators, bounded
const MAX_NOTIFIED_MODERATORS = 200;
// requesters told their join request went through when a private subspace
// opens up (every pending row is activated; the first N hear about it)
const MAX_NOTIFIED_REQUESTERS = 200;
// deleting a subspace releases its posts in bounded accounted batches (each
// batch is one storage transaction); the pass cap only guards against a
// pathological loop, real subspaces drain in a handful of passes — and a
// subspace too big for one call is refused (409) BEFORE its doc goes, so the
// owner simply runs delete again. A batch whose post vanished mid-transaction
// (the accounted updater's storage_conflict) is retried, bounded.
const RELEASE_BATCH = 200;
const MAX_RELEASE_PASSES = 2_000;
const MAX_RELEASE_CONFLICTS = 5;

// ---------------------------------------------------------------------------
// Projections

export type PublicSubspaceViewer = {
	role: SubspaceRole | null;
	member: boolean;
	approved: boolean;
	banned: boolean;
	banReason: string | null;
	banUntil: string | null;
	canModerate: boolean;
	canPost: boolean;
	// a join request awaiting a moderator (private subspaces) — not a member yet
	pending: boolean;
	// asked the mods for posting approval (restricted subspaces)
	approvalRequested: boolean;
};

export type PublicSubspace = {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	access: SubspaceAccessMode;
	nsfw: boolean;
	rules: SubspaceRule[];
	flairs: SubspaceFlair[];
	branding: SubspaceBranding;
	ownerId: string;
	memberCount: number;
	postCount?: number;
	// moderators only (subspace detail): open join requests / posting-approval
	// requests waiting in the Requests queue
	pendingCount?: number;
	approvalRequestCount?: number;
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
	pending: boolean;
	approvalRequested: boolean;
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

const viewerStateOf = (subspace: any, membership: SubspaceMembership | null): PublicSubspaceViewer => {
	const moderator = canModerate(membership);
	const member = isActiveMember(membership);
	return {
		// a pending requester holds no role yet
		role: membership && !membership.left && !membership.pending ? membership.role : null,
		member,
		approved: membership?.approved === true,
		banned: membership?.banned === true,
		banReason: membership?.banned ? membership.banReason : null,
		banUntil: membership?.banned && membership.banUntil ? membership.banUntil.toISOString() : null,
		canModerate: moderator,
		canPost: canPostIn(accessOf(subspace), membership),
		pending: !!membership && membership.pending && !membership.left && !membership.banned,
		approvalRequested: member && membership!.approvalRequested && !membership!.approved
	};
};

const brandingOf = (doc: any): SubspaceBranding => ({
	icon: doc?.crystal?.branding?.icon ?? null,
	iconUrl: doc?.crystal?.branding?.iconUrl ?? null,
	bannerUrl: doc?.crystal?.branding?.bannerUrl ?? null,
	accent: doc?.crystal?.branding?.accent ?? null
});

export const toPublicSubspace = (
	doc: any,
	options: { memberCount: number; postCount?: number; membership: SubspaceMembership | null; requestCounts?: RequestCounts | null }
): PublicSubspace => ({
	id: String(doc.shareId),
	slug: String(doc.crystal?.slug || ''),
	name: String(doc.crystal?.name || doc.crystal?.slug || 'Subspace'),
	description: doc.crystal?.description ?? null,
	access: accessOf(doc),
	nsfw: doc.crystal?.nsfw === true,
	rules: Array.isArray(doc.crystal?.rules) ? doc.crystal.rules : [],
	flairs: flairsOf(doc),
	branding: brandingOf(doc),
	ownerId: String(doc.ownerId),
	memberCount: options.memberCount,
	...(options.postCount === undefined ? {} : { postCount: options.postCount }),
	...(options.requestCounts ? { pendingCount: options.requestCounts.pending, approvalRequestCount: options.requestCounts.approvalRequests } : {}),
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt || doc.createdAt).toISOString(),
	viewer: viewerStateOf(doc, options.membership)
});

const toPublicMember = (doc: any, profile: FeedAuthor | null): PublicSubspaceMember => {
	const membership = membershipOfDoc(doc);
	return {
		userId: String(doc.ownerId),
		profile,
		role: membership.role,
		approved: membership.approved,
		banned: membership.banned,
		banReason: membership.banned ? membership.banReason : null,
		banUntil: membership.banned && membership.banUntil ? membership.banUntil.toISOString() : null,
		left: membership.left,
		pending: membership.pending && !membership.left && !membership.banned,
		approvalRequested: membership.approvalRequested && !membership.approved && isActiveMember(membership),
		joinedAt: new Date(doc.createdAt).toISOString()
	};
};

// ---------------------------------------------------------------------------
// Doc factories + small queries

const newSubspaceMemberDoc = (subspaceId: string, userId: string, crystal: Record<string, unknown>) => {
	const now = new Date();
	const memberKey = subspaceMemberKeyOf(subspaceId, userId);
	return {
		shareId: randomUUID(),
		schemaVersion: THINGS_SCHEMA_VERSION,
		thingtime: ['subspace-member'],
		crystal: { memberKey, role: 'member', approved: false, banned: false, left: false, pending: false, approvalRequested: false, ...crystal },
		uniqueKeys: [thingUniqueKey(SUBSPACE_MEMBER_KEY_FIELD, memberKey)],
		extended: null,
		ownerId: userId,
		acl: ['tt:user'],
		targetId: subspaceId,
		tags: [],
		createdAt: now,
		updatedAt: now
	};
};

const writeModlog = async (
	subspaceId: string,
	actorId: string,
	action: string,
	entry: { postId?: string | null; userId?: string | null; reason?: string | null; detail?: Record<string, unknown> | null } = {},
	session?: any
) => {
	const things = await getThingsCollection();
	const now = new Date();
	await things.insertOne(
		{
			shareId: randomUUID(),
			schemaVersion: THINGS_SCHEMA_VERSION,
			thingtime: ['subspace-modlog'],
			crystal: {
				action,
				postId: entry.postId ?? null,
				userId: entry.userId ?? null,
				reason: entry.reason ?? null,
				detail: entry.detail ?? null
			},
			extended: null,
			ownerId: actorId,
			acl: ['tt:user'],
			targetId: subspaceId,
			tags: [],
			createdAt: now,
			updatedAt: now
		} as any,
		session ? { session } : {}
	);
};

const memberCountsFor = async (subspaceIds: string[]): Promise<Map<string, number>> => {
	const counts = new Map<string, number>();
	if (!subspaceIds.length) return counts;
	const things = await getThingsCollection();
	const rows = (await things
		.aggregate([
			// pending join requests are not members (isActiveMember)
			{ $match: { thingtime: 'subspace-member', targetId: { $in: subspaceIds }, 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true }, 'crystal.pending': { $ne: true } } },
			{ $group: { _id: '$targetId', count: { $sum: 1 } } }
		])
		.toArray()) as any[];
	for (const row of rows) counts.set(String(row._id), Number(row.count) || 0);
	return counts;
};

// The Requests queue sizes a moderator sees on the subspace detail: open join
// requests (pending rows) and posting-approval requests (active, unapproved
// members who asked) — ONE $group over the subspace's member rows.
export type RequestCounts = { pending: number; approvalRequests: number };
const PENDING_REQUEST_MATCH = { 'crystal.pending': true, 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true } };
const APPROVAL_REQUEST_MATCH = { 'crystal.approvalRequested': true, 'crystal.approved': { $ne: true }, 'crystal.pending': { $ne: true }, 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true } };
const requestCountsFor = async (subspaceId: string): Promise<RequestCounts> => {
	const things = await getThingsCollection();
	const [row] = (await things
		.aggregate([
			{ $match: { thingtime: 'subspace-member', targetId: subspaceId, 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true }, $or: [{ 'crystal.pending': true }, { 'crystal.approvalRequested': true }] } },
			{
				$group: {
					_id: null,
					pending: { $sum: { $cond: [{ $eq: ['$crystal.pending', true] }, 1, 0] } },
					approvalRequests: {
						$sum: { $cond: [{ $and: [{ $ne: ['$crystal.pending', true] }, { $eq: ['$crystal.approvalRequested', true] }, { $ne: ['$crystal.approved', true] }] }, 1, 0] }
					}
				}
			}
		])
		.toArray()) as any[];
	return { pending: Number(row?.pending) || 0, approvalRequests: Number(row?.approvalRequests) || 0 };
};

const livePostMatch = (subspaceId: string) => withMatch(postMatch(), { 'crystal.subspaceId': subspaceId, 'subspaceMod.status': { $ne: 'removed' } });

const ownedSubspaceCount = async (userId: string, session?: any): Promise<number> => {
	const things = await getThingsCollection();
	return things.countDocuments({ thingtime: 'subspace-member', ownerId: userId, 'crystal.role': 'owner', 'crystal.left': { $ne: true } } as any, session ? { session } : {});
};

const membershipCount = async (userId: string): Promise<number> => {
	const things = await getThingsCollection();
	return things.countDocuments({ thingtime: 'subspace-member', ownerId: userId, 'crystal.left': { $ne: true } } as any);
};

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number } | null)?.code === 11000;

const requireViewer = (viewerInput: string | Viewer): Fail | { ok: true; viewer: NonNullable<Viewer> } => {
	const viewer = asViewer(viewerInput);
	if (!viewer?.id) return fail(401, 'Unauthorized');
	return { ok: true, viewer };
};

type SubspaceRef = { id?: unknown; slug?: unknown };

const resolveSubspace = async (ref: SubspaceRef): Promise<Fail | { ok: true; subspace: any }> => {
	if ((typeof ref.id !== 'string' || !ref.id.trim()) && (typeof ref.slug !== 'string' || !ref.slug.trim())) {
		return fail(400, 'Subspace id or slug required');
	}
	const subspace = await findSubspace(ref);
	if (!subspace) return fail(404, 'Subspace not found');
	return { ok: true, subspace };
};

const requireModerator = async (subspaceId: string, userId: string): Promise<Fail | { ok: true; membership: SubspaceMembership }> => {
	const membership = await membershipOf(subspaceId, userId);
	if (!canModerate(membership)) return fail(403, 'Moderators only — you need a mod hat for that 🎩');
	return { ok: true, membership: membership! };
};

// owner-only lifecycle actions (transfer / delete) — returns the owner's own
// member doc too, since transfer rewrites it. Belt and braces: the member row
// AND the subspace doc's ownerId must both name the caller (a half-applied
// transfer can never leave two people with the crown).
const requireOwner = async (subspace: any, userId: string, verb: string): Promise<Fail | { ok: true; membership: SubspaceMembership; doc: any }> => {
	const doc = await findSubspaceMemberDoc(String(subspace.shareId), userId);
	const membership = doc ? membershipOfDoc(doc) : null;
	if (!canModerate(membership) || membership!.role !== 'owner' || String(subspace.ownerId || '') !== userId) {
		return fail(403, `Only the owner can ${verb} 👑`);
	}
	return { ok: true, membership: membership!, doc };
};

// A lifecycle write whose guarded filter matched nothing: the subspace
// changed hands (or vanished) between the gate and the transaction. Thrown
// inside the transaction so it aborts as a whole; the util answers 409.
class LifecycleConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LifecycleConflict';
	}
}
const lifecycleConflictToFail = (err: unknown): Fail | null => (err instanceof LifecycleConflict ? fail(409, err.message) : null);

// A deleted subspace's slug hold (kind subspace-tombstone — control-plane
// plumbing carrying the subspaceSlug uniqueKey the subspace held).
const newSubspaceTombstoneDoc = (subspaceId: string, slug: string, previousOwnerId: string, now: Date) => ({
	shareId: randomUUID(),
	schemaVersion: THINGS_SCHEMA_VERSION,
	thingtime: ['subspace-tombstone'],
	crystal: { slug, subspaceId, previousOwnerId, deletedAt: now },
	uniqueKeys: [thingUniqueKey(SUBSPACE_SLUG_KEY_FIELD, slug)],
	extended: null,
	ownerId: previousOwnerId,
	acl: ['tt:user'],
	targetId: subspaceId,
	tags: [],
	createdAt: now,
	updatedAt: now
});
const findSubspaceTombstone = async (things: any, slug: string): Promise<any | null> =>
	things.findOne({ thingtime: 'subspace-tombstone', ...thingUniqueKeyFilter(SUBSPACE_SLUG_KEY_FIELD, slug) } as any);

// the actor snapshot every subspace notification carries (notifications.ts
// re-resolves live profile data on read)
const notificationActorOf = (viewer: NonNullable<Viewer>) => ({ id: viewer.id, username: viewer.username || null });

// active owner + moderators of a subspace, minus the acting user — the
// bounded recipient list for "notify the mods" emits
const moderatorRecipientIds = async (subspaceId: string, exceptUserId: string | null): Promise<string[]> => {
	const things = await getThingsCollection();
	const rows = (await things
		.find({ thingtime: 'subspace-member', targetId: subspaceId, 'crystal.role': { $in: ['owner', 'moderator'] }, 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true } } as any)
		.project({ ownerId: 1 })
		.limit(MAX_NOTIFIED_MODERATORS)
		.toArray()) as any[];
	return rows.map((row) => String(row.ownerId)).filter((userId) => userId && userId !== exceptUserId);
};

// ---------------------------------------------------------------------------
// Create / read

export type CreateSubspaceInput = {
	slug?: unknown;
	name?: unknown;
	description?: unknown;
	access?: unknown;
	nsfw?: unknown;
	rules?: unknown;
	flairs?: unknown;
	branding?: unknown;
};

export const createSubspace = async (viewerInput: string | Viewer, input: CreateSubspaceInput): Promise<Fail | { ok: true; subspace: PublicSubspace }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const ownerId = auth.viewer.id;

	const slug = sanitizeSlug(input.slug ?? input.name);
	if (isFail(slug)) return slug;
	const name = sanitizeName(input.name ?? slug);
	if (isFail(name)) return name;
	const description = sanitizeDescription(input.description);
	if (isFail(description)) return description;
	const access = sanitizeAccess(input.access);
	if (isFail(access)) return access;
	const rules = sanitizeRules(input.rules);
	if (isFail(rules)) return rules;
	const flairs = sanitizeFlairs(input.flairs);
	if (isFail(flairs)) return flairs;
	const branding = sanitizeBranding(input.branding);
	if (isFail(branding)) return branding;

	if ((await ownedSubspaceCount(ownerId)) >= MAX_SUBSPACES_PER_USER) {
		return fail(400, `You already run ${MAX_SUBSPACES_PER_USER} subspaces — that is a lot of subspaces 🪐`);
	}
	if ((await membershipCount(ownerId)) >= MAX_SUBSPACE_MEMBERSHIPS_PER_USER) {
		return fail(400, `You are in ${MAX_SUBSPACE_MEMBERSHIPS_PER_USER} subspaces already — leave one first`);
	}
	const things = await getThingsCollection();
	// a recently deleted subspace still holds its slug: only its last owner may
	// re-found it before the hold lapses (the tombstone is consumed below, in
	// the founding transaction — a second founder racing for the same slug
	// hits the uniqueKey and answers 409 like any taken slug)
	const tombstone = await findSubspaceTombstone(things, slug);
	const hold = slugHoldState(tombstone, ownerId, Date.now());
	if (hold.held) {
		return fail(409, `s/${slug} was deleted recently — its slug is held for its previous owner until ${hold.until!.toISOString().slice(0, 10)}`);
	}

	const now = new Date();
	const subspace = {
		shareId: randomUUID(),
		schemaVersion: THINGS_SCHEMA_VERSION,
		thingtime: ['subspace'],
		crystal: { slug, name, description, access, nsfw: input.nsfw === true, rules, flairs, branding },
		uniqueKeys: [thingUniqueKey(SUBSPACE_SLUG_KEY_FIELD, slug)],
		extended: null,
		ownerId,
		acl: ['tt:all'],
		targetId: null,
		tags: [],
		createdAt: now,
		updatedAt: now
	};
	const owner = newSubspaceMemberDoc(subspace.shareId, ownerId, { role: 'owner', approved: true });
	try {
		await withAccountedThingsTransaction(async (session) => {
			if (tombstone) await things.deleteOne({ _id: tombstone._id } as any, { session });
			await insertAccountedThing(things, subspace as any, { session });
			await things.insertOne(owner as any, { session });
		});
	} catch (err) {
		if (isDuplicateKey(err)) return fail(409, `s/${slug} is taken — pick another slug`);
		throw err;
	}
	return { ok: true, subspace: toPublicSubspace(subspace, { memberCount: 1, postCount: 0, membership: membershipOfDoc(owner) }) };
};

export type ListSubspacesQuery = { q?: unknown; mine?: unknown; cursor?: unknown; limit?: unknown };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listSubspaces = async (
	viewerInput: string | Viewer,
	query: ListSubspacesQuery
): Promise<Fail | { ok: true; subspaces: PublicSubspace[]; nextCursor: string | null }> => {
	const viewer = asViewer(viewerInput);
	const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_PAGE), MAX_PAGE);
	const roles = viewer?.subspaceRoles || (await loadViewerSubspaceRoles(viewer?.id));
	const things = await getThingsCollection();

	let match: Record<string, any> = { thingtime: 'subspace' };
	if (query.mine === true || query.mine === 'true' || query.mine === '1') {
		if (!viewer?.id) return fail(401, 'Unauthorized');
		const ids = [...roles.values()].filter(isActiveMember).map((membership) => membership.subspaceId);
		if (!ids.length) return { ok: true, subspaces: [], nextCursor: null };
		match = withMatch(match, { shareId: { $in: ids } });
	}
	const q = typeof query.q === 'string' ? query.q.trim().slice(0, MAX_QUERY_CHARS) : '';
	if (q) {
		const pattern = new RegExp(escapeRegex(q.toLowerCase().replace(/^s\//, '')), 'i');
		match = withMatch(match, { $or: [{ 'crystal.slug': pattern }, { 'crystal.name': pattern }] });
	}
	const cursor = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
	const pageMatch = cursor ? withMatch(match, chronoCursorClause(cursor)) : match;
	const docs = (await things
		.find(pageMatch as any)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(limit + 1)
		.toArray()) as any[];
	const page = docs.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
	const counts = await memberCountsFor(page.map((doc) => String(doc.shareId)));
	return {
		ok: true,
		subspaces: page.map((doc) =>
			toPublicSubspace(doc, { memberCount: counts.get(String(doc.shareId)) || 0, membership: roles.get(String(doc.shareId)) || null })
		),
		nextCursor
	};
};

export type SubspaceDetail = {
	subspace: PublicSubspace;
	moderators: { userId: string; profile: FeedAuthor | null; role: SubspaceRole }[];
};

export const getSubspace = async (viewerInput: string | Viewer, ref: SubspaceRef): Promise<Fail | ({ ok: true } & SubspaceDetail)> => {
	const viewer = asViewer(viewerInput);
	const found = await resolveSubspace(ref);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const things = await getThingsCollection();
	const [counts, postCount, membership, modDocs] = await Promise.all([
		memberCountsFor([id]),
		things.countDocuments(livePostMatch(id) as any),
		membershipOf(id, viewer?.id),
		things
			.find({ thingtime: 'subspace-member', targetId: id, 'crystal.role': { $in: ['owner', 'moderator'] }, 'crystal.left': { $ne: true } } as any)
			.sort({ createdAt: 1, shareId: 1 })
			.limit(MAX_MODERATORS_LISTED)
			.toArray() as Promise<any[]>
	]);
	// moderators also get the Requests queue sizes (badge on Mod tools 🎩)
	const [profiles, requestCounts] = await Promise.all([resolveProfiles(modDocs.map((doc) => String(doc.ownerId))), canModerate(membership) ? requestCountsFor(id) : Promise.resolve(null)]);
	return {
		ok: true,
		subspace: toPublicSubspace(subspace, { memberCount: counts.get(id) || 0, postCount, membership, requestCounts }),
		moderators: modDocs.map((doc) => ({
			userId: String(doc.ownerId),
			profile: profiles.get(String(doc.ownerId)) || null,
			role: membershipOfDoc(doc).role
		}))
	};
};

// ---------------------------------------------------------------------------
// Settings (branding / rules / flairs / access)

// A private subspace opening up (→ public / restricted) resolves its open
// join requests: every pending row becomes an active membership (they asked
// to be in; now anyone may be), and the first MAX_NOTIFIED_REQUESTERS of them
// hear about it. Returns how many rows flipped.
const activatePendingRequests = async (subspaceId: string, slug: string, actor: NonNullable<Viewer>, now: Date): Promise<number> => {
	const things = await getThingsCollection();
	const match = { thingtime: 'subspace-member', targetId: subspaceId, ...PENDING_REQUEST_MATCH };
	const rows = (await things.find(match as any).project({ ownerId: 1 }).limit(MAX_NOTIFIED_REQUESTERS).toArray()) as any[];
	if (!rows.length) return 0;
	const result = await things.updateMany(match as any, { $set: { 'crystal.pending': false, updatedAt: now } });
	await emitNotificationsBulk(
		rows.map((row) => ({ recipientId: String(row.ownerId), type: 'subspace-join-accepted' as const })),
		{ actor: notificationActorOf(actor), targetId: subspaceId, preview: subspaceNotificationPreview(slug, 'opened up — your request to join went through 🎉') }
	);
	return Number(result?.modifiedCount) || 0;
};

export type UpdateSubspaceInput = SubspaceRef & {
	name?: unknown;
	description?: unknown;
	access?: unknown;
	nsfw?: unknown;
	rules?: unknown;
	flairs?: unknown;
	branding?: unknown;
};

export const updateSubspace = async (viewerInput: string | Viewer, input: UpdateSubspaceInput): Promise<Fail | { ok: true; subspace: PublicSubspace }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const found = await resolveSubspace(input);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const gate = await requireModerator(id, auth.viewer.id);
	if (gate.ok === false) return gate;
	const isOwner = gate.membership.role === 'owner';

	const set: Record<string, unknown> = {};
	const changed: string[] = [];
	if (input.name !== undefined) {
		const name = sanitizeName(input.name);
		if (isFail(name)) return name;
		set['crystal.name'] = name;
		changed.push('name');
	}
	if (input.description !== undefined) {
		const description = sanitizeDescription(input.description);
		if (isFail(description)) return description;
		set['crystal.description'] = description;
		changed.push('description');
	}
	if (input.rules !== undefined) {
		const rules = sanitizeRules(input.rules);
		if (isFail(rules)) return rules;
		set['crystal.rules'] = rules;
		changed.push('rules');
	}
	if (input.flairs !== undefined) {
		const flairs = sanitizeFlairs(input.flairs);
		if (isFail(flairs)) return flairs;
		set['crystal.flairs'] = flairs;
		changed.push('flairs');
	}
	if (input.branding !== undefined) {
		const branding = sanitizeBranding(input.branding, brandingOf(subspace));
		if (isFail(branding)) return branding;
		set['crystal.branding'] = branding;
		changed.push('branding');
	}
	if (input.access !== undefined) {
		if (!isOwner) return fail(403, 'Only the owner can change who may join or post');
		const access = sanitizeAccess(input.access);
		if (isFail(access)) return access;
		set['crystal.access'] = access;
		changed.push('access');
	}
	if (input.nsfw !== undefined) {
		if (!isOwner) return fail(403, 'Only the owner can change the 18+ flag');
		set['crystal.nsfw'] = input.nsfw === true;
		changed.push('nsfw');
	}
	if (!changed.length) return fail(400, 'Nothing to update');

	const things = await getThingsCollection();
	const now = new Date();
	await updateAccountedThing(things, { shareId: id, thingtime: 'subspace' }, { $set: { ...set, updatedAt: now } });
	const detail: Record<string, unknown> = { fields: changed };
	if (set['crystal.access'] !== undefined) {
		const previousAccess = accessOf(subspace);
		const nextAccess = set['crystal.access'] as SubspaceAccessMode;
		// private ⇄ public flips re-stamp existing posts so feed clauses stay exact
		await things.updateMany(
			withMatch(postMatch(), { 'crystal.subspaceId': id }) as any,
			nextAccess === 'private' ? ({ $set: { subspacePrivate: true } } as any) : ({ $unset: { subspacePrivate: '' } } as any)
		);
		// the request queues follow the access mode. Leaving PRIVATE: whoever
		// was waiting to join is simply in — the doors are open to everyone
		// now, and a queue of requests the subspace no longer takes would
		// strand both sides (a "Requested ✓ · cancel" button on a public
		// subspace, a Requests tab the panel says is closed). They are told
		// (subspace-join-accepted). Leaving RESTRICTED: open posting-approval
		// requests are moot (anyone / every member may post now) and clear.
		if (previousAccess === 'private' && nextAccess !== 'private') {
			detail.acceptedRequests = await activatePendingRequests(id, String(subspace.crystal?.slug || id), auth.viewer, now);
		}
		if (previousAccess === 'restricted' && nextAccess !== 'restricted') {
			const cleared = await things.updateMany({ thingtime: 'subspace-member', targetId: id, 'crystal.approvalRequested': true } as any, { $set: { 'crystal.approvalRequested': false, updatedAt: now } });
			detail.clearedApprovalRequests = Number(cleared?.modifiedCount) || 0;
		}
	}
	await writeModlog(id, auth.viewer.id, 'settings.update', { detail });
	const fresh = await findSubspace({ id });
	const counts = await memberCountsFor([id]);
	return { ok: true, subspace: toPublicSubspace(fresh, { memberCount: counts.get(id) || 0, membership: gate.membership }) };
};

// ---------------------------------------------------------------------------
// Membership

const subspaceWithViewer = async (subspace: any, viewerId: string): Promise<PublicSubspace> => {
	const id = String(subspace.shareId);
	const [counts, membership] = await Promise.all([memberCountsFor([id]), membershipOf(id, viewerId)]);
	return toPublicSubspace(subspace, { memberCount: counts.get(id) || 0, membership });
};

export type JoinSubspaceResult = { ok: true; subspace: PublicSubspace; joined: boolean; pending: boolean };

// the "notify the mods" emit every request shares (join request / posting
// approval request): bounded recipients, never throws, preview leads with the
// slug so the bell deep-links to /s/<slug> — the mod page's Requests tab.
// Deduped against each moderator's UNREAD bell: a request filed, cancelled
// (/leave) and filed again — or asked again after a deny — rings once until
// the mod has looked, so the request → cancel → request loop can't turn into
// a per-mod fan-out amplifier.
const notifyModsOfRequest = async (subspaceId: string, slug: string, actor: NonNullable<Viewer>, detail: string) => {
	const recipientIds = await moderatorRecipientIds(subspaceId, actor.id);
	if (!recipientIds.length) return;
	await emitNotificationsBulk(
		recipientIds.map((recipientId) => ({ recipientId, type: 'subspace-join-request' as const })),
		{ actor: notificationActorOf(actor), targetId: subspaceId, preview: subspaceNotificationPreview(slug, detail) },
		{ dedupeUnread: true }
	);
};

export const joinSubspace = async (viewerInput: string | Viewer, ref: SubspaceRef): Promise<Fail | JoinSubspaceResult> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const userId = auth.viewer.id;
	const found = await resolveSubspace(ref);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const existing = await findSubspaceMemberDoc(id, userId);
	const membership = existing ? membershipOfDoc(existing) : null;
	if (membership?.banned) return fail(403, `You are banned from s/${slug} 🚫`);
	if (isActiveMember(membership)) return { ok: true, subspace: await subspaceWithViewer(subspace, userId), joined: false, pending: false };
	const isPending = !!membership && membership.pending && !membership.left;
	const things = await getThingsCollection();
	const now = new Date();
	// private subspaces never self-serve a membership: joining files a JOIN
	// REQUEST (the same member row, pending: true) for the mods' Requests
	// queue — `accept` (or a moderator's `add`) flips it active, `deny` drops
	// it, `leave` cancels it. A member who left or was kicked can re-request;
	// their stale row is not an invitation either.
	if (accessOf(subspace) === 'private') {
		if (isPending) return { ok: true, subspace: await subspaceWithViewer(subspace, userId), joined: false, pending: true };
		if ((await membershipCount(userId)) >= MAX_SUBSPACE_MEMBERSHIPS_PER_USER) {
			return fail(400, `You are in ${MAX_SUBSPACE_MEMBERSHIPS_PER_USER} subspaces already — leave one first`);
		}
		if (existing) {
			// a re-request restarts the row's clock so the queue lists it as
			// new — and starts from a clean slate: a request is never an
			// approved poster (a kicked approved poster asking back in would
			// otherwise carry their old approval through the queue)
			await things.updateOne(
				{ _id: existing._id } as any,
				{
					$set: {
						'crystal.pending': true,
						'crystal.left': false,
						'crystal.banned': false,
						'crystal.approved': false,
						'crystal.approvalRequested': false,
						'crystal.role': 'member',
						createdAt: now,
						updatedAt: now
					}
				}
			);
		} else {
			try {
				await things.insertOne(newSubspaceMemberDoc(id, userId, { role: 'member', pending: true }) as any);
			} catch (err) {
				if (!isDuplicateKey(err)) throw err; // raced ourselves — the request exists
			}
		}
		await notifyModsOfRequest(id, slug, auth.viewer, 'wants to join 🙋');
		return { ok: true, subspace: await subspaceWithViewer(subspace, userId), joined: false, pending: true };
	}
	if ((await membershipCount(userId)) >= MAX_SUBSPACE_MEMBERSHIPS_PER_USER) {
		return fail(400, `You are in ${MAX_SUBSPACE_MEMBERSHIPS_PER_USER} subspaces already — leave one first`);
	}
	if (existing) {
		// rejoining after leaving (or a request left over from when the
		// subspace was private): same doc, active again (ban state is already
		// known to be clear here)
		await things.updateOne({ _id: existing._id } as any, { $set: { 'crystal.left': false, 'crystal.banned': false, 'crystal.pending': false, updatedAt: now } });
	} else {
		try {
			await things.insertOne(newSubspaceMemberDoc(id, userId, { role: 'member' }) as any);
		} catch (err) {
			if (!isDuplicateKey(err)) throw err; // raced ourselves — already a member
		}
	}
	return { ok: true, subspace: await subspaceWithViewer(subspace, userId), joined: true, pending: false };
};

export const leaveSubspace = async (viewerInput: string | Viewer, ref: SubspaceRef): Promise<Fail | { ok: true; subspace: PublicSubspace }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const userId = auth.viewer.id;
	const found = await resolveSubspace(ref);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const existing = await findSubspaceMemberDoc(id, userId);
	const membership = existing ? membershipOfDoc(existing) : null;
	if (!existing || !membership || membership.left) return { ok: true, subspace: await subspaceWithViewer(subspace, userId) };
	if (membership.role === 'owner') return fail(409, 'Owners can’t leave their own subspace 👑');
	const things = await getThingsCollection();
	if (membership.banned) {
		// the ban outlives the membership
		await things.updateOne({ _id: existing._id } as any, { $set: { 'crystal.left': true, 'crystal.role': 'member', 'crystal.pending': false, 'crystal.approvalRequested': false, updatedAt: new Date() } });
	} else {
		// an active membership ends, a pending join request is cancelled —
		// either way the row goes
		await things.deleteOne({ _id: existing._id } as any);
	}
	return { ok: true, subspace: await subspaceWithViewer(subspace, userId) };
};

export type ListMembersQuery = SubspaceRef & { role?: unknown; banned?: unknown; pending?: unknown; approvalRequests?: unknown; cursor?: unknown; limit?: unknown };
const flagOn = (value: unknown): boolean => value === true || value === 'true' || value === '1';

export const listMembers = async (
	viewerInput: string | Viewer,
	query: ListMembersQuery
): Promise<Fail | { ok: true; members: PublicSubspaceMember[]; nextCursor: string | null }> => {
	const viewer = asViewer(viewerInput);
	const found = await resolveSubspace(query);
	if (found.ok === false) return found;
	const id = String(found.subspace.shareId);
	const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_PAGE), MAX_PAGE);
	const membership = await membershipOf(id, viewer?.id);
	const moderator = canModerate(membership);
	const role = typeof query.role === 'string' && (SUBSPACE_ROLES as readonly string[]).includes(query.role) ? (query.role as SubspaceRole) : null;
	const wantBanned = flagOn(query.banned);
	const wantPending = flagOn(query.pending);
	const wantApprovalRequests = flagOn(query.approvalRequests);
	// the moderator roster is public (Reddit shows it in the sidebar); the full
	// member list, the ban list and the two request queues are mod-only
	const publicRosterOnly = role === 'owner' || role === 'moderator';
	if (!moderator && !publicRosterOnly) return fail(403, 'Only moderators can see the member list');
	if (!moderator && (wantBanned || wantPending || wantApprovalRequests)) return fail(403, 'Only moderators can see that list');

	let match: Record<string, any> = { thingtime: 'subspace-member', targetId: id };
	if (wantBanned) match = withMatch(match, { 'crystal.banned': true });
	else if (wantPending) match = withMatch(match, PENDING_REQUEST_MATCH); // join requests
	else if (wantApprovalRequests) match = withMatch(match, APPROVAL_REQUEST_MATCH); // posting-approval requests
	else match = withMatch(match, { 'crystal.left': { $ne: true }, 'crystal.banned': { $ne: true }, 'crystal.pending': { $ne: true } });
	if (role) match = withMatch(match, { 'crystal.role': role });
	const cursor = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
	// members page oldest-first (join order); the request queues newest-first
	// (a re-request restarts the row's createdAt, so the newest request leads)
	const newestFirst = wantPending || wantApprovalRequests;
	const pageMatch = cursor ? withMatch(match, newestFirst ? chronoCursorClause(cursor) : oldestCursorClause(cursor)) : match;
	const things = await getThingsCollection();
	const docs = (await things
		.find(pageMatch as any)
		.sort({ createdAt: newestFirst ? -1 : 1, shareId: 1 })
		.limit(limit + 1)
		.toArray()) as any[];
	const page = docs.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
	const profiles = await resolveProfiles(page.map((doc) => String(doc.ownerId)));
	return { ok: true, members: page.map((doc) => toPublicMember(doc, profiles.get(String(doc.ownerId)) || null)), nextCursor };
};

export type MemberAction = 'add' | 'remove' | 'approve' | 'unapprove' | 'ban' | 'unban' | 'role' | 'accept' | 'deny' | 'request-approval';
const MEMBER_ACTIONS: MemberAction[] = ['add', 'remove', 'approve', 'unapprove', 'ban', 'unban', 'role', 'accept', 'deny', 'request-approval'];

export type MutateMemberInput = SubspaceRef & {
	userId?: unknown;
	username?: unknown;
	action?: unknown;
	role?: unknown;
	reason?: unknown;
	banDays?: unknown;
};

const resolveTargetUserId = async (input: { userId?: unknown; username?: unknown }): Promise<string | Fail> => {
	if (typeof input.userId === 'string' && input.userId.trim()) return input.userId.trim();
	if (typeof input.username === 'string' && input.username.trim()) {
		const user = await findUserByUsername(input.username.trim());
		if (!user) return fail(404, 'User not found');
		return String(user._id);
	}
	return fail(400, 'userId or username required');
};

// `request-approval` is the one member action a plain member takes on
// THEMSELVES: an active member of a RESTRICTED subspace asks the mods for
// posting rights (approvalRequested: true on their own row; the mods'
// Requests tab lists it, `approve` grants it, `deny` clears it). No mod log —
// it is not a moderator action — but the mods are notified.
const requestPostingApproval = async (
	viewer: NonNullable<Viewer>,
	subspace: any,
	input: MutateMemberInput
): Promise<Fail | { ok: true; member: PublicSubspaceMember }> => {
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const userId = viewer.id;
	if (typeof input.userId === 'string' && input.userId.trim() && input.userId.trim() !== userId) return fail(403, 'You can only request posting approval for yourself');
	if (typeof input.username === 'string' && input.username.trim() && input.username.trim().toLowerCase() !== String(viewer.username || '').toLowerCase()) {
		return fail(403, 'You can only request posting approval for yourself');
	}
	if (accessOf(subspace) !== 'restricted') return fail(400, `s/${slug} doesn’t need posting approval — ${accessOf(subspace) === 'public' ? 'anyone can post' : 'every member can post'}`);
	const existing = await findSubspaceMemberDoc(id, userId);
	const membership = existing ? membershipOfDoc(existing) : null;
	if (membership?.banned) return fail(403, `You are banned from s/${slug} 🚫`);
	if (!isActiveMember(membership)) return fail(403, `Join s/${slug} first, then ask for posting approval ✋`);
	if (membership!.approved || canModerate(membership)) return fail(400, `You can already post in s/${slug} ✅`);
	const things = await getThingsCollection();
	// an expired temporary ban reads as lifted (membershipOfDoc) but its raw
	// flags would keep this row out of the Requests queue and its count
	// (they match on crystal.banned) — heal the row as the request lands
	const heal: Record<string, unknown> = existing.crystal?.banned === true ? { 'crystal.banned': false, 'crystal.banReason': null, 'crystal.banUntil': null } : {};
	if (!membership!.approvalRequested) {
		await things.updateOne({ _id: existing._id } as any, { $set: { 'crystal.approvalRequested': true, ...heal, updatedAt: new Date() } });
		await notifyModsOfRequest(id, slug, viewer, 'wants to post ✋');
	} else if (Object.keys(heal).length) {
		await things.updateOne({ _id: existing._id } as any, { $set: { ...heal, updatedAt: new Date() } });
	}
	const [fresh, profiles] = await Promise.all([findSubspaceMemberDoc(id, userId), resolveProfiles([userId])]);
	return { ok: true, member: toPublicMember(fresh, profiles.get(userId) || null) };
};

export const mutateMember = async (viewerInput: string | Viewer, input: MutateMemberInput): Promise<Fail | { ok: true; member: PublicSubspaceMember }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const actorId = auth.viewer.id;
	const found = await resolveSubspace(input);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const action = MEMBER_ACTIONS.includes(input.action as MemberAction) ? (input.action as MemberAction) : null;
	if (!action) return fail(400, `action must be one of ${MEMBER_ACTIONS.join(', ')}`);
	if (action === 'request-approval') return requestPostingApproval(auth.viewer, subspace, input);
	const gate = await requireModerator(id, actorId);
	if (gate.ok === false) return gate;
	const actorIsOwner = gate.membership.role === 'owner';

	const targetUserId = await resolveTargetUserId(input);
	if (isFail(targetUserId)) return targetUserId;
	const things = await getThingsCollection();
	const existing = await findSubspaceMemberDoc(id, targetUserId);
	const target = existing ? membershipOfDoc(existing) : null;
	if (target?.role === 'owner') return fail(403, 'The owner can’t be moderated');
	if (target && target.role === 'moderator' && !target.left && !actorIsOwner && (action === 'ban' || action === 'remove' || action === 'role')) {
		return fail(403, 'Only the owner can moderate other moderators');
	}
	const targetPending = !!target && target.pending && !target.left && !target.banned;
	const targetAskedForApproval = !!target && target.approvalRequested && !target.approved && isActiveMember(target);
	// a pending join request is not a membership: a moderator can decide it
	// (accept / deny / add), ban the requester, or let them straight in as a
	// moderator — nothing else. Posting rights or the member role on a row
	// that is still waiting would leave it half-in (approved but pending, or
	// a "no longer a moderator" bell for someone who never was one).
	if (targetPending && (action === 'approve' || action === 'unapprove' || (action === 'role' && input.role === 'member'))) {
		return fail(400, 'Accept the join request first — they are not a member yet');
	}
	const reason = sanitizeReason(input.reason);
	const now = new Date();
	let set: Record<string, unknown> = {};
	let detail: Record<string, unknown> | null = null;
	// a denied join request drops its row entirely (the user may ask again)
	let deleteRow = false;
	// the request state the write must still find (accept / deny / add on a
	// pending row): a requester who cancelled (row gone) or re-requested (new
	// row) between the read above and this write matches nothing, and the
	// decision answers 409 instead of logging an accept + ringing "welcome
	// in" for someone who is not a member
	let guard: Record<string, unknown> | null = null;

	switch (action) {
		case 'add':
			// also accepts a pending join request (activates the same row)
			set = { 'crystal.left': false, 'crystal.banned': false, 'crystal.banReason': null, 'crystal.banUntil': null, 'crystal.pending': false };
			if (targetPending) {
				detail = { acceptedRequest: true };
				guard = PENDING_REQUEST_MATCH;
			}
			break;
		case 'accept':
			if (!targetPending) return fail(404, 'No pending join request from that user');
			set = { 'crystal.pending': false, 'crystal.left': false, 'crystal.banned': false };
			guard = PENDING_REQUEST_MATCH;
			break;
		case 'deny':
			// a pending JOIN request is dropped; a posting-approval request is
			// cleared (the member stays a member)
			if (targetPending) {
				deleteRow = true;
				guard = PENDING_REQUEST_MATCH;
			} else if (targetAskedForApproval) {
				set = { 'crystal.approvalRequested': false };
				guard = APPROVAL_REQUEST_MATCH;
			} else return fail(404, 'No pending request from that user');
			detail = { request: targetPending ? 'join' : 'approval' };
			break;
		case 'remove':
			if (!existing || target?.left) return fail(404, 'Not a member');
			if (targetPending) return fail(404, 'Not a member yet — deny the join request instead');
			// a kick revokes restricted posting rights too: the row that is
			// left behind must never read as an approved poster
			set = { 'crystal.left': true, 'crystal.role': 'member', 'crystal.approved': false, 'crystal.pending': false, 'crystal.approvalRequested': false };
			break;
		case 'approve':
			// grants posting rights and settles any open approval request
			set = { 'crystal.approved': true, 'crystal.approvalRequested': false };
			break;
		case 'unapprove':
			set = { 'crystal.approved': false, 'crystal.approvalRequested': false };
			break;
		case 'ban': {
			if (targetUserId === actorId) return fail(400, 'You can’t ban yourself');
			const days = Number(input.banDays);
			const banUntil = Number.isFinite(days) && days > 0 ? new Date(now.getTime() + Math.min(days, MAX_BAN_DAYS) * 86_400_000) : null;
			// banning a pending requester also removes the request (they never
			// joined, so the row reads left like any pre-emptive ban)
			set = {
				'crystal.banned': true,
				'crystal.banReason': reason,
				'crystal.banUntil': banUntil,
				'crystal.role': 'member',
				'crystal.approved': false,
				'crystal.pending': false,
				'crystal.approvalRequested': false,
				...(targetPending ? { 'crystal.left': true } : {})
			};
			detail = { banUntil: banUntil ? banUntil.toISOString() : null };
			break;
		}
		case 'unban':
			set = { 'crystal.banned': false, 'crystal.banReason': null, 'crystal.banUntil': null };
			break;
		case 'role': {
			if (!actorIsOwner) return fail(403, 'Only the owner can promote or demote moderators 👑');
			const role = input.role === 'moderator' || input.role === 'member' ? input.role : null;
			if (!role) return fail(400, 'role must be moderator or member');
			// promoting a pending requester lets them in as a moderator
			set = {
				'crystal.role': role,
				'crystal.left': false,
				...(role === 'moderator' ? { 'crystal.approved': true, 'crystal.banned': false, 'crystal.pending': false, 'crystal.approvalRequested': false } : {})
			};
			detail = { role };
			break;
		}
	}

	const WITHDRAWN = 'That request was withdrawn — reload the queue';
	if (deleteRow) {
		const dropped = await things.deleteOne({ _id: existing._id, ...(guard || {}) } as any);
		if (guard && !Number(dropped?.deletedCount)) return fail(409, WITHDRAWN);
	} else if (existing) {
		const written = await things.updateOne({ _id: existing._id, ...(guard || {}) } as any, { $set: { ...set, updatedAt: now } });
		if (guard && !Number(written?.matchedCount)) return fail(409, WITHDRAWN);
	} else {
		if (action === 'remove' || action === 'unban' || action === 'unapprove') return fail(404, 'Not a member');
		// add/approve/ban/role on a non-member mints the row (bans on
		// non-members are how pre-emptive bans work); a lone approve/role
		// also implies membership
		const crystal: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(set)) crystal[key.replace(/^crystal\./, '')] = value;
		if (action === 'ban') crystal.left = true; // banned, never joined
		try {
			await things.insertOne(newSubspaceMemberDoc(id, targetUserId, crystal) as any);
		} catch (err) {
			if (!isDuplicateKey(err)) throw err;
			await things.updateOne(
				{ thingtime: 'subspace-member', targetId: id, ownerId: targetUserId } as any,
				{ $set: { ...set, updatedAt: now } }
			);
		}
	}
	await writeModlog(id, actorId, `member.${action}`, { userId: targetUserId, reason, detail });
	// the affected user hears about role + ban changes and an accepted join
	// request (never throws; prefs gate delivery). The preview leads with
	// s/<slug> so the bell deep-links.
	const notice =
		action === 'role'
			? { type: 'subspace-role' as const, text: set['crystal.role'] === 'moderator' ? 'you are now a moderator 🎩' : 'you are no longer a moderator' }
			: action === 'ban'
				? {
						type: 'subspace-ban' as const,
						text: `you were banned${typeof detail?.banUntil === 'string' ? ` until ${(detail.banUntil as string).slice(0, 10)}` : ''}${reason ? ` — ${reason}` : ''} 🚫`
					}
				: action === 'unban'
					? { type: 'subspace-ban' as const, text: 'your ban was lifted 🕊️' }
					: action === 'accept' || (action === 'add' && targetPending)
						? { type: 'subspace-join-accepted' as const, text: 'your request to join was accepted — welcome in 🎉' }
						: null;
	if (notice) {
		await emitNotification({
			recipientId: targetUserId,
			type: notice.type,
			actor: notificationActorOf(auth.viewer),
			targetId: id,
			preview: subspaceNotificationPreview(slug, notice.text)
		});
	}
	const fresh = await findSubspaceMemberDoc(id, targetUserId);
	const profiles = await resolveProfiles([targetUserId]);
	// a denied join request has no row any more — answer the last known shape,
	// flagged left so a client drops it from every list
	const profile = profiles.get(targetUserId) || null;
	if (!fresh && !existing) return fail(404, 'Not a member');
	const member = fresh ? toPublicMember(fresh, profile) : { ...toPublicMember(existing, profile), pending: false, approvalRequested: false, left: true };
	return { ok: true, member };
};

// ---------------------------------------------------------------------------
// Lifecycle: ownership transfer + deletion (owner only)

export type TransferSubspaceInput = SubspaceRef & { userId?: unknown; username?: unknown };

// The owner hands s/<slug> to an ACTIVE member: they become owner (approved),
// the previous owner steps down to moderator (and may now leave), the
// subspace doc changes hands — through the accounted updater, so its bytes
// move ledgers in the same transaction — and the new owner is notified.
export const transferSubspace = async (
	viewerInput: string | Viewer,
	input: TransferSubspaceInput
): Promise<Fail | { ok: true; subspace: PublicSubspace; newOwner: PublicSubspaceMember }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const actorId = auth.viewer.id;
	const found = await resolveSubspace(input);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const gate = await requireOwner(subspace, actorId, 'transfer ownership');
	if (gate.ok === false) return gate;
	const targetUserId = await resolveTargetUserId(input);
	if (isFail(targetUserId)) return targetUserId;
	if (targetUserId === actorId) return fail(400, 'You already own this subspace 👑');
	const targetDoc = await findSubspaceMemberDoc(id, targetUserId);
	const target = targetDoc ? membershipOfDoc(targetDoc) : null;
	if (target?.banned) return fail(403, `A banned user can’t take over s/${slug} — lift the ban first`);
	if (!isActiveMember(target)) return fail(404, `The new owner has to be an active member of s/${slug} first`);
	const ownerCapMessage = `They already run ${MAX_SUBSPACES_PER_USER} subspaces — the cap applies to owners too`;
	if ((await ownedSubspaceCount(targetUserId)) >= MAX_SUBSPACES_PER_USER) return fail(400, ownerCapMessage);

	const things = await getThingsCollection();
	const now = new Date();
	try {
		await withAccountedThingsTransaction(async (session) => {
			// every write is guarded by the state the gate saw, so two transfers
			// racing from the same owner (double-submit, two tabs, two API clients)
			// commit at most once: the loser matches nothing and the whole
			// transaction aborts — never two owner rows, never an ownerId that
			// disagrees with the roster. The cap is re-read under the session too.
			if ((await ownedSubspaceCount(targetUserId, session)) >= MAX_SUBSPACES_PER_USER) throw new LifecycleConflict(ownerCapMessage);
			const handedOver = await updateAccountedThing(things, { shareId: id, thingtime: 'subspace', ownerId: actorId }, { $set: { ownerId: targetUserId, updatedAt: now } }, { session });
			if (!Number(handedOver?.matchedCount)) throw new LifecycleConflict(`s/${slug} changed hands while you were transferring it — reload and try again`);
			const crowned = await things.updateOne(
				// still an active member: not left, and not banned (an expired
				// temporary ban is healed lazily, so it reads as not banned here too)
				{
					_id: targetDoc._id,
					targetId: id,
					'crystal.left': { $ne: true },
					'crystal.pending': { $ne: true },
					$or: [{ 'crystal.banned': { $ne: true } }, { 'crystal.banUntil': { $ne: null, $lte: now } }]
				} as any,
				{ $set: { 'crystal.role': 'owner', 'crystal.approved': true, 'crystal.left': false, 'crystal.banned': false, 'crystal.banReason': null, 'crystal.banUntil': null, 'crystal.pending': false, 'crystal.approvalRequested': false, updatedAt: now } },
				{ session }
			);
			if (!Number(crowned?.matchedCount)) throw new LifecycleConflict(`The new owner is no longer an active member of s/${slug} — reload and try again`);
			const steppedDown = await things.updateOne({ _id: gate.doc._id, 'crystal.role': 'owner' } as any, { $set: { 'crystal.role': 'moderator', updatedAt: now } }, { session });
			if (!Number(steppedDown?.matchedCount)) throw new LifecycleConflict(`s/${slug} changed hands while you were transferring it — reload and try again`);
		});
	} catch (err) {
		const conflict = lifecycleConflictToFail(err);
		if (conflict) return conflict;
		throw err;
	}
	await writeModlog(id, actorId, 'owner.transfer', { userId: targetUserId, detail: { previousOwnerId: actorId } });
	await emitNotification({
		recipientId: targetUserId,
		type: 'subspace-role',
		actor: notificationActorOf(auth.viewer),
		targetId: id,
		preview: subspaceNotificationPreview(slug, 'you are now the owner 👑')
	});
	const [fresh, counts, actorMembership, newOwnerDoc, profiles] = await Promise.all([
		findSubspace({ id }),
		memberCountsFor([id]),
		membershipOf(id, actorId),
		findSubspaceMemberDoc(id, targetUserId),
		resolveProfiles([targetUserId])
	]);
	return {
		ok: true,
		subspace: toPublicSubspace(fresh, { memberCount: counts.get(id) || 0, membership: actorMembership }),
		newOwner: toPublicMember(newOwnerDoc, profiles.get(targetUserId) || null)
	};
};

// Posts survive their subspace. Every post-shaped thing still pointing at it
// (plain posts AND rich ['post','comment'] things — anything the posting gate
// stamped, so no private fence can outlive its subspace) loses the pointer /
// flair / mod state / private fence in bounded accounted batches (each batch
// one storage transaction — a large subspace never becomes one giant
// transaction). Which strip a post gets is releaseKindFor: a post written
// behind a private wall, or one the moderators removed, becomes an
// author-only post rather than a world-readable one. Both updates re-check
// their side of the split in the filter, so a post moderated mid-pass is
// simply picked up next pass. A batch that trips the accounted updater's
// storage_conflict (an author deleted their post inside the batch) is
// retried, bounded. `remaining` is what still points at the subspace when
// the passes are spent — the caller refuses to drop the doc while it is > 0.
type ReleaseTally = { released: number; privatized: number; remaining: number };
const releaseSubspacePosts = async (things: any, subspaceId: string, access: SubspaceAccessMode): Promise<ReleaseTally> => {
	const fenced = withMatch(postThingMatch(), { 'crystal.subspaceId': subspaceId });
	const tally: ReleaseTally = { released: 0, privatized: 0, remaining: 0 };
	let conflicts = 0;
	for (let pass = 0; pass < MAX_RELEASE_PASSES; pass++) {
		const rows = (await things.find(fenced as any).project({ shareId: 1, 'subspaceMod.status': 1 }).limit(RELEASE_BATCH).toArray()) as any[];
		if (!rows.length) break;
		const split: Record<'released' | 'privatized', string[]> = { released: [], privatized: [] };
		for (const row of rows) split[releaseKindFor(access, row.subspaceMod?.status === 'removed')].push(String(row.shareId));
		const now = new Date();
		let matched = 0;
		try {
			if (split.privatized.length) {
				const filter = withMatch(fenced, { shareId: { $in: split.privatized } }, access === 'private' ? {} : { 'subspaceMod.status': 'removed' });
				const result = await updateAccountedThings(things, filter, privatizedPostUpdate(now));
				const count = Number(result?.matchedCount) || 0;
				tally.privatized += count;
				matched += count;
			}
			if (split.released.length) {
				const filter = withMatch(fenced, { shareId: { $in: split.released } }, { 'subspaceMod.status': { $ne: 'removed' } });
				const result = await updateAccountedThings(things, filter, releasedPostUpdate(now));
				const count = Number(result?.matchedCount) || 0;
				tally.released += count;
				matched += count;
			}
		} catch (err) {
			// the batch's transaction aborted as a whole — re-find and go again
			if (err instanceof StorageMutationError && err.code === 'storage_conflict' && ++conflicts <= MAX_RELEASE_CONFLICTS) continue;
			throw err;
		}
		if (!matched) break; // raced away underneath us — never spin
	}
	tally.remaining = Number(await things.countDocuments(fenced as any)) || 0;
	return tally;
};

export type DeleteSubspaceInput = SubspaceRef & { confirmSlug?: unknown };
export type DeleteSubspaceResult = { ok: true; releasedPosts: number; privatePosts: number; removedMembers: number };

// Owner deletes s/<slug> after retyping its slug. Cascade order matters for
// retries: posts are released first (a failure here leaves everything intact
// — the owner simply retries, the release is idempotent; posts are never
// left fenced behind a missing subspace: while any still point at it the
// call answers 409 and keeps the doc), then the subspace doc itself
// (accounted delete — it is billable content) together with the slug
// tombstone in one guarded transaction, then the member / mod-log / report
// plumbing rows (unbilled; the owner's row must outlive the doc delete or a
// failed attempt could strand a subspace nobody may delete). Former
// moderators are told.
export const deleteSubspace = async (viewerInput: string | Viewer, input: DeleteSubspaceInput): Promise<Fail | DeleteSubspaceResult> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const actorId = auth.viewer.id;
	const found = await resolveSubspace(input);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const gate = await requireOwner(subspace, actorId, 'delete a subspace');
	if (gate.ok === false) return gate;
	if (!confirmSlugMatches(input.confirmSlug, slug)) return fail(400, `Type the slug to confirm — s/${slug}`);

	const things = await getThingsCollection();
	const access = accessOf(subspace);
	const formerModeratorIds = await moderatorRecipientIds(id, actorId);
	const first = await releaseSubspacePosts(things, id, access);
	if (first.remaining > 0) {
		return fail(409, `s/${slug} still has ${first.remaining.toLocaleString('en-US')} posts to release — run delete again to continue (it is safe to retry)`);
	}
	// the doc goes and the slug tombstone arrives in ONE transaction, guarded
	// by the ownership the gate saw: a transfer that landed meanwhile makes the
	// delete match nothing and the whole thing aborts with 409
	const now = new Date();
	try {
		await withAccountedThingsTransaction(async (session) => {
			const dropped = await deleteAccountedThing(things, { shareId: id, thingtime: 'subspace', ownerId: actorId }, { session });
			if (!Number(dropped?.deletedCount)) throw new LifecycleConflict(`s/${slug} changed hands while you were deleting it — reload and try again`);
			await things.insertOne(newSubspaceTombstoneDoc(id, slug, actorId, now) as any, { session });
		});
	} catch (err) {
		const conflict = lifecycleConflictToFail(err);
		if (conflict) return conflict;
		throw err;
	}
	const memberResult = await things.deleteMany({ thingtime: 'subspace-member', targetId: id } as any);
	await things.deleteMany({ thingtime: { $in: ['subspace-modlog', 'subspace-report'] }, targetId: id } as any);
	// a post that landed between the release pass and the doc delete would
	// keep a dangling pointer — one more (usually empty) pass catches it; the
	// doc is gone, so nothing new can arrive after this one
	const second = await releaseSubspacePosts(things, id, access);

	if (formerModeratorIds.length) {
		await emitNotificationsBulk(
			formerModeratorIds.map((recipientId) => ({ recipientId, type: 'subspace-role' as const })),
			{ actor: notificationActorOf(auth.viewer), targetId: id, preview: subspaceNotificationPreview(slug, 'was deleted by its owner 🗑️') }
		);
	}
	const privatePosts = first.privatized + second.privatized;
	return {
		ok: true,
		releasedPosts: first.released + second.released + privatePosts,
		privatePosts,
		removedMembers: Number(memberResult?.deletedCount) || 0
	};
};

// ---------------------------------------------------------------------------
// Post moderation

export type PostModAction = 'remove' | 'approve' | 'pin' | 'unpin' | 'lock' | 'unlock' | 'nsfw' | 'spoiler' | 'flair';
const POST_MOD_ACTIONS: PostModAction[] = ['remove', 'approve', 'pin', 'unpin', 'lock', 'unlock', 'nsfw', 'spoiler', 'flair'];

export type ModeratePostInput = { id?: unknown; action?: unknown; reason?: unknown; value?: unknown; flairId?: unknown };

export const moderatePost = async (viewerInput: string | Viewer, input: ModeratePostInput): Promise<Fail | { ok: true; post: PublicPost }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const actorId = auth.viewer.id;
	if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Post id required');
	const action = POST_MOD_ACTIONS.includes(input.action as PostModAction) ? (input.action as PostModAction) : null;
	if (!action) return fail(400, `action must be one of ${POST_MOD_ACTIONS.join(', ')}`);

	const things = await getThingsCollection();
	const post = (await things.findOne(withMatch(postMatch(), { shareId: input.id.trim() }) as any)) as any as ThingDoc | null;
	const subspaceId = typeof post?.crystal?.subspaceId === 'string' ? post!.crystal!.subspaceId : null;
	if (!post || !subspaceId) return fail(404, 'Post not found in a subspace');
	const gate = await requireModerator(subspaceId, actorId);
	if (gate.ok === false) return gate;
	const subspace = await findSubspace({ id: subspaceId });
	if (!subspace) return fail(404, 'Subspace not found');

	const reason = sanitizeReason(input.reason);
	const now = new Date();
	const current = (post as any).subspaceMod || {};
	const set: Record<string, unknown> = { updatedAt: now };
	const unset: Record<string, ''> = {};
	let detail: Record<string, unknown> | null = null;
	switch (action) {
		case 'remove':
			set['subspaceMod.status'] = 'removed';
			set['subspaceMod.removedById'] = actorId;
			set['subspaceMod.removedAt'] = now;
			set['subspaceMod.reason'] = reason;
			break;
		case 'approve':
			set['subspaceMod.status'] = 'approved';
			set['subspaceMod.approvedById'] = actorId;
			set['subspaceMod.approvedAt'] = now;
			unset['subspaceMod.removedById'] = '';
			unset['subspaceMod.removedAt'] = '';
			unset['subspaceMod.reason'] = '';
			break;
		case 'pin': {
			const pinned = await things.countDocuments({ ...livePostMatch(subspaceId), 'subspaceMod.pinned': true } as any);
			if (!current.pinned && pinned >= MAX_PINNED) return fail(400, `A subspace can pin at most ${MAX_PINNED} posts`);
			set['subspaceMod.pinned'] = true;
			break;
		}
		case 'unpin':
			set['subspaceMod.pinned'] = false;
			break;
		case 'lock':
			set['subspaceMod.locked'] = true;
			break;
		case 'unlock':
			set['subspaceMod.locked'] = false;
			break;
		case 'nsfw':
			set['subspaceMod.nsfw'] = input.value !== false;
			detail = { value: input.value !== false };
			break;
		case 'spoiler':
			set['subspaceMod.spoiler'] = input.value !== false;
			detail = { value: input.value !== false };
			break;
		case 'flair': {
			if (input.flairId === null || input.flairId === '' || input.flairId === undefined) {
				unset['crystal.flairId'] = '';
				detail = { flairId: null };
			} else {
				const flair = flairById(flairsOf(subspace), typeof input.flairId === 'string' ? input.flairId.trim() : null);
				if (!flair) return fail(400, 'Unknown flair');
				set['crystal.flairId'] = flair.id;
				detail = { flairId: flair.id };
			}
			break;
		}
	}
	if (!('subspaceMod.status' in set) && !current.status) set['subspaceMod.status'] = 'approved';
	const update: Record<string, unknown> = { $set: set };
	if (Object.keys(unset).length) update.$unset = unset;
	// accounted update: a flair change edits the post's crystal, and the
	// storage ledger keeps a byte-exact stamp per content row — a raw updateOne
	// would leave sizeBytes stale and lock the AUTHOR out of their next PATCH
	// ("requires the current storage migration"). Root subspaceMod fields are
	// outside the stamp, so this is a no-op delta for the other actions.
	await updateAccountedThing(things, { shareId: post.shareId }, update);
	await writeModlog(subspaceId, actorId, `post.${action}`, { postId: post.shareId, reason, detail });
	const fresh = (await things.findOne({ shareId: post.shareId } as any)) as any as ThingDoc;
	const [projected] = await toPublicPosts([fresh], auth.viewer);
	return { ok: true, post: projected };
};

export type ListModlogQuery = SubspaceRef & { cursor?: unknown; limit?: unknown };

export const listModlog = async (viewerInput: string | Viewer, query: ListModlogQuery): Promise<Fail | { ok: true; entries: PublicModlogEntry[]; nextCursor: string | null }> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const found = await resolveSubspace(query);
	if (found.ok === false) return found;
	const id = String(found.subspace.shareId);
	const gate = await requireModerator(id, auth.viewer.id);
	if (gate.ok === false) return gate;
	const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_PAGE), MAX_PAGE);
	const match: Record<string, any> = { thingtime: 'subspace-modlog', targetId: id };
	const cursor = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
	const pageMatch = cursor ? withMatch(match, chronoCursorClause(cursor)) : match;
	const things = await getThingsCollection();
	const docs = (await things
		.find(pageMatch as any)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(limit + 1)
		.toArray()) as any[];
	const page = docs.slice(0, limit);
	const last = page[page.length - 1];
	const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
	const profiles = await resolveProfiles(page.flatMap((doc) => [String(doc.ownerId), ...(doc.crystal?.userId ? [String(doc.crystal.userId)] : [])]));
	return {
		ok: true,
		entries: page.map((doc) => ({
			id: String(doc.shareId),
			action: String(doc.crystal?.action || ''),
			actor: profiles.get(String(doc.ownerId)) || null,
			userId: doc.crystal?.userId ? String(doc.crystal.userId) : null,
			user: doc.crystal?.userId ? profiles.get(String(doc.crystal.userId)) || null : null,
			postId: doc.crystal?.postId ? String(doc.crystal.postId) : null,
			reason: doc.crystal?.reason ?? null,
			detail: doc.crystal?.detail && typeof doc.crystal.detail === 'object' ? doc.crystal.detail : null,
			createdAt: new Date(doc.createdAt).toISOString()
		})),
		nextCursor
	};
};

// ---------------------------------------------------------------------------
// The subspace feed

export type SubspaceFeedQuery = SubspaceRef & { sort?: unknown; range?: unknown; cursor?: unknown; limit?: unknown; includeRemoved?: unknown };

export type SubspaceFeedResult = {
	ok: true;
	subspace: PublicSubspace;
	posts: PublicPost[];
	nextCursor: string | null;
	sort: SubspaceFeedSort;
};

export const subspaceFeed = async (viewerInput: string | Viewer, query: SubspaceFeedQuery): Promise<Fail | SubspaceFeedResult> => {
	const viewer = await withFriendIds(asViewer(viewerInput));
	const found = await resolveSubspace(query);
	if (found.ok === false) return found;
	const { subspace } = found;
	const id = String(subspace.shareId);
	const membership = viewer?.subspaceRoles ? viewer.subspaceRoles.get(id) || null : await membershipOf(id, viewer?.id);
	const moderator = canModerate(membership);
	if (accessOf(subspace) === 'private' && !moderator && !isActiveMember(membership)) {
		return fail(403, `s/${String(subspace.crystal?.slug || id)} is private — members only 🔒`);
	}
	const sort = sanitizeSort(query.sort);
	const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_PAGE), MAX_PAGE);
	const includeRemoved = moderator && (query.includeRemoved === true || query.includeRemoved === 'true' || query.includeRemoved === '1');
	const things = await getThingsCollection();
	const counts = await memberCountsFor([id]);
	const publicSubspace = toPublicSubspace(subspace, { memberCount: counts.get(id) || 0, membership });

	const audience = visibilityQueryFor(viewer, []);
	if (!audience) return { ok: true, subspace: publicSubspace, posts: [], nextCursor: null, sort };
	const base = withMatch(postMatch(), { 'crystal.subspaceId': id }, audience, includeRemoved ? {} : { 'subspaceMod.status': { $ne: 'removed' } });

	if (sort === 'new') {
		const cursor = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
		// pinned posts lead the first page, newest-first below them
		const pinnedDocs = cursor
			? []
			: ((await things
					.find(withMatch(base, { 'subspaceMod.pinned': true }) as any)
					.sort({ createdAt: -1, shareId: 1 })
					.limit(MAX_PINNED)
					.toArray()) as any as ThingDoc[]);
		const pinnedIds = pinnedDocs.map((doc) => doc.shareId);
		const pageMatch = withMatch(base, cursor ? chronoCursorClause(cursor) : {}, pinnedIds.length ? { shareId: { $nin: pinnedIds } } : {});
		const docs = (await things
			.find(pageMatch as any)
			.sort({ createdAt: -1, shareId: 1 })
			.limit(limit + 1)
			.toArray()) as any as ThingDoc[];
		const page = docs.slice(0, limit);
		const last = page[page.length - 1];
		const nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;
		const visible = [...pinnedDocs, ...page].filter((doc) => canView(doc, viewer));
		return { ok: true, subspace: publicSubspace, posts: await toPublicPosts(visible, viewer), nextCursor, sort };
	}

	// ranked sorts: lean candidate window → one batched vote tally → pure
	// ranking → offset paging → full docs for the page slice only
	const nowMs = Date.now();
	const since = sort === 'top' || sort === 'controversial' ? topRangeSince(sanitizeTopRange(query.range), nowMs) : sort === 'rising' ? topRangeSince('day', nowMs) : null;
	const windowMatch = since ? withMatch(base, { createdAt: { $gte: since } }) : base;
	const candidates = (await things
		.find(windowMatch as any)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(RANKED_WINDOW)
		.project({ shareId: 1, createdAt: 1, 'subspaceMod.pinned': 1 })
		.toArray()) as any[];
	const tallies = await updownTalliesFor(
		candidates.map((doc) => String(doc.shareId)),
		viewer?.id || null
	);
	const ranked = rankSubspacePosts(
		candidates.map(
			(doc): RankCandidate => ({
				id: String(doc.shareId),
				createdAtMs: new Date(doc.createdAt).getTime(),
				up: tallies.get(String(doc.shareId))?.up || 0,
				down: tallies.get(String(doc.shareId))?.down || 0,
				pinned: doc.subspaceMod?.pinned === true
			})
		),
		sort,
		nowMs
	);
	const offset = Math.max(0, Number(query.cursor) || 0);
	const pageIds = ranked.slice(offset, offset + limit);
	const pageDocs = pageIds.length ? ((await things.find(withMatch({ shareId: { $in: pageIds } }, postMatch()) as any).toArray()) as any as ThingDoc[]) : [];
	const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
	const page = pageIds.map((pageId) => docsById.get(pageId)).filter(Boolean) as ThingDoc[];
	const visible = page.filter((doc) => canView(doc, viewer));
	const nextCursor = offset + limit < ranked.length ? String(offset + limit) : null;
	return { ok: true, subspace: publicSubspace, posts: await toPublicPosts(visible, viewer), nextCursor, sort };
};
