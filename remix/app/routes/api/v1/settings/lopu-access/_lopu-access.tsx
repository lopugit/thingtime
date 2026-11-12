import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getStoredLopuAccessSettings, LOPU_ACCESS_KEY, setStoredLopuAccessSettings } from '~/api/utils/settings/lopuAccess';

// /api/v1/settings/lopu-access — the `Thingtime.LopuAccess` singleton
// (design note §1): { requireVerification, allowByoUnverified,
// starterCredits, lowBalanceWarningCredits }. GET is public (the client
// needs the rules to render the locked state before a turn; nothing here is
// secret), POST is admin-only and accepts the whole shape or a partial patch.
// Both answer { ok, key, settings }.
const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export type LopuAccessSettingsHandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  getStoredSettings: typeof getStoredLopuAccessSettings;
  setStoredSettings: typeof setStoredLopuAccessSettings;
};

const methodNotAllowed = () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET, POST' } });

export const createLopuAccessSettingsHandlers = (dependencies: LopuAccessSettingsHandlerDependencies) => {
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
    const user = await dependencies.getCurrentUser(request);
    const limit = await dependencies.enforceRateLimit(request, 'settings.lopu-access', user ? `user:${user.id}` : null);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json({ ok: false, error: 'Lopu access settings are being read too quickly — try again in a moment' }, { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } });
    }
    const settings = await dependencies.getStoredSettings();
    return json({ ok: true, key: LOPU_ACCESS_KEY, settings }, { headers: NO_STORE_HEADERS });
  };

  const action = async ({ request }: { request: Request }) => {
    if (request.method !== 'POST') return methodNotAllowed();
    const gate = await dependencies.requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: NO_STORE_HEADERS });
    const unsupported = requireJsonContentType(request);
    if (unsupported) return unsupported;

    const limit = await dependencies.enforceRateLimit(request, 'settings.lopu-access', `user:${gate.user.id}`, { failClosed: true });
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json({ ok: false, error: 'Lopu access settings are being saved too quickly — pause for a moment' }, { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } });
    }

    const body: any = await readJsonBody(request, MAX_BODY_BYTES);
    const candidate = body && typeof body === 'object' && !Array.isArray(body) && body.settings && typeof body.settings === 'object' ? body.settings : body;
    try {
      const settings = await dependencies.setStoredSettings(candidate, gate.user.id);
      return json({ ok: true, key: LOPU_ACCESS_KEY, settings }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      if (error instanceof TypeError) return json({ ok: false, error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
      throw error;
    }
  };

  return { loader, action };
};

const handlers = createLopuAccessSettingsHandlers({
  requireAdmin,
  getCurrentUser,
  enforceRateLimit,
  getStoredSettings: getStoredLopuAccessSettings,
  setStoredSettings: setStoredLopuAccessSettings
});

export const loader = handlers.loader;
export const action = handlers.action;
