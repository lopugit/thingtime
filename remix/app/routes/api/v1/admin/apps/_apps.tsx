import { json } from '~/api/http';

import { listAdminAppsOverview } from '~/api/utils/admin/adminDirectory';
import { InvalidAdminSnapshotCursorError } from '~/api/utils/admin/adminSnapshot';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache'
};

// GET /api/v1/admin/apps?q= — every registered app across all users, with
// owner + linked managers, live-grant user counts, storage rollups, tier and
// suspension state. Admin only.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });

  const url = new URL(request.url);
  const requestedLimit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
  try {
    const snapshot = await listAdminAppsOverview(
      url.searchParams.get('q') ?? '',
      requestedLimit,
      url.searchParams.get('cursor')
    );
    return json({ ok: true, ...snapshot }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof InvalidAdminSnapshotCursorError) {
      return json({ ok: false, error: error.message }, { status: 400, headers: privateHeaders });
    }
    throw error;
  }
};
