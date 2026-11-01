import { json, readJsonBody } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { finishPasskeyLogin } from '~/api/utils/auth/passkeys';
import { findAppByClientId } from '~/api/utils/apps/apps';
import { prepareUnboundAttachmentCleanupForSessionReplacement } from '~/api/utils/attachments/attachments';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/auth/passkeys/login — { response, clientId? }
// Verifies the assertion from navigator.credentials.get against the challenge
// cookie from /login-options, then finishes exactly like password login: auth
// cookie set, account merged into the switcher roster (never signing others
// out), cross-deployment hint updated. A passkey is possession + on-device
// user verification, so it bypasses email-OTP 2FA by design. An optional
// clientId records which app the login was for on the passkey's linked apps.
export const action = async ({ request }: { request: Request }) => {
	const limit = await enforceRateLimit(request, 'auth.passkeyLogin', null);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Too many login attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
	}

	const body = await readJsonBody(request, MAX_BODY_BYTES);
	if (!body?.response || typeof body.response !== 'object') {
		return json({ ok: false, error: 'Missing WebAuthn response' }, { status: 400 });
	}

	// Only a registered app becomes a linked-app record; unknown ids are
	// dropped rather than letting callers write arbitrary strings.
	let appContext: { clientId: string; appName: string | null } | null = null;
	if (typeof body.clientId === 'string' && body.clientId.startsWith('ttapp_')) {
		const app = await findAppByClientId(body.clientId).catch(() => null);
		if (app) appContext = { clientId: body.clientId, appName: app.crystal?.name || null };
	}

	const result = await finishPasskeyLogin({ request, response: body.response, appContext });
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}

	// Same outgoing-session cleanup hook as password login: only after the
	// assertion verified, so rejected attempts do no cleanup.
	const outgoingUser = await getCurrentUser(request).catch(() => null);
	if (outgoingUser && outgoingUser.id !== result.user.id) {
		await prepareUnboundAttachmentCleanupForSessionReplacement(outgoingUser.id).catch(() => null);
	}

	const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

	const headers = new Headers();
	headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
	for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);
	for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

	return json({ ok: true, user: result.user, passkeyId: result.passkeyId }, { headers });
};
