import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserNotificationPrefs, setUserNotificationPrefs } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { NOTIFICATION_TYPES } from '~/schemas/registry';

// Absent key = enabled: the wire shape always carries every known type so the
// client never has to guess defaults.
const fullPrefs = (stored: Record<string, boolean>): Record<string, boolean> => {
  const prefs: Record<string, boolean> = {};
  for (const type of NOTIFICATION_TYPES) prefs[type] = stored[type] !== false;
  return prefs;
};

// GET /api/v1/notifications/settings — the caller's per-type notification
// switches (friend requests, new followers, posts from followed/friends,
// comments, replies, reactions, shares, groups). Defaults ON.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return json({ ok: true, prefs: fullPrefs(await getUserNotificationPrefs(user.id)) });
};

// POST /api/v1/notifications/settings — { prefs: { [type]: boolean } } —
// merge-patch the switches (only the keys sent change). Unknown types 400 so
// typos never silently persist.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'notifications.settings', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Flipping switches very fast — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 16 * 1024);
  const input = body?.prefs;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ ok: false, error: 'prefs must be an object of { type: boolean }' }, { status: 400 });
  }
  const patch: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(key)) {
      return json({ ok: false, error: `Unknown notification type: ${key.slice(0, 40)}` }, { status: 400 });
    }
    if (typeof value !== 'boolean') {
      return json({ ok: false, error: `${key} must be true or false` }, { status: 400 });
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    return json({ ok: false, error: 'prefs is empty' }, { status: 400 });
  }

  await setUserNotificationPrefs(user.id, patch);
  return json({ ok: true, prefs: fullPrefs(await getUserNotificationPrefs(user.id)) });
};
