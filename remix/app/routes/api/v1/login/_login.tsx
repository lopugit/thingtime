import { json } from '~/api/http';

import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { loginUser } from '~/api/utils/auth/loginUser';

// POST /api/v1/login — { username, password }
// On success sets the httpOnly auth cookie and returns the public user. Logging
// in while other accounts are signed in ADDS this account to the switcher
// roster (Mongo-backed, unlimited) and makes it active — it never signs the
// others out.
export const action = async ({ request }: { request: Request }) => {
  const { username, password } = await request.json().catch(() => ({}));

  const result = await loginUser({ username, password });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  const rosterCookies = await mergeAccountSession(request, { userId: result.user.id, jti: result.jti });

  const headers = new Headers();
  headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
  for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

  return json({ ok: true, user: result.user }, { headers });
};
