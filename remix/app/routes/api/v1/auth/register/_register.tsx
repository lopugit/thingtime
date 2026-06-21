import { json } from '@vercel/remix';

import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
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

  // Surface the link anywhere that isn't real production (local + Vercel
  // preview) so you can verify without real email sending. Vercel runs preview
  // deploys with NODE_ENV=production, so check VERCEL_ENV too.
  const showLink = process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV !== 'production';

  return json(
    {
      ok: true,
      user: result.user,
      verificationLink: showLink ? result.verificationLink : undefined
    },
    { headers: { 'Set-Cookie': await serializeAuthCookie(result.jwt) } }
  );
};
