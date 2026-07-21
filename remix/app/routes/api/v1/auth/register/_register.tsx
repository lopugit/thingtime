import { json, readJsonBody } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { registerUser } from '~/api/utils/auth/registerUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/register — { username, password, email, displayName? }
// On success: creates the user, logs them in (sets the httpOnly auth cookie),
// and kicks off email verification. emailVerified starts false. Registering
// while other accounts are signed in ADDS the new account to the switcher
// roster (Mongo-backed, unlimited) and makes it active — it never signs the
// others out.
//
// SECURITY: whitelist fields — never spread the raw body. `meta` (which holds
// meta.admin, storage flags, etc.) must NOT be settable by a public signup, or
// a caller could mass-assign themselves admin. Legit meta is set later via its
// own authenticated endpoints.
export const action = async ({ request }: { request: Request }) => {
  // Each signup costs a bcrypt hash + a verification email before any auth
  // exists — throttle by IP ahead of the body read, like login/password-reset.
  const limit = await enforceRateLimit(request, 'auth.register', null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many signups from here — try again soon 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const origin = resolveTrustedOrigin(request);

  // (Env-allowlist admin usernames are reserved in createUserAccount — the
  // single chokepoint covering this route, service-account, and seeding.)
  const result = await registerUser({
    username: body?.username,
    password: body?.password,
    email: body?.email,
    displayName: body?.displayName,
    origin
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  // Surface the link only in local + Vercel preview so production never returns
  // raw verification tokens to the browser.
  const showLink = shouldShowDevVerificationLink();

  const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

  const headers = new Headers();
  headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
  for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

  return json(
    {
      ok: true,
      user: result.user,
      verificationLink: showLink ? result.verificationLink : undefined
    },
    { headers }
  );
};
