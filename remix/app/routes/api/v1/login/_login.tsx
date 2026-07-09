import { json } from '~/api/http';

import { mergeAccountToken } from '~/api/utils/auth/accounts';
import { serializeAccountsCookie } from '~/api/utils/auth/accountsCookie';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { loginUser } from '~/api/utils/auth/loginUser';

// POST /api/v1/login — { username, password }
// On success sets the httpOnly auth cookie and returns the public user. Logging
// in while other accounts are signed in ADDS this account to the switcher
// roster (tt_accounts) and makes it active — it never signs the others out.
export const action = async ({ request }: { request: Request }) => {
  const { username, password } = await request.json().catch(() => ({}));

  const result = await loginUser({ username, password });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }

  const rosterTokens = await mergeAccountToken(request, result.jwt, result.user.id);

  const headers = new Headers();
  headers.append('Set-Cookie', await serializeAuthCookie(result.jwt));
  headers.append('Set-Cookie', await serializeAccountsCookie(rosterTokens));

  return json({ ok: true, user: result.user }, { headers });
};
