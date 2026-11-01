import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { startPasskeyRegistration } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/passkeys/register-options — { password } → WebAuthn
// creation options + a signed challenge cookie. Adding a passkey mints a
// durable credential, so it re-confirms the current password first (same
// "re-authenticate for sensitive changes" bar as the token minter); the
// browser then runs navigator.credentials.create and POSTs the attestation to
// /api/v1/auth/passkeys/register.
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
	const confirmation = await confirmCurrentPassword(user.id, body?.password);
	if (confirmation === 'unavailable') {
		return json({ ok: false, error: 'This account has no password to confirm — contact support' }, { status: 400 });
	}
	if (confirmation !== 'confirmed') {
		return json({ ok: false, error: 'Wrong password' }, { status: 403 });
	}

	const result = await startPasskeyRegistration(user, request);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}

	const headers = new Headers();
	for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);
	return json({ ok: true, options: result.options }, { headers });
};
