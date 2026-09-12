import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { connectProvider, listConnections } from '~/api/utils/connections/connections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/connections — list the current user's linked third-party
// accounts. POST — link one: { provider, fields: { … } } per the provider's
// declared connect fields (see GET /api/v1/connections/providers).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Listing connections very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const result = await listConnections(user);
  return json({ ok: true, connections: result.connections });
};

export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'connections.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Linking accounts very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 16 * 1024);
  const result = await connectProvider(user, { provider: body?.provider, fields: body?.fields });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, connection: result.connection, alreadyLinked: result.alreadyLinked });
};
