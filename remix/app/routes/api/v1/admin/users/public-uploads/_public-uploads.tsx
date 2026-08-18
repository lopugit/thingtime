import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserPublicUploads } from '~/api/utils/auth/users';

// POST /api/v1/admin/users/public-uploads — { userId, enabled } — grant or
// withhold a user's public file/media upload permission (meta.publicUploads).
// New signups start withheld, so this is the manual approval step an admin
// performs after the "new user" notification email. Admin only.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });
  if (typeof body?.enabled !== 'boolean') return json({ ok: false, error: 'enabled must be a boolean' }, { status: 400 });

  const row = await setUserPublicUploads(userId, body.enabled);
  if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
  return json({ ok: true, user: row });
};

export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
