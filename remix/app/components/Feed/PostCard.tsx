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
  Text,
  Textarea,
  Tooltip
} from '@chakra-ui/react';
import { Link } from 'react-router';
import { Maximize2, MoreHorizontal, Plus, Send } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
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
const applyReactionToggle = (prev: PublicPost, token: string, adding: boolean): PublicPost => {
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

// A comment row — comments share the post schema, so each row is reactable
// (tap to 👍, hold/hover for the picker), renders rich post bodies, and links
// to its own /post/:id page (also where its replies live).
const CommentRow = (props: {
  comment: PostComment;
  onChanged: (next: PostComment) => void;
  onEngagement?: (event: EngagementEvent) => void;
}) => {
  const { comment, onChanged, onEngagement } = props;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  const viewerSet = new Set(comment.viewerReactions || []);
  const reactionEntries = Object.entries(comment.reactionCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const reactionTotal = reactionEntries.reduce((sum, [, count]) => sum + count, 0);
  const topEmojis = reactionEntries
    .slice(0, 3)
    .map(([token]) => truncateToken(token).text)
    .join('');

  const handleReact = async (rawToken: string) => {
    if (!user) {
      lopu({ title: 'Log in to react 🗝️', status: 'info', duration: 6000 });
      return;
    }
    const token = sanitizeReactionToken(rawToken);
    if (!token) return;
    try {
      const resp = await api.v1.things.react({ id: comment.id, emoji: token });
      onChanged({ ...comment, reactionCounts: resp.reactionCounts, viewerReactions: resp.viewerReactions });
      if (resp.viewerReactions?.includes(token)) onEngagement?.({ thingId: comment.id, signal: 'react' });
    } catch (err: any) {
      lopu({ title: err?.error || 'Reaction did not stick 😞', status: 'error' });
    }
  };

  return (
    <Flex columnGap={2} alignItems="flex-start">
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
          <ReactionControl
            enabled={!!user}
            onQuickTap={() => handleReact('👍')}
            content={(close) => (
              <QuickReactionRow
                viewerSet={viewerSet}
                onPick={(emoji) => {
                  close();
                  handleReact(emoji);
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
          {reactionTotal > 0 && (
            <Text as="span" flexShrink={0} title="Reactions">
              {topEmojis} {reactionTotal}
            </Text>
          )}
          <Link to={`/post/${comment.id}`}>
            <Text as="span" fontSize="11px" fontWeight={600} _hover={{ color: INK }}>
              {comment.commentCount > 0
                ? `${comment.commentCount} repl${comment.commentCount === 1 ? 'y' : 'ies'} 💬`
                : 'Reply 💬'}
            </Text>
          </Link>
        </Flex>
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
  const [commentText, setCommentText] = React.useState('');
  const [commenting, setCommenting] = React.useState(false);
  const [richCommentOpen, setRichCommentOpen] = React.useState(false);
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

  const toggleComments = () => {
    setCommentsOpen((open) => !open);
    if (!expandSentRef.current) {
      expandSentRef.current = true;
      onEngagement?.({ thingId: post.id, signal: 'expand' });
    }
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text || commenting) return;

    setCommenting(true);
    try {
      const resp = await api.v1.things.comment({ id: post.id, text });
      onChanged?.((prev) => ({ ...prev, comments: [...prev.comments, resp.comment], commentCount: resp.commentCount }));
      onEngagement?.({ thingId: post.id, signal: 'comment' });
      setCommentText('');
    } catch (err: any) {
      lopu({ title: err?.error || 'Comment did not send 😞', status: 'error' });
    }
    setCommenting(false);
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
                <Text as="span">
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
            {post.commentCount > post.comments.length && (
              <Text fontSize="xs" color={MUTED} whiteSpace="normal">
                Showing the latest {post.comments.length} of {post.commentCount} comments 💬
              </Text>
            )}

            {post.comments.map((comment) => (
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
                    isLoading={commenting}
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
  );
});
