import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { characterPrincipal } from '~/api/utils/auth/characterSession';
import { isAdminDoc } from '~/api/utils/auth/admin';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { mongoDataPlane } from '~/api/utils/mongodb/dataPlane';
import { getRequestMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { SCHEDULED_HTTP_JOBS } from '~/api/utils/automation/scheduledJobs';
import { readJobSchedules, saveJobSchedule } from '~/api/utils/automation/jobSchedules';

function handle(request: Request, write: boolean) {
  return withAdminPrivateResponse(async () => {
    if (request.method !== (write ? 'POST' : 'GET')) return json({ ok: false }, { status: 405 });
    const principal = await characterPrincipal(request);
    if (!principal) return json({ ok: false, error: 'Full administrator session required.' }, { status: 401 });
    const { user, session } = principal;
    if (!isAdminDoc(user) || user.meta?.character || user.accountKind === 'service' || user.meta?.temporary ||
        ![undefined, null, 'browser'].includes(session.purpose) || session.meta?.activeCharacterId || request.headers.has('X-Thingtime-Character'))
      return json({ ok: false, error: 'Use a direct administrator session.' }, { status: 403 });
    if (mongoDataPlane(await getRequestMongoEndpoint(request)) !== 'home') return json({ ok: false, error: 'Select Home storage.' }, { status: 409 });
    if (!write) return json({ ok: true, jobs: await readJobSchedules() });
    if (request.headers.get('X-Thingtime-Expected-Actor') !== String(user._id)) return json({ ok: false, error: 'Administrator changed. Reload settings.' }, { status: 409 });
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.has('Origin') && request.headers.get('Origin') !== resolvePublicOrigin(request).origin))
      return json({ ok: false }, { status: 403 });
    const invalidType = requireJsonContentType(request);
    if (invalidType) return invalidType;
    const body = await readJsonBody(request, 4096);
    const job = SCHEDULED_HTTP_JOBS.find(entry => entry.id === body?.id);
    if (!job || typeof body.enabled !== 'boolean' || !Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23 ||
        !(body.revision === null || typeof body.revision === 'string') || Object.keys(body).some(k => !['id', 'enabled', 'hour', 'revision'].includes(k)))
      return json({ ok: false, error: 'Choose a registered job, enablement and UTC hour.' }, { status: 400 });
    if (!await saveJobSchedule(String(user._id), job, body)) return json({ ok: false, error: 'The schedule changed. Reload before saving.' }, { status: 409 });
    return json({ ok: true });
  });
}
export const loader = ({ request }: { request: Request }) => handle(request, false);
export const action = ({ request }: { request: Request }) => handle(request, true);
