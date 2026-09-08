import React from 'react';
import { Box, Button, Center, Flex, Input, Select, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_META, isNotificationCategory, isNotificationType } from '~/schemas/registry';
import { NotificationRow } from './NotificationRow';
import {
  NOTIFICATION_TYPES_BY_CATEGORY,
  NOTIFICATION_TYPE_META,
  hasActiveNotificationFilters,
  notificationFiltersToParams,
  notificationFiltersToQuery,
  notificationHistoryCacheKey,
  notificationHref,
  parseNotificationFilters,
  withNotificationCategory,
  withNotificationType,
  type NotificationFilters,
  type NotificationItem
} from './notificationCore';

// The /notifications page: every notification the viewer has received (the
// server keeps their newest 10,000, filtered by their notification prefs
// exactly like the bell), newest first, with the filter grammar in the URL so
// a view is bookmarkable and shareable between tabs: category chips
// (social / engagement / feed / system), a type dropdown, unread-only, free
// text search, and a from/to day window. Optimistic first paint: the
// unfiltered first page seeds synchronously from localStorage
// (tt-notif-history-<viewer>, swept on logout) and reconciles in the
// background; a filter change keeps the current rows dimmed until the fresh
// page lands, so nothing ever flashes empty. Clicking a row marks it read
// optimistically and follows its click-through; "Mark all read" clears the
// bell badge too.

const PAGE_SIZE = 30;
const MUTED = 'var(--tt-muted, #9a9aa6)';
const CARD = 'var(--tt-card, #ffffff)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS = 'var(--tt-radius-lg, 16px)';

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: BORDER,
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

type HistoryPage = {
  at: number;
  items: NotificationItem[];
  total: number | null;
  unreadCount: number;
  nextBefore: string | null;
};

const EMPTY_PAGE: HistoryPage = { at: 0, items: [], total: null, unreadCount: 0, nextBefore: null };

const readCachedPage = (key: string): HistoryPage | null => {
  const entry = readLocalCache<HistoryPage>(key);
  if (!entry || typeof entry.at !== 'number' || !Array.isArray(entry.items)) return null;
  return { ...EMPTY_PAGE, ...entry };
};

const toPage = (resp: any): HistoryPage => ({
  at: Date.now(),
  items: Array.isArray(resp?.notifications) ? resp.notifications : [],
  total: typeof resp?.total === 'number' ? resp.total : null,
  unreadCount: typeof resp?.unreadCount === 'number' ? resp.unreadCount : 0,
  nextBefore: typeof resp?.nextBefore === 'string' ? resp.nextBefore : null
});

const dedupeById = (items: NotificationItem[]): NotificationItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};

const FieldLabel = (props: { children: React.ReactNode }) => (
  <Text fontSize="xs" fontWeight={600} color={MUTED} flexShrink={0}>
    {props.children}
  </Text>
);

const Chip = (props: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) => (
  <Button size="xs" variant={props.active ? 'solid' : 'ghost'} aria-pressed={props.active} aria-label={props.label} onClick={props.onClick}>
    {props.children}
  </Button>
);

export const NotificationsPage = () => {
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = React.useMemo(() => parseNotificationFilters(searchParams), [searchParams]);
  const filtersKey = notificationFiltersToParams(filters).toString();
  const active = hasActiveNotificationFilters(filters);
  const cacheKey = user ? notificationHistoryCacheKey(user.id) : null;
  const bellCacheKey = user ? `tt-notif-unread-${user.id}` : null;

  const [page, setPage] = React.useState<HistoryPage>(() => (cacheKey && !active ? readCachedPage(cacheKey) : null) || EMPTY_PAGE);
  // a spinner only on a true cold start — nothing cached, nothing loaded yet
  const [loading, setLoading] = React.useState(!!user && page.items.length === 0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [marking, setMarking] = React.useState(false);

  const seqRef = React.useRef(0);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const pageRef = React.useRef(page);
  pageRef.current = page;

  const updateFilters = React.useCallback(
    (next: NotificationFilters) => {
      setSearchParams(notificationFiltersToParams(next), { replace: true });
    },
    [setSearchParams]
  );

  // search box: local draft, debounced into the URL (the URL is the truth)
  const [qDraft, setQDraft] = React.useState(filters.q);
  React.useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);
  React.useEffect(() => {
    const trimmed = qDraft.replace(/\s+/g, ' ').trim();
    if (trimmed === filters.q) return;
    const timer = window.setTimeout(() => updateFilters({ ...filters, q: trimmed }), 300);
    return () => window.clearTimeout(timer);
    // filters is derived from the URL; qDraft drives this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  // first page — per viewer + filter set; the unfiltered view seeds from cache
  React.useEffect(() => {
    const seq = ++seqRef.current;
    if (!user) {
      setPage(EMPTY_PAGE);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const seeded = cacheKey && !active ? readCachedPage(cacheKey) : null;
    if (seeded) setPage(seeded);
    setLoading(!seeded && pageRef.current.items.length === 0);
    setRefreshing(true);
    setError(null);
    apiRef.current.v1.notifications
      .list({ limit: PAGE_SIZE, withTotal: 1, ...notificationFiltersToQuery(filters) })
      .then((resp: any) => {
        if (seq !== seqRef.current) return;
        const next = toPage(resp);
        setPage(next);
        if (cacheKey && !active) writeLocalCache(cacheKey, next);
        if (bellCacheKey) writeLocalCache(bellCacheKey, next.unreadCount);
      })
      .catch((err: any) => {
        if (seq !== seqRef.current) return;
        setError(err?.error || 'Could not load your notifications — try again in a moment.');
      })
      .finally(() => {
        if (seq !== seqRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });
    // filtersKey is the URL-derived identity of `filters`; cache keys follow user.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, filtersKey]);

  const loadMore = async () => {
    if (!page.nextBefore || loadingMore) return;
    const seq = seqRef.current;
    setLoadingMore(true);
    try {
      const resp: any = await apiRef.current.v1.notifications.list({
        limit: PAGE_SIZE,
        before: page.nextBefore,
        ...notificationFiltersToQuery(filters)
      });
      if (seq !== seqRef.current) return;
      const more = toPage(resp);
      setPage((prev) => ({ ...prev, items: dedupeById([...prev.items, ...more.items]), nextBefore: more.nextBefore }));
    } catch (err: any) {
      lopu({ title: 'Could not load older notifications 😔', description: err?.error, status: 'error', duration: 6000 });
    } finally {
      if (seq === seqRef.current) setLoadingMore(false);
    }
  };

  const handleRowClick = (item: NotificationItem) => {
    if (!item.readAt) {
      const now = new Date().toISOString();
      const unreadCount = Math.max(0, page.unreadCount - 1);
      setPage((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - 1),
        items: prev.items.map((row) => (row.id === item.id ? { ...row, readAt: now } : row))
      }));
      if (bellCacheKey) writeLocalCache(bellCacheKey, unreadCount);
      apiRef.current.v1.notifications.markRead({ ids: [item.id] }).catch(() => {});
    }
    const href = notificationHref(item);
    if (href) navigate(href);
  };

  const handleMarkAllRead = async () => {
    if (marking) return;
    const previous = page;
    const now = new Date().toISOString();
    setMarking(true);
    setPage((prev) => ({ ...prev, unreadCount: 0, items: prev.items.map((row) => (row.readAt ? row : { ...row, readAt: now })) }));
    if (bellCacheKey) writeLocalCache(bellCacheKey, 0);
    try {
      await apiRef.current.v1.notifications.markRead({ all: true });
      lopu({ title: 'All caught up ✨', status: 'success', duration: 4000 });
    } catch (err: any) {
      setPage(previous);
      if (bellCacheKey) writeLocalCache(bellCacheKey, previous.unreadCount);
      lopu({ title: 'Could not mark everything read 😔', description: err?.error, status: 'error', duration: 6000 });
    } finally {
      setMarking(false);
    }
  };

  const resetFilters = () => {
    setQDraft('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const today = new Date().toISOString().slice(0, 10);
  const hasUnread = page.unreadCount > 0 || page.items.some((row) => !row.readAt);

  return (
    <PageShell width={760}>
      <PageHeader
        eyebrow="Thingtime · everything that reached you 🔔"
        title="Notifications 🔔"
        subtitle="Every notification you've received — social, engagement, feed, and system notes from Lopu. Filter by category or type, search, pick a window, and jump back to what happened."
        after={
          <Button size="xs" variant="outline" onClick={() => navigate('/settings')}>
            Settings ⚙️
          </Button>
        }
      />

      {user ? (
        <>
          {/* filters — the URL is the source of truth */}
          <Flex flexDirection="column" rowGap={3} background={CARD} border={BORDER} borderRadius={RADIUS} padding={[3, 4]}>
            <Flex role="group" aria-label="Category" columnGap={1} rowGap={1} flexWrap="wrap">
              <Chip active={filters.category === 'all'} onClick={() => updateFilters(withNotificationCategory(filters, 'all'))}>
                All
              </Chip>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  active={filters.category === category}
                  onClick={() => updateFilters(withNotificationCategory(filters, category))}
                  label={`${NOTIFICATION_CATEGORY_META[category].label} — ${NOTIFICATION_CATEGORY_META[category].hint}`}
                >
                  {NOTIFICATION_CATEGORY_META[category].emoji} {NOTIFICATION_CATEGORY_META[category].label}
                </Chip>
              ))}
            </Flex>

            <Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
              <Input
                size="sm"
                aria-label="Search notifications"
                placeholder="Search names, previews, action titles 🔍"
                value={qDraft}
                maxLength={100}
                onChange={(event) => setQDraft(event.target.value)}
                flex="1 1 220px"
                minWidth={0}
                {...inputStyles}
              />
              <Select
                size="sm"
                aria-label="Type"
                value={filters.type}
                onChange={(event) => {
                  const value = event.target.value;
                  updateFilters(withNotificationType(filters, isNotificationType(value) ? value : 'all'));
                }}
                width="auto"
                maxWidth="100%"
                {...inputStyles}
              >
                <option value="all">All types</option>
                {NOTIFICATION_CATEGORIES.map((category) => (
                  <optgroup key={category} label={NOTIFICATION_CATEGORY_META[category].label}>
                    {NOTIFICATION_TYPES_BY_CATEGORY[category].map((type) => (
                      <option key={type} value={type}>
                        {NOTIFICATION_TYPE_META[type].emoji} {NOTIFICATION_TYPE_META[type].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <Button
                size="sm"
                variant={filters.unread ? 'solid' : 'outline'}
                aria-pressed={filters.unread}
                onClick={() => updateFilters({ ...filters, unread: !filters.unread })}
              >
                Unread only
              </Button>
            </Flex>

            <Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
              <FieldLabel>From</FieldLabel>
              <Input
                size="sm"
                type="date"
                aria-label="From day"
                value={filters.since}
                max={filters.until || today}
                onChange={(event) => updateFilters({ ...filters, since: event.target.value })}
                width="auto"
                {...inputStyles}
              />
              <FieldLabel>To</FieldLabel>
              <Input
                size="sm"
                type="date"
                aria-label="To day"
                value={filters.until}
                min={filters.since || undefined}
                max={today}
                onChange={(event) => updateFilters({ ...filters, until: event.target.value })}
                width="auto"
                {...inputStyles}
              />
              {active && (
                <Button size="xs" variant="ghost" onClick={resetFilters}>
                  Reset filters ✕
                </Button>
              )}
            </Flex>
          </Flex>

          {/* summary + bulk action */}
          <Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingX={1}>
            <Text fontSize="xs" color={MUTED} aria-live="polite">
              {page.total === null
                ? loading
                  ? 'Loading…'
                  : `${page.items.length} shown`
                : `${page.total.toLocaleString()} ${page.total === 1 ? 'notification' : 'notifications'}${active ? ' match' : ''}`}
              {' · '}
              {page.unreadCount.toLocaleString()} unread
            </Text>
            <Box flex={1} />
            <Button size="xs" variant="outline" isLoading={marking} isDisabled={!hasUnread} onClick={handleMarkAllRead}>
              Mark all read ✓
            </Button>
          </Flex>

          {/* the list */}
          <Flex
            flexDirection="column"
            background={CARD}
            border={BORDER}
            borderRadius={RADIUS}
            padding={2}
            opacity={refreshing && !loading ? 0.6 : 1}
            transition="opacity 160ms ease"
            aria-busy={refreshing || loading}
          >
            {error && (
              <Flex alignItems="center" columnGap={2} paddingX={2} paddingY={2} flexWrap="wrap">
                <Text fontSize="xs" color="var(--tt-danger, #d6455a)">
                  {error}
                </Text>
                <Button size="xs" variant="outline" onClick={() => updateFilters({ ...filters })}>
                  Retry
                </Button>
              </Flex>
            )}

            {loading && (
              <Center paddingY={10}>
                <Spinner size="sm" color={MUTED} />
              </Center>
            )}

            {!loading && !error && page.items.length === 0 && (
              <Flex flexDirection="column" alignItems="center" rowGap={1} paddingY={12}>
                <Text fontSize="2xl" lineHeight="1">
                  {active ? '🔍' : '🕊️'}
                </Text>
                <Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
                  {active ? 'Nothing matches these filters' : 'All quiet — nothing here yet'}
                </Text>
                <Text fontSize="xs" color={MUTED} textAlign="center" paddingX={6}>
                  {active ? 'Loosen a filter or clear them all.' : 'Follows, comments, reactions, mentions, and your action runs will collect here.'}
                </Text>
                {active && (
                  <Button size="xs" variant="outline" marginTop={2} onClick={resetFilters}>
                    Clear filters
                  </Button>
                )}
              </Flex>
            )}

            {page.items.map((item) => (
              <NotificationRow key={item.id} item={item} onClick={handleRowClick} />
            ))}

            {page.nextBefore && !loading && (
              <Center paddingTop={2} paddingBottom={1}>
                <Button size="sm" variant="outline" isLoading={loadingMore} onClick={loadMore}>
                  Load older
                </Button>
              </Center>
            )}
          </Flex>

          <Text fontSize="10px" color={MUTED} paddingX={1}>
            Types you switch off in Settings → Notifications stay hidden here too. Thingtime keeps your newest 10,000 notifications.
          </Text>
        </>
      ) : (
        // signed-out quiet state — notifications are personal by construction
        <Flex
          flexDirection="column"
          alignItems="center"
          rowGap={2}
          paddingY={14}
          border="1px dashed var(--tt-border, #ececef)"
          borderRadius={RADIUS}
          background={CARD}
        >
          <Text fontSize="2xl" lineHeight="1">
            🔔
          </Text>
          <Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
            Your notification history lives here
          </Text>
          <Text fontSize="sm" color={MUTED} textAlign="center" paddingX={6}>
            <Link to="/login">
              <Text as="span" color="var(--tt-accent, #7c5cff)" fontWeight={600} _hover={{ textDecoration: 'underline' }}>
                Log in
              </Text>
            </Link>{' '}
            to see everything that has reached you.
          </Text>
        </Flex>
      )}
    </PageShell>
  );
};

// exported for the bell's "See all" deep link so the two agree on the grammar
export const notificationsHistoryPath = (filters?: Partial<NotificationFilters>): string => {
  if (!filters) return '/notifications';
  const params = notificationFiltersToParams({
    category: isNotificationCategory(filters.category) ? filters.category : 'all',
    type: isNotificationType(filters.type) ? filters.type : 'all',
    unread: !!filters.unread,
    q: filters.q || '',
    since: filters.since || '',
    until: filters.until || ''
  });
  const qs = params.toString();
  return qs ? `/notifications?${qs}` : '/notifications';
};
