import { json, readJsonBody } from '~/api/http';
import { resolveActor } from '~/api/utils/auth/resolveActor';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { getActiveMongoEndpoint, runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { dispatchThingAction } from '~/api/utils/things/thingActions';
import { parseThingActionRequest } from '~/schemas/thingActions';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });

const privateResponse = (response: Response) => {
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) next.headers.set(key, value);
  return next;
};
export const createThingActionHandler = (dependencies: {
  actor: typeof resolveActor; limit: typeof enforceSubscriptionRateLimit; dispatch: typeof dispatchThingAction;
}) => async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed.' }, 405);
  if (!isSameOriginAttachmentRequest(request) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    return reply({ ok: false, error: 'Use application/json.' }, 415);
  if (getActiveMongoEndpoint()) return reply({ ok: false, error: 'Select your home Thingtime data source before sending a Thing to Lopu.' }, 409);
  const actor = await dependencies.actor(request);
  if (actor instanceof Response) return privateResponse(actor);
  // Recording handoff may invoke AI and subsequent tools. App, device and PAT
  // credentials do not inherit this first-party-session capability.
  if (actor.kind !== 'user' || actor.user.temporary || actor.user.accountKind !== 'user')
    return reply({ ok: false, error: 'Sign in with a full user session.' }, 401);
  let input;
  try { input = parseThingActionRequest(await readJsonBody(request, 2048)); }
  catch (error) {
    if (error instanceof Response) return privateResponse(error);
    return reply({ ok: false, error: 'Choose a supported Thing action and exact Thing ID.' }, 400);
  }
  const limit = await dependencies.limit(request, 'lopu.recordings', actor.user.id);
  if (limit.unavailable) return reply({ ok: false, error: 'Account allowance is temporarily unavailable.' }, 503);
  if (!limit.allowed) {
    const init = rateLimitedResponseInit(limit);
    return privateResponse(json({ ok: false, error: 'Please wait a moment and retry.' }, init));
  }
  try {
    const result = await runWithMongoEndpoint(null, () => dependencies.dispatch(actor.user.id, input));
    return reply({ ...result, ownerId: actor.user.id }, result.ok ? 200 : result.status);
  } catch {
    return reply({ ok: false, error: 'Thing action unavailable. Check its activity before retrying.' }, 503);
  }
};
export const action = createThingActionHandler({ actor: resolveActor, limit: enforceSubscriptionRateLimit, dispatch: dispatchThingAction });
