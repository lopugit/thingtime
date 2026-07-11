import { json } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { getMigrationStatus } from '~/api/utils/migrations/migrations';

// GET /api/v1/admin/migrations — per-collection schema-version census plus the
// registered migrations and how many docs each still has to do. Admin-only
// (meta.admin flag or the ADMIN_USERNAMES env allowlist): anonymous callers
// get 401, signed-in non-admins 403.
export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const status = await getMigrationStatus();
  return json({ ok: true, collections: status.collections, migrations: status.migrations });
};
