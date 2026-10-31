import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updatePasskey } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/passkeys/update — { id, nickname?, description? }
// Rename/annotate one of the session user's passkeys. Metadata only — no
// password confirmation needed (unlike revoke/delete, nothing here changes
// what the credential can do).
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	const limit = await enforceRateLimit(request, 'auth.passkeyManage', user.id);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many passkey attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	if (typeof body?.id !== 'string' || !body.id) {
		return json({ ok: false, error: 'id is required' }, { status: 400 });
	}
	if (body.nickname === undefined && body.description === undefined) {
		return json({ ok: false, error: 'Nothing to update — send nickname and/or description' }, { status: 400 });
	}

	const result = await updatePasskey(user.id, body.id, { nickname: body.nickname, description: body.description });
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json({ ok: true, passkey: result.passkey });
};
