import { json, JSON_BODY_WITHOUT_APPLICATION_LIMIT, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { withVaultRequest } from '~/api/utils/auth/vaultRequest';
import { useNamedConnection } from '~/api/utils/connections/connections';
import { requestOrigin } from '~/api/utils/connections/oauth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store' };

export const action = ({ request }: { request: Request }) => withVaultRequest(request, async () => {
  const user = await getCurrentUser(request);
  if (!user || user.accountKind === 'service') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
  const unsupported = requireJsonContentType(request);
  if (unsupported) return unsupported;
  const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);
  if (!body?.expectedOwnerId || body.expectedOwnerId !== user.id)
    return json({ ok: false, error: 'Choose the signed-in account before using a connection.' }, { status: 409, headers });
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Try the operation again later.' }, rateLimitedResponseInit(limit));
  const result = await useNamedConnection(user, { id: body.id, operation: body.operation, resourceId: body.resourceId, pageToken: body.pageToken }, requestOrigin(request), request.signal);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status, headers });
  return json(result, { headers });
});
