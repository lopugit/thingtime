import { json } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { listAdmins, searchUsersForAdmin } from '~/api/utils/auth/users';

// GET /api/v1/admin/users?q=<query> — for the admin panel. Returns the current
// admins plus (when q is given) matching users to promote/demote. Admin only.
export const loader = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

    const q = new URL(request.url).searchParams.get('q') || '';
    const [snapshot, results] = await Promise.all([
      listAdmins(),
      q.trim() ? searchUsersForAdmin(q, 20) : Promise.resolve([])
    ]);
    return json({ ok: true, ...snapshot, results });
  });
