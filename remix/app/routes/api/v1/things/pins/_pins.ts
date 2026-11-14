import { json, readJsonBody, JSON_BODY_WITHOUT_APPLICATION_LIMIT, requireJsonContentType } from '~/api/http';
import { resolveActor } from '~/api/utils/auth/resolveActor';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { parseThingBrowserPinPath, parseThingBrowserPinChange } from '~/utils/thingBrowserPins';
import { readThingBrowserPins, updateThingBrowserPins } from '~/api/utils/things/thingBrowserPins';
import { enforceExpectedDataPlane } from '~/api/utils/mongodb/dataPlane';
import { getActiveMongoEndpoint } from '~/api/utils/mongodb/endpoint';

export const createThingBrowserPinsHandler = (dependencies = { actor: resolveActor, read: readThingBrowserPins, update: updateThingBrowserPins, limit: enforceRateLimit }) =>
  async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
    if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed.' }, { status: 405 });
    const actor = await dependencies.actor(request);
    if (actor instanceof Response) return actor;
    if (actor.kind !== 'user' || actor.user.temporary || actor.user.accountKind !== 'user') return json({ ok: false, error: 'A full user session is required.' }, { status: 401 });
    const planeError = enforceExpectedDataPlane(request, getActiveMongoEndpoint());
    if (planeError) return planeError;
    if (request.method === 'POST') {
      const site = request.headers.get('Sec-Fetch-Site');
      if (!isSameOriginAttachmentRequest(request) || (site && !['same-origin', 'none'].includes(site))) return json({ ok: false, error: 'Use the same Thingtime origin.' }, { status: 403 });
      const invalid = requireJsonContentType(request);
      if (invalid) return invalid;
    }
    const rate = await dependencies.limit(request, request.method === 'GET' ? 'things.read' : 'things.write', `user:${actor.user.id}`, { failClosed: true });
    if (!rate.allowed) return json({ ok: false, error: 'Pins are unavailable or rate limited.' }, rateLimitedResponseInit(rate));
    let input;
    try {
      const query = new URL(request.url).searchParams;
      if (request.method === 'GET') {
        if ([...query.keys()].some(key => !['path', 'cursor', 'revision'].includes(key)) || query.getAll('path').length !== 1 || [...query.keys()].some(key => query.getAll(key).length !== 1)) throw new TypeError();
        input = parseThingBrowserPinPath(JSON.parse(query.get('path')!));
      } else {
        if (query.size) throw new TypeError();
        input = parseThingBrowserPinChange(await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT));
      }
    } catch (error) {
      if (error instanceof Response) return error;
      return json({ ok: false, error: 'Choose a stable page path and valid pin change.' }, { status: 400 });
    }
    try {
      const viewer = { id: actor.user.id }, origin = new URL(request.url).origin;
      const result = request.method === 'GET' ? await dependencies.read(viewer, origin, input as string[], { cursor: new URL(request.url).searchParams.get('cursor') ?? undefined, revision: new URL(request.url).searchParams.get('revision') ?? undefined }) : await dependencies.update(viewer, origin, input as ReturnType<typeof parseThingBrowserPinChange>);
      return json(result.ok === false ? { ok: false, error: result.error } : result, { status: result.ok === false ? result.status : 200 });
    } catch {
      return json({ ok: false, error: 'Pins are temporarily unavailable. Refresh before retrying.' }, { status: 503 });
    }
  });
export const loader = createThingBrowserPinsHandler();
export const action = loader;
