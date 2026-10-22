import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { getSecureFieldsConfig, SECURE_FIELD_DEFAULTS, SECURE_FIELDS, setSecureFieldsConfig } from '~/api/utils/secureFields/config';
import { runMigration } from '~/api/utils/migrations/migrations';

// GET  /api/v1/admin/secure-fields — the current secure-field storage config (admin).
// POST /api/v1/admin/secure-fields — update it: { fields: { email: { secure: boolean } } }.
// Only allowlisted fields are honoured (secure-by-default clamp server-side).
// Every POST also runs the users-email-mirror-sync migration inline so the
// plaintext mirrors on user things immediately match the new config, and
// returns that reconcile report alongside the config.

export const loader = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const config = await getSecureFieldsConfig(true);
  return json({ ok: true, config, fields: SECURE_FIELDS, defaults: SECURE_FIELD_DEFAULTS });
};

export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 64 * 1024);
  const patch = body?.fields && typeof body.fields === 'object' ? body.fields : body;
  const config = await setSecureFieldsConfig(patch, gate.user.id);

  // reconcile mirrors right away — the toggle isn't "done" until existing user
  // things match it (the migration is idempotent and config-driven, so a
  // concurrent/repeat run is harmless)
  const sync = await runMigration('users-email-mirror-sync', { dryRun: false });
  const report = 'report' in sync ? sync.report : null;

  return json({ ok: true, config, fields: SECURE_FIELDS, defaults: SECURE_FIELD_DEFAULTS, report });
};
