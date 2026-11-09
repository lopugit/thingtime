import { json } from '~/api/http';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { withFoundPostBrowser } from '~/api/utils/things/foundPostRequest';
import { readThingMetadata, saveThingMetadata } from '~/api/utils/things/thingMetadata';
import { viewerOf, withLinkKeys } from '~/api/utils/things/things';

const handle = (mutation: boolean) => async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
  const site = request.headers.get('Sec-Fetch-Site');
  if (mutation && ((site && site !== 'same-origin' && site !== 'none') || !isSameOriginAttachmentRequest(request)))
    return json({ ok: false, error: 'Use the same Thingtime origin' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const id = params.get('id')?.trim();
  if (!id || params.getAll('id').length !== 1 || params.getAll('key').length > 1 ||
      [...params.keys()].some(key => key !== 'id' && (mutation || key !== 'key')))
    return json({ ok: false, error: 'Supply an exact Thing id' }, { status: 400 });
  const actor = await resolveActor(request, { thingsScope: mutation ? 'things.update' : 'things.read' });
  if (actor instanceof Response) return actor;
  const user = actorUser(actor), ownerSession = actor.kind === 'user' && user?.accountKind === 'user';
  if (mutation && !ownerSession) return json({ ok: false, error: 'A full user session is required' }, { status: 401 });
  if (actor.kind === 'app' || (actor.kind === 'pat' && actor.cors)) return json({ ok: false, error: 'Thing metadata is unavailable to apps' }, { status: 403 });
  const rate = await enforceRateLimit(request, mutation ? 'things.write' : 'things.views', user ? `user:${user.id}` : null, { failClosed: true });
  if (!rate.allowed) return json({ ok: false, error: 'Thing metadata is unavailable or rate limited' }, rateLimitedResponseInit(rate));
  const viewer = withLinkKeys(withFoundPostBrowser(viewerOf(user, actorPat(actor)), request, actor.kind === 'anonymous'), [params.get('key') || '']);
  const result = mutation ? await saveThingMetadata(viewer, id, request.signal) : await readThingMetadata(viewer, id, ownerSession, request.signal);
  const headers = { Vary: 'Cookie, Authorization' };
  return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status, headers }) : json(result, { headers });
});

export const loader = handle(false);
export const action = handle(true);
