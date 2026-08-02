import { json } from '~/api/http';

import { listAdminAppsOverview } from '~/api/utils/admin/adminDirectory';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';

// GET /api/v1/admin/apps?q= — every registered app across all users, with
// owner + linked managers, live-grant user counts, storage rollups, tier and
// suspension state. Admin only.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const url = new URL(request.url);
  const apps = await listAdminAppsOverview(url.searchParams.get('q') ?? '');
  return json({ ok: true, apps });
};
