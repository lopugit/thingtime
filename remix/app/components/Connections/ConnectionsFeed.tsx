import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useSearchParams } from 'react-router';

import { PostCard } from '~/components/Feed/PostCard';
import { mergeReactionOverlays } from '~/components/Feed/reactionOverlay';
import type { FeedFilterMatch, PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { appendFeedPage, cardStyle, type Connection } from './shared';

// /connections/feed — browse connected third-party feeds as native Thingtime
// posts. PostCard renders each external post, so comments and reactions work
// exactly like the home feed. The viewer's AI feed filters veil ('warn' + a
// Show button) or drop ('hide') matched posts before they render.

const PAGE_SIZE = 20;
const feedCacheKey = (connection: string | null) => `tt-connections-feed:${connection || 'all'}`;

const warnMatches = (post: PublicPost): FeedFilterMatch[] => (post.feedFilterMatches || []).filter((match) => match.action === 'warn');
const hideMatches = (post: PublicPost): FeedFilterMatch[] => (post.feedFilterMatches || []).filter((match) => match.action === 'hide');

// The veil: a matched 'warn' filter covers the post until the viewer clicks
// Show — the exact "warn for sad news, with a button to click 'show'" flow.
const VeiledPost = (props: { post: PublicPost; matches: FeedFilterMatch[]; onShow: () => void }) => (
  <Box {...cardStyle} padding={5} textAlign="center">
    <Text fontSize="xl">⚠️</Text>
    <Text fontWeight="600" marginTop={1}>
      Veiled by your “{props.matches[0]?.name}” filter
    </Text>
    <Text fontSize="sm" color="var(--tt-muted, #6b7280)" marginTop={1}>
      {props.matches[0]?.reason ? `${props.matches[0].reason} · ` : ''}
      via {props.matches[0]?.source === 'heuristic' ? 'keyword match' : props.matches[0]?.source === 'claude' ? 'Claude 🤖' : 'ChatGPT 🤖'}
    </Text>
    <Button size="sm" marginTop={3} borderRadius="999px" variant="outline" onClick={props.onShow}>
      Show anyway
    </Button>
  </Box>
);

export const ConnectionsFeedPage = () => {
  const api = useApi();
  const lopu = useLopu();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeConnection = searchParams.get('connection');

  const [posts, setPosts] = React.useState<PublicPost[]>(
    () => readLocalCache<PublicPost[]>(feedCacheKey(activeConnection)) || []
  );
  const [connections, setConnections] = React.useState<Connection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState<Set<string>>(() => new Set());
  const [signedOut, setSignedOut] = React.useState(false);
  const requestSeq = React.useRef(0);
  // one provider-deepening pass per exhausted scroll — reset when the tab
  // changes or fresh pages arrive
  const deepenedRef = React.useRef(false);

  const load = React.useCallback(
    async (connection: string | null, cursor: string | null, deferSync = false) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      const startedAt = Date.now();
      try {
        const resp = await api.v1.connections.feed({
          connection: connection || undefined,
          cursor: cursor || undefined,
          limit: PAGE_SIZE,
          ...(deferSync ? { sync: 'defer' } : {})
        });
        if (seq !== requestSeq.current) return;
        const merged = mergeReactionOverlays(startedAt, (resp.posts || []) as PublicPost[]);
        // appended pages can overlap what is already rendered (see
        // appendFeedPage) — a plain concat would repeat a post and duplicate
        // its React key
        setPosts((current) => (cursor ? appendFeedPage(current, merged) : merged));
        if (!cursor) writeLocalCache(feedCacheKey(connection), merged.slice(0, PAGE_SIZE));
        setNextCursor(resp.nextCursor || null);
        // a narrowed read returns only the selected connection — never let it
        // collapse the tab bar built from the full list
        if (!connection) setConnections(resp.connections || []);
        setSignedOut(false);
        const failed = (resp.synced || []).filter((entry: any) => entry.error);
        if (failed.length) {
          lopu({
            title: `Some feeds could not sync: ${failed.map((entry: any) => `${entry.provider} (${entry.error})`).join('; ')}`,
            status: 'info',
            duration: 8000
          });
        }
      } catch (err: any) {
        if (seq !== requestSeq.current) return;
        if (err?.status === 401) setSignedOut(true);
        else lopu({ title: err?.error || 'Could not load your connected feed 😞', status: 'error' });
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  React.useEffect(() => {
    // keep last-known posts painted while the fresh page loads (house rule);
    // reseed from the per-tab cache when the tab changes
    setPosts(readLocalCache<PublicPost[]>(feedCacheKey(activeConnection)) || []);
    setNextCursor(null);
    deepenedRef.current = false;
    // stale-while-revalidate: the defer read paints the stored feed instantly
    // (no provider fan-out on the request), then the full read syncs fresh —
    // a second request, because serverless can't background work after a
    // response. The seq guard makes the fresh read supersede cleanly.
    load(activeConnection, null, true).then(() => load(activeConnection, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection, load]);

  // landing directly on a narrowed URL: the feed response carries only that
  // connection, so bootstrap the tab bar from the full list once
  React.useEffect(() => {
    if (!activeConnection) return;
    let cancelled = false;
    api.v1.connections
      .list()
      .then((resp: any) => {
        if (!cancelled && Array.isArray(resp?.connections) && resp.connections.length) setConnections(resp.connections);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection]);

  // PostCard calls onChanged(id, change) — the id comes FIRST precisely so one
  // stable handler serves every card (PostCardProps.onChanged), which is why
  // every other call site passes this straight through rather than wrapping it.
  const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
    setPosts((current) =>
      current.flatMap((post) => {
        if (post.id !== id) return [post];
        const value = typeof next === 'function' ? next(post) : next;
        return value ? [value] : [];
      })
    );
  }, []);

  const hiddenCount = posts.filter((post) => hideMatches(post).length > 0).length;
  const visible = posts.filter((post) => hideMatches(post).length === 0);

  // infinite scroll sentinel: page through what's synced; once the local
  // store runs dry, ask the providers for older content (deepen), then keep
  // paging from where the reader already is — never resetting their scroll
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const deepenAndContinue = React.useCallback(async () => {
    try {
      // sync side effect only: raises the account sync depth and pulls older
      // items into the store (server caps the depth)
      await api.v1.connections.feed({ connection: activeConnection || undefined, limit: 1, deepen: '1' });
    } catch {
      return;
    }
    const last = posts[posts.length - 1];
    const lastMs = last ? new Date(last.createdAt).getTime() : NaN;
    // Never send a cursor the server would reject — an ignored cursor returns
    // page 1, i.e. content the reader has already scrolled past.
    //
    // This cursor is deliberately APPROXIMATE in the safe direction. The server
    // pages membership rows and mints cursors from their `ext-source-…`
    // shareIds; all the client has is the post's `ext-post-…` id. Since the
    // chrono tiebreak is `shareId > cursorId` at an equal createdAt, and
    // `ext-source-…` sorts after `ext-post-…`, the boundary timestamp is
    // re-read rather than skipped — nothing is ever lost, and appendFeedPage
    // absorbs the resulting overlap.
    const syntheticCursor = Number.isFinite(lastMs) && lastMs > 0 && last ? `${lastMs}_${last.id}` : null;
    if (!syntheticCursor) return;
    await load(activeConnection, syntheticCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnection, posts, load]);
  const loadMoreRef = React.useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (loading) return;
    if (nextCursor) {
      load(activeConnection, nextCursor);
    } else if (posts.length && !deepenedRef.current) {
      deepenedRef.current = true;
      deepenAndContinue();
    }
  };
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      maxWidth="680px"
      marginX="auto"
      paddingX={[3, 4]}
      paddingBottom={[5, 7]}
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      display="flex"
      flexDirection="column"
      rowGap={4}
    >
      <Flex alignItems="center" justifyContent="space-between" flexWrap="wrap" rowGap={2}>
        <Text as="h1" fontSize="xl" fontWeight="700">
          Connected feed 📡
        </Text>
        <Button as={Link} to="/connections" size="sm" variant="outline" borderRadius="999px">
          Manage connections
        </Button>
      </Flex>

      {/* connection tabs */}
      {connections.length ? (
        <Flex columnGap={2} rowGap={2} flexWrap="wrap">
          <Button
            size="xs"
            borderRadius="999px"
            variant={!activeConnection ? 'solid' : 'outline'}
            onClick={() => setSearchParams({})}
          >
            All
          </Button>
          {connections.map((connection) => (
            <Button
              key={connection.id}
              size="xs"
              borderRadius="999px"
              variant={activeConnection === connection.id ? 'solid' : 'outline'}
              onClick={() => setSearchParams({ connection: connection.id })}
              title={connection.lastSyncError || undefined}
            >
              {connection.providerIcon} {connection.account.displayName}
              {connection.lastSyncError ? ' ⚠️' : ''}
            </Button>
          ))}
        </Flex>
      ) : null}

      {signedOut ? (
        <Box {...cardStyle} padding={6} textAlign="center">
          <Text fontWeight="600">Sign in to browse your connected feeds</Text>
          <Flex justifyContent="center" columnGap={3} marginTop={4}>
            <Button as={Link} to="/login" size="sm" borderRadius="999px">
              Log in 🗝️
            </Button>
          </Flex>
        </Box>
      ) : null}

      {hiddenCount > 0 ? (
        <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
          🛡️ {hiddenCount} post{hiddenCount === 1 ? '' : 's'} hidden by your filters
        </Text>
      ) : null}

      {visible.map((post) => {
        const veils = warnMatches(post);
        if (veils.length && !revealed.has(post.id)) {
          return (
            <VeiledPost
              key={post.id}
              post={post}
              matches={veils}
              onShow={() => setRevealed((current) => new Set(current).add(post.id))}
            />
          );
        }
        return <PostCard key={post.id} post={post} onChanged={handlePostChanged} />;
      })}

      {!visible.length && !loading && !signedOut ? (
        <Box {...cardStyle} padding={6} textAlign="center">
          <Text fontWeight="600">Nothing here yet</Text>
          <Text fontSize="sm" color="var(--tt-muted, #6b7280)" marginTop={1}>
            Link a third-party app and its feed will flow in here.
          </Text>
          <Button as={Link} to="/connections" size="sm" marginTop={4} borderRadius="999px">
            Connect an app 🔗
          </Button>
        </Box>
      ) : null}

      {loading && !visible.length ? (
        <Box {...cardStyle} padding={6} textAlign="center">
          <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
            Syncing your feeds…
          </Text>
        </Box>
      ) : null}

      <div ref={sentinelRef} />
      {nextCursor ? (
        <Button size="sm" variant="outline" borderRadius="999px" onClick={() => loadMoreRef.current()} isLoading={loading}>
          Load more
        </Button>
      ) : visible.length ? (
        <Button
          size="sm"
          variant="outline"
          borderRadius="999px"
          isLoading={loading}
          onClick={() => {
            deepenedRef.current = true;
            deepenAndContinue();
          }}
        >
          Fetch older from your apps 📡
        </Button>
      ) : null}
    </Box>
  );
};
