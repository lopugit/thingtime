import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { audienceSources } from '~/api/utils/groups/groups';

// GET /api/v1/groups/audience-sources — one call feeding the custom-audience
// picker: the caller's friends, connections (following), recently-interacted
// users (owners of things they recently engaged with), and their groups.
// Viewer-private: this is YOUR social context, full session only.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const result = await audienceSources(user.id);
  return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
};
