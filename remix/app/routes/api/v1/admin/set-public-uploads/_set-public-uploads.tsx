import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserPublicUploads } from '~/api/utils/auth/users';

// POST /api/v1/admin/set-public-uploads — { userId, enabled } — enable/disable
// a user's public file/media upload permission (meta.publicUploadsEnabled).
// Admin only. New signups start disabled; email verification never enables it.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

  const row = await setUserPublicUploads(userId, body?.enabled === true);
  if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
  return json({ ok: true, user: row });
};
