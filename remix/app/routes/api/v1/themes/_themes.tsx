import { OwnedListCursorError } from '~/api/utils/ownedListPage';
import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listThemesForUser, listThemesPageForUser, saveTheme } from '~/api/utils/themes/themes';

// GET /api/v1/themes — list the current user's saved themes.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  if (params.has('page') || params.has('cursor')) {
    if (params.get('page') !== '1' || params.getAll('page').length !== 1 || params.getAll('cursor').length > 1) {
      return json({ ok: false, error: 'Invalid owned list page request' }, { status: 400 });
    }
    try {
      const page = await listThemesPageForUser(user.id, params.get('cursor'), request.signal);
      return json({ ok: true, ...page }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      if (error instanceof OwnedListCursorError) return json({ ok: false, error: error.message }, { status: 400 });
      throw error;
    }
  }
  const themes = await listThemesForUser(user.id);
  return json({ ok: true, themes });
};

// POST /api/v1/themes — { id?, name, theme, visibility? } — save a theme
// (create, or update when `id` is one of the caller's themes).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await saveTheme(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, theme: result.theme });
};
