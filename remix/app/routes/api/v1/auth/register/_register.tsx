import { json } from '@vercel/remix';

import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { registerUser } from '~/api/utils/auth/registerUser';

// POST /api/v1/auth/register — { username, password, email, displayName?, meta? }
// On success: creates the user, logs them in (sets the httpOnly auth cookie),
// and kicks off email verification. emailVerified starts false.
export const action = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const origin = new URL(request.url).origin;

  const result = await registerUser({ ...body, origin });

  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  // Surface the link only in local + Vercel preview so production never returns
  // raw verification tokens to the browser.
  const showLink = shouldShowDevVerificationLink();

  return json(
    {
      ok: true,
      user: result.user,
      verificationLink: showLink ? result.verificationLink : undefined
    },
    { headers: { 'Set-Cookie': await serializeAuthCookie(result.jwt) } }
  );
};
