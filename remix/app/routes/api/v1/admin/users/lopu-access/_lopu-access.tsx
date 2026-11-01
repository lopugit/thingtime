import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserLopuVerified } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/admin/users/lopu-access — { userId, verified } — verify (or
// un-verify) a user's Lopu access (meta.lopuVerified, mirrored by
// meta.lopuVerifiedAt / meta.lopuVerifiedBy). Lopu is invite-only while the
// Thingtime.LopuAccess singleton says requireVerification, and new accounts
// start unverified, so this is the manual step an admin performs from Admin →
// Lopu accounts (the sibling of admin/users/public-uploads). Admin only,
// JSON-only, admin.users.lopu-access fail-closed.
const MAX_BODY_BYTES = 16 * 1024;

export type AdminLopuAccessHandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  enforceRateLimit: typeof enforceRateLimit;
  setUserLopuVerified: typeof setUserLopuVerified;
};

export const createAdminLopuAccessHandlers = (dependencies: AdminLopuAccessHandlerDependencies) => {
  const action = ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
      const gate = await dependencies.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
      const unsupported = requireJsonContentType(request);
      if (unsupported) return unsupported;

      const limit = await dependencies.enforceRateLimit(request, 'admin.users.lopu-access', `user:${gate.user.id}`, { failClosed: true });
      if (!limit.allowed) return json({ ok: false, error: 'Lopu access changes are rate limited — pause for a moment' }, rateLimitedResponseInit(limit));

      const body = await readJsonBody(request, MAX_BODY_BYTES);
      const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
      if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });
      if (typeof body?.verified !== 'boolean') return json({ ok: false, error: 'verified must be a boolean' }, { status: 400 });

      const row = await dependencies.setUserLopuVerified(userId, body.verified, gate.user.id);
      if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
      return json({ ok: true, user: row });
    });

  return { action };
};

const handlers = createAdminLopuAccessHandlers({ requireAdmin, enforceRateLimit, setUserLopuVerified });

export const action = handlers.action;
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
