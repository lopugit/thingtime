import {
  isNotificationCategory,
  isNotificationType,
  notificationTypesInCategory,
  type NormalizedNotificationPrefs,
  type NotificationType
} from '~/schemas/registry';

// The query half of GET /api/v1/notifications, kept pure so the history page's
// filter grammar (category / types / unread / q / since / until, plus the
// `before` cursor) is unit-testable without Mongo. listNotifications turns the
// resolved query into two filters: `base` (everything that matches — the
// history page's total) and `page` (base + the cursor).

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export const MAX_SEARCH_CHARS = 100;
export const MAX_TYPE_FILTERS = 32;

export type NotificationListOptions = {
  limit?: unknown;
  before?: unknown;
  // comma-separated or array of NotificationType; unknown names are dropped
  types?: unknown;
  // one NotificationCategory — intersects with `types` when both are given
  category?: unknown;
  // '1' | 'true' → only unread rows
  unread?: unknown;
  // free text over preview / actor name / actor username / system title
  q?: unknown;
  // ISO bounds on createdAt (inclusive)
  since?: unknown;
  until?: unknown;
};

export type ResolvedNotificationListQuery = {
  limit: number;
  before: Date | null;
  since: Date | null;
  until: Date | null;
  // null = no type restriction beyond the recipient's prefs; [] = the caller
  // asked for types that do not exist, so nothing can match
  types: NotificationType[] | null;
  unread: boolean;
  q: string | null;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
};

const parseTypes = (value: unknown): NotificationType[] | null => {
  if (value === undefined || value === null || value === '') return null;
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set<NotificationType>();
  for (const entry of raw.slice(0, MAX_TYPE_FILTERS)) {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (isNotificationType(name)) seen.add(name);
  }
  return [...seen];
};

const parseBoolean = (value: unknown): boolean => value === true || value === '1' || value === 'true';

export const resolveNotificationListQuery = (options: NotificationListOptions = {}): ResolvedNotificationListQuery => {
  const limitRaw = Number(options.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;

  let types = parseTypes(options.types);
  if (options.category !== undefined && options.category !== null && options.category !== '') {
    const inCategory = isNotificationCategory(options.category) ? notificationTypesInCategory(options.category) : [];
    types = types === null ? inCategory : types.filter((type) => inCategory.includes(type));
  }

  const q = typeof options.q === 'string' ? options.q.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_CHARS) : '';

  return {
    limit,
    before: parseDate(options.before),
    since: parseDate(options.since),
    until: parseDate(options.until),
    types,
    unread: parseBoolean(options.unread),
    q: q || null
  };
};

export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The crystal fields free-text search reads. actorName/actorUsername are the
// write-time snapshots (live names come from actor enrichment at read time);
// title is the system-note headline.
export const NOTIFICATION_SEARCH_FIELDS = ['crystal.preview', 'crystal.actorName', 'crystal.actorUsername', 'crystal.title'] as const;

export type NotificationListFilters = {
  base: Record<string, any>;
  page: Record<string, any>;
};

// null = nothing can match (push master off, or every requested type is
// disabled/unknown) — the caller short-circuits to an empty page.
export const buildNotificationListFilters = (
  userId: string,
  prefs: NormalizedNotificationPrefs,
  query: ResolvedNotificationListQuery
): NotificationListFilters | null => {
  if (!prefs.masters.push) return null;
  const disabled = Object.entries(prefs.push)
    .filter(([, enabled]) => enabled === false)
    .map(([type]) => type);

  const base: Record<string, any> = { thingtime: 'notification', ownerId: userId };

  if (query.types !== null) {
    const allowed = query.types.filter((type) => !disabled.includes(type));
    if (!allowed.length) return null;
    base['crystal.type'] = { $in: allowed };
  } else if (disabled.length) {
    base['crystal.type'] = { $nin: disabled };
  }

  if (query.unread) base.readAt = null;

  const createdAt: Record<string, Date> = {};
  if (query.since) createdAt.$gte = query.since;
  if (query.until) createdAt.$lte = query.until;
  if (Object.keys(createdAt).length) base.createdAt = createdAt;

  if (query.q) {
    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    base.$or = NOTIFICATION_SEARCH_FIELDS.map((field) => ({ [field]: pattern }));
  }

  const page = query.before ? { ...base, createdAt: { ...(base.createdAt || {}), $lt: query.before } } : base;
  return { base, page };
};
