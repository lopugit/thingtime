import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { findUserByUsername, toPublicProfile, updateUserProfile } from '~/api/utils/auth/users';
import { getSharedTheme } from '~/api/utils/themes/themes';
import { countPublicPosts } from '~/api/utils/things/things';

// GET /api/v1/users/profile?username= — a user's public profile (safe
// projection: never email/verification/storage) + their public post count +
// the theme they're wearing ("wear my theme", claude-todo/10 ✨).
export const loader = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  const username = (params.get('username') || '').trim();
  if (!username) {
    return json({ ok: false, error: 'username is required' }, { status: 400 });
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return json({ ok: false, error: 'User not found' }, { status: 404 });
  }

  const postCount = await countPublicPosts(String(user._id));

  // The worn theme is resolved through the same public gate share links use
  // (getSharedTheme), so a PRIVATE active theme yields null — the raw
  // activeThemeId never rides the public profile payload, and a chip shows
  // iff its ?apply link would resolve for the visitor.
  const activeThemeId = typeof user.meta?.activeThemeId === 'string' ? user.meta.activeThemeId : null;
  const worn = activeThemeId ? await getSharedTheme(activeThemeId) : null;

  return json({
    ok: true,
    profile: toPublicProfile(user),
    postCount,
    wornTheme: worn ? { id: worn.id, name: worn.name } : null
  });
};

// Profile updates may carry small data:image URIs for avatar/banner.
const MAX_BODY_BYTES = 256 * 1024;

// POST /api/v1/users/profile — { displayName?, bio?, avatarUrl?, bannerUrl? }
// — update the caller's own profile fields.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Profile payload too large' }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const result = await updateUserProfile(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, user: result.user });
};
