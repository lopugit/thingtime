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
	MAX_SUBSPACE_REPORT_REPORTERS_LISTED,
	MAX_SUBSPACES_PER_USER,
	SUBSPACE_ROLES,
	subspaceNotificationPreview,
	type SubspaceAccessMode,
	type SubspaceFeedSort,
	type SubspaceReportResolution,
	type SubspaceReportStatus,
	type SubspaceRole
} from '~/schemas/registry';
import {
	asViewer,
	canView,
	canViewInherited,
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
	findSubspaceById,
	findSubspaceMemberDoc,
	flairsOf,
	isActiveMember,
	loadViewerSubspaceRoles,
	membershipOf,
	membershipOfDoc,
	resolveRootPost,
	SUBSPACE_MEMBER_KEY_FIELD,
	SUBSPACE_REPORT_KEY_FIELD,
	SUBSPACE_SLUG_KEY_FIELD,
	subspaceIdOfDoc,
	subspaceMemberKeyOf,
	subspaceReportKeyOf,
	userFlairsOf,
	type SubspaceMembership
} from './gate';
import {
	canPostIn,
	confirmSlugMatches,
	flairById,
	liveUserFlair,
	privatizedPostUpdate,
	rankSubspacePosts,
	releaseKindFor,
	releasedPostUpdate,
	removalReasonsOf,
	resolveRemovalReason,
	resolveUserFlair,
	rulesOf,
	sanitizeAccess,
	sanitizeBranding,
	sanitizeDescription,
	sanitizeFlairs,
	sanitizeName,
	sanitizeReason,
	sanitizeRemovalReasons,
	sanitizeReportNote,
	sanitizeReportReason,
	sanitizeRules,
	sanitizeSlug,
	sanitizeSort,
	sanitizeTopRange,
	sanitizeUserFlairs,
	slugHoldState,
	pickReportQueueSubspace,
	tallyReportReasons,
	topRangeSince,
	toPublicUserFlair,
	userFlairSettingsOf,
	userFlairSurvivesDemotion,
	type PublicUserFlair,
	type RankCandidate,
	type ReportReasonTally,
	type SubspaceBranding,
	type SubspaceFlair,
	type SubspaceRemovalReason,
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
// the Reports queue groups the subspace's report rows by post over a bounded
// newest-first window (the ranked-feed pattern) and pages the groups by offset
// — deterministic for a fixed dataset; a queue deeper than the window is a
// subspace with thousands of unsettled reports, and its first pages are the
// ones that matter
const REPORT_WINDOW = 2_000;

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
	// the flair the viewer wears here (active members only; live template
	// label/emoji/color, or their custom text)
	userFlair: PublicUserFlair | null;
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
	// user flairs: the templates members wear beside their name + the two
	// self-service switches (moderators are bound by neither)
	userFlairs: SubspaceFlair[];
	userFlairSelfAssign: boolean;
	allowCustomUserFlair: boolean;
	// canned removal reasons moderators pick when removing a post (title +
	// message become the stored reason); public like the rules they extend
	removalReasons: SubspaceRemovalReason[];
	branding: SubspaceBranding;
	ownerId: string;
	memberCount: number;
	postCount?: number;
	// moderators only (subspace detail): open join requests / posting-approval
	// requests waiting in the Requests queue
	pendingCount?: number;
	approvalRequestCount?: number;
	// moderators only (subspace detail): open reports waiting in the Reports queue
	openReportCount?: number;
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
	// the flair they wear here (null when none / not an active member)
	userFlair: PublicUserFlair | null;
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
		approvalRequested: member && membership!.approvalRequested && !membership!.approved,
		userFlair: member ? toPublicUserFlair(liveUserFlair(membership!.userFlair, userFlairsOf(subspace))) : null
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
	options: { memberCount: number; postCount?: number; membership: SubspaceMembership | null; requestCounts?: RequestCounts | null; openReportCount?: number | null }
): PublicSubspace => ({
	id: String(doc.shareId),
	slug: String(doc.crystal?.slug || ''),
	name: String(doc.crystal?.name || doc.crystal?.slug || 'Subspace'),
	description: doc.crystal?.description ?? null,
	access: accessOf(doc),
	nsfw: doc.crystal?.nsfw === true,
	rules: Array.isArray(doc.crystal?.rules) ? doc.crystal.rules : [],
	flairs: flairsOf(doc),
	...userFlairSettingsOf(doc.crystal),
	removalReasons: removalReasonsOf(doc.crystal),
	branding: brandingOf(doc),
	ownerId: String(doc.ownerId),
	memberCount: options.memberCount,
	...(options.postCount === undefined ? {} : { postCount: options.postCount }),
	...(options.requestCounts ? { pendingCount: options.requestCounts.pending, approvalRequestCount: options.requestCounts.approvalRequests } : {}),
	...(typeof options.openReportCount === 'number' ? { openReportCount: options.openReportCount } : {}),
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt || doc.createdAt).toISOString(),
	viewer: viewerStateOf(doc, options.membership)
});

// `subspace` supplies the live user-flair templates the member's pick resolves
// against (a renamed template shows its current label)
const toPublicMember = (doc: any, profile: FeedAuthor | null, subspace: any): PublicSubspaceMember => {
	const membership = membershipOfDoc(doc);
	const active = isActiveMember(membership);
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
		approvalRequested: membership.approvalRequested && !membership.approved && active,
		userFlair: active ? toPublicUserFlair(liveUserFlair(membership.userFlair, userFlairsOf(subspace))) : null,
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

// open reports waiting in the subspace's Reports queue (the badge on Mod
// tools 🎩 / the Reports tab) — one indexed count
const OPEN_REPORT_MATCH = { thingtime: 'subspace-report', 'crystal.status': 'open' };
const openReportCountFor = async (subspaceId: string): Promise<number> => {
	const things = await getThingsCollection();
	return things.countDocuments({ ...OPEN_REPORT_MATCH, targetId: subspaceId } as any);
};

// Settle every open report on one post: a moderator's remove / approve does
// it implicitly (resolution removed / approved), dismiss explicitly. Answers
// how many rows flipped (0 = nothing was open).
const resolveOpenReports = async (things: any, subspaceId: string, postId: string, resolution: SubspaceReportResolution, actorId: string, now: Date): Promise<number> => {
	const result = await things.updateMany(
		{ ...OPEN_REPORT_MATCH, targetId: subspaceId, 'crystal.postId': postId } as any,
		{ $set: { 'crystal.status': 'resolved', 'crystal.resolution': resolution, 'crystal.resolvedById': actorId, 'crystal.resolvedAt': now, updatedAt: now } }
	);
	return Number(result?.modifiedCount) || 0;
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

// The PUNITIVE notifications (a post removal, a ban / unban) come from the
// subspace's mod team, not from the individual moderator — the post
// projection deliberately hides removedById from the author, and the bell
// must not hand them the name the card withholds (Reddit sends removals and
// bans from the subreddit's mod team for the same reason: a single mod is a
// target). actorId = the subspace shareId (no user has it: notifications.ts
// finds no live profile and keeps this snapshot — actorUsername null, so the
// bell never links to a profile; the row deep-links to the post / subspace
// like every subspace notification). The mod log still names the moderator.
// Role changes and accepted requests keep naming the acting mod — nothing to
// retaliate against there. emitNotification's self-check compares the
// recipient against THIS id, so callers skip the author-is-the-actor case
// themselves.
const subspaceModTeamActor = (subspaceId: string, slug: string) => ({ id: subspaceId, username: null, displayName: `s/${slug} mods` });

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
	const [profiles, requestCounts, openReportCount] = await Promise.all([
		resolveProfiles(modDocs.map((doc) => String(doc.ownerId))),
		canModerate(membership) ? requestCountsFor(id) : Promise.resolve(null),
		canModerate(membership) ? openReportCountFor(id) : Promise.resolve(null)
	]);
	return {
		ok: true,
		subspace: toPublicSubspace(subspace, { memberCount: counts.get(id) || 0, postCount, membership, requestCounts, openReportCount }),
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
	// user flairs (moderators): the templates + the two self-service switches
	userFlairs?: unknown;
	userFlairSelfAssign?: unknown;
	allowCustomUserFlair?: unknown;
	// removal reasons (moderators): the canned { id, title, message } list
	removalReasons?: unknown;
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
	// user flairs — any moderator (the templates are the post-flair grammar;
	// the switches gate MEMBERS' self-service only, never moderators)
	if (input.userFlairs !== undefined) {
		const userFlairs = sanitizeUserFlairs(input.userFlairs);
		if (isFail(userFlairs)) return userFlairs;
		set['crystal.userFlairs'] = userFlairs;
		changed.push('userFlairs');
	}
	if (input.userFlairSelfAssign !== undefined) {
		if (typeof input.userFlairSelfAssign !== 'boolean') return fail(400, 'userFlairSelfAssign must be true or false');
		set['crystal.userFlairSelfAssign'] = input.userFlairSelfAssign;
		changed.push('userFlairSelfAssign');
	}
	if (input.allowCustomUserFlair !== undefined) {
		if (typeof input.allowCustomUserFlair !== 'boolean') return fail(400, 'allowCustomUserFlair must be true or false');
		set['crystal.allowCustomUserFlair'] = input.allowCustomUserFlair;
		changed.push('allowCustomUserFlair');
	}
	// removal reasons — any moderator (they extend the rules; a removed post
	// keeps the composed text it was removed with, so editing the list never
	// rewrites history)
	if (input.removalReasons !== undefined) {
		const removalReasons = sanitizeRemovalReasons(input.removalReasons);
		if (isFail(removalReasons)) return removalReasons;
		set['crystal.removalReasons'] = removalReasons;
		changed.push('removalReasons');
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
	return { ok: true, members: page.map((doc) => toPublicMember(doc, profiles.get(String(doc.ownerId)) || null, found.subspace)), nextCursor };
};

export type MemberAction = 'add' | 'remove' | 'approve' | 'unapprove' | 'ban' | 'unban' | 'role' | 'accept' | 'deny' | 'request-approval' | 'userFlair';
const MEMBER_ACTIONS: MemberAction[] = ['add', 'remove', 'approve', 'unapprove', 'ban', 'unban', 'role', 'accept', 'deny', 'request-approval', 'userFlair'];

export type MutateMemberInput = SubspaceRef & {
	userId?: unknown;
	username?: unknown;
	action?: unknown;
	role?: unknown;
	reason?: unknown;
	banDays?: unknown;
	// ban: a private moderator note (mod log only — never shown to the user)
	note?: unknown;
	// userFlair: a template id, or custom text (+ optional emoji/color);
	// neither clears
	flairId?: unknown;
	text?: unknown;
	emoji?: unknown;
	color?: unknown;
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
	return { ok: true, member: toPublicMember(fresh, profiles.get(userId) || null, subspace) };
};

// `userFlair` — the flair beside a member's name. Self-service (no userId /
// username, or your own): an ACTIVE member picks a template (not modOnly)
// while userFlairSelfAssign is on, types custom text while
// allowCustomUserFlair is on, and may always clear their own. Moderators
// dress ANYONE — the owner included (the round-2 spec says anyone, and the
// owner can always override their own pick) — with any template, modOnly
// included, or custom text; only THAT (a mod setting someone else's) writes
// a member.userFlair mod-log entry. The decision is subspaceCore's
// resolveUserFlair, so the UI and the server agree.
const setUserFlair = async (viewer: NonNullable<Viewer>, subspace: any, input: MutateMemberInput): Promise<Fail | { ok: true; member: PublicSubspaceMember }> => {
	const id = String(subspace.shareId);
	const slug = String(subspace.crystal?.slug || id);
	const actorId = viewer.id;
	const explicitTarget = (typeof input.userId === 'string' && input.userId.trim()) || (typeof input.username === 'string' && input.username.trim());
	const targetUserId = explicitTarget ? await resolveTargetUserId(input) : actorId;
	if (isFail(targetUserId)) return targetUserId;
	const self = targetUserId === actorId;
	const actorMembership = self ? null : await membershipOf(id, actorId);
	const moderator = self ? false : canModerate(actorMembership);
	if (!self && !moderator) return fail(403, 'Only moderators can set someone else’s flair 🎩');
	const existing = await findSubspaceMemberDoc(id, targetUserId);
	const target = existing ? membershipOfDoc(existing) : null;
	if (self) {
		if (target?.banned) return fail(403, `You are banned from s/${slug} 🚫`);
		if (!isActiveMember(target)) return fail(403, `Join s/${slug} first to wear a flair there`);
	} else {
		if (target?.banned) return fail(400, 'Lift the ban first — a banned user wears no flair');
		if (!isActiveMember(target)) return fail(404, target?.pending ? 'Accept the join request first — they are not a member yet' : 'Not a member');
	}
	// moderators are bound by neither switch — for themselves included (they
	// may dress anyone, themselves too)
	const actorIsModerator = self ? canModerate(target) : moderator;
	const flair = resolveUserFlair({ flairId: input.flairId, text: input.text, emoji: input.emoji, color: input.color }, userFlairSettingsOf(subspace.crystal), { moderator: actorIsModerator, self });
	if (isFail(flair)) return flair;
	const things = await getThingsCollection();
	const now = new Date();
	await things.updateOne({ _id: existing._id } as any, { $set: { 'crystal.userFlair': flair, updatedAt: now } });
	if (!self) {
		await writeModlog(id, actorId, 'member.userFlair', { userId: targetUserId, detail: { flairId: flair?.id ?? null, text: flair?.text ?? null } });
	}
	const [fresh, profiles] = await Promise.all([findSubspaceMemberDoc(id, targetUserId), resolveProfiles([targetUserId])]);
	return { ok: true, member: toPublicMember(fresh, profiles.get(targetUserId) || null, subspace) };
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
	if (action === 'userFlair') return setUserFlair(auth.viewer, subspace, input);
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
			// a kick revokes restricted posting rights AND the flair: the row
			// that is left behind must never read as an approved poster, and a
			// badge a mod handed out must not walk back in with a rejoin — once
			// back they pick again (or a mod dresses them again)
			set = { 'crystal.left': true, 'crystal.role': 'member', 'crystal.approved': false, 'crystal.pending': false, 'crystal.approvalRequested': false, 'crystal.userFlair': null };
			if (target?.userFlair) detail = { userFlairCleared: true };
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
				// a ban strips the flair too — unban (or an expired ban) restores
				// the membership, never a badge nobody re-granted
				'crystal.userFlair': null,
				...(targetPending ? { 'crystal.left': true } : {})
			};
			// the optional note is for the mod log only (the user sees `reason`)
			const note = sanitizeReason(input.note);
			detail = { banUntil: banUntil ? banUntil.toISOString() : null, ...(note ? { note } : {}), ...(target?.userFlair ? { userFlairCleared: true } : {}) };
			break;
		}
		case 'unban':
			set = { 'crystal.banned': false, 'crystal.banReason': null, 'crystal.banUntil': null };
			break;
		case 'role': {
			if (!actorIsOwner) return fail(403, 'Only the owner can promote or demote moderators 👑');
			const role = input.role === 'moderator' || input.role === 'member' ? input.role : null;
			if (!role) return fail(400, 'role must be moderator or member');
			// promoting a pending requester lets them in as a moderator; a
			// demotion takes a MOD-ONLY flair off with the hat (ordinary
			// templates and custom text stay — the member could have picked those)
			const stripFlair = role === 'member' && !!target?.userFlair && !userFlairSurvivesDemotion(target.userFlair, userFlairSettingsOf(subspace.crystal).userFlairs);
			set = {
				'crystal.role': role,
				'crystal.left': false,
				...(role === 'moderator' ? { 'crystal.approved': true, 'crystal.banned': false, 'crystal.pending': false, 'crystal.approvalRequested': false } : {}),
				...(stripFlair ? { 'crystal.userFlair': null } : {})
			};
			detail = { role, ...(stripFlair ? { userFlairCleared: true } : {}) };
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
	// s/<slug> so the bell deep-links. A ban / unban comes from the mod team
	// (subspaceModTeamActor), a role change / an accepted request from the mod.
	const notice =
		action === 'role'
			? { type: 'subspace-role' as const, text: set['crystal.role'] === 'moderator' ? 'you are now a moderator 🎩' : 'you are no longer a moderator', fromModTeam: false }
			: action === 'ban'
				? {
						type: 'subspace-ban' as const,
						text: `you were banned${typeof detail?.banUntil === 'string' ? ` until ${(detail.banUntil as string).slice(0, 10)}` : ''}${reason ? ` — ${reason}` : ''} 🚫`,
						fromModTeam: true
					}
				: action === 'unban'
					? { type: 'subspace-ban' as const, text: 'your ban was lifted 🕊️', fromModTeam: true }
					: action === 'accept' || (action === 'add' && targetPending)
						? { type: 'subspace-join-accepted' as const, text: 'your request to join was accepted — welcome in 🎉', fromModTeam: false }
						: null;
	// (a mod can't ban themselves — 400 above — so the mod-team actor never
	// needs a self-skip here)
	if (notice) {
		await emitNotification({
			recipientId: targetUserId,
			type: notice.type,
			actor: notice.fromModTeam ? subspaceModTeamActor(id, slug) : notificationActorOf(auth.viewer),
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
	const member = fresh ? toPublicMember(fresh, profile, subspace) : { ...toPublicMember(existing, profile, subspace), pending: false, approvalRequested: false, left: true };
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
		newOwner: toPublicMember(newOwnerDoc, profiles.get(targetUserId) || null, fresh)
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

// remove: `reason` (free text) and/or `reasonId` (one of the subspace's
// removal reasons — its title + message become the stored reason, the free
// text rides along as a note) or `ruleIndex` (cites a rule the same way)
export type ModeratePostInput = { id?: unknown; action?: unknown; reason?: unknown; reasonId?: unknown; ruleIndex?: unknown; value?: unknown; flairId?: unknown };

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

	let reason = sanitizeReason(input.reason);
	// the short form of a removal reason for the author's bell (the title of a
	// canned reason / the rule citation / the free text) — set by `remove`
	let headline: string | null = null;
	const now = new Date();
	const current = (post as any).subspaceMod || {};
	const set: Record<string, unknown> = { updatedAt: now };
	const unset: Record<string, ''> = {};
	let detail: Record<string, unknown> | null = null;
	switch (action) {
		case 'remove': {
			// a canned removal reason (reasonId) or a cited rule (ruleIndex)
			// composes the stored reason: title — message · note; unknown ids /
			// out-of-range indexes answer 400 before anything is touched
			const resolved = resolveRemovalReason(input, removalReasonsOf(subspace.crystal), rulesOf(subspace.crystal));
			if (isFail(resolved)) return resolved;
			// idempotent: a post that is already removed stays exactly as it is
			// — no rewrite of removedById / removedAt / reason, no second
			// post.remove mod-log row and, above all, no second bell for the
			// author (a request retried after a timeout, or two mods racing on
			// the same post, must not ring twice). Approve first to remove it
			// again with a different reason.
			if (current.status === 'removed') {
				// …but reports filed against it since are settled (the queue must
				// not keep asking about a post that is already down)
				await resolveOpenReports(things, subspaceId, post.shareId, 'removed', actorId, now);
				const [unchanged] = await toPublicPosts([post], auth.viewer);
				return { ok: true, post: unchanged };
			}
			reason = resolved.reason;
			headline = resolved.headline;
			set['subspaceMod.status'] = 'removed';
			set['subspaceMod.removedById'] = actorId;
			set['subspaceMod.removedAt'] = now;
			set['subspaceMod.reason'] = reason;
			if (resolved.reasonId) {
				set['subspaceMod.reasonId'] = resolved.reasonId;
				detail = { reasonId: resolved.reasonId };
			} else unset['subspaceMod.reasonId'] = '';
			if (resolved.ruleIndex !== null) {
				set['subspaceMod.ruleIndex'] = resolved.ruleIndex;
				detail = { ruleIndex: resolved.ruleIndex };
			} else unset['subspaceMod.ruleIndex'] = '';
			break;
		}
		case 'approve':
			set['subspaceMod.status'] = 'approved';
			set['subspaceMod.approvedById'] = actorId;
			set['subspaceMod.approvedAt'] = now;
			unset['subspaceMod.removedById'] = '';
			unset['subspaceMod.removedAt'] = '';
			unset['subspaceMod.reason'] = '';
			unset['subspaceMod.reasonId'] = '';
			unset['subspaceMod.ruleIndex'] = '';
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
	// a removal / approval is the mods' verdict on every open report against
	// the post: settle them (resolution removed / approved) so the Reports
	// queue and the card's 🚩 badge clear with it; the mod log notes how many
	if (action === 'remove' || action === 'approve') {
		const resolvedReports = await resolveOpenReports(things, subspaceId, post.shareId, action === 'remove' ? 'removed' : 'approved', actorId, now);
		if (resolvedReports > 0) detail = { ...(detail || {}), resolvedReports };
	}
	await writeModlog(subspaceId, actorId, `post.${action}`, { postId: post.shareId, reason, detail });
	// the author hears about a removal (never throws; prefs gate delivery).
	// Post-scoped: postId deep-links to /post/<id>; the preview leads with
	// s/<slug> and carries the HEADLINE (a canned reason's title / the rule
	// citation / the free text — previews clamp at 140 chars and the full
	// composed reason is on the post the row opens); it comes from the mod
	// team, never the individual moderator (subspaceModTeamActor — the
	// projection hides removedById from the author for the same reason), so
	// the author-is-the-actor skip is explicit here: a moderator removing
	// their own post tells nobody. approve notifies nothing (the post simply
	// comes back).
	if (action === 'remove' && String(post.ownerId) !== actorId) {
		const slug = String(subspace.crystal?.slug || subspaceId);
		await emitNotification({
			recipientId: String(post.ownerId),
			type: 'subspace-post-removed',
			actor: subspaceModTeamActor(subspaceId, slug),
			targetId: post.shareId,
			postId: post.shareId,
			preview: subspaceNotificationPreview(slug, headline || 'removed by the moderators 🧹')
		});
	}
	const fresh = (await things.findOne({ shareId: post.shareId } as any)) as any as ThingDoc;
	const [projected] = await toPublicPosts([fresh], auth.viewer);
	return { ok: true, post: projected };
};

// ---------------------------------------------------------------------------
// Reports — a viewer flags a post (or a comment, resolved to its root post) to
// the subspace's moderators. One subspace-report thing per (post, reporter):
// targetId = the subspace, ownerId = the reporter, uniqueness on the root
// uniqueKeys namespace (subspaceReportKey:<postId>:<reporterId>). The mods'
// Reports queue groups the rows by post; moderate remove / approve settles
// them implicitly, dismiss explicitly.

export type PublicSubspaceReport = {
	id: string;
	subspaceId: string;
	postId: string;
	// the flagged comment when a comment was reported (null for the post)
	commentId: string | null;
	reason: string;
	note: string | null;
	status: SubspaceReportStatus;
	resolution: SubspaceReportResolution | null;
	createdAt: string;
	updatedAt: string;
};

const toPublicReport = (doc: any): PublicSubspaceReport => ({
	id: String(doc.shareId),
	subspaceId: String(doc.targetId),
	postId: String(doc.crystal?.postId || ''),
	commentId: typeof doc.crystal?.commentId === 'string' && doc.crystal.commentId ? doc.crystal.commentId : null,
	reason: String(doc.crystal?.reason || ''),
	note: typeof doc.crystal?.note === 'string' && doc.crystal.note ? doc.crystal.note : null,
	status: doc.crystal?.status === 'resolved' ? 'resolved' : 'open',
	resolution: doc.crystal?.resolution === 'removed' || doc.crystal?.resolution === 'approved' || doc.crystal?.resolution === 'dismissed' ? doc.crystal.resolution : null,
	createdAt: new Date(doc.createdAt).toISOString(),
	updatedAt: new Date(doc.updatedAt || doc.createdAt).toISOString()
});

const newSubspaceReportDoc = (subspaceId: string, reporterId: string, crystal: { postId: string; commentId: string | null; reason: string; note: string | null }, now: Date) => {
	const reportKey = subspaceReportKeyOf(crystal.postId, reporterId);
	return {
		shareId: randomUUID(),
		schemaVersion: THINGS_SCHEMA_VERSION,
		thingtime: ['subspace-report'],
		crystal: { ...crystal, status: 'open', resolution: null, resolvedById: null, resolvedAt: null, reportKey },
		uniqueKeys: [thingUniqueKey(SUBSPACE_REPORT_KEY_FIELD, reportKey)],
		extended: null,
		ownerId: reporterId,
		acl: ['tt:user'],
		targetId: subspaceId,
		tags: [],
		createdAt: now,
		updatedAt: now
	};
};

export type ReportPostInput = { id?: unknown; reason?: unknown; note?: unknown };
export type ReportPostResult = { ok: true; report: PublicSubspaceReport; updated: boolean };

// Any logged-in viewer who can SEE the target and is not banned in its
// subspace may report it. A comment resolves to its root post (the report
// hangs off the post; commentId remembers which comment). A repeat by the
// same reporter updates the reason / note on their row — and re-opens it when
// the mods had settled it — answering { updated: true }; only a NEW (or
// re-opened) report rings the mods (subspace-report, preview = the reason,
// postId = the post; deduped against each mod's unread bell).
export const reportPost = async (viewerInput: string | Viewer, input: ReportPostInput): Promise<Fail | ReportPostResult> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Post id required');
	const reason = sanitizeReportReason(input.reason);
	if (isFail(reason)) return reason;
	const note = sanitizeReportNote(input.note);
	if (isFail(note)) return note;
	const viewer = (await withFriendIds(auth.viewer)) as NonNullable<Viewer>;
	const things = await getThingsCollection();
	// a post or a comment (plain ['comment'] or rich ['post','comment'])
	const target = (await things.findOne({ shareId: input.id.trim(), $or: [{ thingtime: 'post' }, { thingtime: 'comment' }, { kind: 'post' }] } as any)) as any as ThingDoc | null;
	// never disclose what the viewer can't see: unknown and invisible read alike
	if (!target || !(await canViewInherited(target, viewer))) return fail(404, 'Post not found');
	const root = await resolveRootPost(target);
	const subspaceId = subspaceIdOfDoc(root);
	if (!root || !subspaceId) return fail(400, 'Only posts in a subspace can be reported to its moderators 🚩');
	const subspace = await findSubspaceById(subspaceId);
	if (!subspace) return fail(404, 'Subspace not found');
	const slug = String(subspace.crystal?.slug || subspaceId);
	const membership = viewer.subspaceRoles?.get(subspaceId) || (await membershipOf(subspaceId, viewer.id));
	if (membership?.banned) return fail(403, `You are banned from s/${slug} 🚫`);
	// a post the moderators have already taken down is not reportable: the
	// mods can't act on it again (only Dismiss would be left in the queue) and
	// every fresh row would re-ring the whole mod team about content that is
	// already off the feeds — an unbounded nuisance loop. The redacted
	// placeholder card is visible to everyone, so a 409 discloses nothing new.
	if (root.subspaceMod?.status === 'removed') return fail(409, 'That post was already removed by the moderators 🧹');
	const postId = String(root.shareId);
	const commentId = String(target.shareId) !== postId ? String(target.shareId) : null;
	const now = new Date();
	const keyFilter = { thingtime: 'subspace-report', ...thingUniqueKeyFilter(SUBSPACE_REPORT_KEY_FIELD, subspaceReportKeyOf(postId, viewer.id)) };
	// targetId rides along so a repeat files in the subspace the post lives in
	// NOW — the row is keyed on (post, reporter), and a post can move
	const reopenSet = { targetId: subspaceId, 'crystal.reason': reason, 'crystal.note': note, 'crystal.commentId': commentId, 'crystal.status': 'open', 'crystal.resolution': null, 'crystal.resolvedById': null, 'crystal.resolvedAt': null, updatedAt: now };
	const existing = await things.findOne(keyFilter as any);
	let updated = false;
	// a brand-new or re-opened report rings the mods; a repeat on an open row
	// only refreshes it (no second bell for the same reporter)
	let rings = false;
	if (existing) {
		updated = true;
		// settled by the mods, or filed in a subspace the post has since left
		// (its new mods have not heard about it) — both count as a fresh report
		const reopened = existing.crystal?.status !== 'open' || String(existing.targetId) !== subspaceId;
		rings = reopened;
		// a re-opened row restarts its clock so the queue lists it as new
		await things.updateOne({ _id: existing._id } as any, { $set: { ...reopenSet, ...(reopened ? { createdAt: now } : {}) } });
	} else {
		try {
			await things.insertOne(newSubspaceReportDoc(subspaceId, viewer.id, { postId, commentId, reason, note }, now) as any);
			rings = true;
		} catch (err) {
			if (!isDuplicateKey(err)) throw err; // raced ourselves — refresh the row instead
			updated = true;
			await things.updateOne(keyFilter as any, { $set: reopenSet });
		}
	}
	if (rings) {
		const recipientIds = await moderatorRecipientIds(subspaceId, viewer.id);
		if (recipientIds.length) {
			await emitNotificationsBulk(
				recipientIds.map((recipientId) => ({ recipientId, type: 'subspace-report' as const })),
				{ actor: notificationActorOf(viewer), targetId: postId, postId, preview: subspaceNotificationPreview(slug, reason) },
				{ dedupeUnread: true }
			);
		}
	}
	const row = await things.findOne(keyFilter as any);
	if (!row) return fail(409, 'That report vanished while it was being filed — try again');
	return { ok: true, report: toPublicReport(row), updated };
};

export type ListReportsQuery = SubspaceRef & { status?: unknown; cursor?: unknown; limit?: unknown };

export type PublicReportedPost = {
	postId: string;
	// the post as the moderator sees it (removed content included); null when
	// the post is gone or left the subspace since — dismiss clears such rows
	post: PublicPost | null;
	reportCount: number;
	reasons: ReportReasonTally[];
	// the newest reporters first, bounded (reportCount is the exact total)
	reporters: { userId: string; profile: FeedAuthor | null; reason: string; note: string | null; commentId: string | null; createdAt: string }[];
	latestAt: string;
	status: SubspaceReportStatus;
	// resolved queue only: how the last report on the post was settled
	resolution: SubspaceReportResolution | null;
};

export type ListReportsResult = { ok: true; reports: PublicReportedPost[]; nextCursor: string | null; status: SubspaceReportStatus; openReportCount: number };

// The Reports queue (moderators): the subspace's report rows of one status,
// grouped by post — newest activity first — with the reasons tally and the
// reporters, plus the post re-projected for the mod (one toPublicPosts pass
// for the page). Groups page by offset over a bounded newest-first window.
export const listReports = async (viewerInput: string | Viewer, query: ListReportsQuery): Promise<Fail | ListReportsResult> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const found = await resolveSubspace(query);
	if (found.ok === false) return found;
	const id = String(found.subspace.shareId);
	const gate = await requireModerator(id, auth.viewer.id);
	if (gate.ok === false) return gate;
	const status: SubspaceReportStatus = query.status === 'resolved' ? 'resolved' : 'open';
	const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_PAGE), MAX_PAGE);
	const offset = Math.max(0, Number(query.cursor) || 0);
	const things = await getThingsCollection();
	const groups = (await things
		.aggregate([
			{ $match: { thingtime: 'subspace-report', targetId: id, 'crystal.status': status } },
			{ $sort: { updatedAt: -1, shareId: 1 } },
			{ $limit: REPORT_WINDOW },
			{
				$group: {
					_id: '$crystal.postId',
					count: { $sum: 1 },
					latestAt: { $max: '$updatedAt' },
					// $push keeps the sorted order: newest report first per post
					reports: { $push: { userId: '$ownerId', reason: '$crystal.reason', note: '$crystal.note', commentId: '$crystal.commentId', createdAt: '$createdAt', resolution: '$crystal.resolution' } }
				}
			},
			{ $sort: { latestAt: -1, _id: 1 } },
			{ $skip: offset },
			{ $limit: limit + 1 }
		])
		.toArray()) as any[];
	const page = groups.slice(0, limit);
	const nextCursor = groups.length > limit ? String(offset + limit) : null;
	const postIds = page.map((group) => String(group._id));
	const viewer = await withFriendIds(auth.viewer);
	const [postDocs, openReportCount] = await Promise.all([
		postIds.length ? (things.find(withMatch(postThingMatch(), { shareId: { $in: postIds } }) as any).toArray() as Promise<any[]>) : Promise.resolve([] as any[]),
		openReportCountFor(id)
	]);
	// a post that left the subspace (or was deleted) is no longer this queue's
	// business as content — the group stays listed with post null so the mods
	// can dismiss it
	const visibleDocs = (postDocs as ThingDoc[]).filter((doc) => subspaceIdOfDoc(doc) === id && canView(doc, viewer));
	const projected = await toPublicPosts(visibleDocs, viewer);
	const postsById = new Map(projected.map((post) => [post.id, post]));
	const reporterIds = page.flatMap((group) => (group.reports as any[]).slice(0, MAX_SUBSPACE_REPORT_REPORTERS_LISTED).map((report) => String(report.userId)));
	const profiles = await resolveProfiles(reporterIds);
	return {
		ok: true,
		reports: page.map((group) => {
			const reports = (group.reports as any[]).map((report) => ({
				userId: String(report.userId),
				reason: String(report.reason || ''),
				note: typeof report.note === 'string' && report.note ? report.note : null,
				commentId: typeof report.commentId === 'string' && report.commentId ? report.commentId : null,
				createdAt: new Date(report.createdAt).toISOString(),
				resolution: report.resolution ?? null
			}));
			return {
				postId: String(group._id),
				post: postsById.get(String(group._id)) || null,
				reportCount: Number(group.count) || reports.length,
				reasons: tallyReportReasons(reports),
				reporters: reports.slice(0, MAX_SUBSPACE_REPORT_REPORTERS_LISTED).map(({ userId, reason, note, commentId, createdAt }) => ({ userId, profile: profiles.get(userId) || null, reason, note, commentId, createdAt })),
				latestAt: new Date(group.latestAt).toISOString(),
				status,
				resolution: status === 'resolved' ? reports[0]?.resolution || null : null
			};
		}),
		nextCursor,
		status,
		openReportCount
	};
};

export type MutateReportsInput = SubspaceRef & { postId?: unknown; action?: unknown };
export type MutateReportsResult = { ok: true; postId: string; dismissed: number; openReportCount: number };

// POST /reports { postId, action: 'dismiss' } — the mods looked and the post
// stays: every open report on it is settled with resolution dismissed (mod
// log report.dismiss). The queue the reports sit in is THEIR targetId (a post
// that moved after it was reported leaves its open rows in the old subspace,
// dismissable from there); the post's current subspace decides when it has
// open rows itself, and an explicit id | slug in the body wins over both.
export const mutateReports = async (viewerInput: string | Viewer, input: MutateReportsInput): Promise<Fail | MutateReportsResult> => {
	const auth = requireViewer(viewerInput);
	if (auth.ok === false) return auth;
	const actorId = auth.viewer.id;
	if (typeof input.postId !== 'string' || !input.postId.trim()) return fail(400, 'postId required');
	if (input.action !== 'dismiss') return fail(400, 'action must be dismiss');
	const postId = input.postId.trim();
	const things = await getThingsCollection();
	let subspaceId: string | null = null;
	if ((typeof input.id === 'string' && input.id.trim()) || (typeof input.slug === 'string' && input.slug.trim())) {
		const found = await resolveSubspace(input);
		if (found.ok === false) return found;
		subspaceId = String(found.subspace.shareId);
	} else {
		// the open rows name their own queue; the post's current subspace is
		// the fallback so a non-moderator still meets the 403 wall and a
		// moderator the 404 when nothing is open anywhere
		const post = (await things.findOne(withMatch(postThingMatch(), { shareId: postId }) as any)) as any;
		const openTargets = ((await things.distinct('targetId', { ...OPEN_REPORT_MATCH, 'crystal.postId': postId } as any)) as unknown[]).map(String);
		subspaceId = pickReportQueueSubspace(subspaceIdOfDoc(post), openTargets);
	}
	if (!subspaceId) return fail(404, 'No open reports on that post');
	const gate = await requireModerator(subspaceId, actorId);
	if (gate.ok === false) return gate;
	const now = new Date();
	const dismissed = await resolveOpenReports(things, subspaceId, postId, 'dismissed', actorId, now);
	if (!dismissed) return fail(404, 'No open reports on that post');
	await writeModlog(subspaceId, actorId, 'report.dismiss', { postId, detail: { count: dismissed } });
	return { ok: true, postId, dismissed, openReportCount: await openReportCountFor(subspaceId) };
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
