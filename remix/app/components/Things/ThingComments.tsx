import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { PostCard } from '~/components/Feed/PostCard';
import type { PublicPost, PostChange } from '~/components/Feed/feedTypes';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import { SharedMediaProvider } from '~/components/Sharing/SharedMedia';

// The corresponding discussion projection shares the original Thing id. This
// preserves existing threads, nested replies, and dynamically inherited ACLs.
export function ThingComments({ thingId, linkKey = '', initialPost, description }: { thingId: string; linkKey?: string; initialPost?: PublicPost | null; description?: string }) {
  const user = useCurrentUser();
  return <Discussion key={`${user?.id || 'anonymous'}:${thingId}:${linkKey}`} thingId={thingId} linkKey={linkKey} initialPost={initialPost} description={description} />;
}
function Discussion({ thingId, linkKey, initialPost, description }: { thingId: string; linkKey: string; initialPost?: PublicPost | null; description?: string }) {
  const api = useApi();
  const apiRef = React.useRef(api); apiRef.current = api;
  const [post, setPost] = React.useState<PublicPost | null>(() => initialPost || null);
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    const started = Date.now();
    setError('');
    void apiRef.current.v1.things.get({ id: thingId, key: linkKey }, { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      if (!response?.ok || !(response.discussion || response.post)) throw new Error(response?.error || 'Could not load comments.');
      setPost(mergeReactionOverlay(started, response.discussion || response.post));
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if ([401, 403, 404].includes(Number(failure?.status))) setPost(null);
      setError(failure instanceof Error ? failure.message : 'Could not load comments.');
    });
    return () => controller.abort();
  }, [thingId, linkKey, revision]);
  const onChanged = React.useCallback((id: string, change: PostChange) => setPost(previous => previous && previous.id === id ? typeof change === 'function' ? change(previous) : change : previous), []);
  return <Box minW={0} data-testid="thing-comments" data-discussion-source={thingId}>
    {description && <Text color="var(--tt-muted)" fontSize="sm" mb={2}>{description}</Text>}
    {post && <SharedMediaProvider linkKey={linkKey}><PostCard post={post} onChanged={onChanged} defaultCommentsOpen discussionOnly /></SharedMediaProvider>}
    {error && <Text role="alert" color="red.500" fontSize="sm">{error}</Text>}
    <Button size="sm" variant="ghost" mt={2} onClick={() => setRevision(value => value + 1)}>Refresh comments</Button>
  </Box>;
}
