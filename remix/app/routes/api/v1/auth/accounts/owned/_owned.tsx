import { json } from '~/api/http';

import { listAccountLinksForUser } from '~/api/utils/accounts/accountLinks';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { findUserById, toPublicUser } from '~/api/utils/auth/users';

// GET /api/v1/auth/accounts/owned — the accounts the current user OWNS via
// 'account' account-links (admin-assigned). The switcher renders these under
// "Owned accounts"; each can be assumed without credentials via
// POST /api/v1/auth/accounts/assume.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const links = await listAccountLinksForUser(user.id, 'account');
  const docs = await Promise.all(links.map((link) => findUserById(link.targetId)));

  const accounts = docs
    .filter(Boolean)
    .map((doc: any) => toPublicUser(doc))
    .map((pub) => ({
      id: pub.id,
      username: pub.username,
      displayName: pub.displayName,
      avatarUrl: pub.avatarUrl,
      accountKind: pub.accountKind === 'service' ? 'service' : 'user'
    }));

  return json({ ok: true, accounts });
};
