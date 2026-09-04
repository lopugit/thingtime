import { getAuthToken } from './authCookie';
import { sessionPurposeCanActAsAccount } from './credentialPurpose';
import { serviceAccountAuthenticationAllowed } from './getCurrentUser';
import { isKnownPatScope, isKnownPatVisibility, patScopeCovers } from './patScopes';
import type { PatVisibilityMode } from './patScopes';
import { signJwt, verifyJwt } from './jwt';
import { createSession, getLiveSession } from './sessions';
import type { SessionDoc } from './sessions';
import { findUserById, toPublicUserWithStorage } from './users';
import type { PublicUser } from './users';
import { getSessionsCollection } from '../mongodb/collections';
import { getSubscription } from '../subscriptions/subscriptions';

// Personal access tokens — the Settings "Token minter". A PAT is a scoped,
// revocable credential a user hands to an AI, agent, or script so it can push
// new things, update things, and scan things WITHOUT holding the account
// password or a full session. Same revocable-JWT model as every other
// Thingtime credential (FUNDAMENTALS.md §5): the session doc carries purpose
// 'pat' + { name, scopes, maxUses, usesRemaining }, and the general auth path
// (getCurrentUser/resolveSessionUser) rejects purpose 'pat' outright — a PAT
// only works where a route explicitly resolves it (resolveThingsActor below),
// so it can never manage tokens, change the password, touch OAuth grants, or
// reach any surface that wasn't deliberately opened to it.
//
// Lifetime is two independent dials, either or both:
// - expiresInMs: 1ms → null (never). Session expiresAt is the authoritative
//   ms-precision check (getLiveSession); the JWT exp is ceiled to the next
//   second and the sessions TTL index reaps the doc after expiry.
// - maxUses: 1 → null (unlimited). Each successfully authenticated request
//   atomically consumes one use; at zero the token stops resolving.

// The scope catalog + covering logic live in the pure module patScopes.ts so
// the client-side permissions selector can import them without dragging Mongo
// into the bundle; re-exported here for the server-side callers.
export { PAT_SCOPE_CATALOG, PAT_SCOPE_IDS, PAT_VISIBILITY_CATALOG, isKnownPatScope, isKnownPatVisibility, patScopeCovers } from './patScopes';
export type { PatScopeDescriptor, PatVisibilityDescriptor, PatVisibilityMode } from './patScopes';

// Bounds. Accumulation is bounded by the per-user cap (revoked never-expiring
// tokens get a reap date on revoke, and the TTL index clears expired docs).
export const MAX_PAT_TOKENS_PER_USER = 200;
export const PAT_NAME_MAX = 80;
export const PAT_MAX_SCOPES = 32;
export const PAT_MIN_EXPIRY_MS = 1;
export const PAT_MAX_EXPIRY_MS = 1000 * 60 * 60 * 24 * 365 * 100; // 100 years ≈ never, but finite
export const PAT_MIN_USES = 1;
export const PAT_MAX_USES = 1_000_000_000;
const REVOKED_PAT_REAP_MS = 1000 * 60 * 60 * 24 * 30;

export type PublicPatToken = {
  id: string; // the session jti — what list/revoke exchange
  name: string;
  scopes: string[];
  // sandbox: permissions apply only to things this token itself created
  // (things.ts stamps createdByTokenId on every PAT-created thing)
  onlyCreatedThings: boolean;
  // audience fence: which visibility of things the token may see/touch
  // ('all' = unrestricted; tokens minted before the field read as 'all')
  visibility: PatVisibilityMode;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  usesRemaining: number | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';
};

const patSessionScopes = (meta: Record<string, any> | undefined): string[] =>
  Array.isArray(meta?.scopes) ? meta.scopes.filter(isKnownPatScope) : [];

// Absent (every pre-visibility token) and unknown values both read as 'all' —
// the unrestricted behaviour those tokens were minted with.
const patSessionVisibility = (meta: Record<string, any> | undefined): PatVisibilityMode =>
  isKnownPatVisibility(meta?.visibility) ? meta!.visibility : 'all';

export const toPublicPatToken = (session: SessionDoc): PublicPatToken => {
  const meta = session.meta ?? {};
  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;
  const maxUses = typeof meta.maxUses === 'number' ? meta.maxUses : null;
  const usesRemaining = typeof meta.usesRemaining === 'number' ? meta.usesRemaining : null;

  const status: PublicPatToken['status'] = session.revokedAt
    ? 'revoked'
    : expiresAt && expiresAt.getTime() < Date.now()
      ? 'expired'
      : maxUses !== null && (usesRemaining ?? 0) <= 0
        ? 'exhausted'
        : 'active';

  return {
    id: session.jti,
    name: typeof meta.name === 'string' && meta.name ? meta.name : 'API token',
    scopes: patSessionScopes(meta),
    onlyCreatedThings: meta.onlyCreatedThings === true,
    visibility: patSessionVisibility(meta),
    createdAt: new Date(session.createdAt).toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    maxUses,
    usesRemaining,
    lastUsedAt: meta.lastUsedAt ? new Date(meta.lastUsedAt).toISOString() : null,
    revokedAt: session.revokedAt ? new Date(session.revokedAt).toISOString() : null,
    status
  };
};

export type MintPatInput = {
  name?: unknown;
  scopes?: unknown;
  expiresInMs?: unknown;
  maxUses?: unknown;
  onlyCreatedThings?: unknown;
  visibility?: unknown;
  // Internal mint sites can identify a generated credential without exposing
  // the provenance knob on the public token-minter API.
  createdVia?: 'chatgpt-oauth';
};

export type MintPatResult =
  | { ok: false; status: number; error: string }
  | { ok: true; token: string; tokenType: 'Bearer'; tokenInfo: PublicPatToken };

// Validate + mint. Bad input fails loudly (a typo'd scope should surface in
// dev, not silently lose the permission — same stance as apps/scopes.ts).
export const mintPatToken = async (userId: string, input: MintPatInput): Promise<MintPatResult> => {
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, PAT_NAME_MAX) : 'API token';

  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return { ok: false, status: 400, error: 'scopes must be a non-empty list — see the catalog at /api/v1/tokens-docs' };
  }
  if (input.scopes.length > PAT_MAX_SCOPES) {
    return { ok: false, status: 400, error: 'Too many scopes' };
  }
  const scopes: string[] = [];
  for (const entry of input.scopes) {
    if (!isKnownPatScope(entry)) {
      return { ok: false, status: 400, error: `Unknown scope: ${String(entry)}` };
    }
    if (!scopes.includes(entry)) scopes.push(entry);
  }

  let expiresInMs: number | null = null;
  if (input.expiresInMs !== null && input.expiresInMs !== undefined) {
    const value = Number(input.expiresInMs);
    if (!Number.isFinite(value) || Math.floor(value) < PAT_MIN_EXPIRY_MS) {
      return { ok: false, status: 400, error: 'expiresInMs must be a number ≥ 1 (milliseconds), or null for never' };
    }
    expiresInMs = Math.min(Math.floor(value), PAT_MAX_EXPIRY_MS);
  }

  let maxUses: number | null = null;
  if (input.maxUses !== null && input.maxUses !== undefined) {
    const value = Number(input.maxUses);
    if (!Number.isFinite(value) || Math.floor(value) < PAT_MIN_USES) {
      return { ok: false, status: 400, error: 'maxUses must be a number ≥ 1, or null for unlimited' };
    }
    maxUses = Math.min(Math.floor(value), PAT_MAX_USES);
  }

  // Same fail-loudly stance as scopes: a typo'd visibility must surface at
  // mint time, never silently widen to 'all'.
  let visibility: PatVisibilityMode = 'all';
  if (input.visibility !== null && input.visibility !== undefined) {
    if (!isKnownPatVisibility(input.visibility)) {
      return { ok: false, status: 400, error: `Unknown visibility: ${String(input.visibility)} — use 'all', 'public', or 'private'` };
    }
    visibility = input.visibility;
  }

  const sessions = await getSessionsCollection();
  // The cap is the user's subscription tier (null = unlimited, e.g. payg);
  // free mirrors MAX_PAT_TOKENS_PER_USER.
  const maxPats = (await getSubscription('user', userId)).effective.maxPats;
  if (maxPats !== null) {
    // Revoked credentials are no longer usable and already have a bounded
    // reap date, so they must not prevent a user from replacing a token.
    const existing = await sessions.countDocuments({ userId, purpose: 'pat', revokedAt: null });
    if (existing >= maxPats) {
      return {
        ok: false,
        status: 409,
        error: `You already have ${maxPats} tokens — revoke some before minting more`
      };
    }
  }

  const now = Date.now();
  const expiresAt = expiresInMs === null ? null : new Date(now + expiresInMs);
  const session = await createSession(userId, {
    purpose: 'pat',
    expiresAt,
    meta: {
      name,
      scopes,
      maxUses,
      usesRemaining: maxUses,
      onlyCreatedThings: input.onlyCreatedThings === true,
      // only restrictions are stored — absent means 'all', matching every
      // token minted before the field existed
      ...(visibility !== 'all' ? { visibility } : {}),
      createdVia: input.createdVia === 'chatgpt-oauth' ? 'chatgpt-oauth' : 'token-minter'
    }
  });

  // The JWT exp is second-granular; the session expiresAt above is the
  // authoritative millisecond check (getLiveSession compares real dates).
  const token = await signJwt({
    sub: userId,
    jti: session.jti,
    expiresIn: expiresInMs === null ? null : `${Math.max(1, Math.ceil(expiresInMs / 1000))}s`
  });

  return { ok: true, token, tokenType: 'Bearer', tokenInfo: toPublicPatToken(session) };
};

// List bound: higher tiers can hold more than the free cap (pro = 1000,
// payg = unbounded), so the read window is a display bound, not the mint cap.
const PAT_LIST_MAX = 2000;

export const listPatTokens = async (userId: string): Promise<PublicPatToken[]> => {
  const sessions = await getSessionsCollection();
	const docs = await sessions.find({ userId, purpose: 'pat' }).sort({ createdAt: -1 }).limit(PAT_LIST_MAX).toArray();
  return docs.map((doc: any) => toPublicPatToken(doc));
};

export type RevokePatResult = { ok: false; status: number; error: string } | { ok: true; token: PublicPatToken };

// Revoke is owner-bound (userId in the filter) and idempotent. Never-expiring
// tokens get a reap date on revoke so the TTL index eventually clears the doc
// instead of it lingering forever.
export const revokePatToken = async (userId: string, id: unknown): Promise<RevokePatResult> => {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, status: 400, error: 'id is required' };
  }
  const sessions = await getSessionsCollection();
  const session = await sessions.findOne({ jti: id.trim(), userId, purpose: 'pat' });
  if (!session) return { ok: false, status: 404, error: 'Token not found' };

  if (!session.revokedAt) {
    const revokedAt = new Date();
    const patch: Record<string, any> = { revokedAt };
    if (!session.expiresAt) patch.expiresAt = new Date(revokedAt.getTime() + REVOKED_PAT_REAP_MS);
    await sessions.updateOne({ jti: session.jti }, { $set: patch });
    Object.assign(session, patch);
  }

  return { ok: true, token: toPublicPatToken(session as SessionDoc) };
};

// Atomically consume one use. Unlimited tokens just stamp lastUsedAt; limited
// tokens decrement guarded by usesRemaining > 0 in the filter, so two racing
// requests can never spend the same final use.
const consumePatUse = async (session: SessionDoc): Promise<boolean> => {
  const sessions = await getSessionsCollection();
  const now = new Date();
  if (typeof session.meta?.maxUses !== 'number') {
    await sessions.updateOne({ jti: session.jti }, { $set: { 'meta.lastUsedAt': now } });
    return true;
  }
  const result = await sessions.updateOne(
    { jti: session.jti, purpose: 'pat', revokedAt: null, 'meta.usesRemaining': { $gt: 0 } },
    { $inc: { 'meta.usesRemaining': -1 }, $set: { 'meta.lastUsedAt': now } }
  );
  return result.modifiedCount === 1;
};

export type PatContext = {
  jti: string;
  name: string;
  scopes: string[];
  // sandbox: this token's permissions apply only to things it created —
  // things.ts viewerOf(user, pat) turns this into stamp checks
  onlyCreatedThings: boolean;
  // audience fence: things.ts viewerOf(user, pat) turns 'public'/'private'
  // into acl checks on every read and mutation ('all' = unrestricted)
  visibility: PatVisibilityMode;
  expiresAt: Date | null;
  maxUses: number | null;
  // remaining AFTER this request's consumption
  usesRemaining: number | null;
};

export type ThingsActor = { user: PublicUser | null; pat: PatContext | null };

export type ThingsActorResult = { ok: true; actor: ThingsActor } | { ok: false; status: number; error: string };

// Resolve who is calling a things-family route: a full session (cookie or
// Bearer — pat: null, no scope limits), a PAT (Bearer only — must cover the
// required scope(s), consumes one use), or nobody. Unknown/expired/revoked
// credentials degrade to anonymous exactly like getCurrentUser, so browser
// tabs with stale cookies keep their logged-out UX; PAT-specific failures the
// caller can act on (missing scope, uses exhausted) return explicit errors.
export const resolveThingsActor = async (request: Request, scope: string | string[]): Promise<ThingsActorResult> => {
  const anonymous: ThingsActorResult = { ok: true, actor: { user: null, pat: null } };

  const token = await getAuthToken(request);
  if (!token) return anonymous;

  const claims = await verifyJwt(token);
  if (!claims) return anonymous;

  const session = await getLiveSession(claims.jti);
  if (!session) return anonymous;
  if (String(session.userId) !== claims.sub) return anonymous;

  if (session.purpose === 'pat') {
    // Bearer-only: PATs live in agent/script configs and never ride a cookie,
    // so a cross-site request can't replay one as an ambient credential.
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return anonymous;

    const scopes = patSessionScopes(session.meta);
    for (const required of Array.isArray(scope) ? scope : [scope]) {
      if (!patScopeCovers(scopes, required)) {
        return { ok: false, status: 403, error: `This token is missing the ${required} permission 🔐` };
      }
    }

    if (!(await consumePatUse(session))) {
      return { ok: false, status: 401, error: 'This token has no uses remaining 🔋' };
    }

    const userDoc = await findUserById(claims.sub);
    if (!userDoc || !serviceAccountAuthenticationAllowed(userDoc)) return anonymous;

    const maxUses = typeof session.meta?.maxUses === 'number' ? session.meta.maxUses : null;
    const before = typeof session.meta?.usesRemaining === 'number' ? session.meta.usesRemaining : null;
    return {
      ok: true,
      actor: {
				user: await toPublicUserWithStorage(userDoc),
        pat: {
          jti: session.jti,
          name: typeof session.meta?.name === 'string' ? session.meta.name : 'API token',
          scopes,
          onlyCreatedThings: session.meta?.onlyCreatedThings === true,
          visibility: patSessionVisibility(session.meta),
          expiresAt: session.expiresAt ? new Date(session.expiresAt) : null,
          maxUses,
          usesRemaining: maxUses === null ? null : Math.max(0, (before ?? 0) - 1)
        }
      }
    };
  }

  // Every other scoped credential (app, sandbox app, one-time OAuth code, and
  // future purpose values) only works through its dedicated resolver. Keep the
  // full things surface aligned with resolveSessionUser's fail-closed gate.
  if (!sessionPurposeCanActAsAccount(session.purpose)) return anonymous;

  // Full browser/service session — the normal path, no scope limits.
  const userDoc = await findUserById(claims.sub);
  if (!userDoc || !serviceAccountAuthenticationAllowed(userDoc)) return anonymous;
	return { ok: true, actor: { user: await toPublicUserWithStorage(userDoc), pat: null } };
};

export type PatIntrospection =
  | { ok: false; status: number; error: string }
  | { ok: true; token: PublicPatToken; user: { id: string; username: string; displayName: string | null } };

// Free introspection for /api/v1/tokens/self — an agent can ask "who am I and
// what can I do?" without spending a use (a 1-use token would otherwise burn
// its only call on the question).
export const resolvePatIntrospection = async (request: Request): Promise<PatIntrospection> => {
  const header = request.headers.get('Authorization');
  const unauthorized: PatIntrospection = {
    ok: false,
    status: 401,
    error: 'Send a personal access token as Authorization: Bearer <token>'
  };
  if (!header?.startsWith('Bearer ')) return unauthorized;
  const token = header.slice(7).trim();
  if (!token) return unauthorized;

  const claims = await verifyJwt(token);
  if (!claims) return { ok: false, status: 401, error: 'Token is invalid, expired, or revoked' };

  const session = await getLiveSession(claims.jti);
  if (!session || session.purpose !== 'pat' || String(session.userId) !== claims.sub) {
    return { ok: false, status: 401, error: 'Token is invalid, expired, or revoked' };
  }

  const userDoc = await findUserById(claims.sub);
  if (!userDoc || !serviceAccountAuthenticationAllowed(userDoc)) {
    return { ok: false, status: 401, error: 'Token is invalid, expired, or revoked' };
  }

  return {
    ok: true,
    token: toPublicPatToken(session as SessionDoc),
		user: {
			id: String(userDoc._id),
			username: userDoc.username,
			displayName: typeof userDoc.displayName === 'string' ? userDoc.displayName : null
		}
  };
};
