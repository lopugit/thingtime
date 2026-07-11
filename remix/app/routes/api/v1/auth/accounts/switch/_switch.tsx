import { json, readJsonBody } from '~/api/http';

import { mintAccountToken, persistRosterIfChanged, resolveRoster, toPublicAccounts } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';

// POST /api/v1/auth/accounts/switch — { userId }
// Makes a roster account the active one by minting a fresh JWT for its live
// session into tt_auth. The authorization is possession of the httpOnly
// roster cookie — no password needed to switch.
export const action = async ({ request }: { request: Request }) => {
  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

  const roster = await resolveRoster(request);

  const headers = new Headers();
  for (const cookie of await persistRosterIfChanged(roster)) headers.append('Set-Cookie', cookie);

  const target = roster.accounts.find((account) => account.userId === userId);
  if (!target) {
    // Pruned above if it went stale — the client should refresh its list.
    return json(
      { ok: false, error: 'That account is no longer signed in here', accounts: toPublicAccounts(roster.accounts) },
      { status: 404, headers }
    );
  }

  headers.append('Set-Cookie', await serializeAuthCookie(await mintAccountToken(target)));

  const accounts = roster.accounts.map((account) => ({
    user: account.user,
    active: account.userId === target.userId
  }));

  return json({ ok: true, user: target.user, accounts }, { headers });
};
