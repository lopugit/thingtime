import { json, readJsonBody } from '~/api/http';

import { listAiModels } from '~/api/utils/ai/models';
import { LOPU_CHAT_DEFAULTS_KEY, validateLopuChatDefaults, type StoredLopuChatDefaults } from '~/api/utils/ai/modelsCore';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getStoredLopuChatDefaults, setStoredLopuChatDefaults } from '~/api/utils/settings/lopuChatDefaults';

// /api/v1/settings/lopu-chat-defaults — the `Thingtime.LopuChatDefaults`
// singleton: the model / effort / speed a fresh Lopu conversation starts from.
// GET is public (same posture as the AI workflow waterfall: a non-secret
// preference), POST is admin-only. Both answer { ok, key, defaults, resolved,
// models, providers }: `defaults` is what the admin stored, `resolved` is that
// preference after catalog availability is applied (the same object
// /api/v1/ai/models reports), so an editor can show "you chose X, users get
// Y because X needs a key".
const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type HandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  getStoredDefaults: typeof getStoredLopuChatDefaults;
  setStoredDefaults: typeof setStoredLopuChatDefaults;
  listAiModels: typeof listAiModels;
};

const methodNotAllowed = () =>
  json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET, POST' } });

export const createLopuChatDefaultsHandlers = (dependencies: HandlerDependencies) => {
  const responseBody = async (stored: StoredLopuChatDefaults, viewer: Parameters<typeof listAiModels>[0]) => {
    const list = await dependencies.listAiModels(viewer);
    return {
      ok: true,
      key: LOPU_CHAT_DEFAULTS_KEY,
      defaults: { ...stored },
      resolved: list.defaults,
      models: list.models,
      providers: list.providers
    };
  };

  // GET — public read of the stored preference plus its resolved form.
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();

    const user = await dependencies.getCurrentUser(request);
    const limit = await dependencies.enforceRateLimit(request, 'settings.lopu-chat-defaults', user ? `user:${user.id}` : null);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: 'Lopu defaults are being read too quickly — try again in a moment' },
        { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } }
      );
    }

    const stored = await dependencies.getStoredDefaults();
    return json(await responseBody(stored, user), { headers: NO_STORE_HEADERS });
  };

  // POST — admin-only replace. Body: { model, effort?, speed? } (or the same
  // shape under `defaults`). Validation is strict: a catalog model, an effort
  // the model offers (null = provider default), a fast lane only where sold.
  const action = async ({ request }: { request: Request }) => {
    if (request.method !== 'POST') return methodNotAllowed();

    const gate = await dependencies.requireAdmin(request);
    if ('error' in gate) {
      return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: NO_STORE_HEADERS });
    }

    const limit = await dependencies.enforceRateLimit(request, 'settings.lopu-chat-defaults', `user:${gate.user.id}`, {
      failClosed: true
    });
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: 'Lopu defaults are being saved too quickly — pause for a moment' },
        { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } }
      );
    }

    const body: any = await readJsonBody(request, MAX_BODY_BYTES);
    const candidate = body && typeof body === 'object' && body.defaults && typeof body.defaults === 'object' ? body.defaults : body;
    const validated = validateLopuChatDefaults(candidate);
    if (validated.ok === false) {
      return json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const stored = await dependencies.setStoredDefaults(validated.defaults, gate.user.id);
    return json(await responseBody(stored, gate.user), { headers: NO_STORE_HEADERS });
  };

  return { loader, action };
};

const handlers = createLopuChatDefaultsHandlers({
  requireAdmin,
  getCurrentUser,
  enforceRateLimit,
  getStoredDefaults: getStoredLopuChatDefaults,
  setStoredDefaults: setStoredLopuChatDefaults,
  listAiModels
});

export const loader = handlers.loader;
export const action = handlers.action;
