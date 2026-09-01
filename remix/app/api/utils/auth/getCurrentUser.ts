import { getSubscription } from '../subscriptions/subscriptions';
import { getAuthToken } from './authCookie';
import { verifyJwt } from './jwt';
import type { JwtClaims } from './jwt';
import { getLiveSession } from './sessions';
import type { SessionDoc } from './sessions';
import { findUserById, toPublicUser } from './users';
import type { PublicUser } from './users';
import { sessionPurposeCanActAsAccount } from './credentialPurpose';

const SERVICE_EMAIL_VERIFICATION_GRACE_MS = 1000 * 60 * 60 * 24 * 7;

const serviceEmailVerificationDueAt = (user: any) => {
  if (user.emailVerificationRequiredBy) {
    return new Date(user.emailVerificationRequiredBy).getTime();
  }

  return new Date(user.createdAt).getTime() + SERVICE_EMAIL_VERIFICATION_GRACE_MS;
};

export const serviceAccountAuthenticationAllowed = (user: any, now = Date.now()): boolean =>
  user.accountKind !== 'service' || !!user.emailVerified || serviceEmailVerificationDueAt(user) >= now;

export type ResolvedTokenUser = { user: PublicUser; claims: JwtClaims };

// Scoped credentials must opt into a dedicated resolver. Keeping the purpose
// predicate exported gives every new credential family a pure regression test:
// a device node can never become a full browser session merely because it uses
// the shared sessions collection.
export const isFullAccountSessionPurpose = (purpose: unknown): boolean => purpose === undefined || purpose === 'browser' || purpose === 'service';

// Resolve a live session id to its user, or null. This is THE session→user
// path: JWT resolution below and the account-switcher roster entries
// (accounts.ts, which stores {userId, jti} references) both go through it, so
// a session is either valid everywhere or nowhere. Verifies: session is still
// live in Mongo → it belongs to the expected user → the user exists.
export const resolveSessionUser = async (jti: string, expectedUserId: string): Promise<PublicUser | null> => {
  // All three reads are keyed off values the caller already holds — jti and
  // expectedUserId both come from the verified JWT — so none of them needs to
  // wait on another. Issuing them together turns the three sequential round
  // trips every authenticated request used to pay into one.
  //
  // Every rejection below still happens, in the same order, on the same data:
  // fetching concurrently changes only WHEN the documents arrive, never which
  // requests are allowed. The cost is two speculative reads on the reject
  // paths (dead session, wrong user, scoped-token purpose), which are the rare
  // case — a valid session is the norm.
  const [session, user, subscription] = await Promise.all([
    getLiveSession(jti),
    findUserById(expectedUserId),
    getSubscription('user', expectedUserId)
  ]);

  // Revocation check: the jti must map to a live session for the same user.
  // Without the userId binding, any live jti could claim a different user.
  if (!session) return null;
  if (String(session.userId) !== expectedUserId) return null;
  // App-scoped tokens (third-party "Login with Thingtime" grants) are never
  // full account credentials: they only work through the app-token path
  // (apps/appTokens.ts), which checks the purpose itself. Sandbox tokens
  // couldn't resolve anyway (their userId is no real user), but reject them
  // explicitly all the same. Personal access tokens (the Settings token
  // minter, auth/patTokens.ts) are likewise scoped credentials, not full
  // sessions — they only resolve through resolveThingsActor and the token
  // introspection endpoint, never here, so a PAT can never mint more tokens,
  // change auth settings, or reach unscoped surfaces.
  if (!sessionPurposeCanActAsAccount(session.purpose)) return null;

  if (!user) return null;
  if (!serviceAccountAuthenticationAllowed(user)) {
    return null;
  }

  // findUserById(expectedUserId) guarantees String(user._id) === expectedUserId,
  // so the subscription fetched above is this user's — the same pairing
  // toPublicUserWithStorage would have made.
  return toPublicUser(user, subscription);
};

// Resolve a signed JWT to its live user, or null. Verifies the signature + exp,
// then defers to the shared session→user path above.
export const resolveTokenUser = async (token: string): Promise<ResolvedTokenUser | null> => {
  const claims = await verifyJwt(token);
  if (!claims) return null;

  const user = await resolveSessionUser(claims.jti, claims.sub);
  if (!user) return null;

  return { user, claims };
};

export type TokenIntrospection =
  | { active: false }
  | {
      active: true;
      sub: string;
      jti: string;
      purpose: NonNullable<SessionDoc['purpose']>;
      iat: number;
      exp: number | null;
    };

// Revocation-aware token status for external verifiers (RFC 7662 shape). JWKS
// lets platforms check signature/issuer/expiry offline; this answers the one
// question offline verification cannot: is the session still live in Mongo?
// Unlike resolveSessionUser it also reports purpose:'app' sessions — external
// "Login with Thingtime" platforms are the main caller — because introspection
// only reports status, it never grants the credential any capability.
export const introspectToken = async (token: string): Promise<TokenIntrospection> => {
  const claims = await verifyJwt(token);
  if (!claims) return { active: false };

  const session = await getLiveSession(claims.jti);
  if (!session) return { active: false };
  if (String(session.userId) !== claims.sub) return { active: false };

  // Sandbox sessions (apps/sandbox.ts) are minted against a synthetic
  // 'sandbox:<uuid>' owner that is deliberately no real user — nothing ever
  // persists one — so findUserById can only ever return null for them.
  // Requiring a user document here would report every live sandbox token as
  // inactive, which is precisely backwards for the pre-registration
  // integrators the sandbox exists to serve (and would make the documented
  // purpose:'app-sandbox' response unreachable). Their session doc is still
  // the kill switch, so the liveness checks above are the whole answer.
  if (session.purpose !== 'app-sandbox') {
    const user = await findUserById(claims.sub);
    if (!user) return { active: false };
    if (!serviceAccountAuthenticationAllowed(user)) return { active: false };
  }

  // iat/exp are the SESSION's dates, not the JWT's, because the session record
  // is what getLiveSession actually enforces. That reports the real expiry only
  // while every mint site keeps session.expiresAt at or before its token's exp
  // — patTokens rounds the JWT up, accounts.ts re-mints a fresh 30d JWT over an
  // older session, and the rest pair identical TTLs. A future mint site that
  // sets expiresAt LATER than its token's exp would make this over-report the
  // life of the credential; pair the two there, or read exp off the JWT here.
  return {
    active: true,
    sub: claims.sub,
    jti: claims.jti,
    purpose: session.purpose ?? 'browser',
    iat: Math.floor(new Date(session.createdAt).getTime() / 1000),
    exp: session.expiresAt ? Math.floor(new Date(session.expiresAt).getTime() / 1000) : null
  };
};

// Resolve the authenticated user for a request, or null.
export const getCurrentUser = async (request: Request): Promise<PublicUser | null> => {
  const token = await getAuthToken(request);
  if (!token) return null;

  const resolved = await resolveTokenUser(token);
  return resolved ? resolved.user : null;
};
