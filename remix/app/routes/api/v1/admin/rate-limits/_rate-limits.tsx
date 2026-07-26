import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { getRateLimitConfig, RATE_LIMIT_DEFAULTS, RATE_LIMIT_ENDPOINTS, setRateLimitConfig } from '~/api/utils/rateLimit/config';

// GET  /api/v1/admin/rate-limits — the current global rate-limit config (admin).
// POST /api/v1/admin/rate-limits — update it: { endpoints: { <name>: { limit, windowMs, enabled } } }.
// Unknown endpoints are ignored and values clamped server-side.

export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const config = await getRateLimitConfig(true);
  return json({ ok: true, config, endpoints: RATE_LIMIT_ENDPOINTS, defaults: RATE_LIMIT_DEFAULTS });
};

export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 64 * 1024);
  const patch = body?.endpoints && typeof body.endpoints === 'object' ? body.endpoints : body;
  const config = await setRateLimitConfig(patch, gate.user.id);
  return json({ ok: true, config, endpoints: RATE_LIMIT_ENDPOINTS, defaults: RATE_LIMIT_DEFAULTS });
};
