import { json } from '~/api/http';

import { startPasskeyLogin } from '~/api/utils/auth/passkeys';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/auth/passkeys/login-options — WebAuthn request options + a
// signed challenge cookie. No body, no auth, no username: login is
// discoverable-credential only (empty allowCredentials), which is also what
// feeds the browser's conditional-UI autofill (iCloud Keychain / 1Password
// suggest a passkey directly on the login form's username field).
export const action = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'auth.passkeyOptions', null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const result = await startPasskeyLogin(request);
	const headers = new Headers();
	for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);
	return json({ ok: true, options: result.options }, { headers });
};
