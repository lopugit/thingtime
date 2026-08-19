import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { searchResponsePosts } from './AdvancedFilters';
import { POST_TYPE_META } from './feedTypes';
import type { PublicPost } from './feedTypes';

// "On this day" memories — a dismissible strip above the feed surfacing the
// viewer's OWN posts from this calendar day in previous years (never this
// year: today's posts are not memories). Renders nothing at all when there is
// nothing to show, so the feed never shifts.
//
// Timezone decision: "today" is the VIEWER's local calendar date — memories
// are personal, and someone in Sydney on the 19th shouldn't be shown the
// 18th's anniversaries because the server (or UTC) hasn't rolled over yet.
// Each per-year query window is the viewer's LOCAL calendar day of that
// historical year, converted to UTC instants: the local Date constructor
// (new Date(year, month, day)) yields that year's local midnight in the
// viewer's zone with the historically correct DST offset applied, so the
// window [local 00:00, next local 00:00) is exact for any viewer still in
// the timezone they posted from. A viewer who has since MOVED timezones can
// see posts near local midnight shift by the zone difference — an accepted
// approximation (fixing that would need the offset AT POSTING TIME, which we
// don't store).
//
// The current day is re-evaluated at local midnight (timer) and on window
// focus / tab visibility, so a tab left open across midnight drops
// yesterday's tiles + dismissal and fetches the new day's memories.

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const TEXT = 'var(--tt-text, #5a5a66)';

const MAX_YEARS_BACK = 10;
const MAX_TILES = 6;
// enough headroom over MAX_TILES that a year with several posts can't crowd
// out older years entirely before we slice (server caps at 50)
const FETCH_LIMIT = 18;

const cacheKey = (viewerId: string) => `tt-onthisday-${viewerId}`;

// One localCache entry per viewer (per-viewer key — cached snippets can be
// private/circle posts; useApi's logout sweeps the tt-onthisday- prefix):
// { at, day, posts } caches today's fetch so reopening the feed the same day
// paints instantly without a refetch; { dismissedDay } hides the card until
// the local day changes.
type OnThisDayCacheEntry = {
  at: number;
  day?: string;
  posts?: MemoryTile[];
  dismissedDay?: string;
};

export type MemoryTile = {
  id: string;
  // snippet text (post text, else listing title, else the type label)
  text: string;
  emoji: string;
  createdAt: string;
  yearsAgo: number;
};

// local 'YYYY-MM-DD' — the viewer's own calendar day (see timezone note above)
const localDay = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Viewer-local day ranges (as UTC instants) for this local month/day in each
// of the last MAX_YEARS_BACK years. Year offset 0 (this year) is deliberately
// excluded — the loop starts at back = 1, so no range can ever contain a post
// created this year. Feb 29 anniversaries only exist in leap years: the Date
// constructor rolls 29/02 to 01/03 in other years, which we detect and skip
// rather than show a wrong-day memory.
export const onThisDayRanges = (now = new Date()): { from: string; to: string; year: number }[] => {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const ranges: { from: string; to: string; year: number }[] = [];
  for (let back = 1; back <= MAX_YEARS_BACK; back++) {
    // local Date constructor = that year's local midnight in the viewer's
    // zone, with the historically correct DST offset (see timezone note)
    const start = new Date(year - back, month, day);
    if (start.getMonth() !== month || start.getDate() !== day) continue;
    // next local midnight via the same constructor (day + 1 rolls over), so
    // 23h/25h DST-transition days keep an exact [00:00, next 00:00) window;
    // inclusive-end grammar (between = $gte/$lte), so end 1ms before it
    const end = new Date(year - back, month, day + 1);
    ranges.push({
      from: start.toISOString(),
      to: new Date(end.getTime() - 1).toISOString(),
      year: year - back
    });
  }
  return ranges;
};

const toTiles = (posts: PublicPost[], todayYear: number): MemoryTile[] =>
  posts
    .map((post) => {
      const created = new Date(post.createdAt);
      // local year, matching the viewer-local query windows: a Sydney post at
      // Jan 1 00:30 local is Dec 31 UTC — the UTC year would be off by one
      const yearsAgo = todayYear - created.getFullYear();
      const snippet = (post.text || '').trim() || post.listing?.title?.trim() || POST_TYPE_META[post.type]?.label || 'A thing';
      return {
        id: post.id,
        text: snippet.slice(0, 140),
        emoji: POST_TYPE_META[post.type]?.emoji || '🌀',
        createdAt: post.createdAt,
        yearsAgo
      };
    })
    // belt-and-braces mirror of the query's year-0 exclusion — a tile can
    // never claim "0 years ago today"
    .filter((tile) => tile.yearsAgo >= 1)
    .slice(0, MAX_TILES);

type CardState = { viewerId: string | null; day: string; tiles: MemoryTile[]; dismissed: boolean };

// synchronous seed from localCache (optimistic rendering: cached same-day
// results paint on the very first render, no refetch, no flash)
const seedState = (viewerId: string | null, today: string): CardState => {
  if (!viewerId) return { viewerId, day: today, tiles: [], dismissed: false };
  const entry = readLocalCache<OnThisDayCacheEntry>(cacheKey(viewerId));
  return {
    viewerId,
    day: today,
    tiles: entry?.day === today && Array.isArray(entry.posts) ? entry.posts : [],
    dismissed: entry?.dismissedDay === today
  };
};

export const MemoriesCard = () => {
  const api = useApi();
  const user = useCurrentUser();
  const viewerId = user?.id ?? null;
  const username = user?.username ?? null;

  const apiRef = React.useRef(api);
  apiRef.current = api;

  // the viewer's current local day, kept live so a tab left open across
  // midnight rolls over: re-checked at the next local midnight (timer) and on
  // window focus / tab visibility (the background-reconcile pattern)
  const [day, setDay] = React.useState(() => localDay());
  React.useEffect(() => {
    const refreshDay = () => {
      const next = localDay();
      setDay((prev) => (prev === next ? prev : next));
    };
    const now = new Date();
    // next local midnight + 1s buffer; re-arms via the day dep when it fires
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(refreshDay, Math.max(1000, nextMidnight.getTime() - now.getTime() + 1000));
    window.addEventListener('focus', refreshDay);
    document.addEventListener('visibilitychange', refreshDay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshDay);
      document.removeEventListener('visibilitychange', refreshDay);
    };
  }, [day]);

  const [state, setState] = React.useState<CardState>(() => seedState(viewerId, day));
  // account switch mid-mount, or the local day rolling over: re-seed during
  // render so one account's (or yesterday's) memories never flash into the
  // new session/day — yesterday's dismissal also resets here
  if (state.viewerId !== viewerId || state.day !== day) setState(seedState(viewerId, day));

  React.useEffect(() => {
    if (!viewerId || !username) return;
    const key = cacheKey(viewerId);
    const today = day;
    const entry = readLocalCache<OnThisDayCacheEntry>(key);
    // dismissed today → stay hidden (and skip the fetch entirely); cached for
    // today → the seed already painted it, nothing to refetch until tomorrow
    if (entry?.dismissedDay === today) return;
    if (entry?.day === today && Array.isArray(entry.posts)) return;

    const ranges = onThisDayRanges();
    if (!ranges.length) return; // Feb 29 with no leap years in the window

    let cancelled = false;
    (async () => {
      try {
        // ONE structured search: own posts (author → ownerId), posts-only
        // across both eras (thingtime: 'post'), comments excluded (rich
        // comments are ["post","comment"] things), OR-group of per-year UTC
        // day ranges — the grammar's nested { mode: 'any' } group.
        const resp = await apiRef.current.v1.things.search({
          author: username,
          thingtime: 'post',
          conditions: [
            { field: 'thingtime', op: 'ne', value: 'comment' },
            {
              mode: 'any',
              conditions: ranges.map((range) => ({
                field: 'createdAt',
                op: 'between',
                values: [range.from, range.to]
              }))
            }
          ],
          sort: 'newest',
          limit: FETCH_LIMIT
        });
        if (cancelled) return;
        const tiles = toTiles(searchResponsePosts(resp), new Date().getFullYear());
        // cache even when empty so the feed doesn't re-query all day
        writeLocalCache(key, { at: Date.now(), day: today, posts: tiles } satisfies OnThisDayCacheEntry);
        // state carries the fetched day: if midnight passed mid-flight, the
        // render-time day guard re-seeds and the effect re-runs for the new day
        setState({ viewerId, day: today, tiles, dismissed: false });
      } catch {
        // ambient card — a failed lookup renders nothing rather than toasting
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewerId, username, day]);

  const dismiss = React.useCallback(() => {
    if (!viewerId) return;
    const key = cacheKey(viewerId);
    const entry = readLocalCache<OnThisDayCacheEntry>(key);
    writeLocalCache(key, { ...(entry || {}), at: Date.now(), dismissedDay: localDay() });
    setState((prev) => ({ ...prev, dismissed: true }));
  }, [viewerId]);

  // nothing to show → render NOTHING (zero layout shift while loading too)
  if (!viewerId || state.dismissed || !state.tiles.length) return null;

  return (
    <Flex
      flexDirection="column"
      rowGap={3}
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      background="linear-gradient(135deg, var(--tt-card, #ffffff) 55%, var(--tt-surface-alt, #f5f5f7))"
      padding={4}
      data-testid="onthisday-card"
    >
      <Flex alignItems="flex-start" columnGap={2}>
        <Flex flexDirection="column" rowGap={1} minWidth={0}>
          <Box
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.08em"
            textTransform="uppercase"
            color={MUTED}
          >
            Memories · your posts 🕰️
          </Box>
          <Text fontSize="sm" fontWeight={700} color={TEXT}>
            On this day
          </Text>
        </Flex>
        <Box
          as="button"
          type="button"
          aria-label="Dismiss memories for today"
          onClick={dismiss}
          marginLeft="auto"
          fontSize="14px"
          lineHeight={1}
          color={MUTED}
          border={BORDER}
          borderRadius="8px"
          background="var(--tt-card, #ffffff)"
          padding="6px 8px"
          cursor="pointer"
          _hover={{ color: TEXT }}
        >
          ✕
        </Box>
      </Flex>

      <Flex columnGap={3} overflowX="auto" paddingBottom={1} data-testid="onthisday-tiles">
        {state.tiles.map((tile) => (
          <Box
            key={tile.id}
            as={Link}
            to={`/post/${tile.id}`}
            flexShrink={0}
            width="200px"
            border={BORDER}
            borderRadius="12px"
            background="var(--tt-card, #ffffff)"
            padding={3}
            _hover={{ borderColor: 'var(--tt-muted, #9a9aa6)' }}
          >
            <Flex flexDirection="column" rowGap={2} height="100%">
              <Text fontSize="sm" color={TEXT} noOfLines={3} wordBreak="break-word">
                {tile.emoji} {tile.text}
              </Text>
              <Box
                marginTop="auto"
                fontFamily="mono"
                fontSize="10px"
                fontWeight={600}
                letterSpacing="0.04em"
                color={MUTED}
              >
                {tile.yearsAgo === 1 ? '1 year ago today 🕰️' : `${tile.yearsAgo} years ago today 🕰️`}
              </Box>
            </Flex>
          </Box>
        ))}
      </Flex>
    </Flex>
  );
};
