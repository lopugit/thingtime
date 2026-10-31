import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { deletePasskey } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/passkeys/delete — { id, password }
// Removes a REVOKED passkey (and its linked-app records) for good. The
// revoke-first requirement keeps "working credential" → "gone" a two-step
// path, and deletion frees the authenticator to register a fresh passkey.
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

	const confirmation = await confirmCurrentPassword(user.id, body?.password);
	if (confirmation === 'unavailable') {
		return json({ ok: false, error: 'This account has no password to confirm — contact support' }, { status: 400 });
	}
	if (confirmation !== 'confirmed') {
		return json({ ok: false, error: 'Wrong password' }, { status: 403 });
	}

	const result = await deletePasskey(user.id, body.id);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json({ ok: true });
};
