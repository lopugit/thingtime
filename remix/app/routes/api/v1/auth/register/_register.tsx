import { json } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { registerUser } from '~/api/utils/auth/registerUser';

// POST /api/v1/auth/register — { username, password, email, displayName?, meta? }
// On success: creates the user, logs them in (sets the httpOnly auth cookie),
// and kicks off email verification. emailVerified starts false. Registering
// while other accounts are signed in ADDS the new account to the switcher
// roster (Mongo-backed, unlimited) and makes it active — it never signs the
// others out.
export const action = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;

  const result = await registerUser({ ...body, origin });

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
