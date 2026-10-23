import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { deviceSyncControl } from '~/api/utils/devices/deviceSyncControl';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { REMOTE_SYNC_RESULT_BYTES } from '~/fileSync/remoteSyncProtocol';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
export function createDeviceSyncControlHandlers(overrides: Partial<{
  user: typeof getCurrentUser; plane: typeof mongoDataPlane; control: typeof deviceSyncControl; limit: typeof enforceRateLimit;
}> = {}) {
  const deps = { user: getCurrentUser, plane: mongoDataPlane, control: deviceSyncControl, limit: enforceRateLimit, ...overrides };
  const handle = async ({ request }: { request: Request }) => {
    const reply = (body: any, status = 200) => json(body, { status, headers });
    if (!['GET', 'POST'].includes(request.method)) return reply({ ok: false, error: 'Method not allowed' }, 405);
    const origin = request.headers.get('Origin');
    if ((origin && origin !== resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
      return reply({ ok: false, error: 'Use the selected Thingtime origin' }, 403);
    if (internalRequestActor(request)) return reply({ ok: false, error: 'Manage device sync directly from your account' }, 403);
    const user = await deps.user(request);
    if (!user) return reply({ ok: false, error: 'Unauthorized' }, 401);
    if (user.temporary || user.isCharacter || user.accountKind !== 'user') return reply({ ok: false, error: 'Device sync requires a full Thingtime account' }, 403);
    const expected = request.headers.get(EXPECTED_ACTOR_HEADER);
    if (expected !== null && expected !== user.id) return reply({ ok: false, error: 'The active account changed' }, 409);
    if (deps.plane() !== 'home') return reply({ ok: false, error: 'Device sync requires your home storage' }, 409);
    const limit = await deps.limit(request, 'devices.sync-control', `user:${user.id}`, { failClosed: true });
    if (!limit.allowed) return json({ ok: false, error: 'Sync requests are moving too quickly. Retry shortly.' },
      { ...rateLimitedResponseInit(limit), headers: { ...Object.fromEntries(new Headers(rateLimitedResponseInit(limit).headers)), ...headers } });
    let input: any;
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      input = { action: 'read', deviceId: params.get('deviceId'), requestId: params.get('requestId') };
    } else {
      const invalid = requireJsonContentType(request);
      if (invalid) { for (const [key, value] of Object.entries(headers)) invalid.headers.set(key, value); return invalid; }
      try { input = await readJsonBody(request, REMOTE_SYNC_RESULT_BYTES + 4096); }
      catch (cause) { if (cause instanceof Response) { for (const [key, value] of Object.entries(headers)) cause.headers.set(key, value); return cause; } throw cause; }
    }
    const result = await deps.control(user.id, input);
    return reply(result, result.ok === false ? result.status : 200);
  };
  return { loader: handle, action: handle };
}
export const { loader, action } = createDeviceSyncControlHandlers();
