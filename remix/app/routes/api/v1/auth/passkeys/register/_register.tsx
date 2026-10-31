import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { finishPasskeyRegistration } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// WebAuthn attestation payloads are small; 64 KiB leaves generous headroom
// without opening a large-body surface.
const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/auth/passkeys/register — { response, nickname?, description? }
// Verifies the attestation from navigator.credentials.create against the
// challenge cookie minted by /register-options and stores the passkey.
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
	if (!body?.response || typeof body.response !== 'object') {
		return json({ ok: false, error: 'Missing WebAuthn response' }, { status: 400 });
	}

	const result = await finishPasskeyRegistration({
		user,
		request,
		response: body.response,
		nickname: body.nickname,
		description: body.description
	});
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}

	const headers = new Headers();
	for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);
	return json({ ok: true, passkey: result.passkey }, { headers });
};
