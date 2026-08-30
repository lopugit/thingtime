import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { FeedShortcutsContext, useFeedShortcuts } from '~/hooks/useFeedShortcuts';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import { AdvancedFilters, advancedSearchBody, searchResponsePosts, useAdvancedFilters } from './AdvancedFilters';
import { AlgorithmMenu } from './AlgorithmMenu';
import { FeedFilters } from './FeedFilters';
import { FeedShortcutsHelp } from './FeedShortcutsHelp';
import { MemoriesCard } from './MemoriesCard';
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

  // public tag feeds (claude-todo/10 ✨): /feed?tag=<tag> narrows the feed to
  // one tag — shareable, guest-visible topic hubs. Tag chips on PostCards link
  // here; the banner clears back to the full feed.
  const [searchParams, setSearchParams] = useSearchParams();
  const tagParam = (searchParams.get('tag') || '').trim().toLowerCase() || null;

  // Advanced mode runs the other query grammar, and /things/search ORs its tag
  // list (`{ tags: { $in: [...] } }`) — folding the URL tag into a non-empty
  // advanced tags input would WIDEN the page instead of narrowing it. So the
  // tag is honoured there only when the panel names no tags of its own;
  // otherwise the panel's explicit input wins and the banner says so rather
  // than captioning a page that was never tag-filtered.
  const advancedTags = appliedAdvanced?.tags.trim() || '';
  const tagApplied = !!tagParam && !advancedTags;

  const clearTagParam = React.useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('tag');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

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
            // spread after the body so the URL tag fills search's `tags` slot.
            // tagApplied is false whenever the panel set its own tags, so this
            // only ever fills an unset field — it never overwrites the input.
            ...(tagApplied ? { tags: tagParam } : {}),
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
          tag: tagParam || undefined,
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
    [filters, algorithmId, appliedAdvanced, tagParam, tagApplied]
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

  // keyboard shortcuts (j/k/l/c/n/?) — `n` walks into the composer: expand the
  // collapsed pill if needed, then focus the Editor.js editable once it mounts
  // (the editor loads async, so poll briefly instead of racing it)
  const composerBoxRef = React.useRef<HTMLDivElement | null>(null);
  const focusComposer = React.useCallback(() => {
    const root = composerBoxRef.current;
    if (!root) return;
    const tryFocus = (attempt: number) => {
      const editable = root.querySelector<HTMLElement>('.long-text-editor [contenteditable="true"]');
      if (editable) {
        editable.scrollIntoView({ block: 'center' });
        editable.focus({ preventScroll: true });
        return;
      }
      // no editor holder yet → the composer is collapsed; tap its pill once
      if (attempt === 0 && !root.querySelector('.long-text-editor')) {
        root.querySelector<HTMLButtonElement>('button')?.click();
      }
      if (attempt < 40) window.setTimeout(() => tryFocus(attempt + 1), 50);
    };
    tryFocus(0);
  }, []);

  const postIds = React.useMemo(() => posts.map((post) => post.id), [posts]);
  const shortcuts = useFeedShortcuts({ postIds, onFocusComposer: user ? focusComposer : undefined });

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

        {tagParam && (
          <Flex
            alignItems="center"
            columnGap={2}
            padding="8px 12px"
            borderRadius="var(--tt-radius-md, 12px)"
            border="1px solid var(--tt-border, #ececef)"
            background="var(--tt-card, #fff)"
          >
            <Text fontSize="sm" color="var(--tt-text, #5a5a66)">
              {tagApplied ? 'Posts tagged' : 'Advanced search tags override'}{' '}
              <Text as="span" fontFamily="mono" fontWeight={700} color="var(--tt-ink, #16161a)">
                #{tagParam}
              </Text>
            </Text>
            <Box
              as="button"
              type="button"
              marginLeft="auto"
              onClick={clearTagParam}
              fontSize="13px"
              fontWeight={600}
              color="var(--tt-muted, #9a9aa6)"
              cursor="pointer"
              _hover={{ color: 'var(--tt-ink, #16161a)' }}
              title="Back to the full feed"
            >
              Clear ✕
            </Box>
          </Flex>
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

        {user && (
          <Box ref={composerBoxRef}>
            <PostComposer onPosted={handlePosted} />
          </Box>
        )}

        {/* "On this day" memories — own-post anniversaries; renders nothing
            when there are none, so the list below never shifts */}
        {user && <MemoriesCard />}

        <Box ref={listRef}>
          <FeedShortcutsContext.Provider value={shortcuts.registry}>
            <PostList
              posts={posts}
              loading={loading}
              hasMore={!!nextCursor}
              onLoadMore={handleLoadMore}
              onPostChanged={handlePostChanged}
              onEngagement={recordEvent}
              focusedPostId={shortcuts.focusedPostId}
              emptyLabel={
                appliedAdvanced
                  ? 'Nothing matched — loosen a filter, or try plain words up top ✨'
                  : ranked
                    ? 'Your algorithm has nothing to rank yet — try Latest ⏱️'
                    : 'Nothing here yet — be the first to post ✨'
              }
            />
          </FeedShortcutsContext.Provider>
        </Box>

        <FeedShortcutsHelp isOpen={shortcuts.helpOpen} onClose={shortcuts.closeHelp} />
      </Flex>
    </Flex>
  );
};
