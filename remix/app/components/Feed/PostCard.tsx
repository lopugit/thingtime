import React from 'react';
import {
  Box,
  Button,
  Center,
  Flex,
  Grid,
  IconButton,
  Image,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  SkeletonCircle,
  Text,
  Textarea,
  Tooltip
} from '@chakra-ui/react';
import { Link } from 'react-router';
import { Maximize2, MoreHorizontal, Plus, Send } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCommentDraft } from '~/hooks/useCommentDraft';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useOutsideTapClose } from '~/hooks/useOutsideTapClose';
import { useLopu } from '~/components/Lopu/useLopu';
import { ThingView } from '~/components/Thingtime/ThingView';
import { EmojiPicker } from '~/components/Emoji/EmojiPicker';
import { useRecentReactions } from '~/components/Emoji/useRecentReactions';
import { sanitizeReactionToken, splitEmojis } from '~/utils/reactionTokens';
import { RAINBOW } from '~/theme/rainbow';
import { PostComposer } from './PostComposer';
import { ReactionControl } from './ReactionControl';
import {
  CIRCLE_META,
  MARKETPLACE_CATEGORY_META,
  REACTION_EMOJIS,
  timeAgo
} from './feedTypes';
import type { EngagementEvent, FeedAuthor, PostChange, PostComment, PostVisibility, PublicPost } from './feedTypes';

// Keep reaction displays from running off the card: cap how many individual
// emoji show before an ellipsis, so one long multi-emoji token (🥳🥳🥳…) can't
// blow out a chip or the React-button preview.
const MAX_PREVIEW_EMOJIS = 6;

// Truncate a single token's emoji for chip display.
const truncateToken = (token: string): { text: string; truncated: boolean } => {
  const parts = splitEmojis(token);
  if (parts.length <= MAX_PREVIEW_EMOJIS) return { text: token, truncated: false };
  return { text: parts.slice(0, MAX_PREVIEW_EMOJIS).join(''), truncated: true };
};

// Apply one token's toggle to a post, idempotently (a no-op if the post already
// reflects it). Used for optimistic paint + revert against the FRESHEST post, so
// a concurrent reaction on a different token is never clobbered.
const applyReactionToggle = <T extends Pick<PublicPost, 'reactionCounts' | 'viewerReactions'>>(
  prev: T,
  token: string,
  adding: boolean
): T => {
  const has = prev.viewerReactions.includes(token);
  if (adding === has) return prev;
  const reactionCounts = { ...prev.reactionCounts };
  reactionCounts[token] = (reactionCounts[token] || 0) + (adding ? 1 : -1);
  if (reactionCounts[token] <= 0) delete reactionCounts[token];
  const viewerReactions = adding
    ? [...prev.viewerReactions, token]
    : prev.viewerReactions.filter((entry) => entry !== token);
  return { ...prev, reactionCounts, viewerReactions };
};

// Reconcile ONLY the toggled token against the server's authoritative view,
// leaving other tokens (possibly changed by concurrent reactions) intact.
const reconcileReactionToken = (
  prev: PublicPost,
  token: string,
  serverCounts: Record<string, number>,
  serverViewer: string[]
): PublicPost => {
  const reactionCounts = { ...prev.reactionCounts };
  const count = serverCounts[token] || 0;
  if (count > 0) reactionCounts[token] = count;
  else delete reactionCounts[token];
  const serverHas = serverViewer.includes(token);
  const prevHas = prev.viewerReactions.includes(token);
  let viewerReactions = prev.viewerReactions;
  if (serverHas && !prevHas) viewerReactions = [...prev.viewerReactions, token];
  else if (!serverHas && prevHas) viewerReactions = prev.viewerReactions.filter((entry) => entry !== token);
  return { ...prev, reactionCounts, viewerReactions };
};

// Compact preview of the viewer's reactions for the React button: each token is
// its own group (gapped from the next) carrying its use-count, capped across all
// groups at MAX_PREVIEW_EMOJIS emoji then an ellipsis.
const summarizeReactions = (
  tokens: string[],
  counts: Record<string, number>
): { groups: Array<{ key: string; emoji: string; count: number }>; truncated: boolean } => {
  const groups: Array<{ key: string; emoji: string; count: number }> = [];
  let shown = 0;
  let truncated = false;
  for (const token of tokens) {
    if (shown >= MAX_PREVIEW_EMOJIS) {
      truncated = true;
      break;
    }
    const parts = splitEmojis(token);
    const slice = parts.slice(0, MAX_PREVIEW_EMOJIS - shown);
    if (slice.length < parts.length) truncated = true;
    groups.push({ key: token, emoji: slice.join(''), count: counts[token] || 1 });
    shown += slice.length;
  }
  return { groups, truncated };
};

// The typed post renderer for the feed / profile columns. Renders text,
// photo-grid and marketplace bodies, one-level share nesting, the reaction
// picker, comments and the share popover. All mutations go through
// api.v1.things and bubble optimistic updates up via onChanged.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

export type PostCardProps = {
  post: PublicPost;
  // a value replaces the post (null = deleted); a function applies a delta to
  // the freshest post (used by optimistic reactions)
  onChanged?: (next: PostChange) => void;
  // card-level signals: expand/react/comment/share
  onEngagement?: (event: EngagementEvent) => void;
  // the /post/:id page opens with the conversation expanded
  defaultCommentsOpen?: boolean;
};

const authorName = (author: FeedAuthor | null) =>
  author?.displayName || author?.username || 'Anonymous 👻';

// Every post/comment timestamp is a permalink to its /post/:id page, the way
// timestamps work on every major platform.
const TimestampLink = ({ id, createdAt, fontSize = 'xs' }: { id: string; createdAt: string; fontSize?: string }) => (
  <Link to={`/post/${id}`} title={new Date(createdAt).toLocaleString()}>
    <Text as="span" fontSize={fontSize} color={MUTED} _hover={{ textDecoration: 'underline', color: INK }}>
      {timeAgo(createdAt)}
    </Text>
  </Link>
);

export const AuthorAvatar = (props: { author: FeedAuthor | null; size?: string; fontSize?: string }) => {
  const { author, size = '36px', fontSize = 'sm' } = props;

  const initial = (author?.displayName || author?.username || '?').trim().charAt(0).toUpperCase();

  const circle = author?.avatarUrl ? (
    <Image
      src={author.avatarUrl}
      alt={authorName(author)}
      loading="lazy"
      flexShrink={0}
      width={size}
      height={size}
      borderRadius="999px"
      objectFit="cover"
      background="var(--tt-surface-alt, #f5f5f7)"
    />
  ) : (
    <Center
      flexShrink={0}
      width={size}
      height={size}
      borderRadius="999px"
      background={author ? RAINBOW : 'var(--tt-surface-alt, #f5f5f7)'}
      color="white"
      fontSize={fontSize}
      fontWeight={700}
    >
      {initial}
    </Center>
  );

  if (!author?.username) return circle;

  return <Link to={`/profile/${author.username}`}>{circle}</Link>;
};

const formatPrice = (price: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price}`;
  }
};

const ImageGrid = ({ images, alt }: { images: string[]; alt: string }) => {
  if (!images?.length) return null;

  if (images.length === 1) {
    return (
      <Image
        src={images[0]}
        alt={alt}
        loading="lazy"
        width="100%"
        maxHeight="480px"
        objectFit="cover"
        borderRadius={RADIUS_MD}
        background="var(--tt-surface-alt, #f5f5f7)"
      />
    );
  }

  const shown = images.slice(0, 4);
  const hidden = images.length - shown.length;

  return (
    <Grid templateColumns="repeat(2, 1fr)" gap={1.5}>
      {shown.map((src, index) => {
        const spansBoth = images.length >= 3 && index === 0;
        const showOverlay = hidden > 0 && index === shown.length - 1;

        return (
          <Box key={`${src}-${index}`} position="relative" gridColumn={spansBoth ? '1 / -1' : undefined}>
            <Image
              src={src}
              alt={`${alt} — photo ${index + 1}`}
              loading="lazy"
              width="100%"
              height={spansBoth ? '260px' : '180px'}
              objectFit="cover"
              borderRadius={RADIUS_MD}
              background="var(--tt-surface-alt, #f5f5f7)"
            />
            {showOverlay && (
              <Center
                position="absolute"
                inset={0}
                borderRadius={RADIUS_MD}
                background="rgba(0, 0, 0, 0.45)"
                color="white"
                fontWeight={700}
                fontSize="lg"
              >
                +{hidden}
              </Center>
            )}
          </Box>
        );
      })}
    </Grid>
  );
};

const ListingBlock = ({ post, hideImage }: { post: Pick<PublicPost, 'images' | 'listing'>; hideImage?: boolean }) => {
  const listing = post.listing;
  if (!listing) return null;

  const category = MARKETPLACE_CATEGORY_META[listing.category] || MARKETPLACE_CATEGORY_META.other;

  return (
    <Box border={BORDER} borderRadius={RADIUS_MD} overflow="hidden" opacity={listing.sold ? 0.6 : 1}>
      {!hideImage && post.images?.[0] && (
        <Image
          src={post.images[0]}
          alt={listing.title}
          loading="lazy"
          width="100%"
          maxHeight="340px"
          objectFit="cover"
          background="var(--tt-surface-alt, #f5f5f7)"
        />
      )}
      <Flex flexDirection="column" rowGap={1} padding={4}>
        <Flex alignItems="center" columnGap={2}>
          <Text fontSize="xl" fontWeight={800} color={INK} whiteSpace="normal">
            {formatPrice(listing.price, listing.currency)}
          </Text>
          {listing.sold && (
            <Box
              as="span"
              background="var(--tt-danger, #e5484d)"
              color="white"
              fontSize="10px"
              fontWeight={700}
              letterSpacing="0.08em"
              borderRadius="999px"
              paddingX={2}
              paddingY="2px"
            >
              SOLD
            </Box>
          )}
        </Flex>
        <Text fontWeight={600} color={INK} whiteSpace="normal">
          {listing.title}
        </Text>
        <Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" fontSize="xs" color={MUTED}>
          <Box as="span" border={BORDER} borderRadius="999px" paddingX={2} paddingY="1px">
            {category.emoji} {category.label}
          </Box>
          {listing.condition && <Box as="span">{listing.condition === 'new' ? 'New ✨' : 'Used ♻️'}</Box>}
          {listing.location && <Box as="span">📍 {listing.location}</Box>}
        </Flex>
      </Flex>
    </Box>
  );
};

// Body by post type — shared between the main card, nested shares, and
// comment rows (comments share the post schema, so PostComment fits too).
type PostBodyShape = Pick<PublicPost, 'type' | 'text' | 'images' | 'listing' | 'thing'>;
const PostBody = ({ post, compact }: { post: PostBodyShape; compact?: boolean }) => (
  <Flex flexDirection="column" rowGap={compact ? 2 : 3}>
    {post.text && (
      <Text fontSize={compact ? 'sm' : 'md'} color={TEXT} whiteSpace="normal">
        {post.text}
      </Text>
    )}
    {post.type === 'image' && <ImageGrid images={post.images} alt={post.text || 'Post photo'} />}
    {post.type === 'marketplace' && <ListingBlock post={post} />}
    {/* thingtime: the thing leads; opted-in photos and listing follow. The
    grid owns the photos, so the listing skips its header image (it would
    repeat the first photo). The thing mounts as the NATIVE Thingtime tree
    (sandboxed — see ThingView), rendered through its kind renderer when one
    resolves, with a corner icon flipping between the two views. */}
    {post.type === 'thingtime' && post.thing && <ThingView thing={post.thing} compact={compact} />}
    {post.type === 'thingtime' && !!post.images?.length && (
      <ImageGrid images={post.images} alt={post.text || 'Thing photo'} />
    )}
    {post.type === 'thingtime' && post.listing && <ListingBlock post={post} hideImage={!!post.images?.length} />}
  </Flex>
);

// Compact bordered sub-card for the original post inside a share (no actions).
const SharedPostCard = ({ post }: { post: PublicPost }) => (
  <Box border={BORDER} borderRadius={RADIUS_MD} padding={3}>
    <Flex alignItems="center" columnGap={2} marginBottom={2}>
      <AuthorAvatar author={post.author} size="22px" fontSize="10px" />
      <Text fontSize="xs" fontWeight={700} color={INK} noOfLines={1}>
        {authorName(post.author)}
      </Text>
      <Text fontSize="xs" color={MUTED} flexShrink={0}>
        ·
      </Text>
      <Box flexShrink={0}>
        <TimestampLink id={post.id} createdAt={post.createdAt} />
      </Box>
    </Flex>
    <PostBody post={post} compact />
  </Box>
);

// The quick-reaction strip inside the picker popover — the standard emojis
// plus a ＋ opening the full custom picker (when the host provides one).
const QuickReactionRow = (props: {
  viewerSet: Set<string>;
  onPick: (emoji: string) => void;
  onMore?: () => void;
}) => {
  const { viewerSet, onPick, onMore } = props;
  return (
    <Flex columnGap={0.5} padding={1.5} alignItems="center">
      {REACTION_EMOJIS.map((emoji) => (
        <Center
          key={emoji}
          as="button"
          type="button"
          width="34px"
          height="34px"
          fontSize="lg"
          borderRadius="999px"
          background={viewerSet.has(emoji) ? 'var(--tt-surface-hover, #ececee)' : 'transparent'}
          boxShadow={viewerSet.has(emoji) ? 'inset 0 0 0 1.5px var(--tt-accent, #7c5cff)' : 'none'}
          _hover={{ background: 'var(--tt-surface-hover, #ececee)', transform: 'scale(1.2)' }}
          transition="transform 0.12s ease-out"
          aria-label={`React ${emoji}`}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </Center>
      ))}
      {onMore && (
        <Center
          as="button"
          type="button"
          width="34px"
          height="34px"
          borderRadius="999px"
          color={MUTED}
          background="var(--tt-surface-alt, #f5f5f7)"
          _hover={{ background: 'var(--tt-surface-hover, #ececee)', color: INK, transform: 'scale(1.2)' }}
          transition="transform 0.12s ease-out"
          aria-label="Choose a custom emoji"
          title="Choose a custom emoji"
          onClick={onMore}
        >
          <Plus size={16} strokeWidth={2.4} />
        </Center>
      )}
    </Flex>
  );
};

// Only one EMPTY reply input is open at a time across a card's comment tree:
// opening a reply announces itself here and rows whose draft is empty close
// themselves. Rows with a typed draft stay open — never lose user text.
const ReplyFocusContext = React.createContext<{ openId: string | null; requestOpen: (id: string) => void } | null>(
  null
);

// The viewer as a FeedAuthor embed — optimistic comments render instantly
// with the real author identity while the server write is in flight.
const viewerAsAuthor = (user: any): FeedAuthor | null =>
  user
    ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
        avatarUrl: user.avatarUrl ?? null
      }
    : null;

// A locally-built comment shown the instant the user hits send; swapped for
// the server's copy when the write lands (id is provisional until then).
const buildPendingComment = (user: any, targetId: string, text: string): PostComment => ({
  id: `pending-${Math.random().toString(36).slice(2)}`,
  thingtime: ['comment'],
  author: viewerAsAuthor(user),
  type: 'text',
  text,
  images: [],
  listing: null,
  thing: null,
  tags: [],
  reactionCounts: {},
  viewerReactions: [],
  commentCount: 0,
  targetId,
  createdAt: new Date().toISOString()
});

const isPendingComment = (comment: PostComment) => comment.id.startsWith('pending-');

// Left-to-right shimmer placeholder shaped like comment rows — the ONLY
// loading state threads show, and only on a cold open with nothing cached.
const ReplySkeleton = () => {
  const shimmer = {
    startColor: 'var(--tt-surface-alt, #f5f5f7)',
    endColor: 'var(--tt-surface-hover, #ececee)'
  };
  return (
    <Flex flexDirection="column" rowGap={2} paddingTop={1} aria-label="Loading replies" role="status">
      {[0, 1].map((index) => (
        <Flex key={index} columnGap={2} alignItems="flex-start">
          <SkeletonCircle size="22px" flexShrink={0} {...shimmer} />
          <Flex flex="1" minWidth={0} flexDirection="column" rowGap={1.5} paddingTop="2px">
            <Skeleton height="9px" width="30%" borderRadius="999px" {...shimmer} />
            <Skeleton height="13px" width={index ? '62%' : '82%'} borderRadius="999px" {...shimmer} />
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
};

// A comment row — comments share the post schema, so each row is reactable
// (tap to 👍, hold/hover for the picker — optimistic, no wait), renders rich
// post bodies, and replies INLINE: the Reply control opens a reply input and
// the thread right here (the /post/:id permalink stays on the timestamp).
const CommentRow = (props: {
  comment: PostComment;
  onChanged: (next: PostComment) => void;
  onEngagement?: (event: EngagementEvent) => void;
}) => {
  const { comment, onChanged, onEngagement } = props;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();
  const { recent, pushRecent } = useRecentReactions();
  const replyFocus = React.useContext(ReplyFocusContext);

  // threads ship two levels deep — preloaded replies render immediately
  const [replies, setReplies] = React.useState<PostComment[] | null>(
    comment.comments?.length ? comment.comments : null
  );
  const [repliesOpen, setRepliesOpen] = React.useState(!!comment.comments?.length);
  // the reply INPUT is separate from thread visibility: threads stay open,
  // but only one empty input exists at a time (ReplyFocusContext)
  const [replyInputOpen, setReplyInputOpen] = React.useState(false);
  const [visibleReplies, setVisibleReplies] = React.useState(5);
  const [richReplyOpen, setRichReplyOpen] = React.useState(false);
  const [repliesLoading, setRepliesLoading] = React.useState(false);
  // reply text persists as a per-user draft — leave and pick it up later
  const { value: replyText, setValue: setReplyText, clear: clearReplyDraft, hydrated: draftHydrated } = useCommentDraft(
    user?.id,
    comment.id
  );
  const pending = isPendingComment(comment);

  // ＋ in the quick row opens the full custom picker (same as posts)
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const pickerContentRef = useOutsideTapClose<HTMLElement>(pickerOpen, () => setPickerOpen(false));

  // a stored draft reopens its thread on mount — continue where you left off
  React.useEffect(() => {
    if (draftHydrated && replyText.trim()) {
      openThread();
      setReplyInputOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHydrated]);

  // another reply opened somewhere in this card — close ONLY if our draft is
  // empty (typed text always keeps its input open)
  React.useEffect(() => {
    if (!replyFocus) return;
    if (replyFocus.openId !== comment.id && replyInputOpen && !replyText.trim()) setReplyInputOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyFocus?.openId]);

  const viewerSet = new Set(comment.viewerReactions || []);
  const reactionEntries = Object.entries(comment.reactionCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const reactionTotal = reactionEntries.reduce((sum, [, count]) => sum + count, 0);
  const topEmojis = reactionEntries
    .slice(0, 3)
    .map(([token]) => truncateToken(token).text)
    .join('');

  // optimistic: repaint immediately, reconcile with the server's counts,
  // revert on failure — same principle as post reactions
  const handleReact = async (rawToken: string) => {
    if (!user) {
      lopu({ title: 'Log in to react 🗝️', status: 'info', duration: 6000 });
      return;
    }
    const token = sanitizeReactionToken(rawToken);
    if (!token) return;

    const adding = !viewerSet.has(token);
    const optimistic = applyReactionToggle(comment, token, adding);
    onChanged(optimistic);
    if (adding) onEngagement?.({ thingId: comment.id, signal: 'react' });

    try {
      const resp = await api.v1.things.react({ id: comment.id, emoji: token });
      onChanged({ ...optimistic, reactionCounts: resp.reactionCounts, viewerReactions: resp.viewerReactions });
      if (adding) pushRecent(token, resp.recentReactions);
    } catch (err: any) {
      onChanged(comment); // revert to the pre-toggle snapshot
      lopu({ title: err?.error || 'Reaction did not stick 😞', status: 'error' });
    }
  };

  // Thread data model: stale-while-revalidate with prefetch-ahead.
  // - Every rendered row auto-fetches its missing reply depth on mount, so
  //   revealing a level is instant — and freshly revealed rows prefetch THE
  //   NEXT depth themselves, cascading as you go deeper.
  // - Opening / show-more reveals cached replies immediately and still fires
  //   a background refetch so live comments added meanwhile reconcile in.
  // - The skeleton shows only on a cold open with nothing cached (rare).
  // Loaded replies + reveal depth persist across close/reopen (component
  // state) and reset when the page is left or refreshed.
  const repliesStateRef = React.useRef(replies);
  repliesStateRef.current = replies;
  const fetchingRef = React.useRef(false);

  const fetchThread = React.useCallback(
    (options?: { force?: boolean }) => {
      if (fetchingRef.current || pending) return;
      const loaded = repliesStateRef.current?.length ?? 0;
      if (!options?.force && (comment.commentCount === 0 || loaded >= comment.commentCount)) return;
      fetchingRef.current = true;
      // skeleton only when there is truly nothing to paint
      if (repliesStateRef.current === null && comment.commentCount > 0) setRepliesLoading(true);
      api.v1.things
        .get({ id: comment.id })
        .then((resp: any) => {
          const fetched: PostComment[] = resp?.post?.comments || [];
          setReplies((prev) => {
            // keep optimistic sends that raced the fetch, drop ones the
            // server copy now covers
            const pendings = (prev || []).filter(
              (reply) => isPendingComment(reply) && !fetched.some((entry) => entry.id === reply.id)
            );
            return [...fetched, ...pendings];
          });
        })
        .catch(() => setReplies((prev) => prev ?? []))
        .finally(() => {
          fetchingRef.current = false;
          setRepliesLoading(false);
        });
    },
    [api, comment.id, comment.commentCount, pending]
  );

  // prefetch-ahead: fill this row's missing depth as soon as it renders (and
  // again if the reply count grows under us)
  React.useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  const openThread = () => {
    setRepliesOpen(true);
    // instant reveal from cache + background live refresh
    fetchThread({ force: true });
  };

  const toggleThread = () => {
    if (repliesOpen) setRepliesOpen(false);
    else openThread();
  };

  const toggleReplyInput = () => {
    if (replyInputOpen) {
      setReplyInputOpen(false);
      return;
    }
    openThread();
    setReplyInputOpen(true);
    replyFocus?.requestOpen(comment.id);
  };

  // 5 more per click, revealed instantly from the prefetched cache; a
  // background refetch reconciles any live comments added in the meantime
  const showMoreReplies = () => {
    setVisibleReplies((count) => count + 5);
    fetchThread({ force: true });
  };

  // optimistic: the reply renders the moment you hit send; the server copy
  // swaps in when the write lands, and a failure restores your text
  const submitReply = async () => {
    const text = replyText.trim();
    if (!text) return;

    const pendingReply = buildPendingComment(user, comment.id, text);
    clearReplyDraft();
    setReplies((prev) => [...(prev || []), pendingReply]);
    onChanged({ ...comment, commentCount: comment.commentCount + 1 });
    onEngagement?.({ thingId: comment.id, signal: 'comment' });

    try {
      const resp = await api.v1.things.comment({ id: comment.id, text });
      setReplies((prev) => {
        const mapped = (prev || []).map((reply) => (reply.id === pendingReply.id ? resp.comment : reply));
        return mapped.filter((reply, index) => mapped.findIndex((entry) => entry.id === reply.id) === index);
      });
    } catch (err: any) {
      setReplies((prev) => (prev || []).filter((reply) => reply.id !== pendingReply.id));
      onChanged({ ...comment, commentCount: Math.max(0, comment.commentCount) });
      setReplyText(text); // give the draft back
      lopu({ title: err?.error || 'Reply did not send 😞', status: 'error' });
    }
  };

  // the rich composer posts through api.v1.things.comment itself and hands
  // back the created reply (post-shaped)
  const handleRichReplied = (reply: PostComment) => {
    setReplies((prev) => [...(prev || []), reply]);
    setRepliesOpen(true);
    onChanged({ ...comment, commentCount: comment.commentCount + 1 });
    onEngagement?.({ thingId: comment.id, signal: 'comment' });
    setRichReplyOpen(false);
  };

  const handleReplyChanged = (next: PostComment) => {
    setReplies((prev) => (prev || []).map((reply) => (reply.id === next.id ? next : reply)));
  };

  return (
    <Flex columnGap={2} alignItems="flex-start" opacity={pending ? 0.6 : 1} transition="opacity 0.2s ease">
      <AuthorAvatar author={comment.author} size="22px" fontSize="10px" />
      <Box flex="1" minWidth={0}>
        <Box background="var(--tt-surface-alt, #f5f5f7)" borderRadius={RADIUS_MD} paddingX={3} paddingY={2}>
          <Flex alignItems="baseline" columnGap={2}>
            <Text fontSize="xs" fontWeight={700} color={INK} noOfLines={1}>
              {authorName(comment.author)}
            </Text>
            <Box flexShrink={0}>
              <TimestampLink id={comment.id} createdAt={comment.createdAt} fontSize="10px" />
            </Box>
          </Flex>
          <PostBody post={comment} compact />
        </Box>
        <Flex alignItems="center" columnGap={2} paddingX={2} paddingTop={0.5} fontSize="11px" color={MUTED}>
          <Box position="relative" display="flex">
            <ReactionControl
            enabled={!!user && !pending}
            onQuickTap={() => handleReact('👍')}
            content={(close) => (
              <QuickReactionRow
                viewerSet={viewerSet}
                onPick={(emoji) => {
                  close();
                  handleReact(emoji);
                }}
                onMore={() => {
                  close();
                  setPickerOpen(true);
                }}
              />
            )}
            trigger={
              <Box
                as="button"
                type="button"
                fontSize="11px"
                fontWeight={viewerSet.size ? 700 : 600}
                color={viewerSet.size ? INK : MUTED}
                _hover={{ color: INK }}
              >
                {viewerSet.size ? [...viewerSet].slice(0, 3).join('') : '👍'} React
              </Box>
            }
            />
            {/* the full custom picker (multi-select), anchored above the row */}
            <Popover isOpen={pickerOpen} onClose={() => setPickerOpen(false)} placement="top-start" isLazy closeOnBlur={false}>
              <PopoverAnchor>
                <Box position="absolute" left={0} bottom="100%" width="1px" height="1px" pointerEvents="none" />
              </PopoverAnchor>
              <PopoverContent
                ref={pickerContentRef as any}
                width="auto"
                border={BORDER}
                borderRadius="var(--tt-radius-lg, 16px)"
                background="var(--tt-card, #fff)"
                boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
                zIndex={20}
                _focusVisible={{ outline: 'none' }}
              >
                <EmojiPicker onPick={handleReact} recent={recent} activeTokens={comment.viewerReactions} autoFocus />
              </PopoverContent>
            </Popover>
          </Box>
          {reactionTotal > 0 && (
            <Text as="span" flexShrink={0} title="Reactions">
              {topEmojis} {reactionTotal}
            </Text>
          )}
          <Box
            as="button"
            type="button"
            fontSize="11px"
            fontWeight={600}
            color={replyInputOpen ? INK : MUTED}
            _hover={{ color: INK }}
            aria-expanded={replyInputOpen}
            onClick={toggleReplyInput}
          >
            Reply 💬
          </Box>
          {comment.commentCount > 0 && (
            <Box
              as="button"
              type="button"
              fontSize="11px"
              fontWeight={600}
              color={repliesOpen ? INK : MUTED}
              _hover={{ color: INK }}
              aria-expanded={repliesOpen}
              onClick={toggleThread}
            >
              {comment.commentCount} repl{comment.commentCount === 1 ? 'y' : 'ies'} 🧵
            </Box>
          )}
        </Flex>

        {/* inline thread: replies + reply input, right here on the page */}
        {(repliesOpen || replyInputOpen) && (
          <Flex flexDirection="column" rowGap={2} paddingTop={2}>
            {repliesOpen &&
              !(repliesLoading && replies === null) &&
              ((replies?.length || 0) > visibleReplies || comment.commentCount > (replies?.length || 0)) && (
              <Box
                as="button"
                type="button"
                alignSelf="flex-start"
                fontSize="11px"
                fontWeight={600}
                color={MUTED}
                _hover={{ color: INK }}
                onClick={showMoreReplies}
              >
                Show more replies 💬
              </Box>
            )}
            {repliesLoading && replies === null && <ReplySkeleton />}
            {repliesOpen &&
              (replies || []).slice(-visibleReplies).map((reply) => (
                <CommentRow key={reply.id} comment={reply} onChanged={handleReplyChanged} onEngagement={onEngagement} />
              ))}
            {replyInputOpen &&
              (user ? (
                <Flex flexDirection="column" rowGap={2}>
                  <Flex columnGap={2}>
                    <Input
                      size="xs"
                      borderRadius="999px"
                      placeholder={`Reply to ${authorName(comment.author)}… 💬`}
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          submitReply();
                        }
                      }}
                    />
                    <Tooltip label="Reply with photos, a listing, a thing & more" fontSize="xs" borderRadius="8px" hasArrow>
                      <IconButton
                        aria-label="Open full reply composer"
                        icon={<Maximize2 size={12} />}
                        size="xs"
                        variant={richReplyOpen ? 'solid' : 'outline'}
                        borderRadius="999px"
                        onClick={() => setRichReplyOpen((open) => !open)}
                      />
                    </Tooltip>
                    <IconButton
                      aria-label="Send reply"
                      icon={<Send size={12} />}
                      size="xs"
                      variant="outline"
                      borderRadius="999px"
                      isDisabled={!replyText.trim()}
                      onClick={submitReply}
                    />
                  </Flex>
                  {richReplyOpen && (
                    <PostComposer
                      parentId={comment.id}
                      onPosted={handleRichReplied as any}
                      onClose={() => setRichReplyOpen(false)}
                    />
                  )}
                </Flex>
              ) : (
                <Text fontSize="11px" color={MUTED}>
                  Log in to reply 🗝️
                </Text>
              ))}
          </Flex>
        )}
      </Box>
    </Flex>
  );
};

// memoised: engagement telemetry re-renders the feed page frequently, and an
// unchanged post reference should never re-render its card
export const PostCard = React.memo(function PostCardImpl(props: PostCardProps) {
  const { post, onChanged, onEngagement, defaultCommentsOpen } = props;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  const [commentsOpen, setCommentsOpen] = React.useState(!!defaultCommentsOpen);
  // the comment text persists as a per-user draft — leave and pick it up later
  const { value: commentText, setValue: setCommentText, clear: clearCommentDraft } = useCommentDraft(user?.id, post.id);
  const [richCommentOpen, setRichCommentOpen] = React.useState(false);
  // one EMPTY reply input at a time across this card's comment tree
  const [openReplyId, setOpenReplyId] = React.useState<string | null>(null);
  // comments page 5 at a time — "show more" reveals 5 older ones per click
  const [visibleComments, setVisibleComments] = React.useState(5);
  const replyFocus = React.useMemo(() => ({ openId: openReplyId, requestOpen: setOpenReplyId }), [openReplyId]);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [shareText, setShareText] = React.useState('');
  const [shareVisibility, setShareVisibility] = React.useState<PostVisibility>('public');
  const [sharing, setSharing] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // outside-tap close (NOT closeOnBlur): dismissing the mobile keyboard blurs
  // the search/caption field and must not close these popovers
  const pickerContentRef = useOutsideTapClose<HTMLElement>(pickerOpen, () => setPickerOpen(false));
  const shareContentRef = useOutsideTapClose<HTMLElement>(shareOpen, () => setShareOpen(false));
  const expandSentRef = React.useRef(false);

  const { recent, pushRecent } = useRecentReactions();

  const isOwner = !!user && !!post.author && user.id === post.author.id;
  const circle = CIRCLE_META[post.visibility] || CIRCLE_META.public;

  // Every reaction token on the post, most-used first, as clickable chips.
  const reactionEntries = Object.entries(post.reactionCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const viewerReactions = post.viewerReactions || [];
  const viewerSet = new Set(viewerReactions);

  const handleDelete = async () => {
    try {
      await api.v1.things.remove({ id: post.id });
      lopu({ title: 'Post deleted 🗑️', status: 'success', duration: 6000 });
      onChanged?.(null);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not delete that post 😞', status: 'error' });
    }
  };

  // Toggle one reaction token (single emoji or a multi-emoji group). Optimistic:
  // we repaint the card immediately, then reconcile with the server's counts
  // and revert on failure — no spinner, no wait (optimistic-rendering rule).
  const handleReact = async (rawToken: string) => {
    if (!user) {
      lopu({ title: 'Log in to react 🗝️', status: 'info', duration: 6000 });
      return;
    }
    const token = sanitizeReactionToken(rawToken);
    if (!token) return;

    const adding = !viewerSet.has(token);

    // Optimistic + reconcile + revert all touch ONLY this token, applied to the
    // freshest post — so a concurrent reaction on another token isn't clobbered
    // by a stale full snapshot (and out-of-order responses stay consistent).
    onChanged?.((prev) => applyReactionToggle(prev, token, adding));
    if (adding) onEngagement?.({ thingId: post.id, signal: 'react' });

    try {
      const resp = await api.v1.things.react({ id: post.id, emoji: token });
      onChanged?.((prev) => reconcileReactionToken(prev, token, resp.reactionCounts, resp.viewerReactions));
      // record recents only on a successful ADD (server records the same)
      if (adding) pushRecent(token, resp.recentReactions);
    } catch (err: any) {
      onChanged?.((prev) => applyReactionToggle(prev, token, !adding)); // undo just this token
      lopu({ title: err?.error || 'Reaction did not stick 😞', status: 'error' });
    }
  };

  // Opening shows the first page of comments (5); "Show more" reveals 5 more
  // per click. The revealed count is REMEMBERED across close/reopen (it's
  // component state), and resets only when the page is left or refreshed.
  const toggleComments = () => {
    setCommentsOpen((open) => !open);
    if (!expandSentRef.current) {
      expandSentRef.current = true;
      onEngagement?.({ thingId: post.id, signal: 'expand' });
    }
  };

  // optimistic: the comment renders the moment you hit send; the server copy
  // swaps in when the write lands, and a failure restores your text
  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) return;

    const pendingComment = buildPendingComment(user, post.id, text);
    clearCommentDraft();
    onChanged?.((prev) => ({
      ...prev,
      comments: [...prev.comments, pendingComment],
      commentCount: prev.commentCount + 1
    }));
    onEngagement?.({ thingId: post.id, signal: 'comment' });

    try {
      const resp = await api.v1.things.comment({ id: post.id, text });
      onChanged?.((prev) => ({
        ...prev,
        comments: prev.comments.map((comment) => (comment.id === pendingComment.id ? resp.comment : comment)),
        commentCount: resp.commentCount
      }));
    } catch (err: any) {
      onChanged?.((prev) => ({
        ...prev,
        comments: prev.comments.filter((comment) => comment.id !== pendingComment.id),
        commentCount: Math.max(0, prev.commentCount - 1)
      }));
      setCommentText(text); // give the draft back
      lopu({ title: err?.error || 'Comment did not send 😞', status: 'error' });
    }
  };

  // the rich composer posts through api.v1.things.comment itself and hands
  // back the created comment (post-shaped — comments share the post schema)
  const handleRichCommented = (comment: PostComment) => {
    onChanged?.((prev) => ({
      ...prev,
      comments: [...prev.comments, comment],
      commentCount: prev.commentCount + 1
    }));
    onEngagement?.({ thingId: post.id, signal: 'comment' });
    setRichCommentOpen(false);
  };

  // a comment changed (reaction toggled) — swap it inside the freshest post
  const handleCommentChanged = (next: PostComment) => {
    onChanged?.((prev) => ({
      ...prev,
      comments: prev.comments.map((comment) => (comment.id === next.id ? next : comment))
    }));
  };

  const handleShareClick = () => {
    if (!user) {
      lopu({ title: 'Log in to share ↗️', status: 'info', duration: 6000 });
      return;
    }
    setShareOpen((open) => !open);
  };

  const handleShare = async () => {
    if (sharing) return;

    setSharing(true);
    try {
      await api.v1.things.share({
        id: post.id,
        text: shareText.trim() || undefined,
        visibility: shareVisibility
      });
      lopu({ title: 'Shared ✨', status: 'success', duration: 6000 });
      onChanged?.({ ...post, shareCount: post.shareCount + 1 });
      onEngagement?.({ thingId: post.id, signal: 'share' });
      setShareOpen(false);
      setShareText('');
    } catch (err: any) {
      lopu({ title: err?.error || 'Share failed 😞', status: 'error' });
    }
    setSharing(false);
  };

  const actionButtonStyles = {
    flex: 1,
    size: 'sm' as const,
    variant: 'ghost' as const,
    fontWeight: 600,
    color: MUTED,
    borderRadius: RADIUS_MD,
    _hover: { background: 'var(--tt-surface-hover, #ececee)', color: INK }
  };

  const reactionPreview = summarizeReactions(viewerReactions, post.reactionCounts || {});
  // tap/click, touch-and-hold, and hover are handled by ReactionControl
  const reactButton = (
    <Button
      {...actionButtonStyles}
      minWidth={0}
      color={viewerReactions.length ? INK : MUTED}
      fontWeight={viewerReactions.length ? 700 : 600}
    >
      <Flex
        as="span"
        alignItems="center"
        columnGap={1.5}
        marginRight={1}
        maxWidth="220px"
        overflow="hidden"
        sx={{ whiteSpace: 'nowrap' }}
      >
        {viewerReactions.length ? (
          <>
            {reactionPreview.groups.map((group) => (
              <Flex as="span" key={group.key} alignItems="center" columnGap="2px" flexShrink={0}>
                <Text as="span">{group.emoji}</Text>
                <Text as="span" fontSize="0.72em" opacity={0.7}>
                  {group.count}
                </Text>
              </Flex>
            ))}
            {reactionPreview.truncated && (
              <Text as="span" flexShrink={0}>
                …
              </Text>
            )}
          </>
        ) : (
          <Text as="span">👍</Text>
        )}
      </Flex>
      React
    </Button>
  );

  return (
    <ReplyFocusContext.Provider value={replyFocus}>
    <Box
      background="var(--tt-card, #ffffff)"
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
      padding={[4, 5]}
    >
      <Flex flexDirection="column" rowGap={3}>
        {/* header */}
        <Flex alignItems="center" columnGap={3}>
          <AuthorAvatar author={post.author} />
          <Box minWidth={0} flex="1">
            <Flex alignItems="baseline" columnGap={1.5} flexWrap="wrap" whiteSpace="normal">
              {post.author?.username ? (
                <Link to={`/profile/${post.author.username}`}>
                  <Text as="span" fontSize="sm" fontWeight={700} color={INK} _hover={{ textDecoration: 'underline' }}>
                    {authorName(post.author)}
                  </Text>
                </Link>
              ) : (
                <Text as="span" fontSize="sm" fontWeight={700} color={MUTED}>
                  Anonymous 👻
                </Text>
              )}
              <Text as="span" fontSize="xs" color={MUTED}>
                {post.author?.username ? `@${post.author.username} · ` : ''}
              </Text>
              <TimestampLink id={post.id} createdAt={post.createdAt} />
              <Tooltip label={`${circle.label} — ${circle.hint}`} fontSize="xs" borderRadius="8px" hasArrow>
                <Text as="span" fontSize="xs" cursor="default">
                  {circle.emoji}
                </Text>
              </Tooltip>
            </Flex>
          </Box>
          {isOwner && (
            <Menu placement="bottom-end" autoSelect={false}>
              <MenuButton
                as={IconButton}
                aria-label="Post options"
                icon={<MoreHorizontal size={16} />}
                size="xs"
                variant="ghost"
                color={MUTED}
                borderRadius="8px"
              />
              <MenuList minWidth="160px" borderRadius={RADIUS_MD} zIndex={10}>
                <MenuItem fontSize="sm" color="var(--tt-danger, #e5484d)" onClick={handleDelete}>
                  Delete 🗑️
                </MenuItem>
              </MenuList>
            </Menu>
          )}
        </Flex>

        {/* body — shares render caption + nested original */}
        {post.isShare ? (
          <Flex flexDirection="column" rowGap={3}>
            {post.text && (
              <Text fontSize="md" color={TEXT} whiteSpace="normal">
                {post.text}
              </Text>
            )}
            {post.shareOf ? (
              <SharedPostCard post={post.shareOf} />
            ) : (
              <Flex
                alignItems="center"
                justifyContent="center"
                paddingY={5}
                border="1px dashed var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-md, 12px)"
              >
                <Text fontSize="sm" color={MUTED}>
                  Original post unavailable 🌫️
                </Text>
              </Flex>
            )}
          </Flex>
        ) : (
          <PostBody post={post} />
        )}

        {/* reaction chips + counts row — each chip toggles that reaction */}
        {(reactionEntries.length > 0 || post.commentCount > 0 || post.shareCount > 0) && (
          <Flex alignItems="center" fontSize="xs" color={MUTED} columnGap={2} rowGap={1} flexWrap="wrap">
            {reactionEntries.map(([token, count]) => {
              const mine = viewerSet.has(token);
              const { text, truncated } = truncateToken(token);
              return (
                <Flex
                  as="button"
                  type="button"
                  key={token}
                  alignItems="center"
                  columnGap={1}
                  paddingX={2}
                  paddingY="1px"
                  maxWidth="100%"
                  borderRadius="999px"
                  border={mine ? '1px solid var(--tt-accent, #7c5cff)' : BORDER}
                  background={mine ? 'var(--tt-accent-soft, rgba(124, 92, 255, 0.12))' : 'transparent'}
                  color={mine ? INK : MUTED}
                  cursor={user ? 'pointer' : 'default'}
                  _hover={user ? { background: 'var(--tt-surface-hover, #ececee)' } : undefined}
                  onClick={() => handleReact(token)}
                  title={token}
                >
                  <Text as="span" sx={{ whiteSpace: 'nowrap' }}>
                    {text}
                    {truncated ? '…' : ''}
                  </Text>
                  <Text as="span">{count}</Text>
                </Flex>
              );
            })}
            <Flex alignItems="center" columnGap={2} marginLeft="auto">
              {post.commentCount > 0 && (
                <Text
                  as="button"
                  type="button"
                  fontWeight={600}
                  _hover={{ color: INK, textDecoration: 'underline' }}
                  aria-expanded={commentsOpen}
                  onClick={toggleComments}
                >
                  {post.commentCount} comment{post.commentCount === 1 ? '' : 's'}
                </Text>
              )}
              {post.shareCount > 0 && (
                <Text as="span">
                  {post.shareCount} share{post.shareCount === 1 ? '' : 's'}
                </Text>
              )}
            </Flex>
          </Flex>
        )}

        {/* action row */}
        <Flex borderTop={BORDER} paddingTop={2} columnGap={1}>
          {user ? (
            <Box position="relative" display="flex" flex="1">
              {/* hover OR touch-and-hold: quick reactions + a ＋ that opens the
              full picker; a plain tap/click quick-reacts 👍 */}
              <ReactionControl
                trigger={reactButton}
                onQuickTap={() => handleReact('👍')}
                content={(close) => (
                  <QuickReactionRow
                    viewerSet={viewerSet}
                    onPick={(emoji) => {
                      close();
                      handleReact(emoji);
                    }}
                    onMore={() => {
                      close();
                      setPickerOpen(true);
                    }}
                  />
                )}
              />

              {/* click: the full native-emoji picker (multi-select), anchored here */}
              <Popover
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                placement="top-start"
                isLazy
                closeOnBlur={false}
              >
                <PopoverAnchor>
                  <Box position="absolute" left={0} bottom="100%" width="1px" height="1px" pointerEvents="none" />
                </PopoverAnchor>
                <PopoverContent
                  ref={pickerContentRef as any}
                  width="auto"
                  border={BORDER}
                  borderRadius="var(--tt-radius-lg, 16px)"
                  background="var(--tt-card, #fff)"
                  boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
                  zIndex={20}
                  _focusVisible={{ outline: 'none' }}
                >
                  <EmojiPicker
                    onPick={handleReact}
                    recent={recent}
                    activeTokens={viewerReactions}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </Box>
          ) : (
            <ReactionControl
              enabled={false}
              trigger={reactButton}
              onQuickTap={() => handleReact('👍')}
              content={() => null}
            />
          )}

          <Button {...actionButtonStyles} onClick={toggleComments}>
            Comment 💬
          </Button>

          <Popover
            isOpen={shareOpen}
            onClose={() => setShareOpen(false)}
            placement="top"
            isLazy
            closeOnBlur={false}
          >
            <PopoverTrigger>
              <Button {...actionButtonStyles} onClick={handleShareClick}>
                Share ↗️
              </Button>
            </PopoverTrigger>
            <PopoverContent
              ref={shareContentRef as any}
              width="260px"
              border={BORDER}
              borderRadius={RADIUS_MD}
              boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
              zIndex={10}
            >
              <Flex flexDirection="column" rowGap={2} padding={3}>
                <Text
                  fontFamily="mono"
                  fontSize="10px"
                  fontWeight={600}
                  letterSpacing="0.08em"
                  textTransform="uppercase"
                  color={MUTED}
                >
                  Share this post ↗️
                </Text>
                <Textarea
                  size="sm"
                  rows={2}
                  resize="none"
                  borderRadius="var(--tt-radius-sm, 9px)"
                  placeholder="Say something (optional)…"
                  value={shareText}
                  onChange={(event) => setShareText(event.target.value)}
                />
                <Select
                  size="sm"
                  borderRadius="var(--tt-radius-sm, 9px)"
                  value={shareVisibility}
                  onChange={(event) => setShareVisibility(event.target.value as PostVisibility)}
                >
                  {(Object.keys(CIRCLE_META) as PostVisibility[]).map((key) => (
                    <option key={key} value={key}>
                      {CIRCLE_META[key].emoji} {CIRCLE_META[key].label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  color="white"
                  fontFamily="heading"
                  fontWeight={600}
                  background={RAINBOW}
                  backgroundSize="calc(100px + 200%)"
                  sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
                  _hover={{ opacity: 0.9 }}
                  borderRadius={RADIUS_MD}
                  isLoading={sharing}
                  onClick={handleShare}
                >
                  Share ✨
                </Button>
              </Flex>
            </PopoverContent>
          </Popover>
        </Flex>

        {/* comments */}
        {commentsOpen && (
          <Flex flexDirection="column" rowGap={3}>
            {post.comments.length > visibleComments && (
              <Box
                as="button"
                type="button"
                alignSelf="flex-start"
                fontSize="xs"
                fontWeight={600}
                color={MUTED}
                _hover={{ color: INK }}
                onClick={() => setVisibleComments((count) => count + 5)}
              >
                Show more comments 💬
              </Box>
            )}

            {post.comments.slice(-visibleComments).map((comment) => (
              <CommentRow key={comment.id} comment={comment} onChanged={handleCommentChanged} onEngagement={onEngagement} />
            ))}

            {user ? (
              <Flex flexDirection="column" rowGap={2}>
                <Flex columnGap={2}>
                  <Input
                    size="sm"
                    borderRadius="999px"
                    placeholder="Write a comment… 💬"
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submitComment();
                      }
                    }}
                  />
                  <Tooltip label="Comment with photos, a listing, a thing & more" fontSize="xs" borderRadius="8px" hasArrow>
                    <IconButton
                      aria-label="Open full comment composer"
                      icon={<Maximize2 size={14} />}
                      size="sm"
                      variant={richCommentOpen ? 'solid' : 'outline'}
                      borderRadius="999px"
                      onClick={() => setRichCommentOpen((open) => !open)}
                    />
                  </Tooltip>
                  <IconButton
                    aria-label="Send comment"
                    icon={<Send size={14} />}
                    size="sm"
                    variant="outline"
                    borderRadius="999px"
                    isDisabled={!commentText.trim()}
                    onClick={submitComment}
                  />
                </Flex>
                {richCommentOpen && (
                  <PostComposer parentId={post.id} onPosted={handleRichCommented as any} onClose={() => setRichCommentOpen(false)} />
                )}
              </Flex>
            ) : (
              <Text fontSize="xs" color={MUTED}>
                Log in to join the conversation 🗝️
              </Text>
            )}
          </Flex>
        )}
      </Flex>
    </Box>
    </ReplyFocusContext.Provider>
  );
});
