import { json, readJsonBody } from '~/api/http';
import { introspectToken } from '~/api/utils/auth/introspection';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/introspect — { token } → live token status.
// /api/v1/auth/jwks lets external platforms verify signature, issuer, and
// expiry offline; this endpoint adds the online half: whether the session
// behind the token is still live (not revoked) in Mongo. Anonymous like jwks —
// a token holder can already probe liveness against any authed endpoint — but
// rate limited per IP so it cannot be used for bulk token scanning.
export const action = async ({ request }: { request: Request }) => {
  const limit = await enforceRateLimit(request, 'auth.introspect', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many introspection calls — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return json({ ok: false, error: 'Provide { token } to introspect.' }, { status: 400 });
  }

  const result = await introspectToken(token);
  return json({ ok: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
};
