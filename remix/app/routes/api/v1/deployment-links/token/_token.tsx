import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { signJwt } from '~/api/utils/auth/jwt';
import { createSession } from '~/api/utils/auth/sessions';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/deployment-links/token — mint a non-expiring token for THIS
// deployment, purpose-tagged 'deployment-link' (same shape as service-account
// tokens: null-expiry session + null-exp JWT, revocable via its session doc).
// Two callers: another deployment upgrading a login-derived link token, and a
// user copying a token to paste into another deployment's link form. Returned
// exactly once — it is never stored or shown again.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  const limit = await enforceRateLimit(request, 'deployments.link', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re doing that too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const session = await createSession(user.id, {
    expiresAt: null,
    purpose: 'deployment-link',
    meta: { createdVia: 'deployment-links/token' }
  });
  const token = await signJwt({ sub: user.id, jti: session.jti, expiresIn: null });

  return json({ ok: true, token, tokenType: 'Bearer', expiresAt: null });
};
