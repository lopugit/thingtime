import { json } from '~/api/http';

import { listAdminUsersOverview } from '~/api/utils/admin/adminDirectory';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';

// GET /api/v1/admin/users/overview?q= — the /admin Users tab: each matching
// user with subscription tier, effective quotas, storage usage, and app/PAT/
// link counts. Admin only. (The lighter /api/v1/admin/users powers the
// promote/demote flow and stays unchanged.)
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const url = new URL(request.url);
  const users = await listAdminUsersOverview(url.searchParams.get('q') ?? '');
  return json({ ok: true, users });
};
