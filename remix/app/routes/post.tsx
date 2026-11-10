import { useWorkspaceScope } from '~/hooks/useWorkspaceScope';
import { useCharacterContentPath } from '~/components/Characters/CharacterScope';
import { LOCAL_WORKSPACE_CHANGED } from '~/local-workspace/runtime.client';
import { sharePathForThing } from '~/components/Sharing/audienceCore';
import { sharedThingPath } from '~/components/Sharing/sharedMediaCore';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { SharedMediaProvider } from '~/components/Sharing/SharedMedia';
import React from 'react';
import { Box, Button, Center, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { PostCard } from '~/components/Feed/PostCard';
import { useViewTracking } from '~/components/Feed/useViewTracking';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';

// /post/:id — the shareable permalink page for any post OR comment (comments
// share the post schema, so both render as a full card with the conversation
// open). Comments link back up to the thing they reply to and the thread root.

const MUTED = 'var(--tt-muted, #9a9aa6)';

type ThingResponse = {
  incomplete?: boolean;
  localCacheError?: string;
  post: PublicPost | null;
  parent: PublicPost | null;
  root: PublicPost | null;
};

export const PostPage = () => {
  const scope = useWorkspaceScope(), { id } = useParams(), [query] = useSearchParams();
  return <WorkspacePostPage key={JSON.stringify([scope,id,query.get('key'),query.get('sharedRoot'),query.get('character')])} />;
};
const WorkspacePostPage = () => {
  const { id } = useParams();
  // hidden (unlisted) posts: the secret ?key= from the shared link makes the
  // post viewable to whoever opened it — logged out included
  const [searchParams] = useSearchParams();
  const linkKey = (searchParams.get('key') || '').trim();
  const sharedRoot = searchParams.get('sharedRoot') || '';
  const contentPath = useCharacterContentPath();
  const parentPath = (thing: PublicPost) => contentPath(sharedThingPath(sharePathForThing(thing), linkKey, sharedRoot));
  const api = useApi();
  const user = useCurrentUser();
  const navigate = useNavigate();

  const [data, setData] = React.useState<ThingResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  // permalink pages count as views too (feed/profile wire this via PostList)
  const { observeView } = useViewTracking();

  React.useEffect(() => {
    let cancelled = false;
    if (!data) setLoading(true);
    setError(null);

    // stamp the START — a response snapshotted before a reaction tap that
    // lands after it merges through the viewer's overlay, never clobbers it
    const startedAt = Date.now();
    api.v1.things
      .get({ id: id || '', key: linkKey || undefined, sharedRoot: sharedRoot || undefined })
      .then((resp: any) => {
        if (cancelled) return;
        setData({
          incomplete: resp.incomplete === true, localCacheError: resp.localCacheError,
          post: resp.post ? mergeReactionOverlay(startedAt, resp.post) : null,
          parent: resp.parent ? mergeReactionOverlay(startedAt, resp.parent) : null,
          root: resp.root ? mergeReactionOverlay(startedAt, resp.root) : null
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        if ([403,404,410].includes(Number(err?.status))) setData(null);
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
  }, [id, linkKey, sharedRoot, user?.id, workspaceRevision]);

  const post = data?.post ?? null;
  const isComment = !!post?.thingtime?.includes('comment');
  const parentId = data?.parent?.id ?? null;
  const rootId = data?.root?.id ?? null;

  const handleChanged = (id: string, change: PostChange) => {
    setData((prev) => {
      if (!prev?.post || prev.post.id !== id) return prev;
      const next = typeof change === 'function' ? change(prev.post) : change;
      if (!next) {
        // the thing was deleted from its own page — go somewhere sensible
        const libraryPath = contentPath('/things');
        navigate(rootId ? contentPath(`/post/${rootId}`) : libraryPath === '/things' ? '/feed' : libraryPath);
        return prev;
      }
      return { ...prev, post: next };
    });
  };

  return (
    <SharedMediaProvider linkKey={post?.audience?.linkKey || post?.linkKey || linkKey} sharedRoot={sharedRoot}><Flex
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
              <Link to={parentPath(data!.parent!)}>
                <Button size="xs" variant="outline" borderRadius="999px" leftIcon={<ArrowLeft size={12} />}>
                  {parentId === rootId ? 'View full conversation 🧵' : 'View parent comment 💬'}
                </Button>
              </Link>
            )}
            {rootId && rootId !== parentId && (
              <Link to={parentPath(data!.root!)}>
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

        {data?.incomplete && <Text fontSize="sm" color={MUTED}>Saved on this device. Account updates and cloud media need a connection.</Text>}
        {data?.localCacheError && <Text role="alert" fontSize="sm">{data.localCacheError}</Text>}
        {error && post && <Text role="alert" fontSize="sm">{error}</Text>}
        {loading && (
          <Center paddingY={16}>
            <Spinner size="lg" color={MUTED} />
          </Center>
        )}

        {!loading && !post && (
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

        {!loading && post && (
          <Box ref={(element: HTMLDivElement | null) => observeView(element, post.id)}>
            <PostCard post={post} onChanged={handleChanged} defaultCommentsOpen />
          </Box>
        )}
      </Flex>
    </Flex></SharedMediaProvider>
  );
};

export default PostPage;
