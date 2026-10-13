import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { runConnectionRequest } from '~/api/utils/connections/requests';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
const headers = { 'Cache-Control': 'private, no-store' };
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user || user.accountKind === 'service') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json({ ok: false, error: 'Please wait before using this connection again.' }, { ...init, headers: { ...init.headers, ...headers } });
  }
  const unsupported = requireJsonContentType(request);
  if (unsupported) return unsupported;
  const body = await readJsonBody(request, 4096);
  const result = await runConnectionRequest(user, { connectionId: body?.connectionId, operation: body?.operation, resourceId: body?.resourceId });
  return json(result, { status: result.ok === false ? result.status : 200, headers });
};
