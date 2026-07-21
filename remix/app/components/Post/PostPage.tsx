import React from 'react';
import { Box, Button, Center, Flex, Skeleton, SkeletonCircle, SkeletonText, Text } from '@chakra-ui/react';
import { Link, useParams } from 'react-router';

import { PostCard } from '~/components/Feed/PostCard';
import { useApi } from '~/hooks/useApi';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';

// The /post/:id permalink page (claude-todo/10 "Post permalinks + copy-link
// share"): renders one post through the existing PostCard so a shared link
// lands somewhere real. Guest-visible for public posts (GET /api/v1/things?id=
// applies the same canView gating as the feed); guests who try to react hit
// PostCard's existing "Log in to react 🗝️" funnel.

const SkeletonPost = () => (
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
    <SkeletonText marginTop={4} noOfLines={4} spacing={2} skeletonHeight="10px" />
  </Box>
);

const EmptyState = ({ title }: { title: string }) => (
  <Center
    flexDirection="column"
    rowGap={3}
    paddingY={16}
    border="1px dashed var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-lg, 16px)"
  >
    <Text fontSize="3xl">🪐</Text>
    <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" textAlign="center" whiteSpace="normal" paddingX={6}>
      {title}
    </Text>
    <Button
      as={Link}
      to="/feed"
      size="sm"
      variant="outline"
      borderRadius="var(--tt-radius-md, 12px)"
      borderColor="var(--tt-border, #ececef)"
      color="var(--tt-text, #5a5a66)"
      _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
    >
      Back to the feed 🌈
    </Button>
  </Center>
);

export const PostPage = () => {
  const { id } = useParams();
  const api = useApi();

  const [post, setPost] = React.useState<PublicPost | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing' | 'deleted'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    setState('loading');
    setPost(null);

    api.v1.things
      .get({ id })
      .then((resp: any) => {
        if (cancelled) return;
        // getThing returns post: null for non-post things — a permalink only
        // renders posts, so both 404 and "not a post" land in the same state
        if (resp?.ok && resp.post) {
          setPost(resp.post);
          setState('ready');
        } else {
          setState('missing');
        }
      })
      .catch(() => {
        if (!cancelled) setState('missing');
      });

    return () => {
      cancelled = true;
    };
    // useApi() builds a fresh object every render (its methods are stable
    // useCallbacks) — depending on `api` would re-run this effect every render
    // and pin the page in the loading state. Key the fetch on the id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // PostCard's onChanged is (next) on this base and becomes (id, next) after
  // the memo-stabilisation branch merges — accept both shapes so the merge
  // order between the two branches can never break the permalink page.
  const handleChanged = React.useCallback((...args: unknown[]) => {
    const next = (args.length > 1 ? args[1] : args[0]) as PostChange;
    setPost((prev) => {
      if (!prev) return prev;
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (!resolved) {
        setState('deleted');
        return null;
      }
      return resolved;
    });
  }, []);

  return (
    <Flex justifyContent="center" width="100%">
      <Flex flexDirection="column" rowGap={4} width={['100%', '680px']} maxWidth="100%" paddingX={4} paddingY={6}>
        <Flex flexDirection="column" rowGap={1}>
          <Text
            fontFamily="mono"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
          >
            Thingtime · one shared thing 🔗
          </Text>
          <Box fontFamily="heading" fontSize="2xl" fontWeight={800} sx={RAINBOW_TEXT}>
            Post 📮
          </Box>
        </Flex>

        {state === 'loading' && <SkeletonPost />}
        {state === 'missing' && <EmptyState title="Lopu looked everywhere — that post is private or gone 🤷‍♂️" />}
        {state === 'deleted' && <EmptyState title="That post just left the building 🗑️" />}
        {state === 'ready' && post && (
          <Box data-thing-id={post.id}>
            <PostCard post={post} onChanged={handleChanged} />
          </Box>
        )}
      </Flex>
    </Flex>
  );
};

export default PostPage;
