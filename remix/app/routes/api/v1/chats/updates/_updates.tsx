import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listChats } from '~/api/utils/messenger/messenger';

// GET /api/v1/chats/updates — the polling endpoint behind the unread badge
// and new-message toasts: chat summaries with unread counts, newest-message
// previews, total unread (muted chats excluded) and the pending-request
// count. Same payload family as /api/v1/chats, tuned for a poll loop —
// clients diff lastMessage ids/timestamps against their previous poll.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = await listChats(user.id);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
