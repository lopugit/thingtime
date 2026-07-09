import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/getCurrentUser';
import { runMigration } from '~/api/utils/migrations/migrations';

// POST /api/v1/admin/migrations/run — { migration: <id>, dryRun? } — run (or
// dry-run) a registered schema-version migration. Admin-only; migrations are
// idempotent so a partial failure is safe to re-run.
export const action = async ({ request }: { request: Request }) => {
  const admin = await requireAdmin(request);
  if (!admin) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body: any = await readJsonBody(request, 64 * 1024);
  const result = await runMigration(body?.migration, { dryRun: body?.dryRun });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, migration: result.migration, report: result.report });
};
