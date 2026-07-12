import { createHash } from 'node:crypto';
import { Binary, ObjectId } from 'mongodb';

import { getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
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

export const userUsernameKey = (username: string) => `username:${username.trim().toLowerCase()}`;
// hashed so the multikey uniqueKeys index (plain strings, text-indexed) never
// carries a readable address
export const userEmailKey = (email: string) =>
  `email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;

// BinData wrappers: the wildcard text index tokenizes every STRING field, so
// secrets travel as binary — invisible to $text, still exact-queryable.
const toBin = (value: string) => new Binary(Buffer.from(value, 'utf8'));
const fromBin = (value: any): string => {
  if (typeof value === 'string') return value;
  if (value?.buffer) return Buffer.from(value.buffer).toString('utf8');
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
};

// thing → legacy UserDoc view. _id is the thing's shareId (a hex string —
// String(user._id) everywhere keeps working; new ids are minted ObjectId-shaped
// so ObjectId.isValid guards never reject a things-era user).
const userThingToDoc = (thing: any): any => ({
  _id: thing.shareId,
  ttid: thing.crystal?.ttid || thing.crystal?.username,
  username: thing.crystal?.username,
  displayName: thing.crystal?.displayName ?? null,
  bio: thing.crystal?.bio ?? null,
  avatarUrl: thing.crystal?.avatarUrl ?? null,
  bannerUrl: thing.crystal?.bannerUrl ?? null,
  email: fromBin(thing.secure?.email),
  passwordHash: fromBin(thing.secure?.passwordHash),
  emailVerified: !!thing.secure?.emailVerified,
  accountKind: thing.secure?.accountKind === 'service' ? 'service' : 'user',
  emailVerificationRequiredBy: thing.secure?.emailVerificationRequiredBy ?? null,
  storageAllowanceBytes: thing.secure?.storageAllowanceBytes,
  storageUsedBytes: thing.secure?.storageUsedBytes,
  meta: thing.secure?.meta || {},
  schemaVersion: thing.schemaVersion,
  createdAt: thing.createdAt,
  updatedAt: thing.updatedAt
});

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
  const secure: Record<string, any> = {
    email: toBin(doc.email),
    passwordHash: toBin(doc.passwordHash),
    emailVerified: !!doc.emailVerified,
    accountKind: doc.accountKind ?? 'user',
    emailVerificationRequiredBy: doc.emailVerificationRequiredBy ?? null,
    meta: doc.meta || {}
  };
  if (doc.storageAllowanceBytes !== undefined) secure.storageAllowanceBytes = doc.storageAllowanceBytes;
  if (doc.storageUsedBytes !== undefined) secure.storageUsedBytes = doc.storageUsedBytes;

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
    createdAt: now,
    updatedAt: now
  };
  await (await getThingsCollection()).insertOne(thing as any);
  return userThingToDoc(thing);
};

// Update whichever store holds the user: things first, legacy fallback.
const updateUserStore = async (userId: string, thingUpdate: any, legacyUpdate: any): Promise<boolean> => {
  const things = await getThingsCollection();
  const res = await things.updateOne({ shareId: String(userId), thingtime: 'user' } as any, thingUpdate);
  if (res.matchedCount) return true;
  if (!ObjectId.isValid(userId)) return false;
  await (await getUsersCollection()).updateOne({ _id: new ObjectId(userId) }, legacyUpdate);
  return true;
};

export const markEmailVerified = async (userId: string) => {
  await updateUserStore(
    userId,
    { $set: { 'secure.emailVerified': true, updatedAt: new Date() } },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active theme shareId in meta.
export const setUserActiveTheme = async (userId: string, themeShareId: string | null) => {
  await updateUserStore(
    userId,
    { $set: { 'secure.meta.activeThemeId': themeShareId, updatedAt: new Date() } },
    { $set: { 'meta.activeThemeId': themeShareId, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active feed algorithm shareId in meta.
export const setUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string | null) => {
  await updateUserStore(
    userId,
    { $set: { 'secure.meta.activeFeedAlgorithmId': algorithmShareId, updatedAt: new Date() } },
    { $set: { 'meta.activeFeedAlgorithmId': algorithmShareId, updatedAt: new Date() } }
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
  const things = await getThingsCollection();
  const thingFilter = { shareId: String(userId), thingtime: 'user' } as any;
  const pulled = await things.updateOne(thingFilter, { $pull: { 'secure.meta.recentReactions': token } } as any);
  if (pulled.matchedCount) {
    await things.updateOne(thingFilter, {
      $push: { 'secure.meta.recentReactions': { $each: [token], $position: 0, $slice: MAX_RECENT_REACTIONS } },
      $set: { updatedAt: new Date() }
    } as any);
    const doc = await things.findOne(thingFilter, { projection: { 'secure.meta.recentReactions': 1 } } as any);
    const list = (doc as any)?.secure?.meta?.recentReactions;
    return Array.isArray(list) ? (list as string[]) : [];
  }
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
export const getUserRecentReactions = async (userId: string): Promise<string[]> => {
  const user = await findUserById(userId);
  const list = user?.meta?.recentReactions;
  return Array.isArray(list) ? (list as string[]) : [];
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
  const updatedAny = await updateUserStore(
    userId,
    { $set: { 'secure.meta.admin': admin === true, updatedAt: new Date() } },
    { $set: { 'meta.admin': admin === true, updatedAt: new Date() } }
  );
  if (!updatedAny) return null;
  const updated = await findUserById(userId);
  return updated ? toAdminRow(updated) : null;
};

// merge things-era + legacy results, newest store first, dedup by id
const mergeUserDocs = (thingDocs: any[], legacyDocs: any[], limit: number): any[] => {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const doc of [...thingDocs, ...legacyDocs]) {
    const id = String(doc._id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(doc);
    if (merged.length >= limit) break;
  }
  return merged;
};

// Search users by username/email for the admin panel's promote flow. Things-era
// emails are hashed (never regex-matchable by design) — a full email query
// still finds them via the exact uniqueKeys lookup.
export const searchUsersForAdmin = async (query: string, limit = 20): Promise<AdminUserRow[]> => {
  const q = (query || '').trim();
  const capped = Math.min(50, Math.max(1, limit));
  const pattern = { $regex: escapeRegex(q), $options: 'i' };

  const things = await getThingsCollection();
  const thingFilter = q
    ? { thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] }
    : { thingtime: 'user' };
  const thingDocs = (await things.find(thingFilter as any).limit(capped).toArray()).map(userThingToDoc);
  if (q.includes('@')) {
    const exact = await things.findOne({ uniqueKeys: userEmailKey(q) } as any);
    if (exact) thingDocs.unshift(userThingToDoc(exact));
  }

  const users = await getUsersCollection();
  const legacyFilter = q ? { $or: [{ username: pattern }, { email: pattern }] } : {};
  const legacyDocs = await users
    .find(legacyFilter as any)
    .project({ username: 1, displayName: 1, email: 1, meta: 1 })
    .limit(capped)
    .toArray();

  return mergeUserDocs(thingDocs, legacyDocs, capped).map(toAdminRow);
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
  const thingDocs = (
    await things
      .find({ thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] } as any)
      .sort({ 'crystal.username': 1 })
      .limit(capped)
      .toArray()
  ).map(userThingToDoc);

  const users = await getUsersCollection();
  const legacyDocs = await users
    .find({ $or: [{ username: pattern }, { displayName: pattern }] } as any)
    .project({ username: 1, displayName: 1, bio: 1, avatarUrl: 1, bannerUrl: 1, createdAt: 1 })
    .sort({ username: 1 })
    .limit(capped)
    .toArray();

  return mergeUserDocs(thingDocs, legacyDocs, capped)
    .sort((a, b) => String(a.username).localeCompare(String(b.username)))
    .map(toPublicProfile);
};

// Current DB-flagged admins (env admins are surfaced separately in the config).
export const listAdmins = async (): Promise<AdminUserRow[]> => {
  const things = await getThingsCollection();
  const thingDocs = (
    await things.find({ thingtime: 'user', 'secure.meta.admin': true } as any).limit(200).toArray()
  ).map(userThingToDoc);
  const users = await getUsersCollection();
  const legacyDocs = await users
    .find({ 'meta.admin': true } as any)
    .project({ username: 1, displayName: 1, email: 1, meta: 1 })
    .limit(200)
    .toArray();
  return mergeUserDocs(thingDocs, legacyDocs, 200).map(toAdminRow);
};

const MAX_BIO_CHARS = 500;
const MAX_DISPLAY_NAME_CHARS = 80;
// Generous enough for a small pasted data:image URI, small enough to keep user
// docs (returned on every /me) lean.
const MAX_PROFILE_URL_CHARS = 64 * 1024;

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
