import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { withVaultRequest } from '~/api/utils/auth/vaultRequest';
import { diagnoseConnection } from '~/api/utils/connections/connections';
import { requestOrigin } from '~/api/utils/connections/oauth';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store' };

// Read-only and navigable by the authenticated owner. No OAuth refresh or sync.
export const loader = ({ request }: { request: Request }) => withVaultRequest(request, async () => {
  const user = await getCurrentUser(request);
  if (!user || user.accountKind === 'service') return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  if (query.get('expectedOwnerId') !== user.id)
    return json({ ok: false, error: 'Choose the signed-in account before inspecting a connection.' }, { status: 409, headers });
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    const rateHeaders = new Headers(init.headers);
    rateHeaders.set('Cache-Control', 'private, no-store');
    return json({ ok: false, error: 'Try the operation again later.' }, { ...init, headers: rateHeaders });
  }
  const result = await diagnoseConnection(user, query.get('connectionId') || '', requestOrigin(request));
  return json(result, { status: result.ok === false ? result.status : 200, headers });
});
