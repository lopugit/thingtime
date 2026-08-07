import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  PR_CONFLICT_RESOLVER_MODEL_OPTIONS,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  type PRConflictResolverModelId,
  validatePrConflictResolverModelWaterfall
} from '~/api/utils/settings/prConflictResolverModelWaterfallCore';
import {
  getPrConflictResolverModelWaterfall,
  setPrConflictResolverModelWaterfall
} from '~/api/utils/settings/prConflictResolverModelWaterfall';

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const responseBody = (waterfall: PRConflictResolverModelId[]) => ({
  ok: true,
  key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  waterfall: [...waterfall],
  models: PR_CONFLICT_RESOLVER_MODEL_OPTIONS.map((model) => ({ ...model }))
});

type HandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  getWaterfall: typeof getPrConflictResolverModelWaterfall;
  setWaterfall: typeof setPrConflictResolverModelWaterfall;
};

// Exporting the dependency seam keeps the real route contract directly
// testable without connecting a unit test to MongoDB or weakening production
// auth. The default exports below always inject the real implementations.
export const createPrConflictResolverModelWaterfallHandlers = (dependencies: HandlerDependencies) => {
  // GET /api/v1/settings/pr-conflict-auto-resolver-model-waterfall
  // Public by design: the GitHub workflow consumes this non-secret preference
  // list without receiving an administrator credential.
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(
        { ok: false, error: 'Method not allowed' },
        { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET, POST' } }
      );
    }

    const waterfall = await dependencies.getWaterfall();
    return json(responseBody(waterfall), { headers: NO_STORE_HEADERS });
  };

  // POST /api/v1/settings/pr-conflict-auto-resolver-model-waterfall
  // Admin-only; the public GET projection never includes audit/storage metadata.
  const action = async ({ request }: { request: Request }) => {
    if (request.method !== 'POST') {
      return json(
        { ok: false, error: 'Method not allowed' },
        { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET, POST' } }
      );
    }

    const gate = await dependencies.requireAdmin(request);
    if ('error' in gate) {
      return json(
        { ok: false, error: gate.error.message },
        { status: gate.error.status, headers: NO_STORE_HEADERS }
      );
    }

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const validated = validatePrConflictResolverModelWaterfall(body?.waterfall);
    if (validated.ok === false) {
      return json({ ok: false, error: validated.error }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const waterfall = await dependencies.setWaterfall(validated.waterfall, gate.user.id);
    return json(responseBody(waterfall), { headers: NO_STORE_HEADERS });
  };

  return { loader, action };
};

const handlers = createPrConflictResolverModelWaterfallHandlers({
  requireAdmin,
  getWaterfall: getPrConflictResolverModelWaterfall,
  setWaterfall: setPrConflictResolverModelWaterfall
});

export const loader = handlers.loader;
export const action = handlers.action;
