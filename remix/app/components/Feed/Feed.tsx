import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { FeedShortcutsContext, useFeedShortcuts } from '~/hooks/useFeedShortcuts';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW, RAINBOW_TEXT } from '~/theme/rainbow';
import { AdvancedFilters, advancedSearchBody, searchResponsePosts, useAdvancedFilters } from './AdvancedFilters';
import { AlgorithmMenu } from './AlgorithmMenu';
import { FeedFilters } from './FeedFilters';
import { FeedShortcutsHelp } from './FeedShortcutsHelp';
import { MemoriesCard } from './MemoriesCard';
import { PostComposer } from './PostComposer';
import { PostList } from './PostList';
import { useFeedEngagement } from './useFeedEngagement';
import { mergeReactionOverlays } from './reactionOverlay';
import { appendPostsDeduped, FEED_SCOPE_CACHE_KEY, feedScopeOf } from './feedTypes';
import type { FeedFiltersState, FeedScope, PostChange, PublicPost } from './feedTypes';

// The /feed page: composer + algorithm picker + the "🪐 My subspaces" scope
// chip + filters over an infinite post column. Guest-visible (public posts
// only); engagement telemetry from useFeedEngagement trains whichever
// algorithm is active as you scroll. Filters ▸ Advanced swaps the pager onto
// the structured search API while keeping the same PostList rendering and
// simple-filter narrowing (the scope chip rests while it is applied — search
// has no subspace scope).

const EMPTY_FILTERS: FeedFiltersState = { types: [], circles: [], from: null, to: null };

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

// the persisted scope choice (sync localCache tier — paints on first render)
const readCachedScope = (loggedIn: boolean): FeedScope => feedScopeOf(readLocalCache<string>(FEED_SCOPE_CACHE_KEY), loggedIn);

const PAGE_SIZE = 20;

export const FeedPage = () => {
  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  const [filters, setFilters] = React.useState<FeedFiltersState>(EMPTY_FILTERS);
  const [algorithmId, setAlgorithmId] = React.useState<string | null>(user?.activeFeedAlgorithmId ?? null);
  // "🪐 My subspaces": only posts from the viewer's ACTIVE subspaces (server-
  // side scope=subspaces). Seeded from the sync cache so the chip and the
  // first fetch agree on the very first render; guests always read all.
  const [scope, setScope] = React.useState<FeedScope>(() => readCachedScope(!!user));

  // advanced search: the panel edits a draft; Apply snapshots it into
  // `applied` (null = normal feed), which the pager keys off
  const advancedFilters = useAdvancedFilters();
  const appliedAdvanced = advancedFilters.applied;

  const [posts, setPosts] = React.useState<PublicPost[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [ranked, setRanked] = React.useState(false);

  // login/logout swaps the viewer — re-seed the algorithm from their profile
  // and the scope from the cache (a logout drops back to all: a guest has no
  // subspaces to scope to)
  const lastUserIdRef = React.useRef<string | null>(user?.id ?? null);
  React.useEffect(() => {
    const userId = user?.id ?? null;
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    setAlgorithmId(user?.activeFeedAlgorithmId ?? null);
    setScope(readCachedScope(!!userId));
  }, [user?.id, user?.activeFeedAlgorithmId]);

  const { observeCard, recordEvent, sessionEventCount, getSessionEvents } = useFeedEngagement({
    activeAlgorithmId: algorithmId
  });

  // both URL-param features below — ?algorithm= branch invitations and ?tag=
  // topic feeds — read and clear through this one hook instance
  const [searchParams, setSearchParams] = useSearchParams();

  // "try my feed brain 🧠" (claude-todo/10): /feed?algorithm=<shareId> shows a
  // branch invitation. The preview endpoint only resolves explicitly shared
  // algorithms and never returns weights — branching copies them into the
  // visitor's OWN private algorithm.
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
          return;
        }
        // 429 is the other knowable state, and it is the one this feature
        // invites: the preview limiter keys off the hashed IP, so a link that
        // actually travels can throttle visitors who merely share an egress
        // (office NAT, carrier CGNAT) without any of them doing anything wrong.
        // Silence would read as "this link is broken" — say it's temporary, and
        // don't imply the owner unshared. Retry-After is already on the 429, so
        // ThingtimeApiError.retryAfterSeconds carries the real wait.
        if (err?.status === 429) {
          const retryAfterSeconds = err?.retryAfterSeconds;
          lopuRef.current({
            title: 'Too many feed-brain lookups from your network 🌸',
            description:
              typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
                ? `The link still works — reload in about ${retryAfterSeconds} seconds.`
                : 'The link still works — reload in a moment.',
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

  // public tag feeds (claude-todo/10 ✨): /feed?tag=<tag> narrows the feed to
  // one tag — shareable, guest-visible topic hubs. Tag chips on PostCards link
  // here; the banner clears back to the full feed.
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
          setPosts((prev) => appendPostsDeduped(reset ? [] : prev, pagePosts));
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
          // only a logged-in viewer can be scoped (the server answers a guest
          // an empty page, and the anon URL must stay the shared cacheable one)
          scope: scope === 'subspaces' && viewerIdRef.current ? 'subspaces' : undefined,
          cursor: reset ? undefined : cursor || undefined,
          limit: PAGE_SIZE,
          anon: viewerIdRef.current ? undefined : 1
        });
        if (seq !== requestSeqRef.current) return;

        setPosts((prev) => {
          // `feed` responses are untyped JSON; name the projection the same way
          // the advanced-search branch above does so the pager stays PublicPost[].
          const page: PublicPost[] = mergeReactionOverlays<PublicPost>(startedAt, (resp.posts || []) as PublicPost[]);
          return appendPostsDeduped(reset ? [] : prev, page);
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
    [filters, algorithmId, scope, appliedAdvanced, tagParam, tagApplied]
  );

  // the scope chip: flips instantly (the pager reloads through `load`'s deps)
  // and persists per browser; a guest is nudged to log in instead
  const scopeOn = scope === 'subspaces' && !!user && !appliedAdvanced;
  const toggleScope = React.useCallback(() => {
    if (!user) {
      lopuRef.current({
        title: 'Log in to see your subspaces 🗝️',
        description: 'Join a few on /s and this chip narrows the feed to just them.',
        status: 'info',
        link: { label: 'Log in 🗝️', href: '/login' }
      });
      return;
    }
    setScope((prev) => {
      const next: FeedScope = prev === 'subspaces' ? 'all' : 'subspaces';
      writeLocalCache(FEED_SCOPE_CACHE_KEY, next);
      return next;
    });
  }, [user]);

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
            {scopeOn ? 'Your subspaces 🪐 · ' : ''}
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
        <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
          <AlgorithmMenu
            value={algorithmId}
            onChange={setAlgorithmId}
            sessionEventCount={sessionEventCount}
            getSessionEvents={getSessionEvents}
          />
          <Button
            size="sm"
            variant="outline"
            fontWeight={600}
            borderRadius={RADIUS_MD}
            borderColor="var(--tt-border, #ececef)"
            background={scopeOn ? 'var(--tt-surface-hover, #ececee)' : 'var(--tt-card, #ffffff)'}
            color={scopeOn ? INK : MUTED}
            _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)', color: INK }}
            _active={{ background: 'var(--tt-surface-hover, #ececee)' }}
            isDisabled={!!appliedAdvanced}
            onClick={toggleScope}
            aria-pressed={scopeOn}
            title={appliedAdvanced ? 'Advanced search covers every post' : scopeOn ? 'Showing only your subspaces — tap for everything' : 'Only posts from the subspaces you belong to'}
            data-testid="feed-scope-subspaces"
            data-scope={scopeOn ? 'subspaces' : 'all'}
          >
            🪐 My subspaces
          </Button>
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
                  : scopeOn
                    ? 'Nothing from your subspaces yet — join a few on /s, or post something there 🪐'
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
