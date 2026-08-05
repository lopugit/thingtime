import { createHash } from 'node:crypto';
import { Binary, ObjectId } from 'mongodb';

import { getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS, MAX_BIO_CHARS, MAX_DISPLAY_NAME_CHARS, MAX_PROFILE_URL_CHARS } from '~/schemas/registry';
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
  emailVerificationRequiredBy: user.emailVerificationRequiredBy ? new Date(user.emailVerificationRequiredBy).toISOString() : null,
  storageAllowanceBytes: typeof user.storageAllowanceBytes === 'number' ? user.storageAllowanceBytes : null,
  storageUsedBytes: typeof user.storageUsedBytes === 'number' ? user.storageUsedBytes : null,
  activeThemeId: typeof user.meta?.activeThemeId === 'string' ? user.meta.activeThemeId : null,
  activeFeedAlgorithmId: typeof user.meta?.activeFeedAlgorithmId === 'string' ? user.meta.activeFeedAlgorithmId : null,
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
    email: secure.email || '',
    passwordHash: secure.passwordHash || '',
    emailVerified: !!secure.emailVerified,
    accountKind: secure.accountKind === 'service' ? 'service' : 'user',
    emailVerificationRequiredBy: secure.emailVerificationRequiredBy ? new Date(secure.emailVerificationRequiredBy) : null,
    storageAllowanceBytes: secure.storageAllowanceBytes,
    storageUsedBytes: secure.storageUsedBytes,
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
  isAdmin: boolean;
  envAdmin: boolean; // admin via ADMIN_USERNAMES — can't be demoted from the UI
};

// Escape user-supplied text before embedding it in a Mongo $regex — shared with
// things/search.ts so both search surfaces strip the same metacharacters (a
// regex-injection / ReDoS fix must never patch only one copy).
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  const thingFilter = q ? { thingtime: 'user', $or: [{ 'crystal.username': pattern }, { 'crystal.displayName': pattern }] } : { thingtime: 'user' };
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

  return mergeUserDocs(thingRaw.map(userThingToDoc), legacyDocs).sort(byUsername).slice(0, capped).map(toPublicProfile);
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

type UpdateProfileResult = { ok: false; status: number; error: string } | { ok: true; user: PublicUser };

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
