import { json, readJsonBody } from '~/api/http';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// Signature/exp already passed verifyJwt inside resolveTokenUser, so decoding
// the payload here only surfaces timestamps the token holder can read anyway.
const decodeJwtTimestamps = (token: string): { exp?: number; iat?: number } => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return {
      exp: typeof payload?.exp === 'number' ? payload.exp : undefined,
      iat: typeof payload?.iat === 'number' ? payload.iat : undefined
    };
  } catch {
    return {};
  }
};

// POST /api/v1/auth/introspect — { token }
// RFC 7662-style token introspection with LIVE revocation status. /auth/jwks
// lets platforms verify signature/issuer/expiry offline, but a logged-out or
// admin-revoked session keeps a valid signature until exp (service tokens
// never expire) — this endpoint additionally checks the Mongo session, so
// `active` flips to false the moment the session is revoked.
//
// The caller must present the token itself, so nothing is revealed beyond
// what the holder already knows (and inactive tokens get a bare
// { active: false } with no reason, per RFC 7662 §2.2 — no probe oracle).
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  // anonymous per-IP bound: every call costs a JWT verify + session/user reads
  const limit = await enforceRateLimit(request, 'auth.introspect', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many introspection calls — please slow down 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return json({ ok: false, error: 'token is required' }, { status: 400 });
  }

  // Signature + exp + live Mongo session + user checks — the same shared path
  // every authenticated request uses (getCurrentUser), so introspection can
  // never disagree with what the API itself would accept.
  const resolved = await resolveTokenUser(token);

  if (!resolved) {
    return json({ ok: true, active: false });
  }

  const { exp, iat } = decodeJwtTimestamps(token);

  return json({
    ok: true,
    active: true,
    token_type: 'Bearer',
    sub: resolved.user.id,
    username: resolved.user.username,
    account_kind: resolved.user.accountKind,
    jti: resolved.claims.jti,
    exp,
    iat
  });
};
