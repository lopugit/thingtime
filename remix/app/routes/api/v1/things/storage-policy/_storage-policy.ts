import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { isCustomMongoEndpointActive } from '~/api/utils/mongodb/endpoint';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { withFoundPostBrowser } from '~/api/utils/things/foundPostRequest';
import { readThingStorageAttachments } from '~/api/utils/things/thingStorageAttachments';
import { readStorageBrowser, registerStorageBrowser } from '~/api/utils/things/thingStorageBrowser';
import { readAutomaticThingStorageRules, readThingStoragePolicy, updateThingStoragePolicy } from '~/api/utils/things/thingStoragePolicy';
import { isStorageDeviceId, parseStoragePolicyUpdate } from '~/api/utils/things/thingStoragePolicyCore';
import { viewerOf, withLinkKeys } from '~/api/utils/things/things';

const handle = (mutation: boolean) => async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
  const site = request.headers.get('Sec-Fetch-Site');
  if (mutation && ((site && site !== 'same-origin' && site !== 'none') || !isSameOriginAttachmentRequest(request)))
    return json({ ok: false, error: 'Use the same Thingtime origin' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const automatic = params.get('automatic') === '1';
  const keys = mutation ? [] : automatic ? ['automatic', 'deviceId', 'cursor', 'revision'] : ['id', 'key', 'deviceId', 'attachments', 'cursor'];
  const id = params.get('id'), deviceId = params.get('deviceId') ?? undefined, cursor = params.get('cursor');
  const revision = params.get('revision');
  const manifest = params.get('attachments') === '1';
  if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1) ||
      (automatic && (!isStorageDeviceId(deviceId) || (cursor !== null && (!isStorageDeviceId(cursor) || revision === null)) ||
        (revision !== null && revision !== 'none' && !/^[a-f0-9]{32}$/.test(revision)))) ||
      (!mutation && !automatic && (!isStorageDeviceId(id) || (deviceId !== undefined && !isStorageDeviceId(deviceId)) ||
        (params.has('attachments') && !manifest) || (cursor !== null && (!manifest || !isStorageDeviceId(cursor))))))
    return json({ ok: false, error: 'Invalid exact Thing storage request' }, { status: 400 });
  const actor = await resolveActor(request, { thingsScope: mutation ? 'things.update' : 'things.read' });
  if (actor instanceof Response) return actor;
  const user = actorUser(actor), ownerSession = actor.kind === 'user' && user?.accountKind === 'user';
  if ((mutation || manifest || automatic) && !ownerSession) return json({ ok: false, error: 'A full user session is required' }, { status: 401 });
  if (actor.kind === 'app' || (actor.kind === 'pat' && actor.cors)) return json({ ok: false, error: 'Thing storage policy is unavailable to apps' }, { status: 403 });
  const bucket = mutation ? 'things.write' : manifest ? 'attachments.read' : automatic
    ? 'things.storagePolicy.automatic' : 'things.storagePolicy.read';
  const rate = await enforceRateLimit(request, bucket, user ? `user:${user.id}` : null, { failClosed: true });
  if (!rate.allowed) return json({ ok: false, error: 'Thing storage policy is unavailable or rate limited' }, rateLimitedResponseInit(rate));
  const headers = new Headers({ Vary: 'Cookie, Authorization' });
  const viewer = withLinkKeys(withFoundPostBrowser(viewerOf(user, actorPat(actor)), request, actor.kind === 'anonymous'), [params.get('key') || '']);
  let result;
  if (mutation) {
    const invalid = requireJsonContentType(request);
    if (invalid) return invalid;
    const body = await readJsonBody(request, 16 * 1024);
    if (body?.action === 'register-browser' && Object.keys(body).length === 1) {
      if (isCustomMongoEndpointActive()) return json({ ok: false, error: 'Browser placement requires the home data plane' }, { status: 409, headers });
      try {
        const { installation, cookie } = await registerStorageBrowser(request, user!.id);
        headers.append('Set-Cookie', cookie);
        return json({ ok: true, installation }, { headers });
      } catch { return json({ ok: false, error: 'Browser placement is temporarily unavailable' }, { status: 503, headers }); }
    }
    const input = parseStoragePolicyUpdate(body);
    if (!input) return json({ ok: false, error: 'Invalid Thing storage policy change' }, { status: 400, headers });
    result = await updateThingStoragePolicy(viewer, input, await readStorageBrowser(request, user!.id), request.signal);
  } else if (automatic) {
    result = await readAutomaticThingStorageRules(user!.id, deviceId!, cursor, revision === 'none' ? null : revision ?? undefined, request.signal);
  } else if (manifest) {
    result = await readThingStorageAttachments(viewer, id!, cursor, request.signal);
  } else {
    const browser = ownerSession ? await readStorageBrowser(request, user!.id) : null;
    result = await readThingStoragePolicy(viewer, id!, ownerSession, { requestedId: deviceId, browser }, request.signal);
  }
  return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status, headers }) : json(result, { headers });
});

export const loader = handle(false);
export const action = handle(true);
