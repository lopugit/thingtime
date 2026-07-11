import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { listAdmins, searchUsersForAdmin } from '~/api/utils/auth/users';

// GET /api/v1/admin/users?q=<query> — for the admin panel. Returns the current
// admins plus (when q is given) matching users to promote/demote. Admin only.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const q = new URL(request.url).searchParams.get('q') || '';
  const [admins, results] = await Promise.all([listAdmins(), q.trim() ? searchUsersForAdmin(q, 20) : Promise.resolve([])]);
  return json({ ok: true, admins, results });
};
