import { ObjectId } from 'mongodb';

import { getUsersCollection } from '../mongodb/collections';

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
    typeof user.meta?.activeFeedAlgorithmId === 'string' ? user.meta.activeFeedAlgorithmId : null
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
