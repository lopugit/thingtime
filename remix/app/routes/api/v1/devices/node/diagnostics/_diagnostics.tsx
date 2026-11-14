import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { resolveDeviceActor } from '~/api/utils/devices/deviceAuth';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { deviceDiagnostics } from '~/api/utils/devices/deviceDiagnostics';
import { observationResponse } from '~/api/utils/devices/deviceObservationResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
export const action = ({ request }: { request: Request }) => observationResponse(async () => {
    if (request.method !== 'POST') throw json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    const actor = await resolveDeviceActor(request);
    if (!actor) throw json({ ok: false, error: 'Unauthorized device credential' }, { status: 401 });
    const limit = await enforceRateLimit(request, 'devices.state', `device:${actor.sessionId}`, { failClosed: true });
    if (!limit.allowed) throw json({ ok: false, error: 'Diagnostics are moving too quickly' }, rateLimitedResponseInit(limit));
    const unsupported = requireJsonContentType(request); if (unsupported) throw unsupported;
    return deviceDiagnostics.node(actor, resolvePublicOrigin(request).origin, await readJsonBody(request, 64 * 1024));
});
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { 'Cache-Control': 'private, no-store' } });
