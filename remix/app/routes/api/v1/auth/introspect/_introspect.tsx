import { json, readJsonBody } from '~/api/http';
import { introspectToken } from '~/api/utils/auth/getCurrentUser';
import { getJwtIssuer } from '~/api/utils/auth/jwt';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const noStore = { 'Cache-Control': 'no-store' };

// POST /api/v1/auth/introspect — RFC 7662-style token introspection. JWKS
// covers offline signature/issuer/expiry checks; this reports live revocation
// status from the Mongo sessions collection. Possession of the token is the
// authorization: a caller can only ask about tokens it already holds, and an
// inactive token yields a bare { active: false } with no reason (no oracle).
export const action = async ({ request }: { request: Request }) => {
  const limit = await enforceRateLimit(request, 'auth.introspect', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many introspection requests — please wait a moment 🌸' },
      { ...rateLimitedResponseInit(limit), headers: { ...rateLimitedResponseInit(limit).headers, ...noStore } }
    );
  }

  const body = await readJsonBody(request, 16_384);
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : bearer;
  if (!token) {
    return json({ ok: false, error: 'Provide the token to introspect as { "token": "…" } or a Bearer header' }, { status: 400, headers: noStore });
  }

  const introspection = await introspectToken(token);
  if (!introspection.active) {
    return json({ active: false }, { headers: noStore });
  }

  return json({ ...introspection, iss: getJwtIssuer() }, { headers: noStore });
};
