import { json, readJsonBody } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { completeOtpLogin, loginUser } from '~/api/utils/auth/loginUser';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { prepareUnboundAttachmentCleanupForSessionReplacement } from '~/api/utils/attachments/attachments';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/login — { username, password }, or { challenge, code } to finish
// an email-2FA login.
// On success sets the httpOnly auth cookie and returns the public user. Logging
// in while other accounts are signed in ADDS this account to the switcher
// roster (Mongo-backed, unlimited) and makes it active — it never signs the
// others out. Accounts with email 2FA enabled get { requiresOtp: true,
// challenge, expiresAt } from the password step instead of a session — no
// cookies are set until the emailed code completes the second step.
export const action = async ({ request }: { request: Request }) => {
  // bounds credential stuffing AND otp-email sends (the 2FA branch emails a
  // code on every password-valid attempt); keyed by IP — there's no user yet
  const limit = await enforceRateLimit(request, 'auth.login', null);
  if (!limit.allowed) {
		return json({ ok: false, error: 'Too many login attempts — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, MAX_BODY_BYTES);

  const result =
    typeof body?.challenge === 'string' && body.challenge
      ? await completeOtpLogin({ challenge: body.challenge, code: body.code })
      : await loginUser({ username: body?.username, password: body?.password });

  if (result.ok === false) {
    // Propagate the stable OTP failure reason (when present) so the client can
    // decide whether to abandon the 2FA challenge without matching error copy.
    return json({ ok: false, error: result.error, reason: result.reason }, { status: result.status });
  }

  if ('requiresOtp' in result) {
    // no session yet — the emailed code completes the login
    return json({ ok: true, requiresOtp: true, challenge: result.challenge, expiresAt: result.expiresAt });
  }

	// The request still carries the outgoing browser cookie here. Capture it
	// only after credentials/OTP succeeded, so rejected attempts do no cleanup.
	const outgoingUser = await getCurrentUser(request).catch(() => null);
	if (outgoingUser && outgoingUser.id !== result.user.id) {
		await prepareUnboundAttachmentCleanupForSessionReplacement(outgoingUser.id).catch(() => null);
	}

  const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

  const headers = new Headers();
  headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
  for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

  return json({ ok: true, user: result.user }, { headers });
};
