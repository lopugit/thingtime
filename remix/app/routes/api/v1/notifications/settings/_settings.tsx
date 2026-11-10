import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserNotificationPrefs, setUserNotificationPrefs } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { EMAIL_NOTIFICATION_TYPES, NOTIFICATION_TYPES, normalizeNotificationPrefs } from '~/schemas/registry';

// The wire shape always carries the full channel matrix (every push type,
// every email type, both masters) so the client never has to guess defaults.
// normalizeNotificationPrefs is the single source of what absent keys mean —
// notably the two high-volume post types default OFF on email.
const fullPrefs = (stored: Record<string, any>) => normalizeNotificationPrefs(stored);

const MASTER_KEYS = ['push', 'email'] as const;

// GET /api/v1/notifications/settings — the caller's notification switches as
// a per-channel matrix: push (the bell/in-app channel), email (SES-backed
// notification emails, including the email-only weekly-summary), and the two
// channel master switches.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return json({ ok: true, prefs: fullPrefs(await getUserNotificationPrefs(user.id)) });
};

type ChannelPatch = Record<string, boolean>;

const parseChannelPatch = (
  input: unknown,
  allowed: readonly string[],
  channel: string
): { ok: true; patch: ChannelPatch } | { ok: false; error: string } => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `prefs.${channel} must be an object of { type: boolean }` };
  }
  const patch: ChannelPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) {
      return { ok: false, error: `Unknown ${channel} key: ${key.slice(0, 40)}` };
    }
    if (typeof value !== 'boolean') {
      return { ok: false, error: `${channel}.${key} must be true or false` };
    }
    patch[key] = value;
  }
  return { ok: true, patch };
};

// POST /api/v1/notifications/settings — merge-patch the switches. New shape:
// { prefs: { push?: { [type]: bool }, email?: { [type]: bool },
//   masters?: { push?: bool, email?: bool } } }. The original flat shape
// ({ prefs: { [type]: bool } }) still works and patches the push channel, so
// pre-channel clients keep functioning. Unknown keys 400 so typos never
// silently persist.
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
    return json({ ok: false, error: 'prefs must be an object' }, { status: 400 });
  }

  // Storage patch: flat boolean keys = push channel (the original shape),
  // nested objects under 'email' / 'masters' merge one level deep.
  const patch: Record<string, boolean | ChannelPatch> = {};

  const legacyFlat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'push' || key === 'email' || key === 'masters') continue;
    legacyFlat[key] = value;
  }

  const pushInput =
    (input as any).push !== undefined
      ? (input as any).push
      : Object.keys(legacyFlat).length
        ? legacyFlat
        : undefined;
  if ((input as any).push !== undefined && Object.keys(legacyFlat).length) {
    return json({ ok: false, error: 'Send either the flat legacy shape or channel objects, not both' }, { status: 400 });
  }

  if (pushInput !== undefined) {
    const parsed = parseChannelPatch(pushInput, NOTIFICATION_TYPES, 'push');
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: 400 });
    Object.assign(patch, parsed.patch);
  }
  if ((input as any).email !== undefined) {
    const parsed = parseChannelPatch((input as any).email, EMAIL_NOTIFICATION_TYPES, 'email');
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: 400 });
    if (Object.keys(parsed.patch).length) patch.email = parsed.patch;
  }
  if ((input as any).masters !== undefined) {
    const parsed = parseChannelPatch((input as any).masters, MASTER_KEYS, 'masters');
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: 400 });
    if (Object.keys(parsed.patch).length) patch.masters = parsed.patch;
  }

  if (!Object.keys(patch).length) {
    return json({ ok: false, error: 'prefs is empty' }, { status: 400 });
  }

  await setUserNotificationPrefs(user.id, patch);
  return json({ ok: true, prefs: fullPrefs(await getUserNotificationPrefs(user.id)) });
};
