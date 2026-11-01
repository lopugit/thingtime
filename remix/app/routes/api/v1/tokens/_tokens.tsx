import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listPatTokens, mintPatToken, PAT_SCOPE_CATALOG, PAT_VISIBILITY_CATALOG } from '~/api/utils/auth/patTokens';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// Token management needs a FULL session (browser/service) — getCurrentUser
// rejects purpose 'pat', so a minted token can never list, mint, or revoke
// tokens (no self-replicating credentials).

// GET /api/v1/tokens — your minted personal access tokens (newest first) plus
// the scope catalog the settings permissions selector renders.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'tokens.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re checking very fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const tokens = await listPatTokens(user.id);
  return json({ ok: true, tokens, scopes: PAT_SCOPE_CATALOG, visibilities: PAT_VISIBILITY_CATALOG });
};

// POST /api/v1/tokens — mint: { name?, scopes: string[], expiresInMs?: number
// | null, maxUses?: number | null, onlyCreatedThings?: boolean, visibility?:
// 'all' | 'public' | 'private' }. The token string is returned ONCE and
// never stored in recoverable form (only the revocable session doc is kept).
export const action = async ({ request }: { request: Request }) => {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'tokens.mint', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re minting too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await mintPatToken(user.id, {
    name: body?.name,
    scopes: body?.scopes,
    expiresInMs: body?.expiresInMs,
    maxUses: body?.maxUses,
    onlyCreatedThings: body?.onlyCreatedThings,
    visibility: body?.visibility,
    allowGet: body?.allowGet
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  // A ready-to-paste example so "send a token to an AI" is one copy away.
  const origin = new URL(request.url).origin;
  const example = `curl -H 'Authorization: Bearer ${result.token}' '${origin}/api/v1/things'`;

  return json(
    {
      ok: true,
      token: result.token,
      tokenType: result.tokenType,
      tokenInfo: result.tokenInfo,
      example,
      docs: `${origin}/api/docs`
    },
    { status: 201 }
  );
};
