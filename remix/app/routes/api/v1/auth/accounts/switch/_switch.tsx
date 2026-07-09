import { json, readJsonBody } from '~/api/http';

import { resolveRoster, serializeRosterCookieIfChanged, toPublicAccounts } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';

// POST /api/v1/auth/accounts/switch — { userId }
// Makes a roster account the active one by moving its JWT into tt_auth. The
// authorization is possession of that account's live token in the httpOnly
// roster cookie — no password needed to switch.
export const action = async ({ request }: { request: Request }) => {
  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

  const roster = await resolveRoster(request);

  const headers = new Headers();
  const rosterCookie = await serializeRosterCookieIfChanged(roster);
  if (rosterCookie) headers.append('Set-Cookie', rosterCookie);

  const target = roster.accounts.find((account) => account.user.id === userId);
  if (!target) {
    // Pruned above if it went stale — the client should refresh its list.
    return json(
      { ok: false, error: 'That account is no longer signed in here', accounts: toPublicAccounts(roster.accounts) },
      { status: 404, headers }
    );
  }

  headers.append('Set-Cookie', await serializeAuthCookie(target.token));

  const accounts = roster.accounts.map((account) => ({
    user: account.user,
    active: account.user.id === target.user.id
  }));

  return json({ ok: true, user: target.user, accounts }, { headers });
};
