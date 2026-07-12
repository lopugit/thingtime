import { ObjectId } from 'mongodb';

import { getUsersCollection } from '../mongodb/collections';
import { isAdminDoc, isEnvAdmin } from './admin';

// Canonical user document (thingtime.users). See FUNDAMENTALS.md §3 + the user
// schema in claude-todo/03-auth-login-register.md.
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

export const findUserByUsername = async (username: string) =>
  (await getUsersCollection()).findOne({ username: username.trim().toLowerCase() });

export const findUserByEmail = async (email: string) =>
  (await getUsersCollection()).findOne({ email: email.trim().toLowerCase() });

export const findUserById = async (id: string) => {
  if (!ObjectId.isValid(id)) return null;
  return (await getUsersCollection()).findOne({ _id: new ObjectId(id) });
};

export const insertUser = async (doc: UserDoc) => {
  const res = await (await getUsersCollection()).insertOne(doc);
  return { ...doc, _id: res.insertedId };
};

export const markEmailVerified = async (userId: string) => {
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active theme shareId in meta.
export const setUserActiveTheme = async (userId: string, themeShareId: string | null) => {
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.activeThemeId': themeShareId, updatedAt: new Date() } }
  );
};

// Set (or clear, with null) the user's active feed algorithm shareId in meta.
export const setUserActiveFeedAlgorithm = async (userId: string, algorithmShareId: string | null) => {
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
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
  if (!ObjectId.isValid(userId)) return null;
  const users = await getUsersCollection();
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $set: { 'meta.admin': admin === true, updatedAt: new Date() } }
  );
  const updated = await users.findOne({ _id: new ObjectId(userId) });
  return updated ? toAdminRow(updated) : null;
};

// Search users by username/email for the admin panel's promote flow.
export const searchUsersForAdmin = async (query: string, limit = 20): Promise<AdminUserRow[]> => {
  const q = (query || '').trim();
  const users = await getUsersCollection();
  const filter = q
    ? { $or: [{ username: { $regex: escapeRegex(q), $options: 'i' } }, { email: { $regex: escapeRegex(q), $options: 'i' } }] }
    : {};
  const docs = await users
    .find(filter as any)
    .project({ username: 1, displayName: 1, email: 1, meta: 1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .toArray();
  return docs.map(toAdminRow);
};

// Public people search for /search — matches username or display name
// (escaped literal, case-insensitive) and returns ONLY the public profile
// projection. Never matches email: that would let anyone reverse an address
// to an account.
export const searchUsersPublic = async (query: string, limit = 8): Promise<PublicProfile[]> => {
  const q = (query || '').trim().slice(0, 100);
  if (!q) return [];
  const users = await getUsersCollection();
  const pattern = { $regex: escapeRegex(q), $options: 'i' };
  const docs = await users
    .find({ $or: [{ username: pattern }, { displayName: pattern }] } as any)
    .project({ username: 1, displayName: 1, bio: 1, avatarUrl: 1, bannerUrl: 1, createdAt: 1 })
    .sort({ username: 1 })
    .limit(Math.min(20, Math.max(1, limit)))
    .toArray();
  return docs.map(toPublicProfile);
};

// Current DB-flagged admins (env admins are surfaced separately in the config).
export const listAdmins = async (): Promise<AdminUserRow[]> => {
  const users = await getUsersCollection();
  const docs = await users
    .find({ 'meta.admin': true } as any)
    .project({ username: 1, displayName: 1, email: 1, meta: 1 })
    .limit(200)
    .toArray();
  return docs.map(toAdminRow);
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
  if (!ObjectId.isValid(userId)) {
    return { ok: false, status: 400, error: 'Invalid user id' };
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

  set.updatedAt = new Date();
  const users = await getUsersCollection();
  await users.updateOne({ _id: new ObjectId(userId) }, { $set: set });
  const updated = await users.findOne({ _id: new ObjectId(userId) });
  if (!updated) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  return { ok: true, user: toPublicUser(updated) };
};
