import { json } from '~/api/http';

import { listAiModels } from '~/api/utils/ai/models';
import type { AiModelsResponseExtras } from '~/api/utils/ai/modelsCore';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listUserVaultProviders, userVaultConfigured } from '~/api/utils/lopu/userVault';
import { isVaultProviderHostAllowed } from '~/api/utils/lopu/vaultProviderClient';
import { publicVaultProviders, type LopuVaultProviderPublic } from '~/api/utils/lopu/vaultProviders';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/ai/models — the Lopu model catalog: every `ai-model` Thing as a
// public projection ({ id, label, provider, efforts, speeds, family, enabled,
// available, isDefault }), the availability-resolved chat defaults, and which
// providers have a key configured (presence only, never a value). Public by
// design — the picker renders before login and the list carries no secrets;
// the session, when present, only keys the rate limit.
//
// A signed-in viewer additionally gets `vaultProviders` — their own Secure
// Vault AI connections, redacted to { id, name, kind, model, endpointHost,
// available, reason? } (design note §1.3; never a token, never an endpoint
// beyond its hostname) — and `vault: { configured }`. Anonymous viewers get an
// empty list; a vault read failure degrades to an empty list too (logged),
// never to a failed catalog.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

type HandlerDependencies = {
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  listAiModels: typeof listAiModels;
  listVaultProviders: (viewerId: string) => Promise<LopuVaultProviderPublic[]>;
  vaultConfigured: () => boolean;
  log?: (message: string, error?: unknown) => void;
};

// Dependency seam (same shape as the waterfall settings route) so the real
// contract is unit-testable without MongoDB; the default export injects the
// real implementations.
export const createAiModelsHandlers = (dependencies: HandlerDependencies) => {
  const log = dependencies.log ?? ((message: string, error?: unknown) => console.error(message, error));

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
    const extras: AiModelsResponseExtras = { vaultProviders: [], vault: { configured: dependencies.vaultConfigured() } };
    if (user?.id) {
      try {
        extras.vaultProviders = await dependencies.listVaultProviders(user.id);
      } catch (error) {
        log('[ai-models] Secure Vault providers unavailable — serving the catalog without them', error);
      }
    }
    return json({ ...result, ...extras }, { headers: NO_STORE_HEADERS });
  };

  return { loader };
};

const handlers = createAiModelsHandlers({
  getCurrentUser,
  enforceRateLimit,
  listAiModels,
  listVaultProviders: async (viewerId) =>
    publicVaultProviders(await listUserVaultProviders(viewerId), { vaultConfigured: userVaultConfigured(), hostAllowed: isVaultProviderHostAllowed }),
  vaultConfigured: userVaultConfigured
});

export const loader = handlers.loader;
