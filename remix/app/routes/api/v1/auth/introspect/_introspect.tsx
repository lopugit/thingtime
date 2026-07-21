import { json, readJsonBody } from '~/api/http';

import { introspectToken } from '~/api/utils/auth/introspect';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 8 * 1024;

// The token to introspect comes explicitly from the body or the Authorization
// header — never the caller's own auth cookie (an integration introspecting a
// third party's token wouldn't present it as its own cookie).
const bearerFromHeader = (request: Request): string | null => {
  const header = request.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return null;
};

// POST /api/v1/auth/introspect — RFC 7662-style token introspection.
// Body: { token } (or send the token as `Authorization: Bearer <jwt>`).
// Returns { active: boolean, ... } reflecting LIVE session status (revocation
// included), which offline JWKS verification cannot see. Never returns user PII.
export const action = async ({ request }: { request: Request }) => {
  // Bounded per IP: this is an unauthenticated live-DB lookup, so cap it like
  // the other public read endpoints to keep it from being hammered.
  const limit = await enforceRateLimit(request, 'auth.introspect', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many introspection requests — try again soon 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const token = typeof body?.token === 'string' && body.token ? body.token : bearerFromHeader(request);

  const result = await introspectToken(token);

  // Always 200 with the introspection body (per RFC 7662 an invalid/expired
  // token is reported as { active: false }, not an HTTP error), and never
  // cache — the whole point is a fresh revocation view.
  return json(result, { headers: { 'Cache-Control': 'no-store' } });
};
