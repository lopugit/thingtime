import { json } from '~/api/http';

import { resolveAppToken } from './appTokens';
import type { AppTokenContext } from './appTokens';
import { appCorsHeaders } from './cors';
import { scopeCovers } from './scopes';

// Shared front door for the embed data routes (/app-data*): resolve the
// app-scoped Bearer token, enforce the origin binding, and (when the route
// needs one) require a scope the user granted on the consent screen. Browser
// calls carry an Origin header, which must equal the origin the token was
// granted to; server-to-server calls (no Origin) pass.

export type AppRequestContext = {
  ctx: AppTokenContext;
  cors: Record<string, string>;
};

export const resolveAppRequest = async (
  request: Request,
  requiredScope?: string
): Promise<AppRequestContext | Response> => {
  const requestOrigin = request.headers.get('Origin');
  const cors = appCorsHeaders(requestOrigin);

  const ctx = await resolveAppToken(request);
  if (!ctx) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  if (requestOrigin && requestOrigin !== ctx.origin) {
    return json({ ok: false, error: 'Origin does not match this token' }, { status: 403, headers: cors });
  }

  if (requiredScope && !scopeCovers(ctx.scopes, requiredScope)) {
    return json(
      { ok: false, error: `This token was not granted the ${requiredScope} scope` },
      { status: 403, headers: cors }
    );
  }

  return { ctx, cors };
};
