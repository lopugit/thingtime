import { json, readJsonBody } from '~/api/http';

import { removeAccounts } from '~/api/utils/auth/accounts';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { prepareUnboundAttachmentCleanupForSessionReplacement } from '~/api/utils/attachments/attachments';

// POST /api/v1/auth/accounts/remove — { userId }
// Signs one account out of the switcher: revokes its session and drops it from
// the roster. Removing the ACTIVE account falls through to the next roster
// account (response carries the new active user); removing the last account
// signs the browser out entirely (user: null).
export const action = async ({ request }: { request: Request }) => {
  const body = await readJsonBody(request, 16 * 1024);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return json({ ok: false, error: 'userId is required' }, { status: 400 });

	// Removing an inactive roster entry leaves the active composer untouched.
	// Only an actual active-session replacement cleans that owner's drafts.
	const outgoingUser = await getCurrentUser(request).catch(() => null);
	if (outgoingUser?.id === userId) {
		await prepareUnboundAttachmentCleanupForSessionReplacement(outgoingUser.id).catch(() => null);
	}

  const result = await removeAccounts(request, { userId });

  const headers = new Headers();
  for (const cookie of result.setCookies) headers.append('Set-Cookie', cookie);

  return json({ ok: true, user: result.user, accounts: result.accounts }, { headers });
};
