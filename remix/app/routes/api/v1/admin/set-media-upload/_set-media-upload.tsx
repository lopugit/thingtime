import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { setUserMediaUpload } from '~/api/utils/auth/users';

// POST /api/v1/admin/set-media-upload — { userId, granted } — grant/revoke a
// user's media-upload permission (meta.mediaUpload). Admin only. Admins keep
// upload access regardless of the stored flag (canUploadMedia ORs isAdmin),
// so revoking an admin's grant doesn't block them.
export const action = async ({ request }: { request: Request }) => {
	const gate = await requireAdmin(request);
	if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

	const body = await readJsonBody(request, 16 * 1024);
	const userId = typeof body?.userId === 'string' ? body.userId : '';
	if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

	const row = await setUserMediaUpload(userId, body?.granted === true);
	if (!row) return json({ ok: false, error: 'User not found' }, { status: 404 });
	return json({ ok: true, user: row });
};
