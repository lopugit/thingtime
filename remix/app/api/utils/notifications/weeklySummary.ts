import { getEmailNotificationTargets } from '../auth/users';
import { sendEmail } from '../email/service';
import { renderWeeklySummaryTemplate } from '../email/templates';
import {
  getEmailMessagesCollection,
  getHomeThingsCollection as getThingsCollection,
  getPostViewsCollection,
  getUsersCollection
} from '../mongodb/collections';

import { buildEmailUnsubscribeUrl, notificationEmailChannelOn, notificationEmailOrigin } from './emails';

// Weekly summary digest: one email per opted-in user recapping the last seven
// days around their things. Stats come from the notification docs the bell
// already minted (one aggregation for everyone) plus post views and posts
// written in the window. Users with zero activity get no email — an empty
// digest is spam. Idempotent per run: anyone who already received a digest in
// the last six days is skipped, so a retried cron or a manual admin run after
// the cron never double-sends.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DIGEST_LOOKBACK_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_DIGEST_CANDIDATES = 2000;
const MAX_POSTS_PER_USER_FOR_VIEWS = 500;

const WEEKLY_SUMMARY_TEMPLATE_KEY = 'notification.weekly_summary';

export type WeeklySummaryRunResult = {
  ok: true;
  considered: number;
  eligible: number;
  sent: number;
  skipped: { alreadySent: number; noActivity: number; failed: number };
  truncated: boolean;
  dryRun: boolean;
};

const listAllUserIds = async (): Promise<string[]> => {
  const [things, legacy] = await Promise.all([
    getThingsCollection().then((c) =>
      c
        .find({ thingtime: 'user' } as any)
        .project({ shareId: 1 })
        .limit(MAX_DIGEST_CANDIDATES + 1)
        .toArray()
    ),
    getUsersCollection().then((c) =>
      c
        .find({})
        .project({ _id: 1 })
        .limit(MAX_DIGEST_CANDIDATES + 1)
        .toArray()
    )
  ]);
  const ids = new Set<string>();
  for (const doc of things as any[]) ids.add(String(doc.shareId));
  for (const doc of legacy as any[]) ids.add(String(doc._id));
  return [...ids];
};

// One aggregation for every recipient: notification counts by (owner, type).
const loadNotificationCounts = async (
  ownerIds: string[],
  since: Date
): Promise<Map<string, Record<string, number>>> => {
  const map = new Map<string, Record<string, number>>();
  if (!ownerIds.length) return map;
  const things = await getThingsCollection();
  const rows = await things
    .aggregate([
      { $match: { thingtime: 'notification', ownerId: { $in: ownerIds }, createdAt: { $gte: since } } },
      { $group: { _id: { owner: '$ownerId', type: '$crystal.type' }, n: { $sum: 1 } } }
    ])
    .toArray();
  for (const row of rows as any[]) {
    const owner = String(row._id?.owner || '');
    const type = String(row._id?.type || '');
    if (!owner || !type) continue;
    const counts = map.get(owner) || {};
    counts[type] = (counts[type] || 0) + (row.n || 0);
    map.set(owner, counts);
  }
  return map;
};

const loadPostsAndViews = async (
  userId: string,
  since: Date
): Promise<{ postsInWindow: number; viewsInWindow: number }> => {
  const things = await getThingsCollection();
  const [postsInWindow, postDocs] = await Promise.all([
    things.countDocuments({ thingtime: 'post', ownerId: userId, createdAt: { $gte: since } } as any),
    things
      .find({ thingtime: 'post', ownerId: userId } as any)
      .project({ shareId: 1 })
      .limit(MAX_POSTS_PER_USER_FOR_VIEWS)
      .toArray()
  ]);
  const postIds = (postDocs as any[]).map((doc) => String(doc.shareId)).filter(Boolean);
  const viewsInWindow = postIds.length
    ? await (await getPostViewsCollection()).countDocuments({
        postId: { $in: postIds },
        createdAt: { $gte: since }
      })
    : 0;
  return { postsInWindow, viewsInWindow };
};

const digestStats = (
  counts: Record<string, number>,
  postsInWindow: number,
  viewsInWindow: number
): Array<{ label: string; count: number }> => [
  { label: 'new followers 👀', count: counts['new-follower'] || 0 },
  { label: 'friend requests 🤝', count: counts['friend-request'] || 0 },
  { label: 'accepted friend requests 💚', count: counts['friend-accepted'] || 0 },
  { label: 'comments on your posts 💬', count: counts.comment || 0 },
  { label: 'replies to your comments ↩️', count: counts.reply || 0 },
  { label: 'reactions to your things 🤣', count: counts.reaction || 0 },
  { label: 'shares of your posts 🔁', count: counts.share || 0 },
  { label: 'views across your posts 👁️', count: viewsInWindow },
  { label: 'posts you shared ✨', count: postsInWindow }
];

// Runs the digest for every opted-in user. Called from the cron/admin route;
// serial per-recipient so a big user base can't stampede SES.
export const sendWeeklySummaryEmails = async (
  options: { dryRun?: boolean } = {}
): Promise<WeeklySummaryRunResult> => {
  const dryRun = options.dryRun === true;
  const since = new Date(Date.now() - WEEK_MS);

  const allIds = await listAllUserIds();
  const truncated = allIds.length > MAX_DIGEST_CANDIDATES;
  const candidateIds = allIds.slice(0, MAX_DIGEST_CANDIDATES);
  if (truncated) {
    console.warn(
      `[notifications] weekly summary considered only ${MAX_DIGEST_CANDIDATES} of ${allIds.length} users`
    );
  }

  const targets = (await getEmailNotificationTargets(candidateIds)).filter(
    (target) => target.email && target.emailVerified && notificationEmailChannelOn(target, 'weekly-summary')
  );

  // one lookback query covers every recipient's idempotency check
  const recentDigests = targets.length
    ? await (await getEmailMessagesCollection())
        .find({
          templateKey: WEEKLY_SUMMARY_TEMPLATE_KEY,
          createdAt: { $gte: new Date(Date.now() - DIGEST_LOOKBACK_MS) },
          to: { $in: targets.map((t) => t.email.trim().toLowerCase()) }
        })
        .project({ to: 1 })
        .toArray()
    : [];
  const alreadySent = new Set<string>();
  for (const doc of recentDigests as any[]) {
    for (const recipient of Array.isArray(doc.to) ? doc.to : [doc.to]) {
      if (typeof recipient === 'string') alreadySent.add(recipient);
    }
  }

  const counts = await loadNotificationCounts(
    targets.map((t) => t.id),
    since
  );

  const result: WeeklySummaryRunResult = {
    ok: true,
    considered: candidateIds.length,
    eligible: targets.length,
    sent: 0,
    skipped: { alreadySent: 0, noActivity: 0, failed: 0 },
    truncated,
    dryRun
  };

  const origin = notificationEmailOrigin();
  for (const target of targets) {
    if (alreadySent.has(target.email.trim().toLowerCase())) {
      result.skipped.alreadySent += 1;
      continue;
    }
    try {
      const { postsInWindow, viewsInWindow } = await loadPostsAndViews(target.id, since);
      const stats = digestStats(counts.get(target.id) || {}, postsInWindow, viewsInWindow);
      if (!stats.some((stat) => stat.count > 0)) {
        result.skipped.noActivity += 1;
        continue;
      }
      if (dryRun) {
        result.sent += 1;
        continue;
      }
      const rendered = renderWeeklySummaryTemplate({
        displayName: target.displayName || target.username,
        stats,
        ctaUrl: origin,
        settingsUrl: `${origin}/settings`,
        unsubscribeUrl: buildEmailUnsubscribeUrl(target.id)
      });
      await sendEmail({
        to: target.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        stream: 'notification',
        templateKey: WEEKLY_SUMMARY_TEMPLATE_KEY,
        metadata: {
          purpose: 'notification',
          notificationType: 'weekly-summary',
          digest: true,
          recipientId: target.id
        },
        tags: { stream: 'notification', template: WEEKLY_SUMMARY_TEMPLATE_KEY }
      });
      result.sent += 1;
    } catch (err: any) {
      result.skipped.failed += 1;
      console.error('[notifications] weekly summary send failed:', err?.message || err);
    }
  }

  return result;
};
