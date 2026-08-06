import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserMongoEndpoints } from '~/api/utils/auth/users';
import { PublicError } from '~/api/utils/errors/safeError';
import { getMongoUri, sanitiseMongoHost } from '~/api/utils/mongodb/config';
import type { MongoEndpointSelection } from '~/api/utils/mongodb/endpoint';
import {
  clearMongoEndpointCookie,
  dbNameFromMongoUrl,
  getRequestMongoEndpoint,
  probeMongoUrl,
  serializeMongoEndpointCookie,
  validateMongoUrl
} from '~/api/utils/mongodb/endpoint';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { Submit } from '~/components/API/Submit';

const MAX_BODY_BYTES = 16 * 1024;

// Credentials-stripped host of the home deployment DB (null when unconfigured).
const getDefaultHost = (): string | null => {
  try {
    return sanitiseMongoHost(getMongoUri());
  } catch {
    return null;
  }
};

// The active-endpoint summary every response carries. NEVER includes the URL
// itself — a custom URL may embed credentials, so clients only ever see the
// sanitised host + db name.
const toActiveEndpoint = (selection: MongoEndpointSelection | null) =>
  selection
    ? {
        custom: true,
        host: sanitiseMongoHost(selection.url),
        dbName: dbNameFromMongoUrl(selection.url),
        savedId: selection.savedId
      }
    : { custom: false, host: getDefaultHost(), dbName: 'thingtime', savedId: null };

// GET /api/v1/mongodb/endpoint — the session's active data-plane endpoint.
// Works logged-out: the override is a browser-session concern (tt_mongo
// cookie), not an account one.
export const loader = async ({ request }: { request: Request }) => {
  const selection = await getRequestMongoEndpoint(request);
  return json({ ok: true, endpoint: toActiveEndpoint(selection), defaultHost: getDefaultHost() });
};

// POST /api/v1/mongodb/endpoint — set / reset the session's data-plane endpoint.
// Body is ONE of:
//   { url }      — activate a custom MongoDB URL for this browser session
//                  (logged-out OK; httpOnly session cookie, gone on browser close)
//   { savedId }  — activate one of the logged-in user's saved endpoints
//   { reset }    — back to the Thingtime default (clears the cookie)
// Activation probes the endpoint first (connect + ping, tight timeouts) so a
// bad URL fails HERE with a clear error instead of breaking every data call.
// DELETE is accepted as an alias for { reset: true }.
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const body = request.method === 'DELETE' ? {} : await readJsonBody(request, MAX_BODY_BYTES);

  // Reset is exempt from the rate limit ON PURPOSE: it probes nothing (no
  // outbound connect), and bailing back to the home DB must always work —
  // even when the limiter is unavailable or the caller has burned their window.
  if (request.method === 'DELETE' || body?.reset === true) {
    return json(
      { ok: true, endpoint: toActiveEndpoint(null), defaultHost: getDefaultHost() },
      { headers: { 'Set-Cookie': await clearMongoEndpointCookie() } }
    );
  }

  const user = await getCurrentUser(request);
  // failClosed: activation makes the SERVER probe a caller-supplied host:port
  // (an outbound connect vector) — if the limiter can't answer, refuse rather
  // than probe unbounded. Same posture as mongodb.populate.
  const rate = await enforceRateLimit(request, 'mongodb.endpoint', user ? `user:${user.id}` : null, {
    failClosed: true
  });
  if (!rate.allowed) {
    return json(
      {
        ok: false,
        error: rate.unavailable
          ? 'Endpoint activation is temporarily unavailable — try again shortly'
          : 'Too many endpoint changes — try again shortly'
      },
      rateLimitedResponseInit(rate)
    );
  }

  let selection: MongoEndpointSelection;

  if (typeof body?.savedId === 'string' && body.savedId) {
    // saved endpoints are an account feature — the list lives in the user's
    // secure blob on the home DB
    if (!user) {
      return json({ ok: false, error: 'Sign in to use saved endpoints' }, { status: 401 });
    }
    const saved = (await getUserMongoEndpoints(user.id)).find((entry) => entry.id === body.savedId);
    if (!saved) {
      return json({ ok: false, error: 'Saved endpoint not found' }, { status: 404 });
    }
    selection = { url: saved.url, savedId: saved.id };
  } else {
    try {
      selection = { url: validateMongoUrl(body?.url), savedId: null };
    } catch (err) {
      const message = err instanceof PublicError ? err.publicMessage : 'Invalid MongoDB URL';
      return json({ ok: false, error: message }, { status: 400 });
    }
  }

  const probe = await probeMongoUrl(selection.url);
  if (!probe.ok) {
    return json({ ok: false, error: probe.error }, { status: 422 });
  }

  return json(
    { ok: true, endpoint: toActiveEndpoint(selection), defaultHost: getDefaultHost(), pingMs: probe.pingMs },
    { headers: { 'Set-Cookie': await serializeMongoEndpointCookie(selection) } }
  );
};

export default function Index() {
  const { pathname } = useLocation();

  return (
    <Flex flexDir={'column'}>
      <Submit pathname={pathname}></Submit>
    </Flex>
  );
}
