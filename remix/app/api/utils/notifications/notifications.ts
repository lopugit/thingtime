import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

// Notifications are identity-adjacent (they belong to the RECIPIENT, not to
// whatever data plane the actor's request was riding), so every access here is
// home-pinned — same rationale as users.ts.
import { getHomeThingsCollection as getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { getUserNotificationPrefs } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, normalizeNotificationPrefs } from '~/schemas/registry';
import type { NotificationType } from '~/schemas/registry';
import { emailNotificationsBulk, maybeEmailNotification } from './emails';
import { sendNotificationPush } from './apns';
import { effectiveProfileMediaUrl } from '~/utils/profileMediaUrl';

// Notifications are PROTECTED things minted only here (see registry.ts
// PROTECTED_THINGTIME): ownerId = recipient, targetId = the subject thing
// (post/comment/user), crystal carries the type + actor snapshot, root readAt
// flips when read. Write-side pref checks are an optimization for
// single-recipient emits; the read side ALWAYS filters by the recipient's
// current prefs, so capped fan-out writes never need N pref reads and a pref
// flip retroactively hides already-written notifications of that type.

const MAX_PREVIEW_CHARS = 140;
const MAX_NOTIFICATIONS_PER_USER = 500;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_CURSOR_CHARS = 512;

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
};

export type PublicNotification = {
  id: string;
  type: NotificationType;
  actorId: string;
  actorUsername: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  targetId: string | null;
  postId: string | null;
  preview: string | null;
  readAt: string | null;
  createdAt: string;
};

export const clampPreview = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1)}…` : text;
};

const notificationDoc = (input: EmitNotificationInput, now: Date) => ({
  shareId: randomUUID(),
  schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
  thingtime: ['notification'],
  crystal: {
    type: input.type,
    actorId: input.actor.id,
    actorName: input.actor.displayName || input.actor.username || null,
    ...(input.postId ? { postId: input.postId } : {}),
    ...(clampPreview(input.preview) ? { preview: clampPreview(input.preview) } : {})
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
      const doc = notificationDoc(input, new Date());
      await things.insertOne(doc as any);
      void trimRecipient(input.recipientId).catch(() => {});
      void sendNotificationPush({ ...input, notificationId: doc.shareId }).catch((err: any) => {
        console.error('[notifications] APNs delivery failed:', err?.message || err);
      });
    }
    // The email channel rides the same emit but is fire-and-forget — the
    // social action never waits on SES (emails.ts re-checks its own gates).
    void maybeEmailNotification(input).catch(() => {});
  } catch (err: any) {
    console.error('[notifications] emit failed:', err?.message || err);
  }
};

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
  unreadCount: number;
  nextBefore: string | null;
  nextCursor: string | null;
};

export type NotificationListOptions = {
  limit?: unknown;
  before?: unknown;
  cursor?: unknown;
  from?: unknown;
  to?: unknown;
};

type NormalizedNotificationListOptions = {
  limit: number;
  before: Date | null;
  cursor: { createdAt: Date; shareId: string } | null;
  from: Date | null;
  to: Date | null;
};

const parseOptionalDate = (value: unknown): Date | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
};

export const notificationCursorFor = (createdAt: Date, shareId: string): string =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), shareId }), 'utf8').toString('base64url');

const parseNotificationCursor = (value: unknown): NormalizedNotificationListOptions['cursor'] | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_CURSOR_CHARS) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (Object.keys(decoded).some((key) => key !== 'createdAt' && key !== 'shareId')) return undefined;
    const createdAt = parseOptionalDate(decoded.createdAt);
    const shareId = typeof decoded.shareId === 'string' ? decoded.shareId.trim() : '';
    if (!createdAt || !shareId || shareId.length > 128) return undefined;
    return { createdAt, shareId };
  } catch {
    return undefined;
  }
};

export const notificationCursorClauseFor = (cursor: { createdAt: Date; shareId: string }) => ({
  $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, shareId: { $gt: cursor.shareId } }
  ]
});

export const normalizeNotificationListOptions = (
  options: NotificationListOptions = {}
): { ok: true; value: NormalizedNotificationListOptions } | { ok: false; error: string } => {
  const limitRaw = Number(options.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  const before = parseOptionalDate(options.before);
  const from = parseOptionalDate(options.from);
  const to = parseOptionalDate(options.to);
  const cursor = parseNotificationCursor(options.cursor);
  if (before === undefined) return { ok: false, error: 'before must be a valid date' };
  if (from === undefined) return { ok: false, error: 'from must be a valid date' };
  if (to === undefined) return { ok: false, error: 'to must be a valid date' };
  if (cursor === undefined) return { ok: false, error: 'cursor is invalid' };
  if (before && cursor) return { ok: false, error: 'Pass before or cursor, not both' };
  if (from && to && from.getTime() >= to.getTime()) return { ok: false, error: 'from must be earlier than to' };
  return { ok: true, value: { limit, before, cursor, from, to } };
};

export const listNotifications = async (
  userId: string,
  options: NotificationListOptions = {}
): Promise<ListNotificationsResult | { ok: false; status: 400; error: string }> => {
  const normalized = normalizeNotificationListOptions(options);
  if (normalized.ok === false) return { ok: false, status: 400, error: normalized.error };
  const { limit, before, cursor, from, to } = normalized.value;

  const prefs = normalizeNotificationPrefs(await getUserNotificationPrefs(userId));
  // Push master off = the bell goes quiet entirely (list AND badge), without
  // touching the stored per-type switches.
  if (!prefs.masters.push) {
    return { ok: true, notifications: [], unreadCount: 0, nextBefore: null, nextCursor: null };
  }
  const disabled = Object.entries(prefs.push)
    .filter(([, enabled]) => enabled === false)
    .map(([type]) => type);

  const base: Record<string, any> = { thingtime: 'notification', ownerId: userId };
  if (disabled.length) base['crystal.type'] = { $nin: disabled };

  const clauses: Record<string, any>[] = [base];
  if (from || to) {
    clauses.push({
      createdAt: {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lt: to } : {})
      }
    });
  }
  if (before) clauses.push({ createdAt: { $lt: before } });
  if (cursor) clauses.push(notificationCursorClauseFor(cursor));
  const pageFilter = clauses.length === 1 ? base : { $and: clauses };

  const things = await getThingsCollection();
  const [docs, unreadCount] = await Promise.all([
    things
      .find(pageFilter as any)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit)
      .toArray(),
    things.countDocuments({ ...base, readAt: null } as any)
  ]);

  const actors = await loadActors(docs.map((doc: any) => String(doc.crystal?.actorId || '')));
  const notifications: PublicNotification[] = (docs as any[]).map((doc) => {
    const actorId = String(doc.crystal?.actorId || '');
    const live = actors.get(actorId);
    return {
      id: String(doc.shareId),
      type: doc.crystal?.type,
      actorId,
      actorUsername: live?.username || null,
      actorName: live?.displayName || live?.username || doc.crystal?.actorName || null,
      actorAvatarUrl: live?.avatarUrl || null,
      targetId: doc.targetId ? String(doc.targetId) : null,
      postId: doc.crystal?.postId ? String(doc.crystal.postId) : null,
      preview: typeof doc.crystal?.preview === 'string' ? doc.crystal.preview : null,
      readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
      createdAt: new Date(doc.createdAt).toISOString()
    };
  });

	const nextBefore = docs.length === limit ? new Date((docs as any[])[docs.length - 1].createdAt).toISOString() : null;
  const nextCursor = docs.length === limit
    ? notificationCursorFor(new Date((docs as any[])[docs.length - 1].createdAt), String((docs as any[])[docs.length - 1].shareId))
    : null;
  return { ok: true, notifications, unreadCount, nextBefore, nextCursor };
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
