import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listPasskeys } from '~/api/utils/auth/passkeys';

// GET /api/v1/auth/passkeys — the session user's passkeys with their linked
// apps aggregated on (one query per kind). Never exposes credential material.
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}
	return json({ ok: true, passkeys: await listPasskeys(user.id) });
};
