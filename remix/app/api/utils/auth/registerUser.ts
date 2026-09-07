import { ensureIndexes, withHomeMongoTransaction } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

import { isEnvAdmin } from './admin';
import { createEmailVerification } from './emailVerifications';
import { sendVerificationEmail } from './email';
import { signJwt } from './jwt';
import { hashPassword } from './passwords';
import { createSession } from './sessions';
import { findUserByEmail, findUserByUsername, insertUser, toPublicUser } from './users';
import type { PublicUser, UserDoc } from './users';
import { DEFAULT_SUBSCRIPTION_TIER, subscriptionTierById } from '../subscriptions/tierCatalog';
import { setSubscription } from '../subscriptions/subscriptions';
import { getLiveSubscriptionTier, tierAssignmentSnapshot } from '../subscriptions/tierCatalogStore';

export type RegisterInput = {
  username: string;
  password: string;
  email: string;
  displayName?: string | null;
  meta?: Record<string, any>;
  // Base URL used to build the verification link (request origin in routes).
  origin?: string;
};

export type RegisterResult =
  | { ok: false; status: number; error: string }
  | { ok: true; user: PublicUser; jwt: string; jti: string; verificationLink: string };

export type CreateUserAccountInput = {
  username: string;
  password: string;
  email: string;
  displayName?: string | null;
  emailVerified?: boolean;
  accountKind?: 'user' | 'service';
  emailVerificationRequiredBy?: Date | null;
  storageAllowanceBytes?: number;
  // Opt a creation path INTO an upload scope (admin-provisioned accounts
  // only). Public signup never sets them — see the meta assignment below.
  publicUploads?: boolean;
  privateUploads?: boolean;
  meta?: Record<string, any>;
};

export type CreateUserAccountResult = { ok: false; status: number; error: string } | { ok: true; user: any; publicUser: PublicUser };

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// Privileged meta keys that must never be set at account creation (only via
// their own admin-gated / authenticated endpoints). `publicUploads` and
// `privateUploads` join `admin` here: a public signup body must not be able to
// hand itself the upload permissions this hotfix exists to withhold.
const PRIVILEGED_META_KEYS = ['admin', 'publicUploads', 'privateUploads'];

// Drop privileged keys from any caller-supplied meta before it's persisted.
const sanitizeCreateMeta = (meta: unknown): Record<string, any> => {
  if (!meta || typeof meta !== 'object') return {};
  const clean: Record<string, any> = { ...(meta as Record<string, any>) };
  for (const key of PRIVILEGED_META_KEYS) delete clean[key];
  return clean;
};

// Single insertion path for user accounts. Browser registration, service
// account provisioning, and seeding share this validation + schema path.
export const createUserAccount = async (input: CreateUserAccountInput): Promise<CreateUserAccountResult> => {
  const username = (input.username || '').trim().toLowerCase();
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';

  if (!username) return { ok: false, status: 400, error: 'Username is required' };
  // '/' is the acl grammar's separator: an acl grant is tt:user/<username>
  // with an optional /comment or /write capability suffix (schemas/registry.ts
  // splitCapability). A username containing '/' would make those entries
  // ambiguous — picking the account "someone/write" in the custom-audience
  // picker mints tt:user/someone/write, which the server reads as EDIT rights
  // for the DIFFERENT account "someone". Same chokepoint reasoning as the
  // ADMIN_USERNAMES reservation below; the service-account path already
  // slugifies to [a-z0-9._-], and /profile/:username can't address one either.
  if (username.includes('/')) return { ok: false, status: 400, error: 'Usernames can’t contain “/”' };
  if (password.length < 6) return { ok: false, status: 400, error: 'Password must be at least 6 characters' };
  if (!isEmail(email)) return { ok: false, status: 400, error: 'A valid email is required' };

  // Reserve env-allowlist admin usernames across EVERY creation path (register,
  // service-account, seed) so no public route can mint an account whose
  // username grants admin via ADMIN_USERNAMES — this is the single chokepoint,
  // proof against future parallel creation paths. The username is already
  // normalized (trim + lowercase), matching how isEnvAdmin + storage compare,
  // and it catches slugified inputs from the service-account path too. Generic
  // message avoids leaking which usernames are privileged. Bootstrap: create the
  // admin account BEFORE adding it to ADMIN_USERNAMES.
  if (isEnvAdmin(username)) return { ok: false, status: 409, error: 'Username already taken' };

  // ensure the collections + unique indexes exist (idempotent, API-side)
  await ensureIndexes();

  if (await findUserByUsername(username)) return { ok: false, status: 409, error: 'Username already taken' };
  if (await findUserByEmail(email)) return { ok: false, status: 409, error: 'Email already registered' };

  const now = new Date();
  // UserDoc's type lives in users.ts; intersect the version stamp in here.
  const userDoc: UserDoc & { schemaVersion: number } = {
    ttid: username,
    username,
    email,
    passwordHash: await hashPassword(password),
    displayName: input.displayName ?? null,
    emailVerified: input.emailVerified ?? false,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.users,
    createdAt: now,
    updatedAt: now,
    accountKind: input.accountKind ?? 'user',
    // Defense-in-depth: privileged flags can never be set at creation time,
    // even if a caller sneaks them into meta. `admin` is granted only via the
    // admin-gated setUserAdmin (auth/admin.ts).
    // File/media uploads start WITHHELD for every newly created account, in
    // BOTH scopes (public = post/comment/emoji, private = messages + own
    // profile media) — verifying the email address no longer grants either. An
    // admin turns them on per user, per scope or all at once, from /admin
    // (POST /api/v1/admin/users/public-uploads) after the "new user"
    // notification lands. Both keys are stripped from any caller-supplied meta
    // above, so this is the only writer at creation time. Accounts that
    // predate the hotfix have no flags at all and stay enabled.
    meta: {
      ...sanitizeCreateMeta(input.meta),
      publicUploads: input.publicUploads === true,
      privateUploads: input.privateUploads === true
    }
  };

  if (input.emailVerificationRequiredBy !== undefined) {
    userDoc.emailVerificationRequiredBy = input.emailVerificationRequiredBy;
  }
  const liveDefault = await getLiveSubscriptionTier(DEFAULT_SUBSCRIPTION_TIER);
  const defaultSnapshot = tierAssignmentSnapshot(liveDefault ?? subscriptionTierById(DEFAULT_SUBSCRIPTION_TIER));
  let user;
	let assignedSubscription = null;
	let assignmentFailure: Extract<CreateUserAccountResult, { ok: false }> | null = null;
  try {
		await withHomeMongoTransaction(async (session) => {
			user = await insertUser(userDoc, { initialSubscription: defaultSnapshot, session });
    const userId = String(user._id);
    const assigned = await setSubscription({
      subjectType: 'user',
      subjectId: userId,
      ownerId: userId,
      tier: defaultSnapshot.tierId,
      tierVersionId: defaultSnapshot.versionId,
				overrides: input.storageAllowanceBytes !== undefined ? { userStorageBytes: Math.max(0, Math.floor(input.storageAllowanceBytes)) } : null,
      updatedBy: 'system',
				isDefaultAssignment: true,
				// A just-created account cannot own content yet because the user and
				// ledger are born in this transaction. Never accept a caller-supplied
				// baseline that could manufacture or hide usage.
				initialStorageUsedBytes: 0,
				session
    });
    if (assigned.ok === false) {
				assignmentFailure = assigned;
				// Throwing aborts the user insert too; registration never leaves an
				// account without its authoritative ready storage ledger.
				throw new Error('Initial subscription assignment failed');
    }
			assignedSubscription = assigned.subscription;
		});
  } catch (err: any) {
		if (assignmentFailure) return assignmentFailure;
    // a unique index caught a duplicate that raced past the checks above —
    // things-era collisions surface via uniqueKeys ('email:<hash>' or
    // 'username:<name>'), legacy ones via the old per-field indexes
    if (err?.code === 11000) {
      const kv = err?.keyValue?.uniqueKeys;
      const uniqueKey = typeof kv === 'string' ? kv : kv?.buffer ? Buffer.from(kv.buffer).toString('utf8') : '';
      // keyPattern.email is set for the legacy per-field index; uniqueKey carries
      // an 'email:'/'username:' prefix for things-era hashed keys. When neither is
      // decodable (mongos / older servers omit keyValue), DON'T default to
      // Username — misreporting an email collision sends the user chasing new
      // usernames that can never succeed. Re-check the DB to classify instead.
      let field: 'Email' | 'Username';
      if (err?.keyPattern?.email || uniqueKey.startsWith('email:')) {
        field = 'Email';
      } else if (err?.keyPattern?.username || uniqueKey.startsWith('username:')) {
        field = 'Username';
      } else {
        field = (await findUserByEmail(email)) ? 'Email' : 'Username';
      }
      return { ok: false, status: 409, error: `${field} already registered` };
    }
    throw err;
  }

	if (!user || !assignedSubscription) {
		return { ok: false, status: 503, error: 'Account storage setup did not complete — please try again' };
	}

	return { ok: true, user, publicUser: toPublicUser(user, assignedSubscription) };
};

// Single creation path for users — used by the register route AND by seeding,
// so a seeded user is identical to a real signup (FUNDAMENTALS.md §2).
export const registerUser = async (input: RegisterInput): Promise<RegisterResult> => {
  const created = await createUserAccount({
    username: input.username,
    password: input.password,
    email: input.email,
    displayName: input.displayName,
    meta: input.meta
  });

  if (created.ok === false) return created;

  const user = created.user;
  const userId = String(user._id);

  // session + JWT (logs the user in immediately; emailVerified stays false)
  const session = await createSession(userId);
  const jwt = await signJwt({ sub: userId, jti: session.jti });

  // email verification token + (stubbed) send
  const email = user.email;
  const verification = await createEmailVerification({ userId, email });
  const origin = input.origin || process.env.APP_URL || 'http://localhost:9999';
  const verificationLink = `${origin}/api/v1/auth/verify-email?token=${verification.token}`;
  // Fire-and-forget: a send failure (e.g. fail-closed SES outage) must not fail
  // a registration whose user + session are already committed — the dev link is
  // returned regardless and the user can resend from Settings.
  void sendVerificationEmail({ to: email, link: verificationLink }).catch(() => {});

	return { ok: true, user: created.publicUser, jwt, jti: session.jti, verificationLink };
};
