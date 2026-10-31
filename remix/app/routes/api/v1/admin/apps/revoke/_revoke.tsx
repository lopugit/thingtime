import { json, readJsonBody } from '~/api/http';

import { setAppRevoked } from '~/api/utils/apps/apps';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';

// POST /api/v1/admin/apps/revoke — { clientId, revoked } — suspend or restore
// an app. Suspending sweeps the app's live sessions and the resolveAppToken
// choke point refuses the rest, so access dies immediately; restoring lets
// users re-authorize (swept sessions are not resurrected). Admin only.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const result = await setAppRevoked(body?.clientId, body?.revoked === true, gate.user.id);
  if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
  return json({ ok: true, app: result.app });
};
