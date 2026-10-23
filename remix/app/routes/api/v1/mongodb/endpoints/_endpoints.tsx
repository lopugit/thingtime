import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import type { SavedMongoEndpoint } from '~/api/utils/auth/users';
import { addUserMongoEndpoint, getUserMongoEndpoints, removeUserMongoEndpoint } from '~/api/utils/auth/users';
import { PublicError } from '~/api/utils/errors/safeError';
import { sanitiseMongoHost } from '~/api/utils/mongodb/config';
import {
  clearMongoEndpointCookie,
  dbNameFromMongoUrl,
  getRequestMongoEndpoint,
  probeMongoUrl,
  validateMongoUrl
} from '~/api/utils/mongodb/endpoint';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { Submit } from '~/components/API/Submit';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 64;

// Public projection of a saved endpoint: the raw URL (which may embed
// credentials) never leaves the server — clients see host + db name only.
const toPublicEndpoint = (endpoint: SavedMongoEndpoint, activeSavedId: string | null) => ({
  id: endpoint.id,
  name: endpoint.name,
  host: sanitiseMongoHost(endpoint.url),
  dbName: dbNameFromMongoUrl(endpoint.url),
  createdAt: endpoint.createdAt,
  active: endpoint.id === activeSavedId
});

// GET /api/v1/mongodb/endpoints — the logged-in user's saved data-plane
// endpoints (persisted in their secure blob on the home DB), with the one the
// session currently has active flagged.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const [endpoints, selection] = await Promise.all([
    getUserMongoEndpoints(user.id),
    getRequestMongoEndpoint(request)
  ]);
  const activeSavedId = selection?.savedId ?? null;
  return json({
    ok: true,
    endpoints: endpoints.map((endpoint) => toPublicEndpoint(endpoint, activeSavedId)),
    activeSavedId
  });
};

// POST /api/v1/mongodb/endpoints — { name?, url } — save an endpoint to the
// user's list (probed first so a dead URL fails with a clear error).
// DELETE /api/v1/mongodb/endpoints — { id } — remove a saved endpoint; if the
// session currently has that endpoint active, the override cookie is cleared
// too so the session falls back to the Thingtime default.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // failClosed: saving probes the supplied URL (an outbound connect vector) —
  // if the limiter can't answer, refuse rather than probe unbounded.
  const rate = await enforceRateLimit(request, 'mongodb.endpoints', `user:${user.id}`, { failClosed: true });
  if (!rate.allowed) {
    return json(
      {
        ok: false,
        error: rate.unavailable
          ? 'Endpoint changes are temporarily unavailable — try again shortly'
          : 'Too many endpoint changes — try again shortly'
      },
      rateLimitedResponseInit(rate)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);

  if (request.method === 'DELETE') {
    if (typeof body?.id !== 'string' || !body.id) {
      return json({ ok: false, error: 'id is required' }, { status: 400 });
    }
    const removed = await removeUserMongoEndpoint(user.id, body.id);
    if (!removed) {
      return json({ ok: false, error: 'Saved endpoint not found' }, { status: 404 });
    }
    const selection = await getRequestMongoEndpoint(request);
    const clearingActive = selection?.savedId === body.id;
    return json(
      { ok: true, removed: true, clearedActive: clearingActive },
      clearingActive ? { headers: { 'Set-Cookie': await clearMongoEndpointCookie() } } : {}
    );
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  let url: string;
  try {
    url = validateMongoUrl(body?.url);
  } catch (err) {
    const message = err instanceof PublicError ? err.publicMessage : 'Invalid MongoDB URL';
    return json({ ok: false, error: message }, { status: 400 });
  }

  const name =
    typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, MAX_NAME_LENGTH)
      : sanitiseMongoHost(url) || 'MongoDB endpoint';

  const probe = await probeMongoUrl(url);
  if (!probe.ok) {
    return json({ ok: false, error: probe.error }, { status: 422 });
  }

  const result = await addUserMongoEndpoint(user.id, { name, url });
  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 400 });
  }
  return json({ ok: true, endpoint: toPublicEndpoint(result.endpoint, null) });
};

export default function Index() {
  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}
