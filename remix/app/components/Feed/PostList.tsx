import React from 'react';
import { Box, Button, Center, Flex, Skeleton, SkeletonCircle, SkeletonText, Text } from '@chakra-ui/react';

import { PostCard } from './PostCard';
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

export const PostList = (props: PostListProps) => {
  const { posts, loading, hasMore, onLoadMore, onPostChanged, onEngagement, emptyLabel } = props;

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

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
        <Box key={post.id} data-thing-id={post.id}>
          <PostCard
            post={post}
            onChanged={onPostChanged}
            onEngagement={onEngagement}
          />
        </Box>
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
