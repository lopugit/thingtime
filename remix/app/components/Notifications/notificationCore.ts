import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  isNotificationCategory,
  isNotificationType,
  notificationCategoryOf,
  type NotificationCategory,
  type NotificationType
} from '~/schemas/registry';

// Pure client-side vocabulary shared by the nav bell, Settings →
// Notifications, and the /notifications history page: per-type copy, the row
// headline + click-through rules, and the history page's filter grammar
// (URL search params ↔ GET /api/v1/notifications query).

// One row of GET /api/v1/notifications (PublicNotification on the server).
export type NotificationItem = {
  id: string;
  type: string;
  category?: string | null;
  actorId: string;
  actorUsername: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  targetId: string | null;
  postId: string | null;
  preview: string | null;
  title?: string | null;
  href?: string | null;
  outcome?: 'ok' | 'error' | null;
  readAt: string | null;
  createdAt: string;
};

export const NOTIFICATION_TYPE_META: Record<NotificationType, { emoji: string; label: string; hint: string }> = {
  'friend-request': { emoji: '🤝', label: 'Friend requests', hint: 'Someone asks to be your friend' },
  'friend-accepted': { emoji: '💚', label: 'Request accepted', hint: 'A friend request you sent is accepted' },
  'new-follower': { emoji: '👀', label: 'New followers', hint: 'Someone starts following you' },
  'post-from-followed': {
    emoji: '📰',
    label: 'Posts from people you follow',
    hint: 'New posts by accounts you follow — email is opt-in'
  },
  'post-from-friend': { emoji: '🫶', label: 'Posts from friends', hint: 'New posts by your friends — email is opt-in' },
  comment: { emoji: '💬', label: 'Comments', hint: 'Comments on your posts' },
  reply: { emoji: '↩️', label: 'Replies', hint: 'Replies to your comments' },
  reaction: { emoji: '🤣', label: 'Reactions', hint: 'Reactions on your posts and comments' },
  share: { emoji: '🔁', label: 'Shares', hint: 'Your posts get reposted' },
  mention: { emoji: '📣', label: 'Mentions', hint: 'Someone @mentions you in a post or comment' },
  groups: { emoji: '👥', label: 'Groups', hint: 'Group activity — ready for when groups arrive ✨' },
  'action-run': {
    emoji: '⚡',
    label: 'Action runs',
    hint: 'Lopu reports each action you run yourself, plus any run that fails — email is opt-in'
  },
  'recording-reminder': { emoji: '🦄', label: 'Recording reminders', hint: 'Daily reminders for unfinished todos from Watch recordings — email is opt-in' }
};

export const notificationEmoji = (type: string): string => (isNotificationType(type) ? NOTIFICATION_TYPE_META[type].emoji : '✨');

export const notificationTypeLabel = (type: string): string => (isNotificationType(type) ? NOTIFICATION_TYPE_META[type].label : type);

// The server stamps `category`; older cached rows fall back to the registry map.
export const notificationCategory = (item: Pick<NotificationItem, 'type' | 'category'>): NotificationCategory =>
  isNotificationCategory(item.category) ? item.category : notificationCategoryOf(item.type);

export const isSystemNotification = (item: Pick<NotificationItem, 'type' | 'category'>) => notificationCategory(item) === 'system';

export const notificationVerb = (item: Pick<NotificationItem, 'type' | 'preview'>): string => {
  switch (item.type) {
    case 'friend-request':
      return 'sent you a friend request';
    case 'friend-accepted':
      return 'accepted your friend request';
    case 'new-follower':
      return 'started following you';
    case 'post-from-followed':
    case 'post-from-friend':
      return 'posted';
    case 'comment':
      return 'commented on your post';
    case 'reply':
      return 'replied to your comment';
    case 'reaction':
      return item.preview ? `reacted ${item.preview}` : 'reacted to your post';
    case 'share':
      return 'reposted your post';
    case 'mention':
      return 'mentioned you';
    case 'action-run':
      return 'ran an action';
    case 'recording-reminder':
      return 'has a reminder for you';
    default:
      return 'did something ✨';
  }
};

// What a row says: people rows read "<actor> <verb>", system notes read their
// headline (Lopu speaking), falling back to the verb when a note has none.
export const notificationHeadline = (item: NotificationItem): { actor: string | null; text: string } => {
  if (isSystemNotification(item)) {
    return { actor: null, text: item.title?.trim() || `Lopu ${notificationVerb(item)}` };
  }
  return { actor: item.actorName || item.actorUsername || 'Someone', text: notificationVerb(item) };
};

const isInternalPath = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

// Click-through: a system note's own path, else the post, else the actor.
export const notificationHref = (item: NotificationItem): string | null => {
  if (isInternalPath(item.href)) return item.href;
  if (item.postId) return `/post/${encodeURIComponent(item.postId)}`;
  if (item.actorUsername) return `/profile/${encodeURIComponent(item.actorUsername)}`;
  return null;
};

// ── history page filters ─────────────────────────────────────────────────────

export type NotificationFilters = {
  category: NotificationCategory | 'all';
  type: NotificationType | 'all';
  unread: boolean;
  q: string;
  // YYYY-MM-DD (the date inputs), interpreted in the viewer's local day
  since: string;
  until: string;
};

export const DEFAULT_NOTIFICATION_FILTERS: NotificationFilters = {
  category: 'all',
  type: 'all',
  unread: false,
  q: '',
  since: '',
  until: ''
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDay = (value: string | null): string => {
  if (!value || !DAY_PATTERN.test(value)) return '';
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? '' : value;
};

export const parseNotificationFilters = (params: URLSearchParams): NotificationFilters => {
  const category = params.get('category');
  const type = params.get('type');
  return {
    category: isNotificationCategory(category) ? category : 'all',
    type: isNotificationType(type) ? type : 'all',
    unread: params.get('unread') === '1',
    q: (params.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    since: parseDay(params.get('since')),
    until: parseDay(params.get('until'))
  };
};

// Only non-default values land in the URL, so a clean /notifications stays clean.
export const notificationFiltersToParams = (filters: NotificationFilters): URLSearchParams => {
  const params = new URLSearchParams();
  if (filters.category !== 'all') params.set('category', filters.category);
  if (filters.type !== 'all') params.set('type', filters.type);
  if (filters.unread) params.set('unread', '1');
  if (filters.q) params.set('q', filters.q);
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  return params;
};

export const hasActiveNotificationFilters = (filters: NotificationFilters): boolean =>
  notificationFiltersToParams(filters).toString() !== '';

const localDayBound = (day: string, end: boolean): string => {
  const [year, month, date] = day.split('-').map(Number);
  const bound = end ? new Date(year, month - 1, date, 23, 59, 59, 999) : new Date(year, month - 1, date, 0, 0, 0, 0);
  return bound.toISOString();
};

// The GET /api/v1/notifications query for a filter set (days → local ISO bounds).
export const notificationFiltersToQuery = (filters: NotificationFilters): Record<string, string> => {
  const query: Record<string, string> = {};
  if (filters.category !== 'all') query.category = filters.category;
  if (filters.type !== 'all') query.types = filters.type;
  if (filters.unread) query.unread = '1';
  if (filters.q) query.q = filters.q;
  if (filters.since) query.since = localDayBound(filters.since, false);
  if (filters.until) query.until = localDayBound(filters.until, true);
  return query;
};

// Picking a type narrows past its category chip; picking a chip that does not
// hold the current type drops the type, so a filter set can never be empty by
// construction.
export const withNotificationCategory = (filters: NotificationFilters, category: NotificationFilters['category']): NotificationFilters => ({
  ...filters,
  category,
  type: filters.type !== 'all' && category !== 'all' && notificationCategoryOf(filters.type) !== category ? 'all' : filters.type
});

export const withNotificationType = (filters: NotificationFilters, type: NotificationFilters['type']): NotificationFilters => ({
  ...filters,
  type,
  category: type === 'all' ? filters.category : notificationCategoryOf(type)
});

export const NOTIFICATION_TYPES_BY_CATEGORY: Record<NotificationCategory, NotificationType[]> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((category) => [category, NOTIFICATION_TYPES.filter((type) => notificationCategoryOf(type) === category)])
) as Record<NotificationCategory, NotificationType[]>;

// Per-viewer first-page cache for the flash-free first paint (swept on logout:
// rows can quote private posts and system notes).
export const NOTIFICATION_HISTORY_CACHE_PREFIX = 'tt-notif-history-';
export const notificationHistoryCacheKey = (userId: string) => `${NOTIFICATION_HISTORY_CACHE_PREFIX}${userId}`;
