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
  // This body only ever carries four short scalars (the vault's deliberately
  // uncapped credential payloads are a different contract), so it keeps the
  // same bound as every sibling connections route.
  const body = await readJsonBody(request, 4 * 1024);
  const result = await runConnectionRequest(user, {
    connectionId: body?.connectionId, operation: body?.operation, resourceId: body?.resourceId, pageToken: body?.pageToken
  }, request.signal);
  return json(result, { status: result.ok === false ? result.status : 200, headers });
};
