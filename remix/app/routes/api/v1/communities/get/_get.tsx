import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getCommunityDetail } from '~/api/utils/messenger/communities';
import { listCommunityChannels } from '~/api/utils/messenger/channels';

// GET /api/v1/communities/get?id=<communityId> — one community with sections,
// the member roster (first page + count), the caller's role, and its channel
// directory: channels the caller is in plus public ones they could join.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  const result = await getCommunityDetail(user.id, id);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  const channels = await listCommunityChannels(user.id, result.community.id);
  return json({ ...result, channels: channels.ok ? channels.channels : [] });
};
