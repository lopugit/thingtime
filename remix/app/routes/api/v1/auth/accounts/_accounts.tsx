import { json } from '~/api/http';

import { resolveRoster, serializeRosterCookieIfChanged, toPublicAccounts } from '~/api/utils/auth/accounts';

// GET /api/v1/auth/accounts — the account-switcher roster for this browser:
// every signed-in account with `active` marking the tt_auth one. Works without
// an active session (the login screen offers "continue as" from the roster).
// Dead entries (expired / revoked / deleted user) are pruned and the roster
// cookie rewritten in the same response.
export const loader = async ({ request }: { request: Request }) => {
  const roster = await resolveRoster(request);

  const headers = new Headers();
  const rosterCookie = await serializeRosterCookieIfChanged(roster);
  if (rosterCookie) headers.append('Set-Cookie', rosterCookie);

  return json({ ok: true, accounts: toPublicAccounts(roster.accounts) }, { headers });
};
