import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserAdmin } from '~/api/utils/auth/users';

// POST /api/v1/admin/set-admin — { userId, admin } — promote/demote a user's
// stored admin flag (meta.admin). Admin only. Env-allowlist admins keep access
// regardless, so the returned row's isAdmin may stay true after a demote.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

  const row = await setUserAdmin(userId, body?.admin === true);
  if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
  return json({ ok: true, user: row });
};
