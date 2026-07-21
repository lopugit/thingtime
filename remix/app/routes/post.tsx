import React from 'react';
import { Box, Button, Center, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { PostCard } from '~/components/Feed/PostCard';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';

// /post/:id — the shareable permalink page for any post OR comment (comments
// share the post schema, so both render as a full card with the conversation
// open). Comments link back up to the thing they reply to and the thread root.

const MUTED = 'var(--tt-muted, #9a9aa6)';

type ThingResponse = {
  post: PublicPost | null;
  parent: PublicPost | null;
  root: PublicPost | null;
};

export const PostPage = () => {
  const { id } = useParams();
  const api = useApi();
  const navigate = useNavigate();

  const [data, setData] = React.useState<ThingResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    api.v1.things
      .get({ id: id || '' })
      .then((resp: any) => {
        if (cancelled) return;
        setData({ post: resp.post ?? null, parent: resp.parent ?? null, root: resp.root ?? null });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.error || 'This post is missing or private 🌫️');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // api.v1.things.get is a stable useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const post = data?.post ?? null;
  const isComment = !!post?.thingtime?.includes('comment');
  const parentId = data?.parent?.id ?? null;
  const rootId = data?.root?.id ?? null;

  const handleChanged = (change: PostChange) => {
    setData((prev) => {
      if (!prev?.post) return prev;
      const next = typeof change === 'function' ? change(prev.post) : change;
      if (!next) {
        // the thing was deleted from its own page — go somewhere sensible
        navigate(rootId ? `/post/${rootId}` : '/feed');
        return prev;
      }
      return { ...prev, post: next };
    });
  };

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
            color={MUTED}
          >
            Thingtime · {isComment ? 'Comment 💬' : 'Post 📌'}
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
            {isComment ? 'Comment 💬' : 'Post 📌'}
          </Box>
        </Flex>

        {/* thread context for comments */}
        {post && isComment && (
          <Flex alignItems="center" columnGap={3} flexWrap="wrap">
            {parentId && (
              <Link to={`/post/${parentId}`}>
                <Button size="xs" variant="outline" borderRadius="999px" leftIcon={<ArrowLeft size={12} />}>
                  {parentId === rootId ? 'View full conversation 🧵' : 'View parent comment 💬'}
                </Button>
              </Link>
            )}
            {rootId && rootId !== parentId && (
              <Link to={`/post/${rootId}`}>
                <Button size="xs" variant="ghost" borderRadius="999px">
                  Go to the top of the thread 🧵
                </Button>
              </Link>
            )}
            {!parentId && (
              <Text fontSize="xs" color={MUTED}>
                The thing this comment replies to is unavailable 🌫️
              </Text>
            )}
          </Flex>
        )}

        {loading && (
          <Center paddingY={16}>
            <Spinner size="lg" color={MUTED} />
          </Center>
        )}

        {!loading && (error || !post) && (
          <Flex flexDirection="column" alignItems="center" rowGap={3} paddingY={16}>
            <Text fontSize="sm" color={MUTED}>
              {error || 'This thing has no post view 🌫️'}
            </Text>
            <Link to="/feed">
              <Button size="sm" variant="outline" borderRadius="999px">
                Back to the feed 📰
              </Button>
            </Link>
          </Flex>
        )}

        {!loading && post && <PostCard post={post} onChanged={handleChanged} defaultCommentsOpen />}
      </Flex>
    </Flex>
  );
};

export default PostPage;
