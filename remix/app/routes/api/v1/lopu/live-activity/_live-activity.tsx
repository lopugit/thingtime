import { json, readJsonBody } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { backgroundTaskScopeFor } from '~/api/utils/lopu/backgroundTaskScope';
import { registerLopuLiveActivity, unregisterLopuLiveActivity } from '~/api/utils/lopu/liveActivity';
import { validActivityIdentifier } from '~/api/utils/lopu/liveActivityCore';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const defaults = { getAuthToken, resolveTokenUser, resolvePublicOrigin, backgroundTaskScopeFor, registerLopuLiveActivity, unregisterLopuLiveActivity, enforceRateLimit };
export const createLopuLiveActivityAction = (dependencies = defaults) => async ({ request }: { request: Request }) => {
  const fail = (error: string, status: number) => json({ ok: false, error }, { status, headers });
  if (!['POST', 'DELETE'].includes(request.method)) return fail('Method not allowed.', 405);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return fail('Use application/json.', 415);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== dependencies.resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return fail('Origin mismatch.', 403);
  const token = await dependencies.getAuthToken(request);
  const resolved = token ? await dependencies.resolveTokenUser(token) : null;
  if (!resolved || resolved.user.temporary || resolved.user.accountKind !== 'user') return fail('Sign in with a full account.', 401);
  const body = await readJsonBody(request, 32 * 1024);
  if (body?.ownerId !== resolved.user.id) return fail('Account changed; reconnect the activity.', 409);
  if (!validActivityIdentifier(body.activityId)) return fail('Provide an activity identifier.', 400);
  const limit = await dependencies.enforceRateLimit(request, 'notifications.devices', `live-activity:${resolved.user.id}`, { failClosed: true });
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    const responseHeaders = new Headers(init.headers);
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
    return json({ ok: false, error: 'Please wait before syncing the activity again.' }, { ...init, headers: responseHeaders });
  }
  const scope = await dependencies.backgroundTaskScopeFor(request);
  if (body.contextKey !== scope) return fail('Data source changed; reconnect the activity.', 409);
  if (request.method === 'DELETE') {
    await dependencies.unregisterLopuLiveActivity(resolved.user.id, scope, body.activityId);
    return json({ ok: true }, { headers });
  }
  const result = await dependencies.registerLopuLiveActivity(resolved.user.id, resolved.claims.jti, scope, body);
  return result.ok ? json({ ok: true }, { headers }) : fail(result.error, result.status);
};
export const action = createLopuLiveActivityAction();
