import React from 'react';
import { Box, Button, Center, Flex, Skeleton, SkeletonCircle, SkeletonText, Text } from '@chakra-ui/react';

import { PostCard } from './PostCard';
import { useViewTracking } from './useViewTracking';
import type { EngagementEvent, PostChange, PublicPost } from './feedTypes';

// The feed column: PostCards + an IntersectionObserver sentinel for infinite
// scroll (with a manual "Load more" fallback), skeleton cards while loading
// and a friendly empty state. Each card is wrapped in a data-thing-id div so
// the page can hook engagement observers onto the rendered elements.

export type PostListProps = {
  posts: PublicPost[];
  loading: boolean;
  hasMore: boolean;
  // called from an IntersectionObserver sentinel
  onLoadMore: () => void;
  onPostChanged: (id: string, next: PostChange) => void;
  onEngagement?: (event: EngagementEvent) => void;
  emptyLabel?: string;
  // keyboard-focused post (useFeedShortcuts j/k) — its wrapper draws a subtle
  // accent ring; pages without shortcuts just omit this
  focusedPostId?: string | null;
};

const SkeletonCard = () => (
  <Box
    background="var(--tt-card, #ffffff)"
    border="1px solid var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-lg, 16px)"
    padding={[4, 5]}
  >
    <Flex alignItems="center" columnGap={3}>
      <SkeletonCircle size="36px" />
      <Box flex="1">
        <Skeleton height="10px" width="140px" marginBottom={2} borderRadius="999px" />
        <Skeleton height="8px" width="90px" borderRadius="999px" />
      </Box>
    </Flex>
    <SkeletonText marginTop={4} noOfLines={3} spacing={2} skeletonHeight="10px" />
  </Box>
);

// One memoized row per post. PostCard is already React.memo, but the props it
// received were built inline in the .map body — a fresh `onChanged` closure and
// a fresh `ref` callback on every PostList render — so the memo never hit and
// every engagement event re-rendered every mounted card. Scrolling a 100-post
// feed fires up to 200 session-deduped view/dwell updates, making the wasted
// work quadratic in posts loaded.
//
// `onChanged` is stable by construction now that PostCard takes the post id and
// hands it back, so the parent's handler passes straight through. The ref still
// has to close over the id, and hooks cannot live in a .map body — hence this
// component, where useCallback can key it on the post id. The parent's
// onPostChanged / onEngagement / observeView are all already useCallback-stable,
// so these identities hold across renders and both memos actually stick. The
// stale ref identity also stopped forcing observeView(null) + observeView(el)
// for every wrapper on each of those re-renders.
//
// The j/k focus ring lives here too, as a plain boolean prop rather than the
// focused id: only the row losing focus and the row gaining it change props,
// so the memo still holds for every other mounted card.
const PostRow = React.memo(function PostRow({
  post,
  focused,
  onPostChanged,
  onEngagement,
  observeView
}: {
  post: PublicPost;
  focused: boolean;
  onPostChanged: (id: string, next: PostChange) => void;
  onEngagement?: (event: EngagementEvent) => void;
  observeView: (element: Element | null, thingId: string) => void;
}) {
  const setRef = React.useCallback((element: HTMLDivElement | null) => observeView(element, post.id), [observeView, post.id]);

  return (
    <Box
      data-thing-id={post.id}
      ref={setRef}
      // keyboard focus ring (j/k) — theme-aware accent outline hugging the
      // card's radius. useFeedShortcuts scrollIntoView()s the [data-thing-id]
      // element, so the breathing room has to be on THIS box, not a wrapper.
      borderRadius="var(--tt-radius-lg, 16px)"
      outline={focused ? '2px solid var(--tt-accent, hotpink)' : undefined}
      outlineOffset="3px"
      scrollMarginY="calc(var(--tt-nav-clearance, 54px) + 16px)"
    >
      {/* onPostChanged already takes the post id, so the row passes it straight
      through — no per-row wrapper closure to break PostCard's memo. */}
      <PostCard post={post} onChanged={onPostChanged} onEngagement={onEngagement} />
    </Box>
  );
});

export const PostList = (props: PostListProps) => {
  const { posts, loading, hasMore, onLoadMore, onPostChanged, onEngagement, emptyLabel, focusedPostId } = props;

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  // public view-count telemetry — wired here so every PostList surface (feed,
  // profile) reports views without per-page plumbing
  const { observeView } = useViewTracking();

  // refs so the observer callback always sees fresh state without re-wiring
  const loadMoreRef = React.useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;
  const stateRef = React.useRef({ loading, hasMore });
  stateRef.current = { loading, hasMore };

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (stateRef.current.loading || !stateRef.current.hasMore) return;
          loadMoreRef.current();
        });
      },
      { rootMargin: '600px 0px' }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  return (
    <Flex flexDirection="column" rowGap={4} width="100%">
      {posts.map((post) => (
        <PostRow
          key={post.id}
          post={post}
          focused={post.id === focusedPostId}
          onPostChanged={onPostChanged}
          onEngagement={onEngagement}
          observeView={observeView}
        />
      ))}

      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
          {posts.length === 0 && <SkeletonCard />}
        </>
      )}

      {!loading && posts.length === 0 && (
        <Center
          flexDirection="column"
          rowGap={2}
          paddingY={16}
          border="1px dashed var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-lg, 16px)"
        >
          <Text fontSize="3xl">🪐</Text>
          <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" textAlign="center" whiteSpace="normal" paddingX={6}>
            {emptyLabel || 'Nothing here yet — be the first to post ✨'}
          </Text>
        </Center>
      )}

      {/* infinite-scroll sentinel (kept mounted so the observer stays wired) */}
      <Box ref={sentinelRef} height="1px" />

      {hasMore && !loading && posts.length > 0 && (
        <Center>
          <Button
            size="sm"
            variant="outline"
            borderRadius="var(--tt-radius-md, 12px)"
            borderColor="var(--tt-border, #ececef)"
            color="var(--tt-text, #5a5a66)"
            _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
            onClick={onLoadMore}
          >
            Load more ⬇️
          </Button>
        </Center>
      )}
    </Flex>
  );
};
