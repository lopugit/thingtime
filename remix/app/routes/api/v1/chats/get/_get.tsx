import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getChatDetail } from '~/api/utils/messenger/messenger';

// GET /api/v1/chats/get?id=<chatId> — one chat with its full member list
// (profiles, roles, nicknames, read receipts subject to both sides' privacy
// setting) and the owning community's name for the header. Members only.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  const result = await getChatDetail(user.id, id);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
