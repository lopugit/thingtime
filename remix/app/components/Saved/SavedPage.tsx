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

// The /saved page: the viewer's private Saved library — posts they bookmarked
// via the 🔖 toggle on any card, newest-saved-first
// (GET /api/v1/things/saved). Cards are the SAME PostCards the feed renders,
// so reactions, comments, polls, and the bookmark itself all work in place.
// Optimistic first paint: the last-known library seeds synchronously from
// localStorage (tt-saved-<viewer>) and the fresh library reconciles in the
// background — a skeleton only ever shows on a true cold start (the
// ExplorePage pattern exactly). Unsaving a card removes it from the list
// optimistically; a failed unsave restores it in place.

// Cached entries are per-viewer AND timestamped: per-viewer because a library
// is personal by construction (and can carry private/circle posts — logout
// sweeps the tt-saved- prefix), timestamped so seeds merge through the
// viewer's reaction overlay stamped with the entry's write time.
type CachedLibrary = { at: number; posts: PublicPost[] };

const cacheKeyFor = (viewerId: string | null | undefined) => `tt-saved-${viewerId || 'anon'}`;

const readCachedLibrary = (key: string): PublicPost[] => {
  const entry = readLocalCache<CachedLibrary>(key);
  if (!entry || typeof entry.at !== 'number' || !Array.isArray(entry.posts)) return [];
  return mergeReactionOverlays(entry.at, entry.posts);
};

export const SavedPage = () => {
  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  // synchronous cache tier seeds the very first render (flash-free), scoped
  // to THIS viewer's slot and merged through the reaction overlay
  const cacheKey = cacheKeyFor(user?.id);
  const [posts, setPosts] = React.useState<PublicPost[]>(() => (user ? readCachedLibrary(cacheKey) : []));
  const [loading, setLoading] = React.useState(!!user && posts.length === 0);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);

  // a sequence guard drops stale responses when the viewer changes mid-flight
  const requestSeqRef = React.useRef(0);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const postsRef = React.useRef(posts);
  postsRef.current = posts;
  const nextCursorRef = React.useRef(nextCursor);
  nextCursorRef.current = nextCursor;
  // always-current viewer id / cache key so load() never joins the dep list
  const viewerIdRef = React.useRef(user?.id ?? null);
  viewerIdRef.current = user?.id ?? null;
  const cacheKeyRef = React.useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  // unsaved cards leave the list optimistically, but PostCard's failure
  // revert arrives as a function update for a post that is no longer IN the
  // list — stash removed cards (with their index) so a revert that flips
  // viewerSaved back on restores the card in place instead of losing it
  const removedRef = React.useRef(new Map<string, { post: PublicPost; index: number }>());

  const load = React.useCallback(async () => {
    if (!viewerIdRef.current) return; // signed-out: the quiet state renders instead
    const seq = ++requestSeqRef.current;
    const targetCacheKey = cacheKeyRef.current;
    // stamp the START — responses snapshotted before a reaction tap that
    // lands after it merge through the viewer's overlay, never clobber it
    const startedAt = Date.now();
    // optimistic: the cached library stays painted; a skeleton only appears
    // when there is genuinely nothing to show yet
    if (!postsRef.current.length) setLoading(true);

    try {
      const resp = await apiRef.current.v1.things.saved();
      if (seq !== requestSeqRef.current) return;
      const fresh = mergeReactionOverlays<PublicPost>(startedAt, resp.posts || []);
      removedRef.current.clear();
      setPosts(fresh);
      setNextCursor(resp.nextCursor || null);
      // `at: startedAt` (not write time) — a tap that raced this fetch still
      // outranks the cached copy on reseed (threadCache pattern)
      writeLocalCache(targetCacheKey, { at: startedAt, posts: fresh } satisfies CachedLibrary);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      // keep whatever library is already painted — stale beats blank; the
      // toast says why it isn't refreshing
      lopuRef.current({ title: err?.error || 'Could not load your Saved library 😞', status: 'error' });
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, []);

  const loadMore = React.useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || !viewerIdRef.current) return;
    const seq = requestSeqRef.current;
    const startedAt = Date.now();
    setLoadingMore(true);
    try {
      const resp = await apiRef.current.v1.things.saved({ cursor });
      if (seq !== requestSeqRef.current) return;
      const fresh = mergeReactionOverlays<PublicPost>(startedAt, resp.posts || []);
      setPosts((prev) => {
        const known = new Set(prev.map((post) => post.id));
        return [...prev, ...fresh.filter((post) => !known.has(post.id))];
      });
      setNextCursor(resp.nextCursor || null);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      lopuRef.current({ title: err?.error || 'Could not load more saved posts 😞', status: 'error' });
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false);
    }
  }, []);

  // tracks which viewer slot the painted library came from, so a login/logout
  // re-seeds instead of leaving the previous account's library on screen
  const seededKeyRef = React.useRef(cacheKey);

  React.useEffect(() => {
    if (seededKeyRef.current !== cacheKey) {
      seededKeyRef.current = cacheKey;
      const seeded = viewerIdRef.current ? readCachedLibrary(cacheKey) : [];
      removedRef.current.clear();
      setPosts(seeded);
      postsRef.current = seeded;
      setNextCursor(null);
      setLoading(!!viewerIdRef.current && seeded.length === 0);
    }
    load();
  }, [load, cacheKey]);

  const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
    setPosts((prev) => {
      const index = prev.findIndex((post) => post.id === id);
      if (index === -1) {
        // not in the list — maybe an optimistically-unsaved card reverting
        const stashed = removedRef.current.get(id);
        if (!stashed) return prev;
        const resolved = typeof next === 'function' ? next(stashed.post) : next;
        if (!resolved) {
          removedRef.current.delete(id);
          return prev;
        }
        if (resolved.viewerSaved === false) {
          removedRef.current.set(id, { ...stashed, post: resolved });
          return prev;
        }
        // the unsave failed and reverted — restore the card in place
        removedRef.current.delete(id);
        const restored = [...prev];
        restored.splice(Math.min(stashed.index, restored.length), 0, resolved);
        return restored;
      }
      const post = prev[index];
      const resolved = typeof next === 'function' ? next(post) : next;
      if (!resolved) return prev.filter((entry) => entry.id !== id);
      if (resolved.viewerSaved === false) {
        // unsaved (optimistically) — it leaves the library list, stashed for
        // a potential failure revert
        removedRef.current.set(id, { post: resolved, index });
        return prev.filter((entry) => entry.id !== id);
      }
      return prev.map((entry) => (entry.id === id ? resolved : entry));
    });
  }, []);

  // keyboard shortcuts (j/k/l/c/?) — same wiring as explore
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
            Thingtime · Your library · newest saves first 🔖
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
            Saved 🔖
          </Box>
        </Flex>

        {user ? (
          <>
            <FeedShortcutsContext.Provider value={shortcuts.registry}>
              <PostList
                posts={posts}
                loading={loading || loadingMore}
                hasMore={!!nextCursor}
                onLoadMore={loadMore}
                onPostChanged={handlePostChanged}
                focusedPostId={shortcuts.focusedPostId}
                emptyLabel="Nothing saved yet — tap the 🔖 on any post to keep it here"
              />
            </FeedShortcutsContext.Provider>

            <FeedShortcutsHelp isOpen={shortcuts.helpOpen} onClose={shortcuts.closeHelp} />
          </>
        ) : (
          // signed-out quiet state — a library is personal by construction
          <Flex
            flexDirection="column"
            alignItems="center"
            rowGap={2}
            paddingY={14}
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            background="var(--tt-card, #ffffff)"
          >
            <Text fontSize="2xl" lineHeight="1">
              🔖
            </Text>
            <Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
              Your Saved library lives here
            </Text>
            <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" textAlign="center" paddingX={6}>
              <Link to="/login">
                <Text as="span" color="var(--tt-accent, #7c5cff)" fontWeight={600} _hover={{ textDecoration: 'underline' }}>
                  Log in
                </Text>
              </Link>{' '}
              and tap the 🔖 on any post to keep it here.
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};
