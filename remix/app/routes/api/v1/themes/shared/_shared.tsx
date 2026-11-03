import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getOwnedTheme, getSharedTheme, listPublicThemes, MAX_GALLERY_THEMES } from '~/api/utils/themes/themes';

// GET /api/v1/themes/shared?id=<shareId> — public read of a shared theme.
// Anonymous callers only see public themes; owners can fetch their own
// regardless of visibility. Private themes report 404 (not 403) so their
// existence isn't revealed.
//
// GET /api/v1/themes/shared (no id) — the public theme gallery list: every
// public theme, newest-updated first, capped at MAX_GALLERY_THEMES (optional
// ?limit=<n> lowers it). A theme is listed iff its share link would resolve.
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';

  if (!id) {
    // Throttled like the other anonymous browse endpoints (schemas.browse,
    // users.search): the single-theme read costs one document, but one gallery
    // call is two indexed reads returning up to MAX_GALLERY_THEMES whole token
    // documents — generous but bounded, and free to hammer otherwise.
    // Keyed by IP for EVERY caller on purpose: nothing in the list depends on
    // who is asking, so resolving a session here would add a lookup this
    // branch never otherwise makes.
    const throttle = await enforceRateLimit(request, 'themes.gallery', null);
    if (!throttle.allowed) {
      return json(
        { ok: false, error: 'You’re browsing very enthusiastically — take a breather 🌸' },
        rateLimitedResponseInit(throttle)
      );
    }
    const limit = Number(url.searchParams.get('limit')) || MAX_GALLERY_THEMES;
    const themes = await listPublicThemes(limit);
    return json({ ok: true, themes });
  }

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
