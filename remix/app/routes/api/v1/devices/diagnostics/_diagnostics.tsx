import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { deviceDiagnostics } from '~/api/utils/devices/deviceDiagnostics';
import { observationResponse } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
const handle = ({ request }: { request: Request }) => observationResponse(async () => {
    if (!['GET', 'POST'].includes(request.method)) throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    const user = await getCurrentUser(request);
    if (!user) throw json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    if (user.accountKind !== 'user' || user.temporary) throw json({ ok: false, error: 'A full owning account is required' }, { status: 403 });
    const expected = request.headers.get('X-Thingtime-Expected-Actor');
    if ((expected && expected !== user.id) || (request.method === 'POST' && expected !== user.id))
        throw json({ ok: false, error: 'The active account changed' }, { status: 409 });
    const origin = resolvePublicOrigin(request).origin;
    const limit = await enforceRateLimit(request, request.method === 'POST' ? 'devices.permissions' : 'devices.read', `user:${user.id}`, { failClosed: true });
    if (!limit.allowed) throw json({ ok: false, error: 'Diagnostics are moving too quickly' }, rateLimitedResponseInit(limit));
    if (request.method === 'GET') return deviceDiagnostics.read(user.id, origin, Object.fromEntries(new URL(request.url).searchParams));
    if ((request.headers.get('Origin') && request.headers.get('Origin') !== origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
        throw json({ ok: false, error: 'Use the same Thingtime origin' }, { status: 403 });
    const unsupported = requireJsonContentType(request); if (unsupported) throw unsupported;
    return deviceDiagnostics.owner(user.id, origin, await readJsonBody(request, 16 * 1024));
});
export const loader = handle;
export const action = handle;
