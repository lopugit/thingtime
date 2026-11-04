import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listAiConnections, syncAiConnections } from '~/api/utils/messenger/aiConnections';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 768 * 1024;

// GET lists the caller's consented desktop sources. POST accepts one bounded,
// idempotent native/export batch and maps it into Messenger communities,
// chats, memberships and relational messages.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  return json(await listAiConnections(user.id));
};

export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  if (user.accountKind !== 'user') {
    return json({ ok: false, error: 'AI app connections require a full Thingtime account' }, { status: 403 });
  }
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
  }
  const limit = await enforceRateLimit(request, 'ai.sync', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'That AI sync is moving too quickly — try again shortly' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await syncAiConnections(user.id, body);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json(result);
};
