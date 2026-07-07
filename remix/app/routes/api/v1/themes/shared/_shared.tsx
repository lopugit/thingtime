import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getOwnedTheme, getSharedTheme } from '~/api/utils/themes/themes';

// GET /api/v1/themes/shared?id=<shareId> — public read of a shared theme.
// Anonymous callers only see public themes; owners can fetch their own
// regardless of visibility. Private themes report 404 (not 403) so their
// existence isn't revealed.
export const loader = async ({ request }: { request: Request }) => {
  const id = new URL(request.url).searchParams.get('id') || '';

  let theme = await getSharedTheme(id);
  if (!theme) {
    const user = await getCurrentUser(request);
    if (user) theme = await getOwnedTheme(user.id, id);
  }

  if (!theme) {
    return json({ ok: false, error: 'Theme not found' }, { status: 404 });
  }
  return json({ ok: true, theme });
};
