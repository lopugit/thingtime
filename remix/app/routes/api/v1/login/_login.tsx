import { json } from '@vercel/remix';

import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { loginUser } from '~/api/utils/auth/loginUser';

// POST /api/v1/login — { username, password }
// On success sets the httpOnly auth cookie and returns the public user.
export const action = async ({ request }: { request: Request }) => {
  const { username, password } = await request.json().catch(() => ({}));

  const result = await loginUser({ username, password });
  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  return json(
    { ok: true, user: result.user },
    { headers: { 'Set-Cookie': await serializeAuthCookie(result.jwt) } }
  );
};
