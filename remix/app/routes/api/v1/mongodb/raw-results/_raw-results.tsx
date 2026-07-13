import { json, readJsonBody } from '~/api/http';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { MONGO_QUERY_LIMITS } from '~/api/utils/mongodb/queryContract';
import { mongoQueryCapabilities, runMongoQuery } from '~/api/utils/mongodb/queryRunner';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache'
};

const requireQueryAdmin = async (request: Request) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) {
    return {
      response: json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders })
    };
  }
  return { user: gate.user };
};

// GET /api/v1/mongodb/raw-results — the exact server-owned capabilities used by
// the no-code builder. It intentionally contains no connection string or data.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireQueryAdmin(request);
  if ('response' in gate) return gate.response;
  return json(mongoQueryCapabilities(), { headers: privateHeaders });
};

// POST /api/v1/mongodb/raw-results — execute one bounded, read-only query. Raw
// writes stay behind Thingtime's normal entity APIs (FUNDAMENTALS §1/2).
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireQueryAdmin(request);
  if ('response' in gate) return gate.response;

  const limit = await enforceRateLimit(request, 'mongodb.query', `user:${gate.user.id}`, { failClosed: true });
  if (!limit.allowed) {
    if (limit.unavailable) {
      return json(
        { ok: false, error: 'The database query limiter is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'Retry-After': '5', ...privateHeaders } }
      );
    }
    const init = rateLimitedResponseInit(limit);
    return json(
      { ok: false, error: 'That is a lot of database exploring — please wait a moment 🌸' },
      { ...init, headers: { ...init.headers, ...privateHeaders } }
    );
  }

  const body = await readJsonBody(request, MONGO_QUERY_LIMITS.maxBodyBytes);
  const result = await runMongoQuery(body, request.signal);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status, headers: privateHeaders });
  }
  return json(result, { headers: privateHeaders });
};
