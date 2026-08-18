import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserUploadPermission, type UploadPermissionKind } from '~/api/utils/auth/users';

const VALID_KINDS: readonly UploadPermissionKind[] = ['public', 'private', 'all'];

// POST /api/v1/admin/set-upload-permission — { userId, kind, enabled } — grant
// or withhold a user's public/private/all file-and-media upload permission.
// Admin only. New signups start with public + private withheld pending review
// (see registerUser.ts); this is how an admin manually approves them.
export const action = async ({ request }: { request: Request }) => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

  const kind = body?.kind;
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as UploadPermissionKind)) {
    return json({ ok: false, error: 'kind must be one of: public, private, all' }, { status: 400 });
  }

  const row = await setUserUploadPermission(userId, kind as UploadPermissionKind, body?.enabled === true);
  if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
  return json({ ok: true, user: row });
};
