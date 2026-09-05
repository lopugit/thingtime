import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEmailNotificationTargets } from '../auth/users';
import type { EmailNotificationTarget } from '../auth/users';
import { sendEmail } from '../email/service';
import { renderNotificationEmailTemplate } from '../email/templates';
import { getEmailMessagesCollection } from '../mongodb/collections';
import { normalizeNotificationPrefs, subspaceSlugFromNotificationPreview } from '~/schemas/registry';
import type { NotificationType } from '~/schemas/registry';
import { clampPreview } from './notifications';
import type { EmitNotificationInput } from './notifications';

// Email side of the notification system. Rides the same emit calls as the
// bell but is always fire-and-forget: a slow or failing SES send must never
// block or fail the social action (or even the bell write) that triggered it.
// Gating is recipient-side: email master + per-type switch, verified address
// only, and an hourly per-recipient cap so a pile-on can't flood an inbox.

const MAX_NOTIFICATION_EMAILS_PER_RECIPIENT_PER_HOUR = 10;
const THROTTLE_WINDOW_MS = 60 * 60 * 1000;

// Any stable server secret works as HMAC key material for unsubscribe tokens;
// every deployed config has at least one of the JWT vars set (auth requires
// it), so tokens stay verifiable across restarts and instances.
const getUnsubscribeSecret = () =>
  process.env.THINGTIME_EMAIL_UNSUB_SECRET?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  process.env.JWT_PRIVATE_KEY?.trim() ||
  'dev-insecure-secret-change-me';

export const buildEmailUnsubscribeToken = (userId: string) =>
  createHmac('sha256', getUnsubscribeSecret()).update(`email-unsub:v1:${String(userId)}`).digest('hex');

export const verifyEmailUnsubscribeToken = (userId: string, token: unknown) => {
  const expected = Buffer.from(buildEmailUnsubscribeToken(userId), 'utf8');
  const provided = Buffer.from(typeof token === 'string' ? token : '', 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
};

// Emails are rendered outside any request, so links use the configured APP_URL
// (mirrors registerUser's verification-link fallback chain).
export const notificationEmailOrigin = () =>
  (process.env.APP_URL?.trim() || 'http://localhost:9999').replace(/\/+$/, '');

export const buildEmailUnsubscribeUrl = (userId: string) =>
  `${notificationEmailOrigin()}/api/v1/notifications/email/unsubscribe?uid=${encodeURIComponent(
    String(userId)
  )}&token=${buildEmailUnsubscribeToken(userId)}`;

export const notificationEmailChannelOn = (target: EmailNotificationTarget, type: string) => {
  const prefs = normalizeNotificationPrefs(target.notificationPrefs);
  return prefs.masters.email && prefs.email[type] === true;
};

const recentNotificationEmailCount = async (email: string) => {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
  return (await getEmailMessagesCollection()).countDocuments({
    stream: 'notification',
    to: email.trim().toLowerCase(),
    'metadata.digest': { $ne: true },
    createdAt: { $gte: since }
  });
};

const sendToTarget = async (target: EmailNotificationTarget, input: EmitNotificationInput): Promise<void> => {
  if (!target || !target.email || !target.emailVerified) return;
  if (target.id === input.actor.id) return;
  if (!notificationEmailChannelOn(target, input.type)) return;
  if ((await recentNotificationEmailCount(target.email)) >= MAX_NOTIFICATION_EMAILS_PER_RECIPIENT_PER_HOUR) {
    return;
  }
  const origin = notificationEmailOrigin();
  const actorUsername = input.actor.username || null;
  // subspace-scoped notifications (role/ban/join…) deep-link to the subspace
  // — the slug rides at the head of the preview (registry.ts)
  const subspaceSlug = input.type.startsWith('subspace-') && !input.postId ? subspaceSlugFromNotificationPreview(input.preview) : null;
  const ctaUrl = input.postId
    ? `${origin}/post/${encodeURIComponent(String(input.postId))}`
    : subspaceSlug
      ? `${origin}/s/${encodeURIComponent(subspaceSlug)}`
      : actorUsername
        ? `${origin}/profile/${encodeURIComponent(actorUsername)}`
        : origin;
  const ctaLabel = input.postId ? 'Open the post' : subspaceSlug ? `Open s/${subspaceSlug}` : actorUsername ? `View @${actorUsername}` : 'Open Thingtime';
  const rendered = renderNotificationEmailTemplate({
    type: input.type,
    actorName: input.actor.displayName || input.actor.username || null,
    preview: clampPreview(input.preview),
    ctaUrl,
    ctaLabel,
    settingsUrl: `${origin}/settings`,
    unsubscribeUrl: buildEmailUnsubscribeUrl(target.id)
  });
  await sendEmail({
    to: target.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    stream: 'notification',
    templateKey: `notification.${input.type}`,
    metadata: {
      purpose: 'notification',
      notificationType: input.type,
      recipientId: target.id,
      actorId: input.actor.id
    },
    tags: { stream: 'notification', template: `notification.${input.type}` }
  });
};

// Single-recipient email. Never throws — callers fire-and-forget.
export const maybeEmailNotification = async (input: EmitNotificationInput): Promise<void> => {
  try {
    if (!input.recipientId || input.recipientId === input.actor.id) return;
    const [target] = await getEmailNotificationTargets([input.recipientId]);
    if (!target) return;
    await sendToTarget(target, input);
  } catch (err: any) {
    console.error('[notifications] email send failed:', err?.message || err);
  }
};

// Fan-out email pass (posts to followers/friends). One batched candidate load,
// then per-recipient gating — post types default OFF, so this usually sends to
// the few people who explicitly opted in. Never throws.
export const emailNotificationsBulk = async (
  recipients: Array<{ recipientId: string; type: NotificationType }>,
  base: Omit<EmitNotificationInput, 'recipientId' | 'type'>
): Promise<void> => {
  try {
    if (!recipients.length) return;
    const typeById = new Map(recipients.map((r) => [String(r.recipientId), r.type]));
    const targets = await getEmailNotificationTargets(recipients.map((r) => r.recipientId));
    for (const target of targets) {
      const type = typeById.get(target.id);
      if (!type) continue;
      await sendToTarget(target, { ...base, recipientId: target.id, type });
    }
  } catch (err: any) {
    console.error('[notifications] bulk email send failed:', err?.message || err);
  }
};
