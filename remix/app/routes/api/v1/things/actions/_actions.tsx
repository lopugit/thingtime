import { enforceRateLimit } from '~/api/utils/rateLimit/enforce';
import { json, readJsonBody } from '~/api/http';
import { resolveActor } from '~/api/utils/auth/resolveActor';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { getActiveMongoEndpoint, runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { availableThingActions, dispatchThingAction } from '~/api/utils/things/thingActions';
import { parseThingActionRequest } from '~/schemas/thingActions';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });

const privateResponse = (response: Response) => {
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) next.headers.set(key, value);
  return next;
};
export const createThingActionHandler = (dependencies: {
  actor: typeof resolveActor; limit: typeof enforceSubscriptionRateLimit; dispatch: typeof dispatchThingAction; available?: typeof availableThingActions; libraryLimit?: typeof enforceRateLimit;
}) => async ({ request }: { request: Request }) => {
  if (!['GET', 'POST'].includes(request.method)) return reply({ ok: false, error: 'Method not allowed.' }, 405);
  if (!isSameOriginAttachmentRequest(request) || (request.headers.has('Sec-Fetch-Site') && !['same-origin', 'none'].includes(request.headers.get('Sec-Fetch-Site')!.toLowerCase()))) return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
  if (request.method === 'POST' && request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    return reply({ ok: false, error: 'Use application/json.' }, 415);
  if (getActiveMongoEndpoint()) return reply({ ok: false, error: 'Select your home Thingtime data source before using Thing actions.' }, 409);
  const actor = await dependencies.actor(request);
  if (actor instanceof Response) return privateResponse(actor);
  // Recording handoff may invoke AI and subsequent tools. App, device and PAT
  // credentials do not inherit this first-party-session capability.
  if (actor.kind !== 'user' || actor.user.temporary || actor.user.accountKind !== 'user')
    return reply({ ok: false, error: 'Sign in with a full user session.' }, 401);
  let input;
  try {
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if ([...query.keys()].some(key => key !== 'id') || query.getAll('id').length !== 1) throw new TypeError();
      input = parseThingActionRequest({ id: query.get('id'), action: 'archive' });
    } else input = parseThingActionRequest(await readJsonBody(request, 2048));
  }
  catch (error) {
    if (error instanceof Response) return privateResponse(error);
    return reply({ ok: false, error: 'Choose a supported Thing action and exact Thing ID.' }, 400);
  }
  const libraryAction = request.method === 'GET' || input.action === 'archive' || input.action === 'restore';
  const limit = libraryAction
    ? await (dependencies.libraryLimit || enforceRateLimit)(request, request.method === 'GET' ? 'things.read' : 'things.write', `user:${actor.user.id}`, { failClosed: true })
    : await dependencies.limit(request, 'lopu.recordings', actor.user.id);
  if (limit.unavailable) return reply({ ok: false, error: 'Account allowance is temporarily unavailable.' }, 503);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return privateResponse(json({ ok: false, error: 'Please wait a moment and retry.' }, init));
  }
  try {
    const result = await runWithMongoEndpoint(null, () => request.method === 'GET' ? (dependencies.available || availableThingActions)(actor.user.id, input.id) : dependencies.dispatch(actor.user.id, input));
    if (result.ok === false) return reply({ ok: false, error: result.error }, result.status);
    return reply({ ...result, ownerId: actor.user.id });
  } catch {
    return reply({ ok: false, error: 'Thing action unavailable. Check its activity before retrying.' }, 503);
  }
};
export const action = createThingActionHandler({ actor: resolveActor, limit: enforceSubscriptionRateLimit, dispatch: dispatchThingAction });

export const loader = action;
