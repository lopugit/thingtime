import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// GitHub-style contribution heatmap of a profile's viewer-visible things over
// the last year (GET /api/v1/users/activity — day-counts only, so the grid is
// privacy-cheap by construction). Optimistic rendering: the last-known grid
// paints instantly from the synchronous localCache tier and the fresh counts
// reconcile in the background. The cache key is PER-VIEWER — anonymous, a
// friend, and the owner each see different counts for the same profile, and
// one account's view must never flash for the next.
//
// Renders nothing at all (no empty box) until data exists, and nothing when
// the profile has zero visible things.

type ActivityData = { days: Record<string, number>; total: number };
type ActivityCacheEntry = { at: number; days: Record<string, number>; total: number };

const MS_DAY = 86_400_000;
const WEEKS = 53;
const CELL = 10;
const GAP = 2;
const STEP = CELL + GAP; // 12
const MONTH_ROW = 16;
const GRID_WIDTH = WEEKS * STEP - GAP;
// room past the last column so a month label landing on the newest weeks
// isn't clipped by the svg edge (inline svg overflow is hidden)
const LABEL_PAD = 14;
const SVG_WIDTH = GRID_WIDTH + LABEL_PAD;
const GRID_HEIGHT = MONTH_ROW + 7 * STEP - GAP;

// Theme-aware 5-step intensity scale: level 0 is the neutral surface tint and
// levels 1–4 mix the theme accent over it, so the ramp tracks whatever theme
// (light or dark) is active — the icons.tsx var(--tt-accent) idiom.
const LEVEL_FILLS = [
  'var(--tt-surface-alt, #f5f5f7)',
  'color-mix(in srgb, var(--tt-accent, #a555e8) 25%, var(--tt-surface-alt, #f5f5f7))',
  'color-mix(in srgb, var(--tt-accent, #a555e8) 50%, var(--tt-surface-alt, #f5f5f7))',
  'color-mix(in srgb, var(--tt-accent, #a555e8) 75%, var(--tt-surface-alt, #f5f5f7))',
  'var(--tt-accent, #a555e8)'
];

const levelOf = (count: number, max: number): number => {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
};

// epoch ms → UTC midnight of that day (epoch is UTC-aligned)
const utcMidnight = (ms: number): number => ms - (ms % MS_DAY);

const dayKeyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const TOOLTIP_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

const readCached = (key: string): ActivityData | null => {
  const entry = readLocalCache<ActivityCacheEntry>(key);
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.total !== 'number' || !entry.days || typeof entry.days !== 'object') return null;
  return { days: entry.days, total: entry.total };
};

type Cell = { key: string; week: number; day: number; count: number; level: number };
type MonthMark = { week: number; label: string };

// GitHub grid geometry: columns are weeks (Sunday-first), the last column is
// the current (possibly partial) UTC week, 53 columns back.
const buildGrid = (days: Record<string, number>): { cells: Cell[]; months: MonthMark[] } => {
  const todayMs = utcMidnight(Date.now());
  const todayDow = new Date(todayMs).getUTCDay();
  const startMs = todayMs - ((WEEKS - 1) * 7 + todayDow) * MS_DAY;

  const cells: Cell[] = [];
  let max = 0;
  for (const key of Object.keys(days)) max = Math.max(max, days[key] || 0);

  const months: MonthMark[] = [];
  let prevMonth = -1;
  for (let week = 0; week < WEEKS; week++) {
    const columnMs = startMs + week * 7 * MS_DAY;
    const month = new Date(columnMs).getUTCMonth();
    if (month !== prevMonth) {
      if (prevMonth !== -1) months.push({ week, label: MONTH_LABEL.format(new Date(columnMs)) });
      prevMonth = month;
    }
    for (let day = 0; day < 7; day++) {
      const ms = columnMs + day * MS_DAY;
      if (ms > todayMs) break;
      const key = dayKeyOf(ms);
      const count = days[key] || 0;
      cells.push({ key, week, day, count, level: levelOf(count, max) });
    }
  }
  // drop a month label that would collide with its neighbour at the seam
  const spaced = months.filter((mark, index) => index === months.length - 1 || months[index + 1].week - mark.week >= 3);
  return { cells, months: spaced };
};

export type ActivityHeatmapProps = {
  username: string;
};

export const ActivityHeatmap = (props: ActivityHeatmapProps) => {
  const { username } = props;
  const user = useCurrentUser();
  const api = useApi();
  const getActivity = api.v1.profile.activity;

  // per-viewer, per-profile cache key — see the header comment
  const cacheKey = `tt-activity-${user?.id || 'anon'}-${username.toLowerCase()}`;

  const cached = React.useMemo(() => readCached(cacheKey), [cacheKey]);
  const [fresh, setFresh] = React.useState<{ key: string; data: ActivityData } | null>(null);
  const data = fresh && fresh.key === cacheKey ? fresh.data : cached;

  React.useEffect(() => {
    let cancelled = false;
    getActivity({ username })
      .then((resp: any) => {
        if (cancelled || !resp || resp.ok === false) return;
        if (typeof resp.total !== 'number' || !resp.days || typeof resp.days !== 'object') return;
        const next: ActivityData = { days: resp.days, total: resp.total };
        writeLocalCache(cacheKey, { at: Date.now(), ...next } satisfies ActivityCacheEntry);
        setFresh({ key: cacheKey, data: next });
      })
      .catch(() => {
        // background refetch — the cached grid (or nothing) stays up
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, username, getActivity]);

  const grid = React.useMemo(() => (data && data.total > 0 ? buildGrid(data.days) : null), [data]);

  // today lives in the rightmost column — keep it in view on narrow screens
  const scrollRef = React.useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = node.scrollWidth;
  }, []);

  if (!data || data.total <= 0 || !grid) return null;

  return (
    <Box mt={8} px={[4, 6]}>
      <Text
        fontFamily="mono"
        fontSize="10px"
        fontWeight={600}
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="var(--tt-muted, #9a9aa6)"
        mb={3}
      >
        Activity
      </Text>

      {/* the grid scrolls inside its own container — it must never widen the page */}
      <Box ref={scrollRef} width="100%" overflowX="auto" overflowY="hidden">
        <Box as="svg" width={`${SVG_WIDTH}px`} height={`${GRID_HEIGHT}px`} minWidth={`${SVG_WIDTH}px`} display="block" aria-hidden={false}>
          {grid.months.map((mark) => (
            <text
              key={`m-${mark.week}`}
              x={mark.week * STEP}
              y={10}
              fontSize="9px"
              fontFamily="var(--tt-font-mono, monospace)"
              fill="var(--tt-muted, #9a9aa6)"
            >
              {mark.label}
            </text>
          ))}
          {grid.cells.map((cell) => (
            <rect
              key={cell.key}
              x={cell.week * STEP}
              y={MONTH_ROW + cell.day * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              fill={LEVEL_FILLS[cell.level]}
            >
              <title>{`${cell.count} thing${cell.count === 1 ? '' : 's'} · ${TOOLTIP_DATE.format(new Date(cell.key))}`}</title>
            </rect>
          ))}
        </Box>
      </Box>

      <Flex mt={2} alignItems="center" columnGap={2}>
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          {data.total} thing{data.total === 1 ? '' : 's'} in the last year 🌱
        </Text>
        <Flex marginLeft="auto" alignItems="center" columnGap="3px">
          <Text fontSize="10px" color="var(--tt-muted, #9a9aa6)" mr="2px">
            Less
          </Text>
          {LEVEL_FILLS.map((fill) => (
            <Box key={fill} width="10px" height="10px" borderRadius="2px" background={fill} />
          ))}
          <Text fontSize="10px" color="var(--tt-muted, #9a9aa6)" ml="2px">
            More
          </Text>
        </Flex>
      </Flex>
    </Box>
  );
};
