import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { searchYoutubeChannels } from '~/api/utils/connections/connections';

// GET /api/v1/connections/youtube/search?q=… — resolve a channel id, URL,
// @handle, or (with a YouTube Data API key configured) search channels by
// name, for the Thingtime-managed virtual subscription list.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await searchYoutubeChannels(url.searchParams.get('q') || '');
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, channels: result.channels, via: result.via, searchConfigured: result.searchConfigured });
};
