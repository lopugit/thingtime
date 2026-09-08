import { json, readJsonBody } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { ensureAiModelCatalog, listAiModels, setAiModelEnabled } from '~/api/utils/ai/models';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// /api/v1/admin/ai/models — the admin side of the Lopu model catalog.
//
// GET  → the same list the public route serves (convenient for the editor).
// POST { id, enabled } → flips the one admin-owned field on an `ai-model`
//        Thing (`crystal.enabled`) and answers { ok, model, defaults }.
// POST { seed: true }  → re-runs ensureAiModelCatalog() on demand (self-heals
//        drifted catalog fields, inserts models added to the code catalog,
//        never touches `enabled`) and answers { ok, seeded, report, models }.
// POST { probe: true } → forces a fresh provider-key probe (the cached verdict
//        is bypassed; see api/utils/ai/providerProbe.ts) and answers
//        { ok, probed, providers, models, defaults } — the editor's "Re-check
//        keys" action. Sent together with { seed: true } the seed report
//        carries the freshly probed status too.
// Admin-only, fail-closed rate limit (admin.ai.models): the seed is a batch
// write and the probe dials the providers.
const MAX_BODY_BYTES = 16 * 1024;

type HandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  enforceRateLimit: typeof enforceRateLimit;
  listAiModels: typeof listAiModels;
  setAiModelEnabled: typeof setAiModelEnabled;
  ensureAiModelCatalog: typeof ensureAiModelCatalog;
};

export const createAdminAiModelsHandlers = (dependencies: HandlerDependencies) => {
  const loader = async ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      const gate = await dependencies.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
      return json(await dependencies.listAiModels(gate.user));
    });

  const action = async ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
      }

      const gate = await dependencies.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

      // fail-closed: a broken limiter must never let a seed loop hammer writes
      const limit = await dependencies.enforceRateLimit(request, 'admin.ai.models', `user:${gate.user.id}`, { failClosed: true });
      if (!limit.allowed) {
        return json({ ok: false, error: 'Catalog edits are rate-limited — pause for a moment 🌱' }, rateLimitedResponseInit(limit));
      }

      const body: any = await readJsonBody(request, MAX_BODY_BYTES);

      const reprobe = body?.probe === true;

      if (body?.seed === true) {
        const report = await dependencies.ensureAiModelCatalog({ force: true });
        const list = await dependencies.listAiModels(gate.user, { reprobe });
        return json({ ok: true, seeded: report.total, report, models: list.models, defaults: list.defaults, providers: list.providers });
      }

      if (reprobe) {
        const list = await dependencies.listAiModels(gate.user, { reprobe: true });
        return json({ ok: true, probed: true, providers: list.providers, models: list.models, defaults: list.defaults });
      }

      const id = typeof body?.id === 'string' ? body.id.trim() : '';
      if (!id) {
        return json(
          {
            ok: false,
            error: 'id is required (a catalog model id) — or send { seed: true } to re-seed the catalog, { probe: true } to re-check the provider keys'
          },
          { status: 400 }
        );
      }
      if (typeof body?.enabled !== 'boolean') {
        return json({ ok: false, error: 'enabled must be true or false' }, { status: 400 });
      }

      const result = await dependencies.setAiModelEnabled(id, body.enabled);
      if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
      return json({ ok: true, model: result.model, defaults: result.defaults });
    });

  return { loader, action };
};

const handlers = createAdminAiModelsHandlers({ requireAdmin, enforceRateLimit, listAiModels, setAiModelEnabled, ensureAiModelCatalog });

export const loader = handlers.loader;
export const action = handlers.action;
