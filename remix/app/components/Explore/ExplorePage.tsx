import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { FeedShortcutsContext, useFeedShortcuts } from '~/hooks/useFeedShortcuts';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import { FeedShortcutsHelp } from '~/components/Feed/FeedShortcutsHelp';
import { PostList } from '~/components/Feed/PostList';
import { mergeReactionOverlays } from '~/components/Feed/reactionOverlay';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { SubspaceCard } from '~/components/Subspaces/SubspaceCard';
import { EXPLORE_POPULAR_SUBSPACES, type PublicSubspace } from '~/components/Subspaces/subspaceTypes';

// The /explore page: a "Popular subspaces" strip (the top
// EXPLORE_POPULAR_SUBSPACES by member count — GET /api/v1/subspaces?sort=
// members) above the trending board — public posts from the last week
// ranked by time-decayed engagement (GET /api/v1/things/trending). Guest-
// visible by design (the pool is public-only either way); cards are the SAME
// PostCards the feed renders, so reactions, comments, and polls all work in
// place. Optimistic first paint: the last-known board seeds synchronously
// from localStorage (tt-explore-<viewer>) and the fresh board reconciles in
// the background — a skeleton only ever shows on a true cold start. The strip
// seeds the same way (tt-explore-subspaces-<viewer>: rows carry the viewer's
// own membership state) and simply stays away when there is nothing to show.

// Cached entries are per-viewer AND timestamped. Per-viewer because the
// projection carries personalised fields (viewerReactions, poll viewerVote) —
// one account's board must never first-paint for the next viewer of the same
// browser (sibling caches all scope by user id: tt-messenger-*, tt-things-*,
// tt-recent-reactions). Timestamped so seeds can merge through the viewer's
// reaction overlay stamped with the entry's write time (threadCache pattern) —
// a cached copy older than this session's last tap can't repaint the stale
// reaction state.
type CachedBoard = { at: number; posts: PublicPost[] };

const cacheKeyFor = (viewerId: string | null | undefined) => `tt-explore-${viewerId || 'anon'}`;
type CachedStrip = { at: number; subspaces: PublicSubspace[] };
const stripCacheKeyFor = (viewerId: string | null | undefined) => `tt-explore-subspaces-${viewerId || 'anon'}`;
const readCachedStrip = (key: string): PublicSubspace[] => {
  const entry = readLocalCache<CachedStrip>(key);
  return entry && Array.isArray(entry.subspaces) ? entry.subspaces : [];
};

const readCachedBoard = (key: string): PublicPost[] => {
  const entry = readLocalCache<CachedBoard>(key);
  // shape check also retires any pre-timestamp raw-array cache gracefully
  if (!entry || typeof entry.at !== 'number' || !Array.isArray(entry.posts)) return [];
  return mergeReactionOverlays(entry.at, entry.posts);
};

export const ExplorePage = () => {
  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  // synchronous cache tier seeds the very first render (flash-free), scoped
  // to THIS viewer's slot and merged through the reaction overlay
  const cacheKey = cacheKeyFor(user?.id);
  const [posts, setPosts] = React.useState<PublicPost[]>(() => readCachedBoard(cacheKey));
  const [loading, setLoading] = React.useState(posts.length === 0);
  // the Popular subspaces strip — same per-viewer, flash-free seeding
  const stripCacheKey = stripCacheKeyFor(user?.id);
  const [popular, setPopular] = React.useState<PublicSubspace[]>(() => readCachedStrip(stripCacheKey));

  // a sequence guard drops stale responses when the viewer changes mid-flight
  const requestSeqRef = React.useRef(0);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const postsRef = React.useRef(posts);
  postsRef.current = posts;
  // always-current viewer id so load() can flag logged-out fetches as
  // edge-cacheable (`anon=1`) without joining the callback's dep list
  const viewerIdRef = React.useRef(user?.id ?? null);
  viewerIdRef.current = user?.id ?? null;
  // always-current cache key so load() writes the right viewer's slot
  const cacheKeyRef = React.useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const stripCacheKeyRef = React.useRef(stripCacheKey);
  stripCacheKeyRef.current = stripCacheKey;

  // the strip loads beside the board and fails quietly — trending's own toast
  // already says the page isn't refreshing, and a stale strip beats none
  const loadPopular = React.useCallback(async () => {
    const seq = requestSeqRef.current;
    const targetCacheKey = stripCacheKeyRef.current;
    try {
      // logged-out fetches are flagged edge-cacheable (`anon=1`) like trending
      const resp: any = await apiRef.current.v1.subspaces.list({ sort: 'members', limit: EXPLORE_POPULAR_SUBSPACES, anon: viewerIdRef.current ? undefined : 1 });
      if (seq !== requestSeqRef.current) return;
      const fresh: PublicSubspace[] = Array.isArray(resp?.subspaces) ? resp.subspaces : [];
      setPopular(fresh);
      writeLocalCache(targetCacheKey, { at: Date.now(), subspaces: fresh } satisfies CachedStrip);
    } catch {
      // keep whatever strip is painted
    }
  }, []);

  const load = React.useCallback(async () => {
    const seq = ++requestSeqRef.current;
    // snapshot the slot this fetch belongs to — a response that survives the
    // sequence guard must never land in a different viewer's cache
    const targetCacheKey = cacheKeyRef.current;
    // stamp the START — responses snapshotted before a reaction tap that
    // lands after it merge through the viewer's overlay, never clobber it
    const startedAt = Date.now();
    // optimistic: the cached board stays painted; a skeleton only appears
    // when there is genuinely nothing to show yet
    if (!postsRef.current.length) setLoading(true);

    try {
      const resp = await apiRef.current.v1.things.trending(viewerIdRef.current ? undefined : { anon: 1 });
      if (seq !== requestSeqRef.current) return;
      const fresh = mergeReactionOverlays<PublicPost>(startedAt, resp.posts || []);
      setPosts(fresh);
      // `at: startedAt` (not write time) — same stamp threadCache persists, so
      // a tap that raced this fetch still outranks the cached copy on reseed
      writeLocalCache(targetCacheKey, { at: startedAt, posts: fresh } satisfies CachedBoard);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      // keep whatever board is already painted — trending going stale beats a
      // blank page; the toast says why it isn't refreshing
      lopuRef.current({ title: err?.error || 'Could not load trending 😞', status: 'error' });
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  // tracks which viewer slot the painted board came from, so a login/logout
  // re-seeds instead of leaving the previous account's board on screen
  const seededKeyRef = React.useRef(cacheKey);

  // initial fetch + refetch when the viewer changes. On a viewer switch the
  // old board is personalised to the previous account, so drop it and re-seed
  // from the NEW viewer's cache slot (empty slot → skeleton: it genuinely is
  // a cold start for this viewer) before the background reconcile lands.
  React.useEffect(() => {
    if (seededKeyRef.current !== cacheKey) {
      seededKeyRef.current = cacheKey;
      const seeded = readCachedBoard(cacheKey);
      setPosts(seeded);
      // sync the mirror immediately so the load() call below decides its
      // skeleton from the re-seeded board, not the dropped one
      postsRef.current = seeded;
      setLoading(seeded.length === 0);
      setPopular(readCachedStrip(stripCacheKeyFor(user?.id)));
    }
    load();
    loadPopular();
  }, [load, loadPopular, cacheKey, user?.id]);

  const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
    setPosts((prev) =>
      prev.flatMap((post) => {
        if (post.id !== id) return [post];
        const resolved = typeof next === 'function' ? next(post) : next;
        return resolved ? [resolved] : [];
      })
    );
  }, []);

  // keyboard shortcuts (j/k/l/c/?) — same wiring as the feed, minus the
  // composer (`n` stays unhandled here: explore has nowhere to compose)
  const postIds = React.useMemo(() => posts.map((post) => post.id), [posts]);
  const shortcuts = useFeedShortcuts({ postIds });

  return (
    <Flex
      justifyContent="center"
      width="100%"
      minHeight="100vh"
      background="var(--tt-surface, #fafafb)"
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      paddingBottom={16}
    >
      <Flex
        flexDirection="column"
        rowGap={4}
        width={['100%', '680px']}
        maxWidth="100%"
        paddingX={4}
        paddingTop={[4, 6]}
      >
        {/* header */}
        <Flex flexDirection="column" rowGap={1}>
          <Box
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
          >
            Thingtime · Hot this week · fresh engagement first 📈
          </Box>
          <Box
            as="h1"
            fontFamily="heading"
            fontSize="2xl"
            fontWeight={700}
            letterSpacing="-0.02em"
            background={RAINBOW_TEXT}
            backgroundSize="calc(100px + 200%)"
            sx={{
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
            }}
          >
            Trending 🔥
          </Box>
        </Flex>

        {popular.length > 0 && (
          <Flex flexDirection="column" rowGap={2} data-testid="explore-popular-subspaces">
            <Flex alignItems="baseline" columnGap={2}>
              <Text fontFamily="mono" fontSize="11px" fontWeight={700} color="var(--tt-muted, #9a9aa6)">
                Popular subspaces 🪐
              </Text>
              <Box
                as={Link}
                to="/s?sort=members"
                marginLeft="auto"
                fontSize="12px"
                fontWeight={600}
                color="var(--tt-muted, #9a9aa6)"
                _hover={{ color: 'var(--tt-ink, #16161a)' }}
                data-testid="explore-popular-subspaces-all"
              >
                All subspaces →
              </Box>
            </Flex>
            {/* a horizontal strip that scrolls INSIDE its own box — the page
                never grows a horizontal scrollbar at 375px */}
            <Flex
              columnGap={2}
              overflowX="auto"
              paddingBottom={1}
              marginX={-1}
              paddingX={1}
              sx={{ scrollbarWidth: 'thin', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
            >
              {popular.map((subspace) => (
                <Box key={subspace.id} width="260px" minWidth="220px" flexShrink={0} sx={{ scrollSnapAlign: 'start' }}>
                  <SubspaceCard subspace={subspace} compact />
                </Box>
              ))}
            </Flex>
          </Flex>
        )}

        <FeedShortcutsContext.Provider value={shortcuts.registry}>
          <PostList
            posts={posts}
            loading={loading}
            hasMore={false}
            onLoadMore={() => {}}
            onPostChanged={handlePostChanged}
            focusedPostId={shortcuts.focusedPostId}
            emptyLabel="Nothing is trending yet — go start something 🔥"
          />
        </FeedShortcutsContext.Provider>

        <FeedShortcutsHelp isOpen={shortcuts.helpOpen} onClose={shortcuts.closeHelp} />
      </Flex>
    </Flex>
  );
};
