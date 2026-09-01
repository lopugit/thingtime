import { createHash } from 'node:crypto';
import { Binary, ObjectId } from 'mongodb';

import {
	ADMIN_SNAPSHOT_LOOKAHEAD_LIMIT,
	ADMIN_SNAPSHOT_MAX_LIMIT,
	InvalidAdminSnapshotCursorError,
	adminSnapshotAfterFilter,
	adminSnapshotCursorKey,
	adminSnapshotExcludingIdFilter,
	consumeAdminSnapshotNewest,
	decodeAdminSnapshotCursor,
	encodeAdminSnapshotCursor,
	mergeAdminSnapshotNewest,
	normalizeAdminSnapshotLimit,
	normalizeAdminSnapshotQuery,
	requireAdminSnapshotCursorKey,
	type AdminSnapshotCursorKey
} from '../admin/adminSnapshot';
// Identity is control-plane: user things ALWAYS live on the home deployment
// DB, regardless of any active data-plane endpoint override (see endpoint.ts) —
// aliased so every things access in this file is home-pinned.
import { getHomeThingsCollection as getThingsCollection, getUsersCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS, MAX_BIO_CHARS, MAX_DISPLAY_NAME_CHARS, MAX_PROFILE_URL_CHARS } from '~/schemas/registry';
import { AttachmentBindingError, reconcileReadyProfileAttachmentsToUser, type ProfileAttachmentRefs } from '../attachments/attachmentStore';
import { effectiveProfileMediaUrl, linkedProfileMediaUrl, profileAttachmentIdFromRecord } from '~/utils/profileMediaUrl';
import { isAdminDoc, isEnvAdmin } from './admin';
import { getSubscription, type SubscriptionInfo } from '../subscriptions/subscriptions';
import { ANONYMOUS_USER_NAME } from '~/utils/userIdentity';
import { sanitizeBirthday } from './birthday';

// Users are THINGS now (thingtime ["user"], see
// TODO/claude-todo/22-everything-is-a-thing-collections.md): public
// profile in crystal, credentials/private state under the root `secure` field
// (sensitive strings as BinData so the $** text index can't tokenize them),
// uniqueness via uniqueKeys (username plain, email hashed). This module keeps
// the LEGACY UserDoc shape as its interchange format — every read adapts the
// thing back to it, so loginUser/getCurrentUser/admin.ts/routes are untouched.
// Reads are dual-era (things first, legacy users collection fallback) until
// the users-to-things admin migration converts old accounts; writes always go
// to things for new accounts, and updates target whichever store holds the doc.

// Canonical legacy user document (thingtime.users) — now also the adapter
// output shape for user things. See FUNDAMENTALS.md §3 +
// TODO/claude-todo/22-everything-is-a-thing-collections.md.
export type UserDoc = {
	_id?: any;
	ttid: string;
	username: string;
	email: string;
	passwordHash: string;
	displayName: string | null;
	bio?: string | null;
	avatarUrl?: string | null;
	bannerUrl?: string | null;
	avatarAttachmentId?: string | null;
	bannerAttachmentId?: string | null;
	emailVerified: boolean;
	createdAt: Date;
	updatedAt: Date;
	accountKind?: 'user' | 'service';
	emailVerificationRequiredBy?: Date | null;
	meta: Record<string, any>;
};

export const profileAttachmentRefsForUserRoot = (
	doc: Pick<UserDoc, 'avatarAttachmentId' | 'bannerAttachmentId'> | Record<string, unknown>
): { avatarAttachmentId?: string; bannerAttachmentId?: string } => ({
	...(typeof doc.avatarAttachmentId === 'string' && doc.avatarAttachmentId ? { avatarAttachmentId: doc.avatarAttachmentId } : {}),
	...(typeof doc.bannerAttachmentId === 'string' && doc.bannerAttachmentId ? { bannerAttachmentId: doc.bannerAttachmentId } : {})
});

// Safe shape returned to clients — never includes passwordHash.
export type PublicUser = {
	id: string;
	ttid: string;
	username: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	bannerUrl: string | null;
	avatarAttachmentId: string | null;
	bannerAttachmentId: string | null;
	avatarLinkedUrl: string | null;
	bannerLinkedUrl: string | null;
	// PRIVATE (secure-blob meta.birthday, YYYY-MM-DD): owner-facing responses and
	// the scope-gated userinfo only — never part of PublicProfile.
	birthday: string | null;
	emailVerified: boolean;
	createdAt: string;
	accountKind: 'user' | 'service';
	emailVerificationRequiredBy: string | null;
	storageAllowanceBytes: number | null;
	storageUsedBytes: number | null;
	temporary?: boolean;
	storageRemainingBytes: number | null;
	storageAccountingReady: boolean;
	storage: {
		usedBytes: number | null;
		allowanceBytes: number | null;
		remainingBytes: number | null;
		overageBytes: number | null;
		status: 'ready' | 'reconciling' | 'unavailable';
		accountingVersion: number | null;
		reconciledAt: string | null;
	};
	activeThemeId: string | null;
	activeFeedAlgorithmId: string | null;
	// Upload permissions are OFF for every account created after the
	// signup-permissions hotfix; an admin turns them on per user from /admin
	// (see setUserUploadPermissions), per scope or all at once. Accounts
	// predating the flags have no meta keys and stay enabled — absence means
	// "grandfathered". Public = post/comment/custom-emoji attachments; private
	// = message attachments + own profile avatar/banner.
	publicUploadsEnabled: boolean;
	privateUploadsEnabled: boolean;
	// true when meta.admin OR the ADMIN_USERNAMES env allowlist — the client uses
	// it to reveal the admin panel; the server always re-checks server-side.
	isAdmin: boolean;
};

// Minimal projection safe to show OTHER users (public profiles, post authors).
// Never includes email, verification state, storage, or meta.
export type PublicProfile = {
	id: string;
	username: string;
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	bannerUrl: string | null;
	createdAt: string;
	temporary?: boolean;
};

// Upload permissions. Each scope is tri-state on purpose:
//   meta.<scope> === false  → withheld (every account created since the
//                             signup-permissions hotfix starts here,
//                             INCLUDING after the email is verified)
//   meta.<scope> === true   → granted by an admin from /admin
//   absent                  → grandfathered account, still allowed
// Scopes: `publicUploads` covers publicly viewable surfaces (post, comment,
// custom-emoji attachments); `privateUploads` covers media only the account's
// own circles see (message attachments, own profile avatar/banner). "All" is
// simply both flags. Admins are always allowed regardless of the flags, so a
// locked-out admin can never be unable to fix the account that grants them.
export const userPublicUploadsEnabled = (user: any): boolean => isAdminDoc(user) || user?.meta?.publicUploads !== false;
export const userPrivateUploadsEnabled = (user: any): boolean => isAdminDoc(user) || user?.meta?.privateUploads !== false;

export const toPublicUser = (user: any, subscription?: SubscriptionInfo | null): PublicUser => {
	const source = subscription?.subjectType === 'user' ? subscription.storage : null;
	const status = source?.status ?? ('unavailable' as const);
	const displayable = status === 'ready' || status === 'reconciling';
	const temporary = user.meta?.temporary === true;
	const storage = {
		usedBytes: displayable ? source?.usedBytes ?? null : null,
		allowanceBytes: source?.allowanceBytes ?? null,
		remainingBytes: displayable ? source?.remainingBytes ?? null : null,
		overageBytes: displayable ? source?.overageBytes ?? null : null,
		status,
		accountingVersion: source?.accountingVersion ?? null,
		reconciledAt: source?.reconciledAt ? source.reconciledAt.toISOString() : null
	};
	return {
		id: String(user._id),
		ttid: user.ttid,
		username: user.username,
		email: user.email,
		displayName: user.meta?.temporary === true ? ANONYMOUS_USER_NAME : user.displayName ?? null,
		bio: typeof user.bio === 'string' ? user.bio : null,
		avatarUrl: effectiveProfileMediaUrl(user, 'avatar'),
		bannerUrl: effectiveProfileMediaUrl(user, 'banner'),
		avatarAttachmentId: profileAttachmentIdFromRecord(user, 'avatar'),
		bannerAttachmentId: profileAttachmentIdFromRecord(user, 'banner'),
		avatarLinkedUrl: linkedProfileMediaUrl(user, 'avatar'),
		bannerLinkedUrl: linkedProfileMediaUrl(user, 'banner'),
		birthday: typeof user.meta?.birthday === 'string' ? user.meta.birthday : null,
		emailVerified: !!user.emailVerified,
		createdAt: new Date(user.createdAt).toISOString(),
		accountKind: user.accountKind === 'service' ? 'service' : 'user',
		emailVerificationRequiredBy: user.emailVerificationRequiredBy ? new Date(user.emailVerificationRequiredBy).toISOString() : null,
		temporary,
		// Compatibility aliases now derive from the canonical nested projection.
		// The old secure-blob fields are deliberately never read here.
		storageAllowanceBytes: storage.allowanceBytes,
		storageUsedBytes: storage.status === 'ready' ? storage.usedBytes : null,
		storageRemainingBytes: storage.status === 'ready' ? storage.remainingBytes : null,
		storageAccountingReady: storage.status === 'ready',
		storage,
		activeThemeId: typeof user.meta?.activeThemeId === 'string' ? user.meta.activeThemeId : null,
		activeFeedAlgorithmId: typeof user.meta?.activeFeedAlgorithmId === 'string' ? user.meta.activeFeedAlgorithmId : null,
		publicUploadsEnabled: userPublicUploadsEnabled(user),
		privateUploadsEnabled: userPrivateUploadsEnabled(user),
		isAdmin: isAdminDoc(user)
	};
};

export const toPublicUserWithStorage = async (user: any): Promise<PublicUser> => {
	const userId = String(user._id);
	return toPublicUser(user, await getSubscription('user', userId));
};

export const toPublicProfile = (user: any): PublicProfile => ({
	id: String(user._id),
	username: user.username,
	displayName: user.meta?.temporary === true ? ANONYMOUS_USER_NAME : user.displayName ?? null,
	bio: typeof user.bio === 'string' ? user.bio : null,
	avatarUrl: effectiveProfileMediaUrl(user, 'avatar'),
	bannerUrl: effectiveProfileMediaUrl(user, 'banner'),
	createdAt: new Date(user.createdAt).toISOString(),
	temporary: user.meta?.temporary === true
});

// ---------------------------------------------------------------------------
// The user-things store.

// BinData wrappers: the wildcard text index tokenizes every STRING field, so
// secrets travel as binary — invisible to $text, still exact-queryable.
export const toBin = (value: string) => new Binary(Buffer.from(value, 'utf8'));
export const fromBin = (value: any): string => {
	// Buffer.isBuffer FIRST: a real Node Buffer also has a `.buffer` (the whole
	// ArrayBuffer slab), so the buffer branch would decode the entire pool
	if (Buffer.isBuffer(value)) return value.toString('utf8');
	if (typeof value === 'string') return value;
	if (value?.buffer) return Buffer.from(value.buffer, value.byteOffset || 0, value.length ?? value.byteLength).toString('utf8');
	return '';
};

// A user thing's private state is the opaque BinData blob (`secure`). The $**
// wildcard text index tokenizes string FIELDS only — binary is invisible to it
// — so blobbing the whole subdocument means no field inside it (email,
// passwordHash, service metadata, active-* pointers, or any field a future kind
// adds) can ever leak via q=<value> search enumeration.
//
// Two private fields deliberately live OUTSIDE the blob as ROOT fields, because
// the blob's read-modify-write + `secureVersion` CAS is too heavy for them:
//   • `secureAdmin`  — a boolean, so listAdmins can query it (booleans aren't
//                      text-indexed either).
//   • `secureRecentReactions` — the reaction MRU (see MAX_RECENT_REACTIONS). It
//                      is the hottest user write (one per reaction toggle), so
//                      it needs targeted atomic $pull/$push instead of
//                      re-serializing the whole blob under CAS on every toggle.
//                      Stored as a BSON ARRAY OF BinData elements: a real array
//                      (so $pull/$push/$slice mutate it in place) whose elements
//                      are binary (so the $** text index can't tokenize the
//                      emoji tokens — same guarantee `secure` relies on). A
//                      plain string array here WOULD be enumerable via
//                      q=<emoji>, which is exactly why it is not one.
// Legacy-era user docs keep their plaintext subdocument shape (the `users`
// collection has no text index, so nothing there is searchable).
type SecurePayload = {
	email?: string;
	passwordHash?: string;
	emailVerified?: boolean;
	accountKind?: 'user' | 'service';
	emailVerificationRequiredBy?: string | null; // ISO in the blob
	// Migration-only residue. Normal user adapters never expose these fields;
	// the whole-account storage migration reads them through one explicit
	// helper, preserves a valid allowance in the subscription, then removes
	// both with the secureVersion CAS writer.
	storageAllowanceBytes?: number;
	storageUsedBytes?: number;
	// never carries `admin` (root boolean) or `recentReactions` (root BinData
	// array — buildUserSecure strips it out); those are root fields, not blob body
	meta?: Record<string, any>;
};

export const packSecure = (payload: SecurePayload) => new Binary(Buffer.from(JSON.stringify(payload), 'utf8'));
export const unpackSecure = (value: any): SecurePayload => {
	const raw = fromBin(value);
	if (!raw) return {};
	try {
		return JSON.parse(raw) as SecurePayload;
	} catch {
		return {};
	}
};

export const stripLegacyStorageFromSecurePayload = <T extends Record<string, any>>(payload: T): T => {
	delete payload.storageAllowanceBytes;
	delete payload.storageUsedBytes;
	return payload;
};

// The reaction MRU (secureRecentReactions) is a BSON array of BinData tokens —
// each emoji token wrapped in binary so the $** text index can't tokenize it.
// These convert between that on-disk shape and the string[] the picker uses.
export const packRecentReactions = (tokens: string[]): Binary[] => tokens.map(toBin);
const unpackRecentReactions = (value: any): string[] => (Array.isArray(value) ? value.map(fromBin).filter((t) => t !== '') : []);

// uniqueKeys are BinData too — plain-string keys would tokenize into the text
// index and make user things enumerable via q=email/q=username, and the email
// key is additionally sha256-hashed so not even an exact-binary reader learns
// an address. The multikey unique index and exact-match lookups work the same
// on binary values.
export const userUsernameKey = (username: string) => toBin(`username:${username.trim().toLowerCase()}`);
export const userEmailKey = (email: string) => toBin(`email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`);

// thing → legacy UserDoc view. _id is the thing's shareId (a hex string —
// String(user._id) everywhere keeps working; new ids are minted ObjectId-shaped
// so ObjectId.isValid guards never reject a things-era user). admin is
// reconstructed from the root boolean; everything else decodes from the blob.
const userThingToDoc = (thing: any): any => {
	const secure = unpackSecure(thing.secure);
	return {
		_id: thing.shareId,
		ttid: thing.crystal?.ttid || thing.crystal?.username,
		username: thing.crystal?.username,
		displayName: thing.crystal?.displayName ?? null,
		bio: thing.crystal?.bio ?? null,
		avatarUrl: thing.crystal?.avatarUrl ?? null,
		bannerUrl: thing.crystal?.bannerUrl ?? null,
		avatarAttachmentId: thing.avatarAttachmentId ?? null,
		bannerAttachmentId: thing.bannerAttachmentId ?? null,
		email: secure.email || '',
		passwordHash: secure.passwordHash || '',
		emailVerified: !!secure.emailVerified,
		accountKind: secure.accountKind === 'service' ? 'service' : 'user',
		emailVerificationRequiredBy: secure.emailVerificationRequiredBy ? new Date(secure.emailVerificationRequiredBy) : null,
		meta: { ...(secure.meta || {}), admin: !!thing.secureAdmin },
		schemaVersion: thing.schemaVersion,
		createdAt: thing.createdAt,
		updatedAt: thing.updatedAt
	};
};

// Build the packed secure blob for a user (shared by insertUser + the
// users-to-things migration so their shapes can't drift). `admin` and
// `recentReactions` are returned separately — they live as ROOT fields
// (secureAdmin boolean, secureRecentReactions BinData array), never in the blob.
export const buildUserSecure = (
	doc: Pick<UserDoc, 'email' | 'passwordHash' | 'emailVerified' | 'accountKind' | 'emailVerificationRequiredBy' | 'meta'> & {
		storageAllowanceBytes?: number;
		storageUsedBytes?: number;
	}
): { secure: Binary; admin: boolean; recentReactions: string[] } => {
	const meta = { ...(doc.meta || {}) };
	const admin = meta.admin === true;
	delete meta.admin; // admin is the root boolean, not blob content
	// recentReactions is the root secureRecentReactions array, not blob content —
	// strip it here so a migrated user's legacy meta.recentReactions moves to the
	// atomic field instead of bloating the CAS-serialized blob.
	const recentReactions = Array.isArray(meta.recentReactions)
		? (meta.recentReactions as string[]).filter((t) => typeof t === 'string').slice(0, MAX_RECENT_REACTIONS)
		: [];
	delete meta.recentReactions;
	const payload: SecurePayload = {
		email: doc.email,
		passwordHash: doc.passwordHash,
		emailVerified: !!doc.emailVerified,
		accountKind: doc.accountKind === 'service' ? 'service' : 'user',
		emailVerificationRequiredBy: doc.emailVerificationRequiredBy ? new Date(doc.emailVerificationRequiredBy).toISOString() : null,
		meta
	};
	if (doc.storageAllowanceBytes !== undefined) payload.storageAllowanceBytes = doc.storageAllowanceBytes;
	if (doc.storageUsedBytes !== undefined) payload.storageUsedBytes = doc.storageUsedBytes;
	return { secure: packSecure(payload), admin, recentReactions };
};

const findUserThing = async (filter: Record<string, unknown>) => (await getThingsCollection()).findOne({ thingtime: 'user', ...filter } as any);

// User resolution runs on every authenticated request (getCurrentUser), so the
// two stores are probed CONCURRENTLY (thing wins) rather than serially — until
// the users→things migration completes, a legacy account would otherwise pay
// two back-to-back round trips on the hottest path. Mirrors searchUsersForAdmin.
export const findUserByUsername = async (username: string) => {
	const normalized = username.trim().toLowerCase();
	const [thing, legacy] = await Promise.all([
		findUserThing({ 'crystal.username': normalized }),
		getUsersCollection().then((c) => c.findOne({ username: normalized }))
	]);
	if (thing) return userThingToDoc(thing);
	return legacy;
};

// Batch form for @mention resolution (bounded at MENTION_CAP per text): same
// two-store probe and Things-first precedence as findUserByUsername, but one
// $in query per physical store instead of up to 2×N point reads on the
// synchronous create path. Preserves caller order; unknown names simply drop
// out. Mirrors findUsersByIds (same loose UserDoc-shaped `any` rows as every
// resolver here — userThingToDoc is untyped by design until the migration).
export const findUsersByUsernames = async (usernames: readonly string[]): Promise<any[]> => {
	const unique = [...new Set(usernames.map((username) => username.trim().toLowerCase()).filter(Boolean))];
	if (!unique.length) return [];
	const [thingRows, legacyRows] = await Promise.all([
		getThingsCollection().then((collection) => collection.find({ thingtime: 'user', 'crystal.username': { $in: unique } } as any).toArray()),
		getUsersCollection().then((collection) => collection.find({ username: { $in: unique } } as any).toArray())
	]);
	const legacyByName = new Map(legacyRows.map((row: any) => [String(row.username), row]));
	const thingsByName = new Map(thingRows.map((row: any) => [String(row?.crystal?.username), userThingToDoc(row)] as const));
	return unique.map((name) => thingsByName.get(name) ?? legacyByName.get(name)).filter((row): row is NonNullable<typeof row> => !!row);
};

export const findUserByEmail = async (email: string) => {
	// the hashed uniqueKey is the exact-match path — no email string in any index
	const [thing, legacy] = await Promise.all([
		getThingsCollection().then((c) => c.findOne({ uniqueKeys: userEmailKey(email) } as any)),
		getUsersCollection().then((c) => c.findOne({ email: email.trim().toLowerCase() }))
	]);
	if (thing) return userThingToDoc(thing);
	return legacy;
};

export const findUserById = async (id: string) => {
	const [thing, legacy] = await Promise.all([
		findUserThing({ shareId: String(id) }),
		ObjectId.isValid(id) ? getUsersCollection().then((c) => c.findOne({ _id: new ObjectId(id) })) : Promise.resolve(null)
	]);
	if (thing) return userThingToDoc(thing);
	return legacy;
};

// Batch form for bounded admin directories. Preserve caller order and the
// same Things-first migration precedence as findUserById, while replacing up
// to hundreds of two-store point reads with one query per physical store.
export const findUsersByIds = async (ids: readonly string[]) => {
	const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
	if (!uniqueIds.length) return [];

	const legacyIds = uniqueIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
	const [thingRows, legacyRows] = await Promise.all([
		getThingsCollection().then((collection) => collection.find({ thingtime: 'user', shareId: { $in: uniqueIds } } as any).toArray()),
		legacyIds.length ? getUsersCollection().then((collection) => collection.find({ _id: { $in: legacyIds } } as any).toArray()) : Promise.resolve([])
	]);

	const legacyById = new Map(legacyRows.map((row: any) => [String(row._id), row]));
	const thingsById = new Map(
		thingRows.map((row: any) => {
			const user = userThingToDoc(row);
			return [String(user._id), user] as const;
		})
	);

	return uniqueIds.map((id) => thingsById.get(id) ?? legacyById.get(id)).filter((row): row is NonNullable<typeof row> => !!row);
};

export type LegacyUserStorageFields = {
	storageAllowanceBytes?: unknown;
	storageUsedBytes?: unknown;
};

// Deliberately migration-only: stale secure-blob counters must not leak back
// into the normal UserDoc interchange shape and become a second display or
// enforcement source. Things-era rows win over their dual-era fallback just
// like every other user resolver.
export const findLegacyUserStorageFieldsByIds = async (ids: readonly string[]): Promise<Map<string, LegacyUserStorageFields>> => {
	const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
	const legacyIds = uniqueIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
	const [thingRows, legacyRows] = await Promise.all([
		uniqueIds.length
			? getThingsCollection().then((collection) =>
					collection
						.find({ thingtime: 'user', shareId: { $in: uniqueIds } } as any)
						.project({ shareId: 1, secure: 1 })
						.toArray()
			  )
			: Promise.resolve([]),
		legacyIds.length
			? getUsersCollection().then((collection) =>
					collection
						.find({ _id: { $in: legacyIds } } as any)
						.project({ storageAllowanceBytes: 1, storageUsedBytes: 1 })
						.toArray()
			  )
			: Promise.resolve([])
	]);

	const fields = new Map<string, LegacyUserStorageFields>();
	for (const row of legacyRows as any[]) {
		fields.set(String(row._id), {
			...(Object.prototype.hasOwnProperty.call(row, 'storageAllowanceBytes') ? { storageAllowanceBytes: row.storageAllowanceBytes } : {}),
			...(Object.prototype.hasOwnProperty.call(row, 'storageUsedBytes') ? { storageUsedBytes: row.storageUsedBytes } : {})
		});
	}
	for (const row of thingRows as any[]) {
		const secure = unpackSecure(row.secure);
		fields.set(String(row.shareId), {
			...(Object.prototype.hasOwnProperty.call(secure, 'storageAllowanceBytes') ? { storageAllowanceBytes: secure.storageAllowanceBytes } : {}),
			...(Object.prototype.hasOwnProperty.call(secure, 'storageUsedBytes') ? { storageUsedBytes: secure.storageUsedBytes } : {})
		});
	}
	return fields;
};

// Batch userId → email-send candidate (address, verified flag, display name,
// raw notificationPrefs) for notification emails: one query per store for a
// whole fan-out instead of N findUserById round trips. Only returns users
// that actually have an email address; things win over legacy on id collision.
export type EmailNotificationTarget = {
	id: string;
	email: string;
	emailVerified: boolean;
	username: string | null;
	displayName: string | null;
	notificationPrefs: Record<string, any>;
};

export const getEmailNotificationTargets = async (userIds: string[]): Promise<EmailNotificationTarget[]> => {
	const ids = [...new Set(userIds.map(String))].filter(Boolean);
	if (!ids.length) return [];
	const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
	const [things, legacy] = await Promise.all([
		getThingsCollection().then((c) =>
			c
				.find({ thingtime: 'user', shareId: { $in: ids } } as any)
				.project({ shareId: 1, crystal: 1, secure: 1 })
				.toArray()
		),
		objectIds.length
			? getUsersCollection().then((c) =>
					c
						.find({ _id: { $in: objectIds } })
						.project({ email: 1, emailVerified: 1, username: 1, displayName: 1, 'meta.notificationPrefs': 1 })
						.toArray()
			  )
			: Promise.resolve([])
	]);
	const map = new Map<string, EmailNotificationTarget>();
	for (const doc of legacy as any[]) {
		if (typeof doc.email !== 'string' || !doc.email) continue;
		map.set(String(doc._id), {
			id: String(doc._id),
			email: doc.email,
			emailVerified: !!doc.emailVerified,
			username: doc.username || null,
			displayName: doc.displayName || null,
			notificationPrefs: doc.meta?.notificationPrefs && typeof doc.meta.notificationPrefs === 'object' ? doc.meta.notificationPrefs : {}
		});
	}
	for (const doc of things as any[]) {
		const secure = unpackSecure(doc.secure);
		if (!secure.email) continue;
		const prefs = secure.meta?.notificationPrefs;
		map.set(String(doc.shareId), {
			id: String(doc.shareId),
			email: secure.email,
			emailVerified: !!secure.emailVerified,
			username: doc.crystal?.username || null,
			displayName: doc.crystal?.displayName ?? null,
			notificationPrefs: prefs && typeof prefs === 'object' ? prefs : {}
		});
	}
	return ids.map((id) => map.get(id)).filter((t): t is EmailNotificationTarget => !!t);
};

// New accounts are user things. The id is minted ObjectId-shaped so every
// String(user._id) / ObjectId.isValid assumption in the auth web holds for
// both eras; users own themselves (ownerId = shareId) and the crystal profile
// is public (acl tt:all) like the profile endpoint always was.
export const insertUser = async (
	doc: UserDoc & { schemaVersion?: number },
	options: {
		initialSubscription?: {
			tierId: string;
			versionId: string;
			version: number;
			title: string;
			metered: boolean;
			quotas: Record<string, number | null>;
		};
		session?: any;
	} = {}
) => {
	const shareId = new ObjectId().toHexString();
	const now = doc.createdAt instanceof Date ? doc.createdAt : new Date();
	const { secure, admin, recentReactions } = buildUserSecure(doc);

	const thing = {
		shareId,
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: ['user'],
		crystal: {
			username: doc.username,
			ttid: doc.ttid || doc.username,
			displayName: doc.displayName ?? null,
			bio: doc.bio ?? null,
			avatarUrl: doc.avatarUrl ?? null,
			bannerUrl: doc.bannerUrl ?? null
		},
		ownerId: shareId,
		acl: [ACL_ALL],
		targetId: null,
		tags: [],
		...profileAttachmentRefsForUserRoot(doc),
		uniqueKeys: [userUsernameKey(doc.username), userEmailKey(doc.email)],
		secure,
		secureVersion: 0, // optimistic-concurrency token for blob mutations
		// Durable signup fallback: if the relational subscription insert is ever
		// interrupted, quota reads still recover the exact revision that was live
		// when this account was created. Unknown root fields are not projected by
		// the public profile adapters.
		...(options.initialSubscription ? { initialSubscription: { ...options.initialSubscription } } : {}),
		// sparse boolean, queryable by listAdmins (booleans aren't text-indexed)
		...(admin ? { secureAdmin: true } : {}),
		// reaction MRU as a BinData array (text-index-invisible, atomically mutable);
		// only present when a migrated account arrives with prior recents
		...(recentReactions.length ? { secureRecentReactions: packRecentReactions(recentReactions) } : {}),
		createdAt: now,
		updatedAt: now
	};
	await (await getThingsCollection()).insertOne(thing as any, options.session ? { session: options.session } : undefined);
	return userThingToDoc(thing);
};

// Read-modify-write a things-era user's secure blob (the whole subdocument is
// opaque BinData, so no dotted $set is possible). The blob can't rely on
// field-scoped atomic $set, so the write is guarded by an optimistic
// `secureVersion` CAS + retry: if another writer bumped the version between our
// read and write, we re-read and re-apply — so two concurrent mutations of
// DIFFERENT fields never clobber each other (proven necessary: a naive
// last-write-wins reverted emailVerified under a racing reaction write).
//
// Returns one of three outcomes so callers never conflate them:
//   'mutated'   — the write landed (return success)
//   'missing'   — no user thing exists (fall back to the legacy users store)
//   'contended' — the thing exists but we lost every CAS round; the mutation did
//                 NOT persist. Callers must surface a failure (a burned-token
//                 password reset must not claim the password rotated) and must
//                 NOT fall through to legacy (the doc is a thing, not legacy).
// generous ceiling: retries only ever loop on genuine concurrent writes to the
// SAME user (rare — a couple at most in practice), and each contended writer
// needs up to (N concurrent) attempts to win a round, so the cap must comfortably
// exceed realistic burst width
const SECURE_CAS_ATTEMPTS = 20;
type SecureMutateResult = 'mutated' | 'missing' | 'contended';
const mutateUserThingSecure = async (userId: string, mutate: (secure: SecurePayload) => void): Promise<SecureMutateResult> => {
	const things = await getThingsCollection();
	const base = { shareId: String(userId), thingtime: 'user' } as any;
	for (let attempt = 0; attempt < SECURE_CAS_ATTEMPTS; attempt++) {
		const thing = await things.findOne(base, { projection: { secure: 1, secureVersion: 1 } });
		if (!thing) return 'missing';
		const version = (thing as any).secureVersion; // number | undefined (pre-versioned docs)
		const secure = unpackSecure((thing as any).secure);
		if (!secure.meta) secure.meta = {};
		mutate(secure);
		// guard on the exact version we read — a missing field guards on its absence
		const guard = version === undefined ? { secureVersion: { $exists: false } } : { secureVersion: version };
		const res = await things.updateOne(
			{ ...base, ...guard },
			{ $set: { secure: packSecure(secure), secureVersion: (version ?? 0) + 1, updatedAt: new Date() } }
		);
		if (res.modifiedCount) return 'mutated';
		// lost the CAS — another writer won; small jittered backoff so a burst of
		// writers doesn't keep colliding on the same round, then re-read and re-apply
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3 * attempt + Math.floor(Math.random() * 5)));
	}
	return 'contended';
};

// Finalize the storage-field handoff after the canonical subscription
// override has been persisted. This uses the same CAS retry as every secure
// mutation, so a racing password/profile write cannot resurrect or lose
// fields. The legacy collection fallback is retained only for recovery from a
// partially-completed users-to-things migration.
export const removeLegacyUserStorageFields = async (userId: string): Promise<void> => {
	const result = await mutateUserThingSecure(userId, (secure) => {
		stripLegacyStorageFromSecurePayload(secure);
	});
	if (result === 'mutated') return;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (
		await getUsersCollection()
	).updateOne(
		{ _id: new ObjectId(userId) },
		{
			$unset: { storageAllowanceBytes: '', storageUsedBytes: '' },
			$set: { updatedAt: new Date() }
		}
	);
};

// Thrown by the secure-blob setters when a things-era write loses every CAS
// round (never persisted). Routes propagate it as a 5xx so the caller retries,
// rather than the write silently reporting success.
class SecureWriteContendedError extends Error {
	constructor(userId: string) {
		super(`secure blob write contended for user ${userId} — mutation did not persist`);
		this.name = 'SecureWriteContendedError';
	}
}

export const markEmailVerified = async (userId: string) => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.emailVerified = true;
	});
	if (result === 'mutated') return;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, { $set: { emailVerified: true, updatedAt: new Date() } });
};

// Rotate the user's password hash. Returns whether a store actually accepted
// the write — a password reset burns its token before rotating, so a silent
// miss here would log the user out everywhere while the OLD password keeps
// working (a failed rotation the user believes succeeded).
export const setUserPasswordHash = async (userId: string, passwordHash: string): Promise<boolean> => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.passwordHash = passwordHash;
	});
	if (result === 'mutated') return true;
	// Contended: the rotation never landed. Throw rather than return — the reset
	// route has already burned the token, so a false success would leave the user
	// locked out with the OLD password still working.
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return false;
	const res = await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, { $set: { passwordHash, updatedAt: new Date() } });
	return res.matchedCount > 0;
};

// Email-2FA opt-in flag (meta.twoFactorEmailEnabled) — dual-era accessors so
// the settings toggle and the login gate hit whichever store holds the doc
// (thing-era users keep it inside the secure blob). Projected reads only.
export const getUserTwoFactorEmailEnabled = async (userId: string): Promise<boolean> => {
	const things = await getThingsCollection();
	const thing = await things.findOne({ shareId: String(userId), thingtime: 'user' } as any, { projection: { secure: 1 } });
	if (thing) return !!unpackSecure((thing as any).secure).meta?.twoFactorEmailEnabled;
	if (!ObjectId.isValid(userId)) return false;
	const doc = await (await getUsersCollection()).findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.twoFactorEmailEnabled': 1 } });
	return !!doc?.meta?.twoFactorEmailEnabled;
};

// Returns whether a store matched the user — enabling 2FA must never report
// success without the flag actually landing (login would then skip the OTP).
export const setUserTwoFactorEmailEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.meta!.twoFactorEmailEnabled = enabled;
	});
	if (result === 'mutated') return true;
	// Contended: the flag never landed. Throw rather than report success — a false
	// "enabled" would make login skip the OTP step the user thinks they turned on.
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return false;
	const res = await (
		await getUsersCollection()
	).updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.twoFactorEmailEnabled': enabled, updatedAt: new Date() } });
	return res.matchedCount > 0;
};

// Notification prefs (meta.notificationPrefs: { [type]: boolean }) — absent
// key = enabled (defaults ON). Dual-era accessors mirroring the 2FA flag
// above; cold-written, so the secure blob is the right home (never crystal —
// string-free booleans, but the blob keeps ALL private account state in one
// place). Merged as a patch so two devices flipping different switches don't
// clobber each other.
export const getUserNotificationPrefs = async (userId: string): Promise<Record<string, boolean>> => {
	const things = await getThingsCollection();
	const thing = await things.findOne({ shareId: String(userId), thingtime: 'user' } as any, { projection: { secure: 1 } });
	if (thing) {
		const prefs = unpackSecure((thing as any).secure).meta?.notificationPrefs;
		return prefs && typeof prefs === 'object' ? { ...prefs } : {};
	}
	if (!ObjectId.isValid(userId)) return {};
	const doc = await (await getUsersCollection()).findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.notificationPrefs': 1 } });
	const prefs = doc?.meta?.notificationPrefs;
	return prefs && typeof prefs === 'object' ? { ...prefs } : {};
};

// Returns whether a store matched the user. Contended writes throw — a false
// success would leave a switch the user flipped silently unapplied.
// Flat boolean keys are the push/in-app channel; the 'email' and 'masters'
// keys hold nested channel objects and merge one level deep so flipping one
// email switch never clobbers the others.
export const setUserNotificationPrefs = async (userId: string, patch: Record<string, boolean | Record<string, boolean>>): Promise<boolean> => {
	const result = await mutateUserThingSecure(userId, (s) => {
		const current = s.meta!.notificationPrefs;
		const base = { ...(current && typeof current === 'object' ? current : {}) } as Record<string, any>;
		for (const [key, value] of Object.entries(patch)) {
			if (value && typeof value === 'object') {
				const nested = base[key] && typeof base[key] === 'object' ? base[key] : {};
				base[key] = { ...nested, ...value };
			} else {
				base[key] = value;
			}
		}
		s.meta!.notificationPrefs = base;
	});
	if (result === 'mutated') return true;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return false;
	const sets: Record<string, any> = { updatedAt: new Date() };
	for (const [key, value] of Object.entries(patch)) {
		if (value && typeof value === 'object') {
			for (const [subKey, subValue] of Object.entries(value)) {
				sets[`meta.notificationPrefs.${key}.${subKey}`] = subValue;
			}
		} else {
			sets[`meta.notificationPrefs.${key}`] = value;
		}
	}
	const res = await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, { $set: sets });
	return res.matchedCount > 0;
};

// Messenger read-receipts privacy flag (meta.readReceiptsEnabled) — mirrors the
// 2FA accessors above. DEFAULT ON: absent means enabled, so only an explicit
// false hides receipts. Turning it off is parity-based (you stop sharing AND
// stop seeing others' receipts — enforced in api/utils/messenger).
export const getUserReadReceiptsEnabled = async (userId: string): Promise<boolean> => {
	const things = await getThingsCollection();
	const thing = await things.findOne({ shareId: String(userId), thingtime: 'user' } as any, { projection: { secure: 1 } });
	if (thing) return unpackSecure((thing as any).secure).meta?.readReceiptsEnabled !== false;
	if (!ObjectId.isValid(userId)) return true;
	const doc = await (await getUsersCollection()).findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.readReceiptsEnabled': 1 } });
	return doc?.meta?.readReceiptsEnabled !== false;
};

export const setUserReadReceiptsEnabled = async (userId: string, enabled: boolean): Promise<boolean> => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.meta!.readReceiptsEnabled = enabled;
	});
	readReceiptsCache.delete(String(userId));
	if (result === 'mutated') return true;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return false;
	const res = await (
		await getUsersCollection()
	).updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.readReceiptsEnabled': enabled, updatedAt: new Date() } });
	return res.matchedCount > 0;
};

// Reading the flag means fetching + unpacking each member's whole secure
// blob, and chat pages poll every few seconds — so values sit in a short
// per-process TTL cache. Writes above invalidate their own entry; other
// instances converge within the TTL (receipts privacy is not revocation).
const READ_RECEIPTS_CACHE_TTL_MS = 60_000;
const READ_RECEIPTS_CACHE_MAX = 5000;
const readReceiptsCache = new Map<string, { value: boolean; at: number }>();

// Batch flavour for chat member lists: ONE $in query over user things (plus a
// legacy fallback for ids the things pass missed), never a per-member round
// trip. Missing users default to enabled like the single accessor.
export const getUsersReadReceiptsMap = async (userIds: string[]): Promise<Record<string, boolean>> => {
	const now = Date.now();
	const map: Record<string, boolean> = {};
	const ids = Array.from(new Set(userIds.map(String).filter(Boolean))).filter((id) => {
		const cached = readReceiptsCache.get(id);
		if (cached && now - cached.at < READ_RECEIPTS_CACHE_TTL_MS) {
			map[id] = cached.value;
			return false;
		}
		return true;
	});
	if (!ids.length) return map;
	for (const id of ids) map[id] = true;
	const things = await getThingsCollection();
	const found = new Set<string>();
	const docs = await things.find({ shareId: { $in: ids }, thingtime: 'user' } as any, { projection: { shareId: 1, secure: 1 } }).toArray();
	for (const doc of docs) {
		found.add(String((doc as any).shareId));
		map[String((doc as any).shareId)] = unpackSecure((doc as any).secure).meta?.readReceiptsEnabled !== false;
	}
	const legacyIds = ids.filter((id) => !found.has(id) && ObjectId.isValid(id));
	if (legacyIds.length) {
		const legacy = await (await getUsersCollection())
			.find({ _id: { $in: legacyIds.map((id) => new ObjectId(id)) } }, { projection: { 'meta.readReceiptsEnabled': 1 } })
			.toArray();
		for (const doc of legacy) {
			map[String((doc as any)._id)] = (doc as any)?.meta?.readReceiptsEnabled !== false;
		}
	}
	if (readReceiptsCache.size > READ_RECEIPTS_CACHE_MAX) readReceiptsCache.clear();
	for (const id of ids) readReceiptsCache.set(id, { value: map[id], at: now });
	return map;
};

// ── Saved MongoDB endpoints (thin-frontend mode — see mongodb/endpoint.ts) ──
// A user's saved data-plane endpoints live INSIDE the secure blob
// (meta.mongoEndpoints): connection URLs embed credentials, and the blob is
// the one place a user thing keeps unsearchable private state. Dual-era
// accessors mirror the 2FA flag above. Full URLs never leave the API utils —
// routes project them to host/db summaries before responding.
export type SavedMongoEndpoint = { id: string; name: string; url: string; createdAt: string };

export const MAX_SAVED_MONGO_ENDPOINTS = 20;

const normalizeSavedMongoEndpoints = (value: any): SavedMongoEndpoint[] =>
	Array.isArray(value)
		? value
				.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.url === 'string')
				.map((entry) => ({
					id: entry.id,
					name: typeof entry.name === 'string' ? entry.name : '',
					url: entry.url,
					createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : ''
				}))
		: [];

export const getUserMongoEndpoints = async (userId: string): Promise<SavedMongoEndpoint[]> => {
	const things = await getThingsCollection();
	const thing = await things.findOne({ shareId: String(userId), thingtime: 'user' } as any, { projection: { secure: 1 } });
	if (thing) return normalizeSavedMongoEndpoints(unpackSecure((thing as any).secure).meta?.mongoEndpoints);
	if (!ObjectId.isValid(userId)) return [];
	const doc = await (await getUsersCollection()).findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.mongoEndpoints': 1 } });
	return normalizeSavedMongoEndpoints(doc?.meta?.mongoEndpoints);
};

// Append a saved endpoint. The cap + duplicate-URL checks run INSIDE the CAS
// round so a racing add can't slip past either; a check failure still counts
// as 'mutated' (the blob was rewritten unchanged) and reports via `failure`.
export const addUserMongoEndpoint = async (
	userId: string,
	input: { name: string; url: string }
): Promise<{ ok: true; endpoint: SavedMongoEndpoint } | { ok: false; error: string }> => {
	const endpoint: SavedMongoEndpoint = {
		id: new ObjectId().toHexString(),
		name: input.name,
		url: input.url,
		createdAt: new Date().toISOString()
	};

	let failure: string | null = null;
	const apply = (list: SavedMongoEndpoint[]): SavedMongoEndpoint[] | null => {
		failure = null;
		if (list.length >= MAX_SAVED_MONGO_ENDPOINTS) {
			failure = `You can save at most ${MAX_SAVED_MONGO_ENDPOINTS} MongoDB endpoints`;
			return null;
		}
		if (list.some((entry) => entry.url === endpoint.url)) {
			failure = 'That MongoDB endpoint is already saved';
			return null;
		}
		return [...list, endpoint];
	};

	const result = await mutateUserThingSecure(userId, (secure) => {
		const next = apply(normalizeSavedMongoEndpoints(secure.meta?.mongoEndpoints));
		if (next) secure.meta!.mongoEndpoints = next;
	});
	if (result === 'mutated') return failure ? { ok: false, error: failure } : { ok: true, endpoint };
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return { ok: false, error: 'User not found' };
	const users = await getUsersCollection();
	const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.mongoEndpoints': 1 } });
	if (!doc) return { ok: false, error: 'User not found' };
	const next = apply(normalizeSavedMongoEndpoints(doc.meta?.mongoEndpoints));
	if (!next) return { ok: false, error: failure || 'Could not save MongoDB endpoint' };
	await users.updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.mongoEndpoints': next, updatedAt: new Date() } });
	return { ok: true, endpoint };
};

// Remove a saved endpoint by id. Returns whether an entry was actually removed.
export const removeUserMongoEndpoint = async (userId: string, endpointId: string): Promise<boolean> => {
	let removed = false;
	const result = await mutateUserThingSecure(userId, (secure) => {
		const list = normalizeSavedMongoEndpoints(secure.meta?.mongoEndpoints);
		const next = list.filter((entry) => entry.id !== endpointId);
		removed = next.length !== list.length;
		secure.meta!.mongoEndpoints = next;
	});
	if (result === 'mutated') return removed;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return false;
	const users = await getUsersCollection();
	const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.mongoEndpoints': 1 } });
	const list = normalizeSavedMongoEndpoints(doc?.meta?.mongoEndpoints);
	const next = list.filter((entry) => entry.id !== endpointId);
	if (next.length === list.length) return false;
	await users.updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.mongoEndpoints': next, updatedAt: new Date() } });
	return true;
};

// ── Saved deployment links (cross-deployment account sync) ──────────────────
// A user's links to their accounts on OTHER Thingtime deployments live INSIDE
// the secure blob (meta.deploymentLinks): each link carries a bearer token for
// the remote deployment, and the blob is the one place a user thing keeps
// unsearchable private state (same reasoning as meta.mongoEndpoints above).
// Tokens never leave the API utils — routes project links through
// toPublicDeploymentLink before responding.
export type DeploymentSyncMode = 'push' | 'pull' | 'two-way' | 'off';
export type DeploymentLinkPathRule = { path: string; mode: DeploymentSyncMode };
export type SavedDeploymentLink = {
  id: string;
  name: string;
  baseUrl: string;
  token: string; // remote-deployment JWT — NEVER projected out of api/utils
  tokenExpiresAt: string | null; // ISO; null = non-expiring link token
  remoteUserId: string;
  remoteUsername: string;
  syncMode: DeploymentSyncMode;
  pathRules: DeploymentLinkPathRule[];
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncSummary: Record<string, any> | null;
};

export const MAX_DEPLOYMENT_LINKS = 10;
export const MAX_DEPLOYMENT_PATH_RULES = 50;

const DEPLOYMENT_SYNC_MODES: DeploymentSyncMode[] = ['push', 'pull', 'two-way', 'off'];

const normalizeDeploymentPathRules = (value: any): DeploymentLinkPathRule[] =>
  Array.isArray(value)
    ? value
        .filter(
          (rule) =>
            rule &&
            typeof rule.path === 'string' &&
            DEPLOYMENT_SYNC_MODES.includes(rule.mode)
        )
        .slice(0, MAX_DEPLOYMENT_PATH_RULES)
        .map((rule) => ({ path: rule.path, mode: rule.mode }))
    : [];

const normalizeSavedDeploymentLinks = (value: any): SavedDeploymentLink[] =>
  Array.isArray(value)
    ? value
        .filter(
          (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            typeof entry.baseUrl === 'string' &&
            typeof entry.token === 'string'
        )
        .map((entry) => ({
          id: entry.id,
          name: typeof entry.name === 'string' ? entry.name : '',
          baseUrl: entry.baseUrl,
          token: entry.token,
          tokenExpiresAt: typeof entry.tokenExpiresAt === 'string' ? entry.tokenExpiresAt : null,
          remoteUserId: typeof entry.remoteUserId === 'string' ? entry.remoteUserId : '',
          remoteUsername: typeof entry.remoteUsername === 'string' ? entry.remoteUsername : '',
          syncMode: DEPLOYMENT_SYNC_MODES.includes(entry.syncMode) ? entry.syncMode : 'off',
          pathRules: normalizeDeploymentPathRules(entry.pathRules),
          createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
          lastSyncAt: typeof entry.lastSyncAt === 'string' ? entry.lastSyncAt : null,
          lastSyncSummary:
            entry.lastSyncSummary && typeof entry.lastSyncSummary === 'object' ? entry.lastSyncSummary : null
        }))
    : [];

export const getUserDeploymentLinks = async (userId: string): Promise<SavedDeploymentLink[]> => {
  const things = await getThingsCollection();
  const thing = await things.findOne(
    { shareId: String(userId), thingtime: 'user' } as any,
    { projection: { secure: 1 } }
  );
  if (thing) return normalizeSavedDeploymentLinks(unpackSecure((thing as any).secure).meta?.deploymentLinks);
  if (!ObjectId.isValid(userId)) return [];
  const doc = await (await getUsersCollection()).findOne(
    { _id: new ObjectId(userId) },
    { projection: { 'meta.deploymentLinks': 1 } }
  );
  return normalizeSavedDeploymentLinks(doc?.meta?.deploymentLinks);
};

// Append a deployment link. Cap + duplicate checks run INSIDE the CAS round so
// a racing add can't slip past either (same contract as addUserMongoEndpoint).
// A duplicate is the same (baseUrl, remoteUserId) pair — you can link two
// DIFFERENT remote accounts on one deployment, but not the same account twice.
export const addUserDeploymentLink = async (
  userId: string,
  input: Omit<SavedDeploymentLink, 'id' | 'createdAt' | 'lastSyncAt' | 'lastSyncSummary'>
): Promise<{ ok: true; link: SavedDeploymentLink } | { ok: false; error: string }> => {
  const link: SavedDeploymentLink = {
    ...input,
    id: new ObjectId().toHexString(),
    pathRules: normalizeDeploymentPathRules(input.pathRules),
    createdAt: new Date().toISOString(),
    lastSyncAt: null,
    lastSyncSummary: null
  };

  let failure: string | null = null;
  const apply = (list: SavedDeploymentLink[]): SavedDeploymentLink[] | null => {
    failure = null;
    if (list.length >= MAX_DEPLOYMENT_LINKS) {
      failure = `You can link at most ${MAX_DEPLOYMENT_LINKS} deployments`;
      return null;
    }
    if (list.some((entry) => entry.baseUrl === link.baseUrl && entry.remoteUserId === link.remoteUserId)) {
      failure = 'That deployment account is already linked';
      return null;
    }
    return [...list, link];
  };

  const result = await mutateUserThingSecure(userId, (secure) => {
    const next = apply(normalizeSavedDeploymentLinks(secure.meta?.deploymentLinks));
    if (next) secure.meta!.deploymentLinks = next;
  });
  if (result === 'mutated') return failure ? { ok: false, error: failure } : { ok: true, link };
  if (result === 'contended') throw new SecureWriteContendedError(userId);
  if (!ObjectId.isValid(userId)) return { ok: false, error: 'User not found' };
  const users = await getUsersCollection();
  const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.deploymentLinks': 1 } });
  if (!doc) return { ok: false, error: 'User not found' };
  const next = apply(normalizeSavedDeploymentLinks(doc.meta?.deploymentLinks));
  if (!next) return { ok: false, error: failure || 'Could not link that deployment' };
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.deploymentLinks': next, updatedAt: new Date() } }
  );
  return { ok: true, link };
};

// Patch a link in place (settings edits + post-sync bookkeeping). Only the
// mutable fields are accepted; identity fields (baseUrl/remote identity/token)
// are fixed at link time except `token`/`tokenExpiresAt`, which re-auth updates.
export const updateUserDeploymentLink = async (
  userId: string,
  linkId: string,
  patch: Partial<
    Pick<
      SavedDeploymentLink,
      'name' | 'syncMode' | 'pathRules' | 'token' | 'tokenExpiresAt' | 'lastSyncAt' | 'lastSyncSummary'
    >
  >
): Promise<SavedDeploymentLink | null> => {
  let updated: SavedDeploymentLink | null = null;
  const apply = (list: SavedDeploymentLink[]): SavedDeploymentLink[] => {
    updated = null;
    return list.map((entry) => {
      if (entry.id !== linkId) return entry;
      updated = {
        ...entry,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.syncMode !== undefined && DEPLOYMENT_SYNC_MODES.includes(patch.syncMode)
          ? { syncMode: patch.syncMode }
          : {}),
        ...(patch.pathRules !== undefined ? { pathRules: normalizeDeploymentPathRules(patch.pathRules) } : {}),
        ...(patch.token !== undefined ? { token: patch.token } : {}),
        ...(patch.tokenExpiresAt !== undefined ? { tokenExpiresAt: patch.tokenExpiresAt } : {}),
        ...(patch.lastSyncAt !== undefined ? { lastSyncAt: patch.lastSyncAt } : {}),
        ...(patch.lastSyncSummary !== undefined ? { lastSyncSummary: patch.lastSyncSummary } : {})
      };
      return updated;
    });
  };

  const result = await mutateUserThingSecure(userId, (secure) => {
    secure.meta!.deploymentLinks = apply(normalizeSavedDeploymentLinks(secure.meta?.deploymentLinks));
  });
  if (result === 'mutated') return updated;
  if (result === 'contended') throw new SecureWriteContendedError(userId);
  if (!ObjectId.isValid(userId)) return null;
  const users = await getUsersCollection();
  const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.deploymentLinks': 1 } });
  if (!doc) return null;
  const next = apply(normalizeSavedDeploymentLinks(doc.meta?.deploymentLinks));
  if (!updated) return null;
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.deploymentLinks': next, updatedAt: new Date() } }
  );
  return updated;
};

// Remove a link by id. Returns the removed link (the route best-effort revokes
// its remote session) or null when no entry matched.
export const removeUserDeploymentLink = async (
  userId: string,
  linkId: string
): Promise<SavedDeploymentLink | null> => {
  let removed: SavedDeploymentLink | null = null;
  const result = await mutateUserThingSecure(userId, (secure) => {
    const list = normalizeSavedDeploymentLinks(secure.meta?.deploymentLinks);
    removed = list.find((entry) => entry.id === linkId) || null;
    secure.meta!.deploymentLinks = list.filter((entry) => entry.id !== linkId);
  });
  if (result === 'mutated') return removed;
  if (result === 'contended') throw new SecureWriteContendedError(userId);
  if (!ObjectId.isValid(userId)) return null;
  const users = await getUsersCollection();
  const doc = await users.findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.deploymentLinks': 1 } });
  const list = normalizeSavedDeploymentLinks(doc?.meta?.deploymentLinks);
  removed = list.find((entry) => entry.id === linkId) || null;
  if (!removed) return null;
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.deploymentLinks': list.filter((entry) => entry.id !== linkId), updatedAt: new Date() } }
  );
  return removed;
};

// Set (or clear, with null) the user's active theme shareId in meta.
export const setUserActiveTheme = async (userId: string, themeShareId: string | null) => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.meta!.activeThemeId = themeShareId;
	});
	if (result === 'mutated') return;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (
		await getUsersCollection()
	).updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.activeThemeId': themeShareId, updatedAt: new Date() } });
};

// Clear the user's active theme pointer ONLY if it still points at the given
// theme shareId — theme deletion uses this so it never stomps a pointer the
// user has since moved to another theme.
export const clearUserActiveTheme = async (userId: string, themeShareId: string) => {
	const cleared = await mutateUserThingSecure(userId, (s) => {
		if (s.meta!.activeThemeId === themeShareId) s.meta!.activeThemeId = null;
	});
	// A matched user thing (cleared or pointer already moved) needs no legacy write.
	if (cleared === 'mutated') return;
	if (cleared === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (
		await getUsersCollection()
	).updateOne({ _id: new ObjectId(userId), 'meta.activeThemeId': themeShareId }, { $set: { 'meta.activeThemeId': null, updatedAt: new Date() } });
};

// Set (or clear, with null) the user's active feed algorithm shareId in meta.
export const setUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string | null) => {
	const result = await mutateUserThingSecure(userId, (s) => {
		s.meta!.activeFeedAlgorithmId = algorithmShareId;
	});
	if (result === 'mutated') return;
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (
		await getUsersCollection()
	).updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.activeFeedAlgorithmId': algorithmShareId, updatedAt: new Date() } });
};

// Clear the active feed-algorithm pointer only if it still points at the given
// algorithm — the twin of clearUserActiveTheme, so algorithm delete stops
// hand-rolling the users-store layout (was inlined in deleteAlgorithm).
export const clearUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string) => {
	const cleared = await mutateUserThingSecure(userId, (s) => {
		if (s.meta!.activeFeedAlgorithmId === algorithmShareId) s.meta!.activeFeedAlgorithmId = null;
	});
	if (cleared === 'mutated') return;
	if (cleared === 'contended') throw new SecureWriteContendedError(userId);
	if (!ObjectId.isValid(userId)) return;
	await (
		await getUsersCollection()
	).updateOne(
		{ _id: new ObjectId(userId), 'meta.activeFeedAlgorithmId': algorithmShareId },
		{ $set: { 'meta.activeFeedAlgorithmId': null, updatedAt: new Date() } }
	);
};

// Recently-used reaction tokens are the user's MRU list for the custom-emoji
// picker's "Recently Used", so it follows the user across devices and roster
// accounts. For a user thing they live in the root secureRecentReactions BinData
// array (see the SecurePayload doc block); the `users` legacy store keeps them
// in meta.recentReactions. Capped high enough to feel unlimited while keeping
// the doc lean; NOT projected onto the public user (fetched lazily by picker).
const MAX_RECENT_REACTIONS = 500;

// Push a token to the front of the user's recents (de-duped) and return the
// updated MRU list. This is the HOTTEST user write (one per reaction toggle), so
// the thing-era path uses TARGETED ATOMIC array ops on secureRecentReactions —
// $pull the token then $push it at the front with $slice — instead of the secure
// blob's read-modify-write + secureVersion CAS + retry. That means a reaction
// toggle no longer re-serializes the whole blob, never bumps secureVersion, and
// never contends the CAS against a concurrent secure write (email verify, 2FA,
// theme pointer, …). Two writes because Mongo can't $pull and $push one path in
// a single update — the same non-atomic-pair pattern the legacy store uses; a
// concurrent toggle of the same token can leave a transient duplicate that the
// next push of that token removes (cosmetic, self-healing, matches legacy).
export const pushUserRecentReaction = async (userId: string, token: string): Promise<string[]> => {
	const things = await getThingsCollection();
	const base = { shareId: String(userId), thingtime: 'user' } as any;
	const bin = toBin(token);
	// de-dupe first; matchedCount tells us whether a user thing exists at all
	const pull = await things.updateOne(base, { $pull: { secureRecentReactions: bin } } as any);
	if (pull.matchedCount) {
		// unshift + cap, returning the post-image so the caller doesn't re-read
		const after = await things.findOneAndUpdate(
			base,
			{
				$push: { secureRecentReactions: { $each: [bin], $position: 0, $slice: MAX_RECENT_REACTIONS } },
				$set: { updatedAt: new Date() }
			} as any,
			{ projection: { secureRecentReactions: 1 }, returnDocument: 'after' }
		);
		return unpackRecentReactions((after as any)?.secureRecentReactions);
	}

	// No user thing — legacy users store (plaintext array; that collection has no
	// text index, so plain-string tokens are safe there).
	if (!ObjectId.isValid(userId)) return [];
	const users = await getUsersCollection();
	const _id = new ObjectId(userId);
	await users.updateOne({ _id }, { $pull: { 'meta.recentReactions': token } } as any);
	await users.updateOne({ _id }, {
		$push: {
			'meta.recentReactions': { $each: [token], $position: 0, $slice: MAX_RECENT_REACTIONS }
		},
		$set: { updatedAt: new Date() }
	} as any);
	const doc = await users.findOne({ _id }, { projection: { 'meta.recentReactions': 1 } });
	return Array.isArray(doc?.meta?.recentReactions) ? (doc!.meta.recentReactions as string[]) : [];
};

// The user's full recents MRU (most-recent-first), for the picker to page.
// Projected reads only — never drag credentials or 64KB avatar crystals over.
export const getUserRecentReactions = async (userId: string): Promise<string[]> => {
	const things = await getThingsCollection();
	const thing = await things.findOne({ shareId: String(userId), thingtime: 'user' } as any, { projection: { secureRecentReactions: 1, secure: 1 } });
	if (thing) {
		const list = unpackRecentReactions((thing as any).secureRecentReactions);
		if (list.length) return list;
		// Transitional bridge: a user thing written before the MRU moved out of the
		// blob still carries it at secure.meta.recentReactions. Read it so recents
		// survive the cutover; the next pushUserRecentReaction migrates it to the
		// atomic field. (Harmless once every doc has been pushed to at least once.)
		const legacyInBlob = unpackSecure((thing as any).secure).meta?.recentReactions;
		return Array.isArray(legacyInBlob) ? (legacyInBlob as string[]) : [];
	}
	if (!ObjectId.isValid(userId)) return [];
	const doc = await (await getUsersCollection()).findOne({ _id: new ObjectId(userId) }, { projection: { 'meta.recentReactions': 1 } });
	return Array.isArray(doc?.meta?.recentReactions) ? (doc!.meta.recentReactions as string[]) : [];
};

// --- Admin management (see auth/admin.ts) ---

// Lightweight user row for the admin panel (never includes passwordHash/meta).
export type AdminUserRow = {
	id: string;
	username: string;
	displayName: string | null;
	email: string;
	createdAt: string | null;
	isAdmin: boolean;
	envAdmin: boolean; // admin via ADMIN_USERNAMES — can't be demoted from the UI
	emailVerified: boolean;
	// false while the account waits for an admin to grant that upload scope
	publicUploadsEnabled: boolean;
	privateUploadsEnabled: boolean;
	// true only when the flag was explicitly withheld (i.e. a post-hotfix
	// signup), so the UI can tell "awaiting approval" from "grandfathered".
	publicUploadsPending: boolean;
	privateUploadsPending: boolean;
};

// Escape user-supplied text before embedding it in a Mongo $regex — shared with
// things/search.ts so both search surfaces strip the same metacharacters (a
// regex-injection / ReDoS fix must never patch only one copy).
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const adminCreatedAt = (value: unknown): string | null => {
	const date = value instanceof Date ? value : value ? new Date(value as any) : null;
	return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

const toAdminRow = (doc: any): AdminUserRow => ({
	id: String(doc._id),
	username: doc.username,
	displayName: doc.displayName ?? null,
	email: doc.email,
	createdAt: adminCreatedAt(doc.createdAt),
	isAdmin: isAdminDoc(doc),
	envAdmin: isEnvAdmin(doc.username),
	emailVerified: !!doc.emailVerified,
	publicUploadsEnabled: userPublicUploadsEnabled(doc),
	privateUploadsEnabled: userPrivateUploadsEnabled(doc),
	publicUploadsPending: doc?.meta?.publicUploads === false && !isAdminDoc(doc),
	privateUploadsPending: doc?.meta?.privateUploads === false && !isAdminDoc(doc)
});

// Set (or clear) a user's stored admin flag. Env-allowlist admins remain admin
// regardless (isAdminDoc ORs the env check), so demoting one only clears the
// DB flag — they keep access until removed from ADMIN_USERNAMES.
export const setUserAdmin = async (userId: string, admin: boolean): Promise<AdminUserRow | null> => {
	// admin is a ROOT boolean on user things (queryable by listAdmins; booleans
	// aren't text-indexed), so it's a plain $set — not blob content.
	//
	// Write BOTH stores (not updateUserStore's thing-first/legacy-fallback): a
	// dual-era twin left by an interrupted migration would otherwise keep a stale
	// meta.admin:true in the legacy doc that the dual-store listAdmins read would
	// resurrect — so a demote appears not to take. Mirrors deleteAlgorithm's
	// dual-delete. Best-effort per store; either matching counts as applied.
	const now = new Date();
	const [thingRes, legacyRes] = await Promise.all([
		getThingsCollection().then((c) =>
			c.updateOne({ shareId: String(userId), thingtime: 'user' } as any, { $set: { secureAdmin: admin === true, updatedAt: now } })
		),
		ObjectId.isValid(userId)
			? getUsersCollection().then((c) => c.updateOne({ _id: new ObjectId(userId) }, { $set: { 'meta.admin': admin === true, updatedAt: now } }))
			: Promise.resolve({ matchedCount: 0 } as { matchedCount: number })
	]);
	if (!thingRes.matchedCount && !legacyRes.matchedCount) return null;
	const updated = await findUserById(userId);
	return updated ? toAdminRow(updated) : null;
};

// Grant or withhold a user's upload permissions, per scope or both at once
// ("all"). Unlike `secureAdmin` these are NOT queryable root booleans — the
// admin dashboard already loads a complete user snapshot and filters
// client-side, so the flags ride inside the CAS-guarded secure blob's `meta`
// (same home as activeThemeId) and need no new index or collection generation.
// Both keys are written in ONE CAS round so an "all" grant can't land half.
//
// Both stores are written for the same reason setUserAdmin does it: a dual-era
// twin left by an interrupted users→things migration would otherwise keep a
// stale value that the dual-store read resurrects, so a grant would appear not
// to take. Best-effort per store; either matching counts as applied.
export type UploadPermissionUpdates = { publicUploads?: boolean; privateUploads?: boolean };
export const setUserUploadPermissions = async (userId: string, updates: UploadPermissionUpdates): Promise<AdminUserRow | null> => {
	const keys = (['publicUploads', 'privateUploads'] as const).filter((key) => typeof updates[key] === 'boolean');
	if (!keys.length) return null;
	let applied = false;
	const result = await mutateUserThingSecure(userId, (secure) => {
		const next = { ...(secure.meta || {}) };
		for (const key of keys) next[key] = updates[key] === true;
		secure.meta = next;
	});
	if (result === 'contended') throw new SecureWriteContendedError(userId);
	if (result === 'mutated') applied = true;

	if (ObjectId.isValid(userId)) {
		const $set: Record<string, unknown> = { updatedAt: new Date() };
		for (const key of keys) $set[`meta.${key}`] = updates[key] === true;
		const legacy = await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, { $set });
		if (legacy.matchedCount) applied = true;
	}

	if (!applied) return null;
	const updated = await findUserById(userId);
	return updated ? toAdminRow(updated) : null;
};

// merge things-era + legacy results, dedup by id (things win). NO capping here —
// callers sort THEN slice, so a legacy user who sorts first is never starved by
// a full things-first page (the cap-before-sort bug).
const mergeUserDocs = (thingDocs: any[], legacyDocs: any[]): any[] => {
	const seen = new Set<string>();
	const merged: any[] = [];
	for (const doc of [...thingDocs, ...legacyDocs]) {
		const id = String(doc._id);
		if (seen.has(id)) continue;
		seen.add(id);
		merged.push(doc);
	}
	return merged;
};

const byUsername = (a: any, b: any) => String(a.username).localeCompare(String(b.username));

// Search users by username/email for the admin panel's promote flow. Things-era
// emails are hashed (never regex-matchable by design) — a full email query
// still finds them via the exact uniqueKeys lookup.
const searchUsersForAdminCapped = async (query: string, limit: number, hardCap: number): Promise<AdminUserRow[]> => {
	const q = (query || '').trim();
	const capped = Math.min(hardCap, Math.max(1, Math.floor(Number(limit) || 0)));
	const pattern = { $regex: escapeRegex(q), $options: 'i' };
	const things = await getThingsCollection();
	const users = await getUsersCollection();

	const thingFilter = q ? { thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] } : { thingtime: 'user' };
	// project just what toAdminRow needs (secure blob for email, secureAdmin) —
	// never the 64KB avatar/banner crystals — and run both stores concurrently
	const [thingRaw, exact, legacyDocs] = await Promise.all([
		things
			.find(thingFilter as any)
			.project({ shareId: 1, 'crystal.username': 1, 'crystal.displayName': 1, secure: 1, secureAdmin: 1, createdAt: 1 })
			.limit(capped)
			.toArray(),
		q.includes('@') ? things.findOne({ uniqueKeys: userEmailKey(q) } as any) : Promise.resolve(null),
		users
			.find((q ? { $or: [{ username: pattern }, { email: pattern }] } : {}) as any)
			.project({ username: 1, displayName: 1, email: 1, meta: 1, createdAt: 1 })
			.limit(capped)
			.toArray()
	]);

	const thingDocs = thingRaw.map(userThingToDoc);
	if (exact) thingDocs.unshift(userThingToDoc(exact));
	return mergeUserDocs(thingDocs, legacyDocs).sort(byUsername).slice(0, capped).map(toAdminRow);
};

// Promotion/user-management lookups stay deliberately small. The overview
// endpoint opts into its own larger one-row-lookahead cap so it can return an
// honest bounded snapshot without changing this existing search contract.
export const searchUsersForAdmin = async (query: string, limit = 20): Promise<AdminUserRow[]> => searchUsersForAdminCapped(query, limit, 50);

type AdminUserSourceCursor = {
	done: boolean;
	key: AdminSnapshotCursorKey | null;
};

type AdminUsersCursor = {
	v: 1;
	kind: 'users';
	q: string;
	exactDone: boolean;
	exactId: string | null;
	things: AdminUserSourceCursor;
	legacy: AdminUserSourceCursor;
};

export type AdminUserOverviewPage = {
	rows: AdminUserRow[];
	nextCursor: string | null;
};

const readAdminUserSourceCursor = (value: unknown, legacy = false): AdminUserSourceCursor => {
	if (!value || typeof value !== 'object') throw new InvalidAdminSnapshotCursorError();
	const source = value as Record<string, unknown>;
	if (typeof source.done !== 'boolean') throw new InvalidAdminSnapshotCursorError();
	const key = source.key === null ? null : requireAdminSnapshotCursorKey(source.key);
	if (legacy && key && !ObjectId.isValid(key.id)) throw new InvalidAdminSnapshotCursorError();
	return { done: source.done, key };
};

const readAdminUsersCursor = (cursor: unknown, q: string): AdminUsersCursor => {
	const decoded = decodeAdminSnapshotCursor(cursor);
	if (!decoded) {
		return {
			v: 1,
			kind: 'users',
			q,
			exactDone: !q.includes('@'),
			exactId: null,
			things: { done: false, key: null },
			legacy: { done: false, key: null }
		};
	}
	if (decoded.v !== 1 || decoded.kind !== 'users' || decoded.q !== q || typeof decoded.exactDone !== 'boolean') {
		throw new InvalidAdminSnapshotCursorError();
	}
	const exactId =
		decoded.exactId === undefined || decoded.exactId === null
			? null
			: typeof decoded.exactId === 'string' && decoded.exactId
			? decoded.exactId
			: null;
	if (decoded.exactId !== undefined && decoded.exactId !== null && exactId === null) {
		throw new InvalidAdminSnapshotCursorError();
	}
	return {
		v: 1,
		kind: 'users',
		q,
		exactDone: decoded.exactDone,
		exactId,
		things: readAdminUserSourceCursor(decoded.things),
		legacy: readAdminUserSourceCursor(decoded.legacy, true)
	};
};

const advanceAdminUserSource = (current: AdminUserSourceCursor, page: any[], consumed: number, hasMore: boolean): AdminUserSourceCursor => {
	if (current.done) return current;
	const boundedConsumed = Math.min(page.length, Math.max(0, Math.floor(consumed)));
	return {
		done: boundedConsumed === page.length && !hasMore,
		key: boundedConsumed ? adminSnapshotCursorKey(page[boundedConsumed - 1]) : current.key
	};
};

// Composite cursor pagination scans Things-era and legacy users independently.
// Legacy candidates are batch-probed against Things before exposure, so a
// migrated user's canonical Things record wins even when its older timestamp
// places it on a later source page. The admin UI drains every page before
// presenting the new snapshot, then applies its computed/nested filters once.
export const searchUsersForAdminOverviewPage = async (query: string, limit = 20, cursor?: string | null): Promise<AdminUserOverviewPage> => {
	const q = normalizeAdminSnapshotQuery(query);
	const capped = normalizeAdminSnapshotLimit(limit, 20);
	const state = readAdminUsersCursor(cursor, q);
	const pattern = { $regex: escapeRegex(q), $options: 'i' };
	const things = await getThingsCollection();
	const users = await getUsersCollection();

	const thingAdminProjection = {
		shareId: 1,
		'crystal.username': 1,
		'crystal.displayName': 1,
		secure: 1,
		secureAdmin: 1,
		createdAt: 1
	};

	// A hashed exact-email hit is a third, one-record pagination source. Keep its
	// id in the opaque cursor until it is consumed so an older exact match can
	// remain pending behind newer directory rows. The id also excludes it from
	// the ordinary Things regex scan on every continuation page.
	let exactId = state.exactId;
	let exactRaw: any = null;
	if (q.includes('@')) {
		if (exactId) {
			if (!state.exactDone) {
				exactRaw = await things.findOne({ thingtime: 'user', shareId: exactId } as any, { projection: thingAdminProjection });
			}
		} else {
			const resolved = await things.findOne({ thingtime: 'user', uniqueKeys: userEmailKey(q) } as any, { projection: thingAdminProjection });
			exactId = resolved?.shareId ? String(resolved.shareId) : null;
			if (!state.exactDone) exactRaw = resolved;
		}
	}
	const exactPending = !state.exactDone && !!exactId && !!exactRaw;

	const thingsActive = !state.things.done;
	const legacyActive = !state.legacy.done;
	// Each source needs a full output-sized window. Splitting the limit between
	// stores lets older legacy rows leak into page 1 while newer Things rows sit
	// unseen on page 2. A one-row lookahead tells the merge when it must stop and
	// continue rather than compare against an unknown source head.
	const thingsLimit = thingsActive ? capped : 0;
	const legacyLimit = legacyActive ? capped : 0;

	const thingSearchBase = q
		? { thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] }
		: { thingtime: 'user' };
	const thingBase = adminSnapshotExcludingIdFilter(thingSearchBase, 'shareId', exactId);
	const legacyBase = q ? { $or: [{ username: pattern }, { email: pattern }] } : {};
	const thingFilter = state.things.key ? { $and: [thingBase, adminSnapshotAfterFilter(state.things.key, 'shareId')] } : thingBase;
	const legacyFilter = state.legacy.key
		? {
				$and: [legacyBase, adminSnapshotAfterFilter(state.legacy.key, '_id', new ObjectId(state.legacy.key.id))]
		  }
		: legacyBase;

	const [thingFound, legacyFound] = await Promise.all([
		thingsLimit > 0
			? things
					.find(thingFilter as any)
					.project(thingAdminProjection)
					.sort({ createdAt: -1, shareId: 1 })
					.limit(thingsLimit + 1)
					.toArray()
			: Promise.resolve([]),
		legacyLimit > 0
			? users
					.find(legacyFilter as any)
					.project({ username: 1, displayName: 1, email: 1, meta: 1, createdAt: 1 })
					.sort({ createdAt: -1, _id: 1 })
					.limit(legacyLimit + 1)
					.toArray()
			: Promise.resolve([])
	]);

	const thingHasMore = thingsActive && thingFound.length > thingsLimit;
	const legacyHasMore = legacyActive && legacyFound.length > legacyLimit;
	const thingPage = thingFound.slice(0, thingsLimit);
	const legacyPage = legacyFound.slice(0, legacyLimit);

	// A migration can leave a legacy twin. Drop it at its legacy position; its
	// Things record will appear at the canonical Things cursor position.
	const legacyIds = legacyPage.map((doc: any) => String(doc._id));
	const thingTwins = legacyIds.length
		? await things
				.find({ thingtime: 'user', shareId: { $in: legacyIds } } as any)
				.project({ shareId: 1 })
				.toArray()
		: [];
	const canonicalThingIds = new Set(thingTwins.map((doc: any) => String(doc.shareId)));

	const exactDocs = exactPending ? [userThingToDoc(exactRaw)] : [];
	const thingDocs = thingPage.map(userThingToDoc);
	const page = consumeAdminSnapshotNewest(
		[
			{ records: exactDocs, hasMore: false },
			{ records: thingDocs, hasMore: thingHasMore },
			{ records: legacyPage, hasMore: legacyHasMore }
		],
		capped,
		(doc, sourceIndex) => sourceIndex !== 2 || !canonicalThingIds.has(String(doc._id))
	);
	const rows = page.records.map(toAdminRow);
	const nextState: AdminUsersCursor = {
		v: 1,
		kind: 'users',
		q,
		exactDone: state.exactDone || !exactPending || page.consumed[0] > 0,
		exactId,
		things: advanceAdminUserSource(state.things, thingPage, page.consumed[1], thingHasMore),
		legacy: advanceAdminUserSource(state.legacy, legacyPage, page.consumed[2], legacyHasMore)
	};
	const hasNext = !nextState.exactDone || !nextState.things.done || !nextState.legacy.done;
	return {
		rows,
		nextCursor: hasNext ? encodeAdminSnapshotCursor(nextState as unknown as Record<string, unknown>) : null
	};
};

// Public people search for /search — matches username or display name
// (escaped literal, case-insensitive) and returns ONLY the public profile
// projection. Never matches email: that would let anyone reverse an address
// to an account.
export const searchUsersPublic = async (query: string, limit = 8): Promise<PublicProfile[]> => {
	const q = (query || '').trim().slice(0, 100);
	if (!q) return [];
	const capped = Math.min(20, Math.max(1, limit));
	const pattern = { $regex: escapeRegex(q), $options: 'i' };
	const things = await getThingsCollection();
	const users = await getUsersCollection();

	// public profile only — project crystal (no secure blob) and run both stores
	// concurrently; avatars/banners are part of the profile card, so they ride
	const [thingRaw, legacyDocs] = await Promise.all([
		things
			.find({ thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] } as any)
			.project({ shareId: 1, crystal: 1, avatarAttachmentId: 1, bannerAttachmentId: 1, createdAt: 1 })
			.sort({ 'crystal.username': 1 })
			.limit(capped)
			.toArray(),
		users
			.find({ $or: [{ username: pattern }, { displayName: pattern }] } as any)
			.project({
				username: 1,
				displayName: 1,
				bio: 1,
				avatarUrl: 1,
				bannerUrl: 1,
				avatarAttachmentId: 1,
				bannerAttachmentId: 1,
				createdAt: 1
			})
			.sort({ username: 1 })
			.limit(capped)
			.toArray()
	]);

	return mergeUserDocs(thingRaw.map(userThingToDoc), legacyDocs).sort(byUsername).slice(0, capped).map(toPublicProfile);
};

export type AdminListSnapshot = {
	admins: AdminUserRow[];
	limit: number;
	totalCapped: boolean;
};

// Current DB-flagged admins (env admins are surfaced separately in the config).
// Keep the response bounded like the richer overview and expose lookahead
// metadata so the UI never silently presents a partial roster as complete.
export const listAdmins = async (): Promise<AdminListSnapshot> => {
	const limit = ADMIN_SNAPSHOT_MAX_LIMIT;
	const things = await getThingsCollection();
	const users = await getUsersCollection();
	const [thingRaw, legacyDocs] = await Promise.all([
		things
			.find({ thingtime: 'user', secureAdmin: true } as any)
			.project({ shareId: 1, 'crystal.username': 1, 'crystal.displayName': 1, secure: 1, secureAdmin: 1, createdAt: 1 })
			.sort({ createdAt: -1, shareId: 1 })
			.limit(ADMIN_SNAPSHOT_LOOKAHEAD_LIMIT)
			.toArray(),
		users
			.find({ 'meta.admin': true } as any)
			.project({ username: 1, displayName: 1, email: 1, meta: 1, createdAt: 1 })
			.sort({ createdAt: -1, _id: 1 })
			.limit(ADMIN_SNAPSHOT_LOOKAHEAD_LIMIT)
			.toArray()
	]);
	const merged = mergeAdminSnapshotNewest(thingRaw.map(userThingToDoc), legacyDocs, ADMIN_SNAPSHOT_LOOKAHEAD_LIMIT);
	return {
		admins: merged.slice(0, limit).map(toAdminRow),
		limit,
		totalCapped: merged.length > limit
	};
};

// Profile bounds are the schema's (registry.ts) — one source of truth shared by
// the crystal sanitizer and this endpoint, so the two can't drift.

// New writes accept parsed http(s) URLs only. Existing data:image values remain
// read-compatible through the projection helpers, but managed S3 media removes
// the need to persist another unbounded inline image.
const sanitizeProfileImageUrl = (value: unknown): string | null | undefined => {
	if (value === null) return null;
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.length > MAX_PROFILE_URL_CHARS) return undefined;
	// HTTP(S) writes receive strict structural validation: no embedded
	// credentials, whitespace/control spoofing, backslash normalization, or an
	// empty host. The server never fetches this URL.
	if (!/^https?:\/\//i.test(trimmed) || /[\p{Cc}\p{Cf}\p{Cs}\s]/u.test(trimmed) || trimmed.includes('\\')) return undefined;
	try {
		const parsed = new URL(trimmed);
		if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return undefined;
		return trimmed;
	} catch {
		return undefined;
	}
};

export type UpdateProfileInput = {
	displayName?: unknown;
	bio?: unknown;
	avatarUrl?: unknown;
	bannerUrl?: unknown;
	avatarAttachmentId?: unknown;
	bannerAttachmentId?: unknown;
	birthday?: unknown;
};

type UpdateProfileResult = { ok: false; status: number; error: string } | { ok: true; user: PublicUser };

type ProfileUserMutationDependencies = {
	withTransaction: typeof withHomeMongoTransaction;
	getThings: typeof getThingsCollection;
	getUsers: typeof getUsersCollection;
	reconcileAttachments: typeof reconcileReadyProfileAttachmentsToUser;
	findUser: typeof findUserById;
	projectUser: typeof toPublicUserWithStorage;
	now: () => Date;
};

const normalizeProfileAttachmentId = (value: unknown): string | null | undefined => {
	if (value === null) return null;
	if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128) return undefined;
	return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : undefined;
};

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

// Update the caller's own profile fields. Whitelist-only: username/email/
// password never pass through here (they need uniqueness + auth flows).
export const createUpdateUserProfile = (overrides: Partial<ProfileUserMutationDependencies> = {}) => {
	const dependencies: ProfileUserMutationDependencies = {
		withTransaction: withHomeMongoTransaction,
		getThings: getThingsCollection,
		getUsers: getUsersCollection,
		reconcileAttachments: reconcileReadyProfileAttachmentsToUser,
		findUser: findUserById,
		projectUser: toPublicUserWithStorage,
		now: () => new Date(),
		...overrides
	};

	return async (userId: string, input: UpdateProfileInput): Promise<UpdateProfileResult> => {
		if (!input || typeof input !== 'object' || Array.isArray(input)) {
			return { ok: false, status: 400, error: 'Invalid profile update' };
		}
		const set: Record<string, any> = {};

		if (input.displayName !== undefined) {
			if (input.displayName !== null && typeof input.displayName !== 'string') {
				return { ok: false, status: 400, error: 'Display name must be text' };
			}
			const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
			if (displayName.length > MAX_DISPLAY_NAME_CHARS) {
				return { ok: false, status: 400, error: `Display name is too long (max ${MAX_DISPLAY_NAME_CHARS})` };
			}
			set.displayName = displayName || null;
		}

		if (input.bio !== undefined) {
			if (input.bio !== null && typeof input.bio !== 'string') {
				return { ok: false, status: 400, error: 'Bio must be text' };
			}
			const bio = typeof input.bio === 'string' ? input.bio.trim() : '';
			if (bio.length > MAX_BIO_CHARS) {
				return { ok: false, status: 400, error: `Bio is too long (max ${MAX_BIO_CHARS} characters)` };
			}
			set.bio = bio || null;
		}

		const media = {} as Record<
			'avatar' | 'banner',
			{ touched: boolean; attachmentIdPresent: boolean; attachmentId: string | null; urlPresent: boolean; url: string | null }
		>;
		for (const slot of ['avatar', 'banner'] as const) {
			const attachmentKey = `${slot}AttachmentId` as const;
			const urlKey = `${slot}Url` as const;
			const attachmentIdPresent = hasOwn(input, attachmentKey);
			const urlPresent = hasOwn(input, urlKey);
			const attachmentId = attachmentIdPresent ? normalizeProfileAttachmentId(input[attachmentKey]) : null;
			if (attachmentIdPresent && attachmentId === undefined) {
				return { ok: false, status: 400, error: `${slot === 'avatar' ? 'Avatar' : 'Banner'} attachment id is invalid` };
			}
			if (attachmentId && urlPresent) {
				return {
					ok: false,
					status: 400,
					error: `${slot === 'avatar' ? 'Avatar' : 'Banner'} cannot use both an attachment and an external URL`
				};
			}
			const url = urlPresent ? sanitizeProfileImageUrl(input[urlKey]) : null;
			if (urlPresent && url === undefined) {
				return { ok: false, status: 400, error: `${slot === 'avatar' ? 'Avatar' : 'Banner'} must be an http(s) image URL` };
			}
			media[slot] = {
				touched: attachmentIdPresent || urlPresent,
				attachmentIdPresent,
				attachmentId: attachmentId ?? null,
				urlPresent,
				url: url ?? null
			};
		}
		if (media.avatar.attachmentId && media.banner.attachmentId && media.avatar.attachmentId === media.banner.attachmentId) {
			return { ok: false, status: 400, error: 'Avatar and banner must use different attachments' };
		}

		// Birthday is PRIVATE state — it lives in the secure blob (meta.birthday),
		// never in the public crystal, so it takes the secure write path below
		// rather than the crystal/attachment transaction.
		let birthday: string | null | undefined;
		if (input.birthday !== undefined) {
			birthday = sanitizeBirthday(input.birthday);
			if (birthday === undefined) {
				return { ok: false, status: 400, error: 'Birthday must be a real YYYY-MM-DD date (1900 → today)' };
			}
		}

		if (!Object.keys(set).length && !media.avatar.touched && !media.banner.touched && birthday === undefined) {
			return { ok: false, status: 400, error: 'Nothing to update' };
		}

		// Secure-blob write first: it is a separate store from the crystal, so it
		// runs outside the profile/attachment transaction below.
		if (birthday !== undefined) {
			const cleared = birthday === null;
			const result = await mutateUserThingSecure(userId, (s) => {
				if (cleared) delete s.meta!.birthday;
				else s.meta!.birthday = birthday;
			});
			if (result === 'contended') throw new SecureWriteContendedError(userId);
			if (result === 'missing') {
				if (!ObjectId.isValid(userId)) return { ok: false, status: 400, error: 'Invalid user id' };
				await (await dependencies.getUsers()).updateOne(
					{ _id: new ObjectId(userId) },
					cleared
						? { $unset: { 'meta.birthday': '' }, $set: { updatedAt: dependencies.now() } }
						: { $set: { 'meta.birthday': birthday, updatedAt: dependencies.now() } }
				);
			}
		}

		// A birthday-only update never touches the crystal or attachments, so the
		// transactional write below is skipped entirely for it.
		if (Object.keys(set).length || media.avatar.touched || media.banner.touched) {
			try {
				const mutated = await dependencies.withTransaction(async (session) => {
					const things = await dependencies.getThings();
					const thing = (await things.findOne({ shareId: String(userId) } as any, { session })) as any;
					let kind: 'thing' | 'legacy';
					let user: any;
					let collection: any;
					if (thing) {
						if (
							!Array.isArray(thing.thingtime) ||
							thing.thingtime.length !== 1 ||
							thing.thingtime[0] !== 'user' ||
							thing.ownerId !== String(userId) ||
							thing.targetId !== null
						) {
							return false;
						}
						kind = 'thing';
						user = thing;
						collection = things;
					} else {
						if (!ObjectId.isValid(userId)) return false;
						collection = await dependencies.getUsers();
						user = await collection.findOne({ _id: new ObjectId(userId) }, { session });
						if (!user) return false;
						kind = 'legacy';
					}

					const current: ProfileAttachmentRefs = {
						avatar: typeof user.avatarAttachmentId === 'string' && user.avatarAttachmentId ? user.avatarAttachmentId : null,
						banner: typeof user.bannerAttachmentId === 'string' && user.bannerAttachmentId ? user.bannerAttachmentId : null
					};
					const desired: ProfileAttachmentRefs = { ...current };
					const externalUrlUpdates: Partial<Record<'avatar' | 'banner', string | null>> = {};
					for (const slot of ['avatar', 'banner'] as const) {
						const request = media[slot];
						if (!request.touched) continue;
						if (request.attachmentIdPresent && request.attachmentId) {
							desired[slot] = request.attachmentId;
						} else {
							desired[slot] = null;
							// Explicit attachmentId:null removes managed media while preserving
							// the existing external fallback. A URL field switches to (or clears)
							// that fallback and also removes the managed reference.
							if (request.urlPresent) externalUrlUpdates[slot] = request.url;
						}
					}
					if (desired.avatar && desired.avatar === desired.banner) {
						throw new AttachmentBindingError(400, 'Avatar and banner must use different attachments');
					}

					const now = dependencies.now();
					if (media.avatar.touched || media.banner.touched) {
						await dependencies.reconcileAttachments({ ownerId: userId, targetId: userId, current, desired, now, session });
					}

					const rootSet: Record<string, unknown> = {};
					const rootUnset: Record<string, ''> = {};
					const profileSet: Record<string, unknown> = { ...set };
					for (const slot of ['avatar', 'banner'] as const) {
						if (!media[slot].touched) continue;
						if (Object.prototype.hasOwnProperty.call(externalUrlUpdates, slot)) {
							profileSet[`${slot}Url`] = externalUrlUpdates[slot] ?? null;
						}
						if (desired[slot]) rootSet[`${slot}AttachmentId`] = desired[slot];
						else rootUnset[`${slot}AttachmentId`] = '';
					}

					if (kind === 'thing') {
						const thingSet: Record<string, unknown> = { updatedAt: now, ...rootSet };
						for (const [key, value] of Object.entries(profileSet)) thingSet[`crystal.${key}`] = value;
						const write = await collection.updateOne(
							{ _id: user._id, shareId: String(userId), thingtime: 'user', updatedAt: user.updatedAt } as any,
							{ $set: thingSet, ...(Object.keys(rootUnset).length ? { $unset: rootUnset } : {}) },
							{ session }
						);
						if (write.matchedCount !== 1) throw new AttachmentBindingError(409, 'Profile changed while it was being updated');
					} else {
						const write = await collection.updateOne(
							{ _id: user._id, updatedAt: user.updatedAt },
							{
								$set: { ...profileSet, ...rootSet, updatedAt: now },
								...(Object.keys(rootUnset).length ? { $unset: rootUnset } : {})
							},
							{ session }
						);
						if (write.matchedCount !== 1) throw new AttachmentBindingError(409, 'Profile changed while it was being updated');
					}
					return true;
				});
				if (!mutated) return { ok: false, status: 400, error: 'Invalid user id' };
			} catch (error) {
				if (error instanceof AttachmentBindingError) {
					return { ok: false, status: error.status, error: error.message };
				}
				throw error;
			}
		}

		const updated = await dependencies.findUser(userId);
		if (!updated) return { ok: false, status: 404, error: 'User not found' };
		return { ok: true, user: await dependencies.projectUser(updated) };
	};
};

export const updateUserProfile = createUpdateUserProfile();
