import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { migrationFailureResult } from '~/api/utils/migrations/migrationFailure';
import { runMigration } from '~/api/utils/migrations/migrations';

// POST /api/v1/admin/migrations/run — { migration: <id>, dryRun?, confirm? } —
// run (or dry-run) a registered schema-version migration. Admin-only;
// migrations are idempotent so a partial failure is safe to re-run.
// Destructive migrations (collection drops) additionally require
// confirm: true on the non-dry run.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body: any = await readJsonBody(request, 64 * 1024);
  // runMigration normally returns a structured failure. This final boundary
  // also catches lease-release or other orchestration errors so Nitro never
  // replaces useful context with its `{ error: true, unhandled: true }` shape.
  const result = await runMigration(body?.migration, { dryRun: body?.dryRun, confirm: body?.confirm }).catch((error) =>
    migrationFailureResult(body?.migration, error)
  );

  if (result.ok === false) {
    return json(
      {
        ok: false,
        error: result.error,
        ...('outcome' in result ? { outcome: result.outcome } : {})
      },
      { status: result.status }
    );
  }
  return json({ ok: true, migration: result.migration, report: result.report });
};
