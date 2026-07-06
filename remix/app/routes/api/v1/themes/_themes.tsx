import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listThemesForUser, saveTheme } from '~/api/utils/themes/themes';

// GET /api/v1/themes — list the current user's saved themes.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const themes = await listThemesForUser(user.id);
  return json({ ok: true, themes });
};

// Theme docs are small; a resolved token document is ~2KB.
const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/themes — { id?, name, theme, visibility? } — save a theme
// (create, or update when `id` is one of the caller's themes).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Theme payload too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await saveTheme(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, theme: result.theme });
};
