import { json } from '~/api/http';

import { removeAccounts } from '~/api/utils/auth/accounts';
import { clearAuthCookie, getAuthToken } from '~/api/utils/auth/authCookie';
import { verifyJwt } from '~/api/utils/auth/jwt';
import { revokeSession } from '~/api/utils/auth/sessions';
import { prepareUnboundAttachmentCleanupForSessionReplacement } from '~/api/utils/attachments/attachments';

// POST /api/v1/auth/logout — body optional: { all?: boolean }
// Signs the ACTIVE account out: revokes its session and drops it from the
// switcher roster. When other accounts remain the next one becomes active and
// is returned as `user`; with none left (or `all: true`, which revokes every
// roster session) both cookies clear and `user` is null — the pre-switcher
// behavior.
export const action = async ({ request }: { request: Request }) => {
  const body = await request.json().catch(() => ({}));
  const all = body?.all === true;

  const token = await getAuthToken(request);
  const claims = token ? await verifyJwt(token) : null;

  if (!claims && !all) {
    // Can't tell which account this was (missing/undecodable token) — just
    // clear the active credential; roster accounts stay signed in.
    return json({ ok: true, user: null }, { headers: { 'Set-Cookie': await clearAuthCookie() } });
  }

	if (claims) {
		await prepareUnboundAttachmentCleanupForSessionReplacement(claims.sub).catch(() => null);
	}

  const result = await removeAccounts(request, all ? { all: true } : { userId: claims!.sub });

  // The roster is cookie-derived, so a Bearer-only credential never appears in
  // it — always revoke the session this request authenticated with directly
  // (idempotent when the roster removal already got it).
  if (claims) await revokeSession(claims.jti);

  const headers = new Headers();
  for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);

  return json({ ok: true, user: result.user, accounts: result.accounts }, { headers });
};
