import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePatIntrospection } from '~/api/utils/auth/patTokens';
import { getUserConnectorConfirmations, setUserConnectorConfirmations } from '~/api/utils/auth/users';
import { parseConnectorConfirmationPatch } from '~/api/utils/chatgpt/connectorProtections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'private, no-store' };
const defaults = { getCurrentUser, resolvePatIntrospection, getUserConnectorConfirmations, setUserConnectorConfirmations, enforceRateLimit };

export const createConnectorProtectionHandler = (deps: typeof defaults) => async ({ request }: { request: Request }) => {
  const respond = (body: unknown, status = 200) => json(body, { status, headers });
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, HEAD, POST' } });
  }
  const writing = request.method === 'POST';
  const viewer = await deps.getCurrentUser(request);
  let accountId = viewer && !viewer.temporary && viewer.accountKind !== 'service' ? viewer.id : null;
  if (!accountId && !writing && request.headers.has('Authorization')) {
    const pat = await deps.resolvePatIntrospection(request);
    if (pat.ok && pat.token.status === 'active' && pat.token.scopes.some(scope => scope === 'things' || scope.startsWith('things.'))) {
      accountId = pat.user.id;
    }
  }
  if (!accountId) return respond({ ok: false, error: 'Sign in to access these confirmation settings.' }, 401);

  const expectedActor = request.headers.get('X-Thingtime-Expected-Actor');
  if ((writing || expectedActor) && expectedActor !== accountId) {
    return respond({ ok: false, error: 'The active Thingtime account changed. Reopen Settings and try again.' }, 409);
  }
  const origin = request.headers.get('Origin');
  if (writing && ((origin && origin !== resolvePublicOrigin(request).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
    return respond({ ok: false, error: 'Use the same Thingtime origin to change these settings.' }, 403);
  }
  if (!writing) return respond({ ok: true, accountId, confirmations: await deps.getUserConnectorConfirmations(accountId) });
  const limit = await deps.enforceRateLimit(request, 'settings.connector-protections', `user:${accountId}`, { failClosed: true });
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return json({ ok: false, error: 'Too many settings requests. Try again shortly.' }, { ...init, headers: { ...init.headers, ...headers } });
  }

  const unsupported = requireJsonContentType(request);
  if (unsupported) {
    for (const [key, value] of Object.entries(headers)) unsupported.headers.set(key, value);
    return unsupported;
  }
  const body = await readJsonBody(request, 4096);
  const patch = body && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === 1 && 'confirmations' in body ? parseConnectorConfirmationPatch(body.confirmations) : null;
  if (!patch) return respond({ ok: false, error: 'Choose one or more known actions and send a boolean for each.' }, 400);
  const confirmations = await deps.setUserConnectorConfirmations(accountId, patch);
  return respond({ ok: true, accountId, confirmations });
};

export const loader = createConnectorProtectionHandler(defaults);
export const action = loader;
