import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

// Notifications are identity-adjacent (they belong to the RECIPIENT, not to
// whatever data plane the actor's request was riding), so every access here is
// home-pinned — same rationale as users.ts.
import { getHomeThingsCollection as getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { getUserNotificationPrefs } from '../auth/users';
import {
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  SYSTEM_NOTIFICATION_ACTOR_ID,
  normalizeNotificationPrefs,
  notificationCategoryOf
} from '~/schemas/registry';
import type { NotificationCategory, NotificationType } from '~/schemas/registry';
import { emailNotificationsBulk, maybeEmailNotification } from './emails';
import { buildNotificationListFilters, resolveNotificationListQuery, type NotificationListOptions } from './listQuery';
import { effectiveProfileMediaUrl } from '~/utils/profileMediaUrl';

// Notifications are PROTECTED things minted only here (see registry.ts
// PROTECTED_THINGTIME): ownerId = recipient, targetId = the subject thing
// (post/comment/user), crystal carries the type + actor snapshot, root readAt
// flips when read. Write-side pref checks are an optimization for
// single-recipient emits; the read side ALWAYS filters by the recipient's
// current prefs, so capped fan-out writes never need N pref reads and a pref
// flip retroactively hides already-written notifications of that type.

const MAX_PREVIEW_CHARS = 140;
const MAX_HREF_CHARS = 300;
// The /notifications history page promises "everything you've received", so
// the per-recipient tail is generous; it is still bounded so an account that
// scripts an action sixty times a minute cannot accumulate forever.
export const MAX_NOTIFICATIONS_PER_USER = 10_000;

export type NotificationActor = {
  id: string;
  username?: string | null;
  displayName?: string | null;
};

export type EmitNotificationInput = {
  recipientId: string;
  type: NotificationType;
  actor: NotificationActor;
  // shareId of the subject thing (the post/comment/user the click-through opens)
  targetId?: string | null;
  // post for click-through when targetId is a comment/reaction subject
  postId?: string | null;
  preview?: string | null;
  // system notes only — see emitSystemNotification
  title?: string | null;
  href?: string | null;
  outcome?: 'ok' | 'error' | null;
};

export type PublicNotification = {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  actorId: string;
  actorUsername: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  targetId: string | null;
  postId: string | null;
  preview: string | null;
  title: string | null;
  href: string | null;
  outcome: 'ok' | 'error' | null;
  readAt: string | null;
  createdAt: string;
};

export const clampPreview = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1)}…` : text;
};

// A click-through for a system note is always an in-app path: rooted, not
// protocol-relative, no whitespace/control characters, bounded. Anything else
// is dropped rather than rendered.
export const safeInternalHref = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href.startsWith('/') || href.startsWith('//') || href.length > MAX_HREF_CHARS) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return null;
  return href;
};

const notificationDoc = (input: EmitNotificationInput, now: Date) => ({
  shareId: randomUUID(),
  schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
  thingtime: ['notification'],
  crystal: {
    type: input.type,
    actorId: input.actor.id,
    actorName: input.actor.displayName || input.actor.username || null,
    ...(input.actor.username ? { actorUsername: input.actor.username } : {}),
    ...(input.postId ? { postId: input.postId } : {}),
    ...(clampPreview(input.preview) ? { preview: clampPreview(input.preview) } : {}),
    ...(clampPreview(input.title) ? { title: clampPreview(input.title) } : {}),
    ...(safeInternalHref(input.href) ? { href: safeInternalHref(input.href) } : {}),
    ...(input.outcome === 'ok' || input.outcome === 'error' ? { outcome: input.outcome } : {})
  },
  ownerId: input.recipientId,
  acl: [ACL_OWNER],
  targetId: input.targetId || null,
  tags: [],
  readAt: null,
  createdAt: now,
  updatedAt: now
});

// Keep a recipient's notification tail bounded — without this, an active
// account accumulates forever. Fire-and-forget from single-recipient emits
// (low volume); bulk fan-out skips it (one extra doc per recipient per post).
const trimRecipient = async (recipientId: string) => {
  const things = await getThingsCollection();
  const total = await things.countDocuments({ thingtime: 'notification', ownerId: recipientId } as any);
  if (total <= MAX_NOTIFICATIONS_PER_USER) return;
  const overflow = await things
    .find({ thingtime: 'notification', ownerId: recipientId } as any)
    .sort({ createdAt: -1, shareId: 1 })
    .skip(MAX_NOTIFICATIONS_PER_USER)
    .project({ _id: 1 })
    .toArray();
  if (overflow.length) {
    await things.deleteMany({ _id: { $in: overflow.map((doc: any) => doc._id) } } as any);
  }
};

// Emit one notification to one recipient. NEVER throws — a failed notification
// must not fail the social action that triggered it (the action is the
// product; the notification is a side effect).
export const emitNotification = async (input: EmitNotificationInput): Promise<void> => {
  try {
    if (!input.recipientId || input.recipientId === input.actor.id) return;
    const prefs = normalizeNotificationPrefs(await getUserNotificationPrefs(input.recipientId));
    const pushOn = prefs.masters.push && prefs.push[input.type] !== false;
    if (pushOn) {
      const things = await getThingsCollection();
      await things.insertOne(notificationDoc(input, new Date()) as any);
      void trimRecipient(input.recipientId).catch(() => {});
    }
    // The email channel rides the same emit but is fire-and-forget — the
    // social action never waits on SES (emails.ts re-checks its own gates).
    void maybeEmailNotification(input).catch(() => {});
  } catch (err: any) {
    console.error('[notifications] emit failed:', err?.message || err);
  }
};

// System notes: the platform speaking through Lopu — an action you ran
// finished, and whatever comes next. Same protected doc, same prefs gate
// (the recipient's 'action-run' switch), same bounded tail; the synthetic
// actor id never collides with a user, so the "never notify yourself" guard
// in emitNotification stays intact for people while letting Lopu address you.
// The headline replaces "<actor> <verb>" in every row; href is the in-app
// click-through. Never throws.
export const SYSTEM_NOTIFICATION_ACTOR: NotificationActor = {
  id: SYSTEM_NOTIFICATION_ACTOR_ID,
  username: null,
  displayName: 'Lopu'
};

export type EmitSystemNotificationInput = {
  recipientId: string;
  type: NotificationType;
  title: string;
  preview?: string | null;
  href?: string | null;
  targetId?: string | null;
  outcome?: 'ok' | 'error' | null;
};

export const emitSystemNotification = (input: EmitSystemNotificationInput): Promise<void> =>
  emitNotification({
    recipientId: input.recipientId,
    type: input.type,
    actor: SYSTEM_NOTIFICATION_ACTOR,
    targetId: input.targetId ?? null,
    preview: input.preview ?? null,
    title: input.title,
    href: input.href ?? null,
    outcome: input.outcome ?? null
  });

// Capped fan-out (posts from followed/friends): one insertMany, pref-agnostic
// at write (reads filter). recipients map lets followers and friends of the
// same author get differently-typed notifications in one call. Never throws.
export const emitNotificationsBulk = async (
  recipients: Array<{ recipientId: string; type: NotificationType }>,
  base: Omit<EmitNotificationInput, 'recipientId' | 'type'>
): Promise<void> => {
  try {
    const seen = new Set<string>([base.actor.id]);
    const now = new Date();
    const docs = recipients
      .filter(({ recipientId }) => {
        if (!recipientId || seen.has(recipientId)) return false;
        seen.add(recipientId);
        return true;
      })
      .map(({ recipientId, type }) => notificationDoc({ ...base, recipientId, type }, now));
    if (!docs.length) return;
    const things = await getThingsCollection();
    await things.insertMany(docs as any, { ordered: false });
    const deduped = docs.map((doc) => ({
      recipientId: String(doc.ownerId),
      type: doc.crystal.type as NotificationType
    }));
    // email pass is fire-and-forget for the same reason as single emits
    void emailNotificationsBulk(deduped, base).catch(() => {});
  } catch (err: any) {
    console.error('[notifications] bulk emit failed:', err?.message || err);
  }
};

// Batch actor enrichment (dual-era, one query per store). Live profile data
// wins over the write-time snapshot so renames/avatars stay fresh.
const loadActors = async (
  actorIds: string[]
): Promise<Map<string, { username: string | null; displayName: string | null; avatarUrl: string | null }>> => {
  const ids = [...new Set(actorIds)].filter(Boolean);
  const map = new Map<string, { username: string | null; displayName: string | null; avatarUrl: string | null }>();
  if (!ids.length) return map;
  const things = await getThingsCollection();
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const [userThings, legacyUsers] = await Promise.all([
    things
      .find({ thingtime: 'user', shareId: { $in: ids } } as any)
			.project({ shareId: 1, crystal: 1, avatarAttachmentId: 1 })
      .toArray(),
    objectIds.length
			? (
					await getUsersCollection()
			  )
          .find({ _id: { $in: objectIds } })
					.project({ username: 1, displayName: 1, avatarUrl: 1, avatarAttachmentId: 1 })
          .toArray()
      : Promise.resolve([])
  ]);
  for (const doc of legacyUsers as any[]) {
    map.set(String(doc._id), {
      username: doc.username || null,
      displayName: doc.displayName || null,
			avatarUrl: effectiveProfileMediaUrl(doc, 'avatar')
    });
  }
  for (const doc of userThings as any[]) {
    map.set(String(doc.shareId), {
      username: doc.crystal?.username || null,
      displayName: doc.crystal?.displayName || null,
			avatarUrl: effectiveProfileMediaUrl(doc, 'avatar')
    });
  }
  return map;
};

export type ListNotificationsResult = {
  ok: true;
  notifications: PublicNotification[];
  // unread across ALL enabled types — the bell badge, regardless of filters
  unreadCount: number;
  // how many rows match the filters in full (cursor ignored); only computed
  // for withTotal callers so the bell's 90s poll stays a single query
  total: number | null;
  nextBefore: string | null;
};

const publicNotification = (
  doc: any,
  actors: Map<string, { username: string | null; displayName: string | null; avatarUrl: string | null }>
): PublicNotification => {
  const actorId = String(doc.crystal?.actorId || '');
  const live = actors.get(actorId);
  const outcome = doc.crystal?.outcome;
  return {
    id: String(doc.shareId),
    type: doc.crystal?.type,
    category: notificationCategoryOf(doc.crystal?.type),
    actorId,
    actorUsername: live?.username || (typeof doc.crystal?.actorUsername === 'string' ? doc.crystal.actorUsername : null),
    actorName: live?.displayName || live?.username || doc.crystal?.actorName || null,
    actorAvatarUrl: live?.avatarUrl || null,
    targetId: doc.targetId ? String(doc.targetId) : null,
    postId: doc.crystal?.postId ? String(doc.crystal.postId) : null,
    preview: typeof doc.crystal?.preview === 'string' ? doc.crystal.preview : null,
    title: typeof doc.crystal?.title === 'string' ? doc.crystal.title : null,
    href: safeInternalHref(doc.crystal?.href),
    outcome: outcome === 'ok' || outcome === 'error' ? outcome : null,
    readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
    createdAt: new Date(doc.createdAt).toISOString()
  };
};

export const listNotifications = async (
  userId: string,
  options: NotificationListOptions & { withTotal?: unknown } = {}
): Promise<ListNotificationsResult> => {
  const query = resolveNotificationListQuery(options);
  const withTotal = options.withTotal === true || options.withTotal === '1' || options.withTotal === 'true';

  const prefs = normalizeNotificationPrefs(await getUserNotificationPrefs(userId));
  // Push master off = the bell goes quiet entirely (list AND badge), without
  // touching the stored per-type switches. The same short-circuit covers a
  // filter that asks only for disabled or unknown types.
  const filters = buildNotificationListFilters(userId, prefs, query);
  if (!filters) {
    return { ok: true, notifications: [], unreadCount: 0, total: withTotal ? 0 : null, nextBefore: null };
  }

  // The badge count is filter-agnostic: everything enabled and unread.
  const unreadFilter = buildNotificationListFilters(userId, prefs, resolveNotificationListQuery({ unread: '1' }));

  const things = await getThingsCollection();
  const [docs, unreadCount, total] = await Promise.all([
    things
      .find(filters.page as any)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(query.limit)
      .toArray(),
    unreadFilter ? things.countDocuments(unreadFilter.base as any) : Promise.resolve(0),
    withTotal ? things.countDocuments(filters.base as any) : Promise.resolve(null)
  ]);

  const actors = await loadActors(docs.map((doc: any) => String(doc.crystal?.actorId || '')));
  const notifications = (docs as any[]).map((doc) => publicNotification(doc, actors));

	const nextBefore = docs.length === query.limit ? new Date((docs as any[])[docs.length - 1].createdAt).toISOString() : null;
  return { ok: true, notifications, unreadCount, total, nextBefore };
};

export const markNotificationsRead = async (
  userId: string,
  input: { ids?: unknown; all?: unknown }
): Promise<{ ok: false; status: number; error: string } | { ok: true; updated: number }> => {
  const all = input.all === true;
	const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string' && !!id.trim()).slice(0, 200) : [];
  if (!all && !ids.length) {
    return { ok: false, status: 400, error: 'Pass ids to mark, or all: true' };
  }
  const filter: Record<string, any> = { thingtime: 'notification', ownerId: userId, readAt: null };
  if (!all) filter.shareId = { $in: ids };
  const things = await getThingsCollection();
  const res = await things.updateMany(filter as any, { $set: { readAt: new Date(), updatedAt: new Date() } });
  return { ok: true, updated: res.modifiedCount || 0 };
};
