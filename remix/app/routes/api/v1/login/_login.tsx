import { json, readJsonBody } from '~/api/http';

import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { completeOtpLogin, loginUser } from '~/api/utils/auth/loginUser';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/login — { username, password }
// On success sets the httpOnly auth cookie and returns the public user.
// Accounts with email 2FA enabled instead get { requiresOtp: true, challenge }
// and finish login with a second POST: { challenge, code }.
export const action = async ({ request }: { request: Request }) => {
  const body = await readJsonBody(request, MAX_BODY_BYTES);

  const result =
    typeof body?.challenge === 'string' && body.challenge
      ? await completeOtpLogin({ challenge: body.challenge, code: body.code })
      : await loginUser({ username: body?.username, password: body?.password });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  if ('requiresOtp' in result) {
    // no session yet — the emailed code completes the login
    return json({
      ok: true,
      requiresOtp: true,
      challenge: result.challenge,
      expiresAt: result.expiresAt
    });
  }

  return json(
    { ok: true, user: result.user },
    { headers: { 'Set-Cookie': await serializeAuthCookie(result.jwt) } }
  );
};
