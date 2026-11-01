import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { PostCard } from '~/components/Feed/PostCard';
import { mergeCommentPage, type PublicPost, type PostChange } from '~/components/Feed/feedTypes';
import { createDiscussionCommentPager, mergeDiscussionComments } from '~/components/Feed/discussionCommentPages';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import { SharedMediaProvider } from '~/components/Sharing/SharedMedia';
import { collectionStyles } from '~/components/Collections/collectionStyles';

type DiscussionProps = {
  thingId: string;
  linkKey?: string;
  initialPost?: PublicPost | null;
  description?: string;
  onCommentAdded?: () => void | Promise<unknown>;
  collectionControls?: boolean;
};

// The corresponding discussion shares the original Thing id and its live ACL.
export function ThingComments({ thingId, linkKey = '', initialPost, description, onCommentAdded, collectionControls = false }: DiscussionProps) {
  const user = useCurrentUser();
  return <Discussion key={`${user?.id || 'anonymous'}:${thingId}:${linkKey}`} thingId={thingId} linkKey={linkKey} initialPost={initialPost} description={description} onCommentAdded={onCommentAdded} collectionControls={collectionControls} />;
}

function Discussion({ thingId, linkKey = '', initialPost, description, onCommentAdded, collectionControls }: DiscussionProps) {
  const api = useApi();
  const apiRef = React.useRef(api); apiRef.current = api;
  const [post, setPost] = React.useState<PublicPost | null>(() => initialPost ? { ...initialPost, comments: initialPost.comments.filter(comment => comment.repliesLoaded === false) } : null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [hasMore, setHasMore] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const active = React.useRef<{ pager: ReturnType<typeof createDiscussionCommentPager>; controller: AbortController } | null>(null);
  const reportFailure = React.useCallback((failure: any) => {
    if ([401, 403, 404].includes(Number(failure?.status))) {
      setPost(null);
      active.current?.pager.dispose();
      setHasMore(false);
    }
    setError(failure instanceof Error ? failure.message : 'Could not load comments.');
  }, []);
  const fetchPage = React.useCallback((cursor?: string) => apiRef.current.v1.things.list({
    target: thingId, thingtime: 'comment', key: linkKey, cursor, limit: 20, commentProjection: true
  }, { signal: active.current?.controller.signal }), [thingId, linkKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    const pager = createDiscussionCommentPager();
    active.current = { controller, pager };
    const started = Date.now();
    setError(''); setLoading(true); setHasMore(false);
    // Retain the cached conversation while both authoritative reads run. The
    // root carries no unrequested nested reply data in this projection.
    void Promise.all([
      apiRef.current.v1.things.get({ id: thingId, key: linkKey, commentProjection: true }, { signal: controller.signal }),
      pager.load(fetchPage)
    ]).then(([response, page]) => {
      if (controller.signal.aborted) return;
      const fresh = response?.discussion || response?.post;
      if (!response?.ok || !fresh) throw Object.assign(new Error(response?.error || 'Could not load comments.'), { status: response?.status });
      const comments = page?.comments || [];
      setPost(previous => {
        const keep = (previous?.comments || []).filter(comment => new Date(comment.createdAt).getTime() >= started).map(comment => comment.id);
        const merged = mergeCommentPage(comments, previous?.comments || [], keep, started);
        return mergeReactionOverlay(started, { ...fresh, comments: merged.comments, ...(fresh.commentCount === undefined ? {} : { commentCount: fresh.commentCount + merged.unseen }) });
      });
    }).catch(failure => { if (!controller.signal.aborted) reportFailure(failure); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); setHasMore(pager.hasMore); } });
    return () => { controller.abort(); pager.dispose(); };
  }, [thingId, linkKey, revision, fetchPage, reportFailure]);

  const loadMore = React.useCallback(async () => {
    const request = active.current;
    if (!request || loading || !request.pager.hasMore) return;
    const started = Date.now();
    setLoading(true); setError('');
    try {
      const page = await request.pager.load(fetchPage);
      if (request.controller.signal.aborted || !page) return;
      setPost(previous => previous && mergeReactionOverlay(started, { ...previous, comments: mergeDiscussionComments(previous.comments, page.comments) }));
    } catch (failure) {
      if (!request.controller.signal.aborted) reportFailure(failure);
    } finally {
      if (!request.controller.signal.aborted) { setLoading(false); setHasMore(request.pager.hasMore); }
    }
  }, [fetchPage, loading, reportFailure]);
  const onChanged = React.useCallback((id: string, change: PostChange) => setPost(previous => previous && previous.id === id ? typeof change === 'function' ? change(previous) : change : previous), []);
  return <Box minW={0} data-testid="thing-comments" data-discussion-source={thingId}>
    {collectionControls && <style>{collectionStyles}</style>}
    {description && <Text color="var(--tt-muted)" fontSize="sm" mb={2}>{description}</Text>}
    {post && <SharedMediaProvider linkKey={linkKey}><PostCard key={revision} post={post} onChanged={onChanged} onCommentAdded={onCommentAdded} defaultCommentsOpen discussionOnly commentCollection={{ controls: !!collectionControls, hasMore, loadMore, loading, error, resetKey: String(revision) }} /></SharedMediaProvider>}
    {error && <Text role="alert" color="red.500" fontSize="sm">{error}</Text>}
    <Button size="sm" variant="ghost" mt={2} isDisabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh comments</Button>
  </Box>;
}
