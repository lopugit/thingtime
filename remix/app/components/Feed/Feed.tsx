import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { AdvancedFilters, advancedSearchBody, searchResponsePosts, useAdvancedFilters } from './AdvancedFilters';
import { AlgorithmMenu } from './AlgorithmMenu';
import { FeedFilters } from './FeedFilters';
import { PostComposer } from './PostComposer';
import { PostList } from './PostList';
import { useFeedEngagement } from './useFeedEngagement';
import { mergeReactionOverlays } from './reactionOverlay';
import type { FeedFiltersState, PostChange, PublicPost } from './feedTypes';

// The /feed page: composer + algorithm picker + filters over an infinite
// post column. Guest-visible (public posts only); engagement telemetry from
// useFeedEngagement trains whichever algorithm is active as you scroll.
// Filters ▸ Advanced swaps the pager onto the structured search API while
// keeping the same PostList rendering and simple-filter narrowing.

const EMPTY_FILTERS: FeedFiltersState = { types: [], circles: [], from: null, to: null };

const PAGE_SIZE = 20;

export const FeedPage = () => {
  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  const [filters, setFilters] = React.useState<FeedFiltersState>(EMPTY_FILTERS);
  const [algorithmId, setAlgorithmId] = React.useState<string | null>(user?.activeFeedAlgorithmId ?? null);

  // advanced search: the panel edits a draft; Apply snapshots it into
  // `applied` (null = normal feed), which the pager keys off
  const advancedFilters = useAdvancedFilters();
  const appliedAdvanced = advancedFilters.applied;

  const [posts, setPosts] = React.useState<PublicPost[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [ranked, setRanked] = React.useState(false);

  // login/logout swaps the viewer — re-seed the algorithm from their profile
  const lastUserIdRef = React.useRef<string | null>(user?.id ?? null);
  React.useEffect(() => {
    const userId = user?.id ?? null;
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    setAlgorithmId(user?.activeFeedAlgorithmId ?? null);
  }, [user?.id, user?.activeFeedAlgorithmId]);

  const { observeCard, recordEvent, sessionEventCount, getSessionEvents } = useFeedEngagement({
    activeAlgorithmId: algorithmId
  });

  // "try my feed brain 🧠" (claude-todo/10): /feed?algorithm=<shareId> shows a
  // branch invitation. The preview endpoint only resolves explicitly shared
  // algorithms and never returns weights — branching copies them into the
  // visitor's OWN private algorithm.
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedAlgorithmParam = searchParams.get('algorithm');
  const getSharedAlgorithm = api.v1.algorithms.getShared;
  const [sharedPreview, setSharedPreview] = React.useState<{
    id: string;
    name: string;
    emoji: string;
    eventCount: number;
    ownerUsername: string | null;
  } | null>(null);
  const [branchingShared, setBranchingShared] = React.useState(false);

  React.useEffect(() => {
    if (!sharedAlgorithmParam) {
      setSharedPreview(null);
      return;
    }
    let cancelled = false;
    getSharedAlgorithm({ id: sharedAlgorithmParam })
      .then((resp: any) => {
        if (cancelled) return;
        setSharedPreview(resp?.ok && resp?.algorithm ? resp.algorithm : null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setSharedPreview(null);
        // getJson REJECTS on a non-2xx, so the revoked/unknown/private link —
        // the one case worth explaining — arrives here as a 404, never as a
        // resolved { ok: false } body. Stay quiet on anything else: a transient
        // network blip must not accuse the owner of unsharing.
        if (err?.status === 404) {
          lopuRef.current({
            title: 'That feed brain is no longer shared 🌫️',
            description: 'The link may have been turned off by its owner.',
            status: 'info'
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sharedAlgorithmParam, getSharedAlgorithm]);

  const clearSharedParam = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('algorithm');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const handleBranchShared = React.useCallback(async () => {
    if (!sharedPreview) return;
    if (!user) {
      lopuRef.current({
        title: 'Log in to branch this feed brain 🗝️',
        description: 'Your copy starts with the same taste and trains privately as you scroll.',
        status: 'info',
        link: { label: 'Log in 🗝️', href: '/login' }
      });
      return;
    }
    setBranchingShared(true);
    try {
      const created: any = await api.v1.algorithms.create({
        name: sharedPreview.name,
        emoji: sharedPreview.emoji,
        branchFrom: sharedPreview.id
      });
      if (!created?.algorithm) throw created;
      // The copy exists from here on. Activation is a second call that can fail
      // on its own, so retire the invitation either way — reporting "Branch
      // failed" for a branch that landed would invite a retry that silently
      // creates a duplicate algorithm.
      setSharedPreview(null);
      clearSharedParam();
      let activated = true;
      try {
        await api.v1.algorithms.setActive({ algorithmId: created.algorithm.id });
        setAlgorithmId(created.algorithm.id);
      } catch {
        activated = false;
      }
      lopuRef.current({
        title: `Branched "${created.algorithm.name}" ${created.algorithm.emoji} 🌿`,
        description: activated
          ? 'It is now your active algorithm — it trains as you scroll and is yours alone.'
          : 'Your copy is saved and yours alone — activate it from Settings ▸ Algorithms.',
        status: activated ? 'success' : 'info',
        duration: 8000
      });
    } catch (err: any) {
      lopuRef.current({
        title: 'Branch failed 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBranchingShared(false);
    }
  }, [sharedPreview, user, api.v1.algorithms, clearSharedParam]);

  // pager machinery — a sequence guard drops stale responses when the
  // filters/algorithm change mid-flight
  const requestSeqRef = React.useRef(0);
  const loadingRef = React.useRef(false);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  // always-current viewer id so load() can flag logged-out fetches as
  // edge-cacheable (`anon=1`) without joining the callback's dep list
  const viewerIdRef = React.useRef(user?.id ?? null);
  viewerIdRef.current = user?.id ?? null;

  const load = React.useCallback(
    async (options: { reset?: boolean; cursor?: string | null } = {}) => {
      const { reset, cursor } = options;
      if (loadingRef.current && !reset) return;

      const seq = ++requestSeqRef.current;
      // stamp the START — responses snapshotted before a reaction tap that
      // lands after it merge through the viewer's overlay, never clobber it
      const startedAt = Date.now();
      loadingRef.current = true;
      setLoading(true);

      try {
        if (appliedAdvanced) {
          // advanced mode: the structured search API, posts projected the same
          // way the feed projects them — simple filters keep narrowing
          const resp = await apiRef.current.v1.things.search({
            ...advancedSearchBody(appliedAdvanced),
            types: filters.types.length ? filters.types : undefined,
            circles: filters.circles.length ? filters.circles : undefined,
            from: filters.from || undefined,
            to: filters.to || undefined,
            cursor: reset ? undefined : cursor || undefined,
            limit: PAGE_SIZE
          });
          if (seq !== requestSeqRef.current) return;

          const pagePosts: PublicPost[] = mergeReactionOverlays(startedAt, searchResponsePosts(resp));
          setPosts((prev) => {
            if (reset) return pagePosts;
            const seen = new Set(prev.map((post) => post.id));
            return [...prev, ...pagePosts.filter((post) => !seen.has(post.id))];
          });
          setNextCursor(resp.nextCursor ?? null);
          setRanked(!!resp.ranked);
          return;
        }

        const resp = await apiRef.current.v1.things.feed({
          types: filters.types,
          circles: filters.circles,
          from: filters.from,
          to: filters.to,
          algorithm: algorithmId ?? 'latest',
          cursor: reset ? undefined : cursor || undefined,
          limit: PAGE_SIZE,
          anon: viewerIdRef.current ? undefined : 1
        });
        if (seq !== requestSeqRef.current) return;

        setPosts((prev) => {
          const page = mergeReactionOverlays(startedAt, resp.posts || []);
          return reset ? page : [...prev, ...page];
        });
        setNextCursor(resp.nextCursor ?? null);
        setRanked(!!resp.ranked);
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        // a failed RESET must not leave the previous query's posts posing as
        // this one's results (the optimistic keep only covers the happy path);
        // a failed load-more keeps the list it was extending
        if (reset) setPosts([]);
        setNextCursor(null);
        lopuRef.current({ title: err?.error || 'Could not load the feed 😞', status: 'error' });
      } finally {
        if (seq === requestSeqRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [filters, algorithmId, appliedAdvanced]
  );

  // initial fetch + reset whenever the filters, algorithm, or advanced search
  // change — or the viewer does (an account switch can keep the same algorithm
  // id, e.g. null, so `load`'s identity alone wouldn't refetch the new
  // account's feed). Optimistic rendering: the last-known posts stay on screen
  // while the new query loads (reset replaces them when it lands) — only a
  // viewer change clears immediately, so one account's circle posts never
  // linger into another's session.
  const lastViewerRef = React.useRef(user?.id ?? null);
  React.useEffect(() => {
    const viewerId = user?.id ?? null;
    if (lastViewerRef.current !== viewerId) {
      lastViewerRef.current = viewerId;
      setPosts([]);
    }
    setNextCursor(null);
    load({ reset: true });
  }, [load, user?.id]);

  const handleLoadMore = React.useCallback(() => {
    if (!nextCursor) return;
    load({ cursor: nextCursor });
  }, [nextCursor, load]);

  const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
    setPosts((prev) =>
      prev.flatMap((post) => {
        if (post.id !== id) return [post];
        const resolved = typeof next === 'function' ? next(post) : next;
        return resolved ? [resolved] : [];
      })
    );
  }, []);

  // deliberately optimistic even while an advanced search is applied: seeing
  // your own fresh post beats strict filter fidelity, and the next Apply or
  // page reload reconciles the list
  const handlePosted = React.useCallback((post: PublicPost) => {
    setPosts((prev) => [post, ...prev]);
  }, []);

  // hook the engagement observer onto every rendered card wrapper
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    root.querySelectorAll('[data-thing-id]').forEach((element) => {
      const thingId = element.getAttribute('data-thing-id');
      if (thingId) observeCard(element, thingId);
    });
  }, [posts, observeCard]);

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
            Thingtime ·{' '}
            {appliedAdvanced
              ? ranked
                ? 'Advanced search · best match first 🔬'
                : 'Advanced search 🔬'
              : ranked
                ? 'Ranked by your algorithm 🧠'
                : 'Fresh things first ⏱️'}
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
            Feed 📰
          </Box>
        </Flex>

        {sharedPreview && (
          <Box p="1.5px" borderRadius="var(--tt-radius-md, 12px)" background={RAINBOW} backgroundSize="calc(100px + 200%)" sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}>
            <Flex
              alignItems="center"
              columnGap={3}
              rowGap={2}
              flexWrap="wrap"
              padding={3}
              borderRadius="calc(var(--tt-radius-md, 12px) - 1.5px)"
              background="var(--tt-card, #fff)"
            >
              <Text fontSize="sm" color="var(--tt-text, #5a5a66)">
                {sharedPreview.ownerUsername ? `@${sharedPreview.ownerUsername} shared their` : 'Someone shared their'} feed
                brain <strong>&ldquo;{sharedPreview.name}&rdquo; {sharedPreview.emoji}</strong>
                {sharedPreview.eventCount > 0 ? ` — trained on ${sharedPreview.eventCount.toLocaleString()} scrolls` : ' — still an egg 🥚'}
              </Text>
              <Flex marginLeft="auto" columnGap={2}>
                <Button size="sm" isLoading={branchingShared} onClick={handleBranchShared}>
                  Branch a copy 🌿
                </Button>
                <Button size="sm" variant="ghost" color="var(--tt-muted, #9a9aa6)" onClick={clearSharedParam}>
                  Dismiss
                </Button>
              </Flex>
            </Flex>
          </Box>
        )}

        {/* controls */}
        <Flex alignItems="center" columnGap={2}>
          <AlgorithmMenu
            value={algorithmId}
            onChange={setAlgorithmId}
            sessionEventCount={sessionEventCount}
            getSessionEvents={getSessionEvents}
          />
          <Box marginLeft="auto">
            <FeedFilters
              value={filters}
              onChange={setFilters}
              advancedOpen={advancedFilters.open}
              onAdvancedToggle={advancedFilters.toggle}
            />
          </Box>
        </Flex>

        {advancedFilters.open && (
          <AdvancedFilters
            value={advancedFilters.draft}
            onChange={advancedFilters.setDraft}
            onApply={advancedFilters.apply}
            onClear={advancedFilters.clear}
            loading={loading}
          />
        )}

        {user && <PostComposer onPosted={handlePosted} />}

        <Box ref={listRef}>
          <PostList
            posts={posts}
            loading={loading}
            hasMore={!!nextCursor}
            onLoadMore={handleLoadMore}
            onPostChanged={handlePostChanged}
            onEngagement={recordEvent}
            emptyLabel={
              appliedAdvanced
                ? 'Nothing matched — loosen a filter, or try plain words up top ✨'
                : ranked
                  ? 'Your algorithm has nothing to rank yet — try Latest ⏱️'
                  : 'Nothing here yet — be the first to post ✨'
            }
          />
        </Box>
      </Flex>
    </Flex>
  );
};
