import { json, readJsonBody } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { captureMigrationFailureDiagnostic, migrationFailureResult } from '~/api/utils/migrations/migrationFailure';
import { createMigrationDiagnostic, formatMigrationDiagnosticDetail } from '~/api/utils/migrations/migrationDiagnostics';
import { runMigration } from '~/api/utils/migrations/migrations';

// POST /api/v1/admin/migrations/run — { migration: <id>, dryRun?, confirm? } —
// run (or dry-run) a registered schema-version migration. Admin-only;
// migrations are idempotent so a partial failure is safe to re-run.
// Destructive migrations (collection drops) additionally require
// confirm: true on the non-dry run.
export const action = async ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body: any = await readJsonBody(request, 64 * 1024);
		const dryRun = body?.dryRun === true || body?.dryRun === 'true';
  // runMigration normally returns a structured failure. This final boundary
  // also catches lease-release or other orchestration errors so Nitro never
  // replaces useful context with its `{ error: true, unhandled: true }` shape.
  const result = await runMigration(body?.migration, { dryRun: body?.dryRun, confirm: body?.confirm }).catch((error) =>
    migrationFailureResult(body?.migration, error, dryRun ? 'rejected' : 'unknown')
  );

  if (result.ok === false) {
			let diagnosticThingId: string | undefined;
			let adminDetail: string | undefined;
			const diagnostic = 'outcome' in result ? captureMigrationFailureDiagnostic(result) : null;
			if ('outcome' in result && diagnostic) {
				if (!dryRun) {
					const stored = await createMigrationDiagnostic({
						ownerId: gate.user.id,
						migrationId: body?.migration,
						status: result.status,
						outcome: result.outcome,
						summary: result.error,
						diagnostic
					});
					if (stored.ok) diagnosticThingId = stored.id;
				}
				if (!diagnosticThingId) {
					adminDetail = formatMigrationDiagnosticDetail({
						migrationId: body?.migration,
						mode: dryRun ? 'dry run' : 'run',
						status: result.status,
						outcome: result.outcome,
						summary: result.error,
						diagnostic
					});
				}
			}
    return json(
      {
        ok: false,
        error: result.error,
					...('outcome' in result ? { outcome: result.outcome } : {}),
					...(diagnosticThingId ? { diagnosticThingId } : {}),
					...(adminDetail ? { adminDetail } : {})
      },
      { status: result.status }
    );
  }
  return json({ ok: true, migration: result.migration, report: result.report });
	});
