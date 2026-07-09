import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/getCurrentUser';
import { getMigrationStatus } from '~/api/utils/migrations/migrations';

// GET /api/v1/admin/migrations — per-collection schema-version census plus the
// registered migrations and how many docs each still has to do. Admin-only
// (THINGTIME_PRIVATE_ADMIN_USERNAMES allowlist); non-admins get the same 401
// as logged-out callers.
export const loader = async ({ request }: { request: Request }) => {
  const admin = await requireAdmin(request);
  if (!admin) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const status = await getMigrationStatus();
  return json({ ok: true, collections: status.collections, migrations: status.migrations });
};
