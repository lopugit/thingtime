import { createHash } from 'node:crypto';
import { Binary, ObjectId } from 'mongodb';

import { getThingsCollection, getUsersCollection } from '../mongodb/collections';
import {
  ACL_ALL,
  COLLECTION_SCHEMA_VERSIONS,
  MAX_BIO_CHARS,
  MAX_DISPLAY_NAME_CHARS,
  MAX_PROFILE_URL_CHARS
} from '~/schemas/registry';
import { isAdminDoc, isEnvAdmin } from './admin';

// Users are THINGS now (thingtime ["user"], see claude-todo/12): public
// profile in crystal, credentials/private state under the root `secure` field
// (sensitive strings as BinData so the $** text index can't tokenize them),
// uniqueness via uniqueKeys (username plain, email hashed). This module keeps
// the LEGACY UserDoc shape as its interchange format — every read adapts the
// thing back to it, so loginUser/getCurrentUser/admin.ts/routes are untouched.
// Reads are dual-era (things first, legacy users collection fallback) until
// the users-to-things admin migration converts old accounts; writes always go
// to things for new accounts, and updates target whichever store holds the doc.

// Canonical legacy user document (thingtime.users) — now also the adapter
// output shape for user things. See FUNDAMENTALS.md §3 + claude-todo/12.
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
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  accountKind?: 'user' | 'service';
  emailVerificationRequiredBy?: Date | null;
  storageAllowanceBytes?: number;
  storageUsedBytes?: number;
  meta: Record<string, any>;
};

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
  emailVerified: boolean;
  createdAt: string;
  accountKind: 'user' | 'service';
  emailVerificationRequiredBy: string | null;
  storageAllowanceBytes: number | null;
  storageUsedBytes: number | null;
  activeThemeId: string | null;
  activeFeedAlgorithmId: string | null;
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
};

export const toPublicUser = (user: any): PublicUser => ({
  id: String(user._id),
  ttid: user.ttid,
  username: user.username,
  email: user.email,
  displayName: user.displayName ?? null,
  bio: typeof user.bio === 'string' ? user.bio : null,
  avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
  bannerUrl: typeof user.bannerUrl === 'string' ? user.bannerUrl : null,
  emailVerified: !!user.emailVerified,
  createdAt: new Date(user.createdAt).toISOString(),
  accountKind: user.accountKind === 'service' ? 'service' : 'user',
  emailVerificationRequiredBy: user.emailVerificationRequiredBy
    ? new Date(user.emailVerificationRequiredBy).toISOString()
    : null,
  storageAllowanceBytes: typeof user.storageAllowanceBytes === 'number' ? user.storageAllowanceBytes : null,
  storageUsedBytes: typeof user.storageUsedBytes === 'number' ? user.storageUsedBytes : null,
  activeThemeId: typeof user.meta?.activeThemeId === 'string' ? user.meta.activeThemeId : null,
  activeFeedAlgorithmId:
    typeof user.meta?.activeFeedAlgorithmId === 'string' ? user.meta.activeFeedAlgorithmId : null,
  isAdmin: isAdminDoc(user)
});

export const toPublicProfile = (user: any): PublicProfile => ({
  id: String(user._id),
  username: user.username,
  displayName: user.displayName ?? null,
  bio: typeof user.bio === 'string' ? user.bio : null,
  avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
  bannerUrl: typeof user.bannerUrl === 'string' ? user.bannerUrl : null,
  createdAt: new Date(user.createdAt).toISOString()
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

// A user thing's entire private state is ONE opaque BinData blob (`secure`).
// The $** wildcard text index tokenizes string FIELDS only — binary is
// invisible to it — so blobbing the whole subdocument means no field inside it
// (email, passwordHash, service metadata, active-* pointers, reaction MRU, or
// any field a future kind adds) can ever leak via q=<value> search enumeration.
// The one field that must stay QUERYABLE (admin, for listAdmins) lives OUTSIDE
// the blob as a boolean — booleans aren't text-indexed either. Legacy-era user
// docs keep their plaintext subdocument shape (the `users` collection has no
// text index, so nothing there is searchable).
type SecurePayload = {
  email?: string;
  passwordHash?: string;
  emailVerified?: boolean;
  accountKind?: 'user' | 'service';
  emailVerificationRequiredBy?: string | null; // ISO in the blob
  storageAllowanceBytes?: number;
  storageUsedBytes?: number;
  meta?: Record<string, any>; // never carries `admin` (that's the root boolean)
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

// uniqueKeys are BinData too — plain-string keys would tokenize into the text
// index and make user things enumerable via q=email/q=username, and the email
// key is additionally sha256-hashed so not even an exact-binary reader learns
// an address. The multikey unique index and exact-match lookups work the same
// on binary values.
export const userUsernameKey = (username: string) => toBin(`username:${username.trim().toLowerCase()}`);
export const userEmailKey = (email: string) =>
  toBin(`email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`);

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
    email: secure.email || '',
    passwordHash: secure.passwordHash || '',
    emailVerified: !!secure.emailVerified,
    accountKind: secure.accountKind === 'service' ? 'service' : 'user',
    emailVerificationRequiredBy: secure.emailVerificationRequiredBy
      ? new Date(secure.emailVerificationRequiredBy)
      : null,
    storageAllowanceBytes: secure.storageAllowanceBytes,
    storageUsedBytes: secure.storageUsedBytes,
    meta: { ...(secure.meta || {}), admin: !!thing.secureAdmin },
    schemaVersion: thing.schemaVersion,
    createdAt: thing.createdAt,
    updatedAt: thing.updatedAt
  };
};

// Build the packed secure blob for a user (shared by insertUser + the
// users-to-things migration so their shapes can't drift). admin is returned
// separately — it lives as a root boolean, never in the blob.
export const buildUserSecure = (
  doc: Pick<
    UserDoc,
    'email' | 'passwordHash' | 'emailVerified' | 'accountKind' | 'emailVerificationRequiredBy' | 'meta'
  > & { storageAllowanceBytes?: number; storageUsedBytes?: number }
): { secure: Binary; admin: boolean } => {
  const meta = { ...(doc.meta || {}) };
  const admin = meta.admin === true;
  delete meta.admin; // admin is the root boolean, not blob content
  const payload: SecurePayload = {
    email: doc.email,
    passwordHash: doc.passwordHash,
    emailVerified: !!doc.emailVerified,
    accountKind: doc.accountKind === 'service' ? 'service' : 'user',
    emailVerificationRequiredBy: doc.emailVerificationRequiredBy
      ? new Date(doc.emailVerificationRequiredBy).toISOString()
      : null,
    meta
  };
  if (doc.storageAllowanceBytes !== undefined) payload.storageAllowanceBytes = doc.storageAllowanceBytes;
  if (doc.storageUsedBytes !== undefined) payload.storageUsedBytes = doc.storageUsedBytes;
  return { secure: packSecure(payload), admin };
};

const findUserThing = async (filter: Record<string, unknown>) =>
  (await getThingsCollection()).findOne({ thingtime: 'user', ...filter } as any);

export const findUserByUsername = async (username: string) => {
  const thing = await findUserThing({ 'crystal.username': username.trim().toLowerCase() });
  if (thing) return userThingToDoc(thing);
  return (await getUsersCollection()).findOne({ username: username.trim().toLowerCase() });
};

export const findUserByEmail = async (email: string) => {
  // the hashed uniqueKey is the exact-match path — no email string in any index
  const thing = await (await getThingsCollection()).findOne({ uniqueKeys: userEmailKey(email) } as any);
  if (thing) return userThingToDoc(thing);
  return (await getUsersCollection()).findOne({ email: email.trim().toLowerCase() });
};

export const findUserById = async (id: string) => {
  const thing = await findUserThing({ shareId: String(id) });
  if (thing) return userThingToDoc(thing);
  if (!ObjectId.isValid(id)) return null;
  return (await getUsersCollection()).findOne({ _id: new ObjectId(id) });
};

// New accounts are user things. The id is minted ObjectId-shaped so every
// String(user._id) / ObjectId.isValid assumption in the auth web holds for
// both eras; users own themselves (ownerId = shareId) and the crystal profile
// is public (acl tt:all) like the profile endpoint always was.
export const insertUser = async (doc: UserDoc & { schemaVersion?: number }) => {
  const shareId = new ObjectId().toHexString();
  const now = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const { secure, admin } = buildUserSecure(doc);

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
    uniqueKeys: [userUsernameKey(doc.username), userEmailKey(doc.email)],
    secure,
    // sparse boolean, queryable by listAdmins (booleans aren't text-indexed)
    ...(admin ? { secureAdmin: true } : {}),
    createdAt: now,
    updatedAt: now
  };
  await (await getThingsCollection()).insertOne(thing as any);
  return userThingToDoc(thing);
};

// Update whichever store holds the user: things first, legacy fallback. For
// NON-secure fields only (crystal, root booleans) — secure content goes through
// mutateUserThingSecure so the blob is re-serialized, never dotted-$set.
const updateUserStore = async (userId: string, thingUpdate: any, legacyUpdate: any): Promise<boolean> => {
  const things = await getThingsCollection();
  const res = await things.updateOne({ shareId: String(userId), thingtime: 'user' } as any, thingUpdate);
  if (res.matchedCount) return true;
  if (!ObjectId.isValid(userId)) return false;
  await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, legacyUpdate);
  return true;
};

// Read-modify-write a things-era user's secure blob (the whole subdocument is
// opaque BinData, so no dotted $set is possible). Not atomic, but per-user
// secure writes don't meaningfully race — the pointer/verify/reaction paths are
// single-actor, and the old dotted path already did two separate writes for the
// MRU. Returns false when there is no user thing (caller falls back to legacy).
const mutateUserThingSecure = async (
  userId: string,
  mutate: (secure: SecurePayload) => void
): Promise<boolean> => {
  const things = await getThingsCollection();
  const filter = { shareId: String(userId), thingtime: 'user' } as any;
  const thing = await things.findOne(filter, { projection: { secure: 1 } });
  if (!thing) return false;
  const secure = unpackSecure((thing as any).secure);
  if (!secure.meta) secure.meta = {};
  mutate(secure);
  await things.updateOne(filter, { $set: { secure: packSecure(secure), updatedAt: new Date() } });
  return true;
};

export const markEmailVerified = async (userId: string) => {
  if (await mutateUserThingSecure(userId, (s) => { s.emailVerified = true; })) return;
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active theme shareId in meta.
export const setUserActiveTheme = async (userId: string, themeShareId: string | null) => {
  if (await mutateUserThingSecure(userId, (s) => { s.meta!.activeThemeId = themeShareId; })) return;
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.activeThemeId': themeShareId, updatedAt: new Date() } }
  );
};

// Clear the user's active theme pointer ONLY if it still points at the given
// theme shareId — theme deletion uses this so it never stomps a pointer the
// user has since moved to another theme.
export const clearUserActiveTheme = async (userId: string, themeShareId: string) => {
  const cleared = await mutateUserThingSecure(userId, (s) => {
    if (s.meta!.activeThemeId === themeShareId) s.meta!.activeThemeId = null;
  });
  // A matched user thing (cleared or pointer already moved) needs no legacy write.
  if (cleared) return;
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId), 'meta.activeThemeId': themeShareId },
    { $set: { 'meta.activeThemeId': null, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active feed algorithm shareId in meta.
export const setUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string | null) => {
  if (await mutateUserThingSecure(userId, (s) => { s.meta!.activeFeedAlgorithmId = algorithmShareId; })) return;
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.activeFeedAlgorithmId': algorithmShareId, updatedAt: new Date() } }
  );
};

// Clear the active feed-algorithm pointer only if it still points at the given
// algorithm — the twin of clearUserActiveTheme, so algorithm delete stops
// hand-rolling the users-store layout (was inlined in deleteAlgorithm).
export const clearUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string) => {
  const cleared = await mutateUserThingSecure(userId, (s) => {
    if (s.meta!.activeFeedAlgorithmId === algorithmShareId) s.meta!.activeFeedAlgorithmId = null;
  });
  if (cleared) return;
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId), 'meta.activeFeedAlgorithmId': algorithmShareId },
    { $set: { 'meta.activeFeedAlgorithmId': null, updatedAt: new Date() } }
  );
};

// Recently-used reaction tokens live in meta.recentReactions as a most-recent-
// first MRU list, so the custom-emoji picker's "Recently Used" follows the user
// across devices and roster accounts (same tier as activeThemeId). Capped high
// enough to feel unlimited while keeping the user doc lean; it is NOT projected
// onto the public user (fetched lazily by the picker instead).
const MAX_RECENT_REACTIONS = 500;

// Push a token to the front of the user's recents (de-duped) and return the
// updated MRU list. Two writes because Mongo can't $pull and $push one field
// in a single update.
export const pushUserRecentReaction = async (userId: string, token: string): Promise<string[]> => {
  let updated: string[] | null = null;
  const ok = await mutateUserThingSecure(userId, (s) => {
    const prev = Array.isArray(s.meta!.recentReactions) ? (s.meta!.recentReactions as string[]) : [];
    updated = [token, ...prev.filter((t) => t !== token)].slice(0, MAX_RECENT_REACTIONS);
    s.meta!.recentReactions = updated;
  });
  if (ok) return updated || [];

  if (!ObjectId.isValid(userId)) return [];
  const users = await getUsersCollection();
  const _id = new ObjectId(userId);
  await users.updateOne({ _id }, { $pull: { 'meta.recentReactions': token } } as any);
  await users.updateOne(
    { _id },
    {
      $push: {
        'meta.recentReactions': { $each: [token], $position: 0, $slice: MAX_RECENT_REACTIONS }
      },
      $set: { updatedAt: new Date() }
    } as any
  );
  const doc = await users.findOne({ _id }, { projection: { 'meta.recentReactions': 1 } });
  return Array.isArray(doc?.meta?.recentReactions) ? (doc!.meta.recentReactions as string[]) : [];
};

// The user's full recents MRU (most-recent-first), for the picker to page.
// Projected reads only — never drag credentials or 64KB avatar crystals over.
export const getUserRecentReactions = async (userId: string): Promise<string[]> => {
  const things = await getThingsCollection();
  const thing = await things.findOne(
    { shareId: String(userId), thingtime: 'user' } as any,
    { projection: { secure: 1 } }
  );
  if (thing) {
    const list = unpackSecure((thing as any).secure).meta?.recentReactions;
    return Array.isArray(list) ? (list as string[]) : [];
  }
  if (!ObjectId.isValid(userId)) return [];
  const doc = await (await getUsersCollection()).findOne(
    { _id: new ObjectId(userId) },
    { projection: { 'meta.recentReactions': 1 } }
  );
  return Array.isArray(doc?.meta?.recentReactions) ? (doc!.meta.recentReactions as string[]) : [];
};

// --- Admin management (see auth/admin.ts) ---

// Lightweight user row for the admin panel (never includes passwordHash/meta).
export type AdminUserRow = {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  isAdmin: boolean;
  envAdmin: boolean; // admin via ADMIN_USERNAMES — can't be demoted from the UI
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toAdminRow = (doc: any): AdminUserRow => ({
  id: String(doc._id),
  username: doc.username,
  displayName: doc.displayName ?? null,
  email: doc.email,
  isAdmin: isAdminDoc(doc),
  envAdmin: isEnvAdmin(doc.username)
});

// Set (or clear) a user's stored admin flag. Env-allowlist admins remain admin
// regardless (isAdminDoc ORs the env check), so demoting one only clears the
// DB flag — they keep access until removed from ADMIN_USERNAMES.
export const setUserAdmin = async (userId: string, admin: boolean): Promise<AdminUserRow | null> => {
  // admin is a ROOT boolean on user things (queryable by listAdmins; booleans
  // aren't text-indexed), so it's a plain $set — not blob content.
  const updatedAny = await updateUserStore(
    userId,
    { $set: { secureAdmin: admin === true, updatedAt: new Date() } },
    { $set: { 'meta.admin': admin === true, updatedAt: new Date() } }
  );
  if (!updatedAny) return null;
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
export const searchUsersForAdmin = async (query: string, limit = 20): Promise<AdminUserRow[]> => {
  const q = (query || '').trim();
  const capped = Math.min(50, Math.max(1, limit));
  const pattern = { $regex: escapeRegex(q), $options: 'i' };
  const things = await getThingsCollection();
  const users = await getUsersCollection();

  const thingFilter = q
    ? { thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] }
    : { thingtime: 'user' };
  // project just what toAdminRow needs (secure blob for email, secureAdmin) —
  // never the 64KB avatar/banner crystals — and run both stores concurrently
  const [thingRaw, exact, legacyDocs] = await Promise.all([
    things
      .find(thingFilter as any)
      .project({ shareId: 1, 'crystal.username': 1, 'crystal.displayName': 1, secure: 1, secureAdmin: 1 })
      .limit(capped)
      .toArray(),
    q.includes('@') ? things.findOne({ uniqueKeys: userEmailKey(q) } as any) : Promise.resolve(null),
    users
      .find((q ? { $or: [{ username: pattern }, { email: pattern }] } : {}) as any)
      .project({ username: 1, displayName: 1, email: 1, meta: 1 })
      .limit(capped)
      .toArray()
  ]);

  const thingDocs = thingRaw.map(userThingToDoc);
  if (exact) thingDocs.unshift(userThingToDoc(exact));
  return mergeUserDocs(thingDocs, legacyDocs).sort(byUsername).slice(0, capped).map(toAdminRow);
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
      .project({ shareId: 1, crystal: 1, createdAt: 1 })
      .sort({ 'crystal.username': 1 })
      .limit(capped)
      .toArray(),
    users
      .find({ $or: [{ username: pattern }, { displayName: pattern }] } as any)
      .project({ username: 1, displayName: 1, bio: 1, avatarUrl: 1, bannerUrl: 1, createdAt: 1 })
      .sort({ username: 1 })
      .limit(capped)
      .toArray()
  ]);

  return mergeUserDocs(thingRaw.map(userThingToDoc), legacyDocs)
    .sort(byUsername)
    .slice(0, capped)
    .map(toPublicProfile);
};

// Current DB-flagged admins (env admins are surfaced separately in the config).
export const listAdmins = async (): Promise<AdminUserRow[]> => {
  const things = await getThingsCollection();
  const users = await getUsersCollection();
  const [thingRaw, legacyDocs] = await Promise.all([
    things
      .find({ thingtime: 'user', secureAdmin: true } as any)
      .project({ shareId: 1, 'crystal.username': 1, 'crystal.displayName': 1, secure: 1, secureAdmin: 1 })
      .limit(200)
      .toArray(),
    users
      .find({ 'meta.admin': true } as any)
      .project({ username: 1, displayName: 1, email: 1, meta: 1 })
      .limit(200)
      .toArray()
  ]);
  return mergeUserDocs(thingRaw.map(userThingToDoc), legacyDocs).slice(0, 200).map(toAdminRow);
};

// Profile bounds are the schema's (registry.ts) — one source of truth shared by
// the crystal sanitizer and this endpoint, so the two can't drift.

// http(s) URLs or inline data:image URIs only — anything else (javascript:,
// file:, protocol-relative) is rejected rather than stored.
const sanitizeProfileImageUrl = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PROFILE_URL_CHARS) return undefined;
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) return trimmed;
  return undefined;
};

export type UpdateProfileInput = {
  displayName?: unknown;
  bio?: unknown;
  avatarUrl?: unknown;
  bannerUrl?: unknown;
};

type UpdateProfileResult =
  | { ok: false; status: number; error: string }
  | { ok: true; user: PublicUser };

// Update the caller's own profile fields. Whitelist-only: username/email/
// password never pass through here (they need uniqueness + auth flows).
export const updateUserProfile = async (userId: string, input: UpdateProfileInput): Promise<UpdateProfileResult> => {
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

  if (input.avatarUrl !== undefined) {
    const avatarUrl = sanitizeProfileImageUrl(input.avatarUrl);
    if (avatarUrl === undefined) {
      return { ok: false, status: 400, error: 'Avatar must be an http(s) image URL' };
    }
    set.avatarUrl = avatarUrl;
  }

  if (input.bannerUrl !== undefined) {
    const bannerUrl = sanitizeProfileImageUrl(input.bannerUrl);
    if (bannerUrl === undefined) {
      return { ok: false, status: 400, error: 'Banner must be an http(s) image URL' };
    }
    set.bannerUrl = bannerUrl;
  }

  if (!Object.keys(set).length) {
    return { ok: false, status: 400, error: 'Nothing to update' };
  }

  // things-era profile fields live under crystal.*
  const thingSet: Record<string, any> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(set)) thingSet[`crystal.${key}`] = value;
  set.updatedAt = new Date();

  const updatedAny = await updateUserStore(userId, { $set: thingSet }, { $set: set });
  if (!updatedAny) return { ok: false, status: 400, error: 'Invalid user id' };
  const updated = await findUserById(userId);
  if (!updated) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  return { ok: true, user: toPublicUser(updated) };
};
