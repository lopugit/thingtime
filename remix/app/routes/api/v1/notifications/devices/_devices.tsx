import { json, readJsonBody } from '~/api/http';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { registerPushDevices, unregisterPushDevice } from '~/api/utils/notifications/pushDevices';
import { resolveWatchDevice } from '~/api/utils/watch/watchPairing';

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST, DELETE' } });
  }

  const token = await getAuthToken(request);
  const resolved = token ? await resolveTokenUser(token) : null;
  const watch = resolved ? null : await resolveWatchDevice(request, 'watch.push');
  if (!resolved && !watch) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const user = resolved?.user ?? watch!.user;
  const sessionId = resolved?.claims.jti ?? watch!.actor.sessionId;

  const limit = await enforceRateLimit(request, 'notifications.devices', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Device registration is changing very quickly — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, 16 * 1024);
  if (request.method === 'DELETE') {
    const removed = await unregisterPushDevice(user.id, body?.id);
    return json({ ok: true, removed });
  }

  const result = await registerPushDevices(user.id, sessionId, body?.devices);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, devices: result.devices });
};
