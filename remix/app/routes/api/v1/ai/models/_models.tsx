import { json } from '~/api/http';

import { listAiModels } from '~/api/utils/ai/models';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/ai/models — the Lopu model catalog: every `ai-model` Thing as a
// public projection ({ id, label, provider, efforts, speeds, family, enabled,
// available, isDefault }), the availability-resolved chat defaults, and which
// providers have a key configured (presence only, never a value). Public by
// design — the picker renders before login and the list carries no secrets;
// the session, when present, only keys the rate limit.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type HandlerDependencies = {
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  listAiModels: typeof listAiModels;
};

// Dependency seam (same shape as the waterfall settings route) so the real
// contract is unit-testable without MongoDB; the default export injects the
// real implementations.
export const createAiModelsHandlers = (dependencies: HandlerDependencies) => {
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET' } });
    }

    const user = await dependencies.getCurrentUser(request);
    const limit = await dependencies.enforceRateLimit(request, 'ai.models', user ? `user:${user.id}` : null);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: 'The model catalog is being read too quickly — try again in a moment 🦄' },
        { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } }
      );
    }

    const result = await dependencies.listAiModels(user);
    return json(result, { headers: NO_STORE_HEADERS });
  };

  return { loader };
};

const handlers = createAiModelsHandlers({ getCurrentUser, enforceRateLimit, listAiModels });

export const loader = handlers.loader;
