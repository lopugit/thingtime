import { json } from '~/api/http';

import { persistRosterIfChanged, resolveRoster, toPublicAccounts } from '~/api/utils/auth/accounts';

// GET /api/v1/auth/accounts — the account-switcher roster for this browser:
// every signed-in account with `active` marking the tt_auth one. Works without
// an active session (the login screen offers "continue as" from the roster).
// Dead entries (expired / revoked / deleted user) are pruned and the Mongo
// roster doc + cookie updated in the same response.
export const loader = async ({ request }: { request: Request }) => {
  const roster = await resolveRoster(request);

  const headers = new Headers();
  for (const cookie of await persistRosterIfChanged(roster)) headers.append('Set-Cookie', cookie);

  return json({ ok: true, accounts: toPublicAccounts(roster.accounts) }, { headers });
};
