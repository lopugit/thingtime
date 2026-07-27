import { json } from '~/api/http';

import { listSharedAppData } from '~/api/utils/apps/appData';
import { resolveAppRequest } from '~/api/utils/apps/appRequest';
import { appCorsHeaders, appDataPreflight } from '~/api/utils/apps/cors';
import { scopeCovers } from '~/api/utils/apps/scopes';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/app-data/shared?key=&prefix=&limit=&cursor= — the app-scoped
// shared read: entries users of THIS app opted into sharing (POST /app-data
// with visibility 'app', i.e. acl carrying tt:app/<clientId>), newest first
// with a cursor. Requires the app-data.shared scope on the calling token, and
// each entry's author must still hold a live grant covering that scope —
// revoking the grant pulls their entries from this feed instantly. Authors are
// shaped per THEIR OWN grant, exactly like /oauth/userinfo (id + username
// always; displayName/avatarUrl only if that author shared them).
// key= matches exactly, key=post:* or prefix= matches a prefix.
export const loader = async ({ request }: { request: Request }) => {
  const resolved = await resolveAppRequest(request, 'app-data.shared');
  if (resolved instanceof Response) return resolved;
  const { ctx, cors } = resolved;

  const limit = await enforceRateLimit(request, 'oauth.read', `user:${ctx.user.id}:app:${ctx.clientId}`);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'Reading too fast — take a breather 🌸' },
      { ...init, headers: { ...init.headers, ...cors } }
    );
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const result = await listSharedAppData(
    ctx.clientId,
    {
      key: url.searchParams.get('key'),
      prefix: url.searchParams.get('prefix'),
      limit: rawLimit === null ? null : Number(rawLimit),
      cursor: url.searchParams.get('cursor')
    },
    // Sandbox tokens read their own namespace only, authored by the synthetic
    // sandbox user shaped by the token's scopes — same wire shape end to end.
    ctx.sandbox
      ? {
          sandbox: {
            ownerId: ctx.user.id,
            author: {
              id: ctx.user.id,
              username: ctx.user.username,
              ...(scopeCovers(ctx.scopes, 'profile.displayName') ? { displayName: ctx.user.displayName } : {}),
              ...(scopeCovers(ctx.scopes, 'profile.avatar') ? { avatarUrl: ctx.user.avatarUrl } : {})
            }
          }
        }
      : undefined
  );

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: cors });
  }
  return json({ ok: true, entries: result.entries, nextCursor: result.nextCursor }, { headers: cors });
};

// OPTIONS preflights land on `action` (the catch-all routes non-GET there).
// This route is GET-only; the 405 carries CORS so embedding pages can read it.
export const action = async ({ request }: { request: Request }) => {
  const preflight = appDataPreflight(request, 'GET, OPTIONS');
  if (preflight) return preflight;

  return json(
    { ok: false, error: 'Method not allowed' },
    { status: 405, headers: appCorsHeaders(request.headers.get('Origin')) }
  );
};
