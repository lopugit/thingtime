import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { revokePatToken } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 4 * 1024;

// POST /api/v1/tokens/revoke — { id } kills one of YOUR personal access
// tokens immediately (owner-bound in the util; idempotent). Full session
// required — a PAT can never revoke (or otherwise manage) tokens.
export const action = async ({ request }: { request: Request }) => {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'tokens.revoke', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re revoking very fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await revokePatToken(user.id, body?.id);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, token: result.token });
};
