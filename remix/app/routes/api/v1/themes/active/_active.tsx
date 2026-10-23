import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { setUserActiveTheme } from '~/api/utils/auth/users';
import { getOwnedTheme, getSharedTheme } from '~/api/utils/themes/themes';

// POST /api/v1/themes/active — { themeId: string | null } — set (or clear)
// the current user's active theme so it follows them across devices.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const themeId = body?.themeId ?? null;

  if (themeId !== null) {
    if (typeof themeId !== 'string' || !themeId.trim()) {
      return json({ ok: false, error: 'themeId must be a string or null' }, { status: 400 });
    }
    const theme = (await getOwnedTheme(user.id, themeId)) || (await getSharedTheme(themeId));
    if (!theme) {
      return json({ ok: false, error: 'Theme not found' }, { status: 404 });
    }
  }

  await setUserActiveTheme(user.id, themeId === null ? null : themeId.trim());
  return json({ ok: true, activeThemeId: themeId === null ? null : themeId.trim() });
};
