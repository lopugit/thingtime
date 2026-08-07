import { json, readJsonBody } from '~/api/http';

import { userOwnsLinkedAccount } from '~/api/utils/accounts/accountLinks';
import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { signJwt } from '~/api/utils/auth/jwt';
import { createSession } from '~/api/utils/auth/sessions';
import { findUserById, toPublicUserWithStorage } from '~/api/utils/auth/users';

const ASSUME_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d, same as login

// POST /api/v1/auth/accounts/assume — { accountId }
// Sign into an account you OWN via an 'account' account-link (assigned by an
// admin) without its credentials: mints a fresh browser session for the
// target, folds it into this browser's roster (the switcher picks it up), and
// makes it the active account. Authorization is the server-side link — the
// roster's cookie-fixation gate is never widened (accounts.ts:20).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = await readJsonBody(request, 16 * 1024);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  if (!accountId) return json({ ok: false, error: 'accountId is required' }, { status: 400 });

  if (!(await userOwnsLinkedAccount(user.id, accountId))) {
    return json({ ok: false, error: 'You are not an owner of that account' }, { status: 403 });
  }

  const target = await findUserById(accountId);
  if (!target) return json({ ok: false, error: 'Account not found' }, { status: 404 });

  // A fresh session per assume (per browser): mergeAccountSession only ever
  // revokes the session this roster previously held for the same user, so
  // owners in other browsers are never signed out.
  const session = await createSession(accountId, {
    purpose: 'browser',
    expiresAt: new Date(Date.now() + ASSUME_SESSION_TTL_MS),
    meta: { ownedBy: user.id, createdVia: 'account-link' }
  });

  const headers = new Headers();
  for (const cookie of await mergeAccountSession(request, { userId: accountId, jti: session.jti })) {
    headers.append('Set-Cookie', cookie);
  }
  headers.append('Set-Cookie', await serializeAuthCookie(await signJwt({ sub: accountId, jti: session.jti })));

	return json({ ok: true, user: await toPublicUserWithStorage(target) }, { headers });
};
