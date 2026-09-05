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
  MenuDivider,
  MenuItem,
  MenuItemOption,
  MenuList,
  MenuGroup,
  MenuOptionGroup,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Select,
  Skeleton,
  SkeletonCircle,
  Text,
  Textarea,
  Tooltip
} from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { Link } from 'react-router';
import { ArrowLeft, Bookmark, Eye, Heart, Maximize2, MessageCircle, MoreHorizontal, Plus, Repeat2, Send, Share } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCommentDraft } from '~/hooks/useCommentDraft';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useOutsideTapClose } from '~/hooks/useOutsideTapClose';
import { FeedShortcutsContext } from '~/hooks/useFeedShortcuts';
import type { FeedPostShortcutActions } from '~/hooks/useFeedShortcuts';
import { useLopu } from '~/components/Lopu/useLopu';
import { ThingView } from '~/components/Thingtime/ThingView';
import { EmojiPicker } from '~/components/Emoji/EmojiPicker';
import { useRecentReactions } from '~/components/Emoji/useRecentReactions';
import { getEditorJsDoc } from '~/components/Editor/editorJsValue';
import { RichTextBlocks } from '~/components/Kinds/kindRenderersMedia';
import { PostAttachments } from '~/components/Attachments/PostAttachments';
import { mediaPageUrl } from '~/components/Attachments/attachmentUiCore';
import { sanitizeReactionToken } from '~/utils/reactionTokens';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';
import { RAINBOW } from '~/theme/rainbow';
import { PostComposer } from './PostComposer';
import { ReactionControl } from './ReactionControl';
import { UpdownControl } from './UpdownControl';
import { useSubspacePrefs } from '~/components/Subspaces/useSubspacePrefs';
import { RemoveModal, loadModerationSubspace, type RemoveChoice } from '~/components/Subspaces/ModerationModals';
import { splashEmoji } from './emojiSplash';
import { isUnknownReactionFailure, reactionFailureMessage, shouldReconcileReactionFailure } from './reactionFailure';
import { mergeReactionOverlay, mergeReactionOverlays, noteLocalReactions } from './reactionOverlay';
import { fetchThreadInto, getCachedThread, prefetchNextDepth, setCachedThread, warmAvatars } from './threadCache';
import { canonicalPostTags } from '~/components/Attachments/attachmentUiCore';
import { profileMentionHref, splitMentionSegments, type MentionSegment } from '~/utils/mentions';
import { extractInlineHashtags, searchTagHref, splitHashtagSegments, type HashtagSegment } from './hashtags';
import { CIRCLE_META, MARKETPLACE_CATEGORY_META, REACTION_EMOJIS, applyUpdownVote, timeAgo } from './feedTypes';
import type { EngagementEvent, FeedAuthor, PostChange, PostComment, PostVisibility, PublicAuthorFlair, PublicPost, UpdownDirection } from './feedTypes';
import type { PollRenderPollContext } from '~/components/Kinds';

// Apply one token's toggle to a post, idempotently (a no-op if the post already
// reflects it). Used for optimistic paint + revert against the FRESHEST post, so
// a concurrent reaction on a different token is never clobbered.
const applyReactionToggle = <T extends Pick<PublicPost, 'reactionCounts' | 'viewerReactions'>>(prev: T, token: string, adding: boolean): T => {
  const has = prev.viewerReactions.includes(token);
  if (adding === has) return prev;
  const reactionCounts = { ...prev.reactionCounts };
  reactionCounts[token] = (reactionCounts[token] || 0) + (adding ? 1 : -1);
  if (reactionCounts[token] <= 0) delete reactionCounts[token];
	const viewerReactions = adding ? [...prev.viewerReactions, token] : prev.viewerReactions.filter((entry) => entry !== token);
  return { ...prev, reactionCounts, viewerReactions };
};

// Reconcile ONLY the toggled token against the server's authoritative view,
// leaving other tokens (possibly changed by concurrent reactions) intact.
const reconcileReactionToken = <T extends Pick<PublicPost, 'reactionCounts' | 'viewerReactions'>>(
  prev: T,
  token: string,
  serverCounts: Record<string, number>,
  serverViewer: string[]
): T => {
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

// Apply one poll-vote tap optimistically, on the FRESHEST post: your same
// option removes the vote, a different option moves it, no vote yet adds it —
// the exact semantics the server applies, so reconcile is usually a no-op.
const applyPollVoteToggle = <T extends Pick<PublicPost, 'pollVotes'>>(prev: T, optionIndex: number): T => {
	const tally = prev.pollVotes;
	if (!tally || optionIndex < 0 || optionIndex >= tally.counts.length) return prev;
	const counts = [...tally.counts];
	let totalVotes = tally.totalVotes;
	let viewerVote: number | null;
	if (tally.viewerVote === optionIndex) {
		counts[optionIndex] = Math.max(0, counts[optionIndex] - 1);
		totalVotes = Math.max(0, totalVotes - 1);
		viewerVote = null;
	} else if (tally.viewerVote !== null && tally.viewerVote >= 0 && tally.viewerVote < counts.length) {
		counts[tally.viewerVote] = Math.max(0, counts[tally.viewerVote] - 1);
		counts[optionIndex] += 1;
		viewerVote = optionIndex;
	} else {
		counts[optionIndex] += 1;
		totalVotes += 1;
		viewerVote = optionIndex;
	}
	return { ...prev, pollVotes: { counts, totalVotes, viewerVote } };
};

type ReactionTruth = Pick<PublicPost, 'id' | 'reactionCounts' | 'viewerReactions'>;

const fetchReactionTruth = async (api: ReturnType<typeof useApi>, id: string): Promise<ReactionTruth | null> => {
  // This is called only after a completed HTTP response, so a fetch started
  // here cannot overtake that mutation. reactionOverlay still protects any
  // newer concurrent tap while the fetch is in flight.
  const startedAt = Date.now();
  const response = await api.v1.things.get({ id });
  if (!response?.post) return null;
  const fresh = mergeReactionOverlay(startedAt, response.post as ReactionTruth);
  return { id: fresh.id, reactionCounts: fresh.reactionCounts, viewerReactions: fresh.viewerReactions };
};

type CommentChange = PostComment | ((current: PostComment) => PostComment);

const applyCommentChange = (current: PostComment, change: CommentChange): PostComment => (typeof change === 'function' ? change(current) : change);

// Compact everyone's-reactions summary for the merged react button: EVERY
// token the viewer reacted with (your full set always shows), then the
// crowd's top remaining tokens by count, capped at maxOthers. FB/X-style —
// the button IS the counts. Each token renders in FULL — a multi-emoji token
// like 🤣🤣🙌 is ONE reaction and must read as one (truncating to a lead
// glyph made multi-emoji reactions look like single-emoji ones).
// Joined with a zero-width space so adjacent tokens can't shape into one
// glyph (two lone regional indicators would otherwise merge into a flag).
const reactionDisplayEmojis = (entries: Array<[string, number]>, viewerSet: Set<string>, maxOthers: number) =>
	[...entries.filter(([token]) => viewerSet.has(token)), ...entries.filter(([token]) => !viewerSet.has(token)).slice(0, maxOthers)]
    .map(([token]) => token)
    .join('​');

// The typed post renderer for the feed / profile columns. Renders text,
// photo-grid and marketplace bodies, one-level share nesting, the merged
// reaction control, comments, and the repost menu (instant repost + quote
// composer) plus the outward share-link action. All mutations go through
// api.v1.things and bubble optimistic updates up via onChanged.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';
const ACCENT = 'var(--tt-accent, #7c5cff)';

// X-style action button: icon + count, NO text label (`label` is a11y/tooltip
// only). forwardRef so it can also serve as a Chakra MenuButton via `as`.
const ActionIcon = React.forwardRef<
	HTMLButtonElement,
	{
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
	} & Record<string, any>
>((props, ref) => {
  const { icon, label, count, active, ...rest } = props;
  return (
    <Flex
      ref={ref}
      as="button"
      type="button"
      alignItems="center"
      columnGap={1.5}
      paddingX={2}
      height="32px"
      borderRadius="999px"
      fontSize="sm"
      fontWeight={600}
      color={active ? INK : MUTED}
      _hover={{ background: 'var(--tt-surface-hover, #ececee)', color: INK }}
      aria-label={label}
      title={label}
      {...rest}
    >
      {icon}
      {(count ?? 0) > 0 && <Text as="span">{count}</Text>}
    </Flex>
  );
});
ActionIcon.displayName = 'ActionIcon';

export type PostCardProps = {
  post: PublicPost;
  // a value replaces the post (null = deleted); a function applies a delta to
  // the freshest post (used by optimistic reactions). Takes the post id so the
  // SAME handler identity can be passed to every card — a per-card closure
  // would defeat React.memo below and repaint the whole column on any change.
  onChanged?: (id: string, next: PostChange) => void;
  // card-level signals: expand/react/comment/share
  onEngagement?: (event: EngagementEvent) => void;
  // the /post/:id page opens with the conversation expanded
  defaultCommentsOpen?: boolean;
	// the /media/:id page projects a protected attachment Thing as this card:
	// interactions stay live, but the owner menu drops edit/privacy/delete
	// (title/description edit via annotate; lifecycle belongs to the parent post)
	mediaThing?: boolean;
};

const authorName = (author: FeedAuthor | null) => (author ? getUserDisplayName(author) : 'Anonymous 👻');

// The author's USER flair in the post's subspace (api/utils/subspaces — a
// template they picked or custom text a mod allowed): a small pill right
// after the name on cards and comment rows. `authorFlair` is null outside
// subspaces, so nothing renders anywhere else.
export const AuthorFlairChip = ({ flair, size = 'sm' }: { flair: PublicAuthorFlair | null | undefined; size?: 'sm' | 'xs' }) => {
  if (!flair?.label) return null;
  const label = `${flair.emoji ? `${flair.emoji} ` : ''}${flair.label}`;
  return (
    <Text
      as="span"
      display="inline-block"
      verticalAlign="middle"
      fontSize={size === 'xs' ? '9px' : '10px'}
      fontWeight={600}
      lineHeight="1.3"
      paddingX={1.5}
      borderRadius="999px"
      border={`1px solid ${flair.color || 'var(--tt-border, #ececef)'}`}
      color={flair.color || TEXT}
      maxWidth="160px"
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
      title={label}
      data-testid="author-flair"
      data-flair-id={flair.id || '~custom'}
    >
      {label}
    </Text>
  );
};

// 1234 → "1.2k" — view counts stay one glyph-cluster wide however popular a
// post gets (the other counters stay raw; they cap out far lower)
const formatCompactCount = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
};

const formatDwell = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms / 100) / 10}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
};

// Every post/comment timestamp is a permalink to its /post/:id page, the way
// timestamps work on every major platform.
const TimestampLink = ({ id, createdAt, fontSize = 'xs', to }: { id: string; createdAt: string; fontSize?: string; to?: string }) => (
  <Link to={to || `/post/${id}`} title={new Date(createdAt).toLocaleString()}>
    <Text as="span" fontSize={fontSize} color={MUTED} _hover={{ textDecoration: 'underline', color: INK }}>
      {timeAgo(createdAt)}
    </Text>
  </Link>
);

export const AuthorAvatar = (props: { author: FeedAuthor | null; size?: string; fontSize?: string }) => {
  const { author, size = '36px', fontSize = 'sm' } = props;

  const initial = author ? getUserDisplayName(author).trim().charAt(0).toUpperCase() : '?';

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
				referrerPolicy="no-referrer"
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
							referrerPolicy="no-referrer"
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
					referrerPolicy="no-referrer"
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

// Post text with inline #hashtags rendered as links to /search pre-filtered
// to that tag, and @mentions rendered as links to /profile/<username>. Text is
// otherwise plain (no markdown layer), so the linkifier IS the rendering
// layer. Sequential passes — hashtags first, then mentions inside the
// remaining plain-text segments: the grammars are disjoint (`@`/`#` are not
// name characters in either, and both require a word start), so the passes can
// never double-linkify or nest anchors, and every emitted segment is exactly
// one of text/tag/mention. Non-link segments pass through verbatim and
// concatenate back to the exact original string. URL fragments, HTML entities,
// emails and mid-word #/@ never match (word-start rules — hashtags.ts /
// ~/utils/mentions.ts); a post-hashtag segment passes precededByWordChar so a
// "#tag@name" seam stays plain. Mentions linkify on grammar alone — no
// client-side existence check (the render must stay cheap; the profile page
// handles names nobody holds).
const HashtagText = ({ text }: { text: string }) => {
	const segments = React.useMemo(
		() =>
			splitHashtagSegments(text).flatMap((segment, index): Array<HashtagSegment | MentionSegment> =>
				segment.kind === 'tag' ? [segment] : splitMentionSegments(segment.text, index > 0)
			),
		[text]
	);
	return (
		<>
			{segments.map((segment, index) =>
				segment.kind === 'tag' ? (
					<Link key={`${segment.tag}-${index}`} to={searchTagHref(segment.tag)}>
						<Text as="span" color={ACCENT} fontWeight={600} _hover={{ textDecoration: 'underline' }}>
							{segment.text}
						</Text>
					</Link>
				) : segment.kind === 'mention' ? (
					<Link key={`${segment.username}-${index}`} to={profileMentionHref(segment.username)}>
						<Text as="span" color={ACCENT} fontWeight={600} _hover={{ textDecoration: 'underline' }}>
							{segment.text}
						</Text>
					</Link>
				) : (
					<React.Fragment key={index}>{segment.text}</React.Fragment>
				)
			)}
		</>
	);
};

// The post's tags as tappable pills (the composer-preview pill style) linking
// to /search seeded to filter by that tag. Marketplace category tags are real
// tags on the doc, so they show — and are tappable — too.
const TagChipRow = ({ tags, compact }: { tags?: string[]; compact?: boolean }) => {
	if (!tags?.length) return null;
	return (
		<Flex columnGap={1} rowGap={1} flexWrap="wrap">
			{tags.map((tag) => (
				<Box
					key={tag}
					as={Link}
					to={searchTagHref(tag)}
					fontSize={compact ? '11px' : 'xs'}
					background="var(--tt-surface-alt, #f5f5f7)"
					color={TEXT}
					borderRadius="999px"
					paddingX={2}
					paddingY="2px"
					_hover={{ background: 'var(--tt-surface-hover, #ececee)', color: INK }}
				>
					#{tag}
				</Box>
			))}
		</Flex>
	);
};

// Body by post type — shared between the main card, nested shares, and
// comment rows (comments share the post schema, so PostComment fits too).
type PostBodyShape = Pick<PublicPost, 'type' | 'text' | 'richText' | 'images' | 'listing' | 'thing' | 'tags' | 'mediaLayout'>;

const PostTextBody = ({ post, compact }: { post: Pick<PostBodyShape, 'text' | 'richText'>; compact?: boolean }) => {
  const richText = getEditorJsDoc(post.richText);
  if (richText) return <RichTextBlocks blocks={richText.blocks} bodyFontSize={compact ? 'sm' : 'md'} />;
  if (!post.text) return null;
  return (
    <Text fontSize={compact ? 'sm' : 'md'} color={TEXT} whiteSpace="pre-wrap" overflowWrap="anywhere">
      <HashtagText text={post.text} />
    </Text>
  );
};

const PostBody = ({
	post,
	compact,
	attachments,
	poll
}: {
	post: PostBodyShape;
	compact?: boolean;
	attachments?: PublicPost['attachments'];
	// live poll wiring for poll things (tally + optimistic vote handler) —
	// supplied by the main card; nested/read-only surfaces pass a results-only
	// context or nothing
	poll?: PollRenderPollContext;
}) => (
  <Flex flexDirection="column" rowGap={compact ? 2 : 3}>
    <PostTextBody post={post} compact={compact} />
    {post.type === 'image' && <ImageGrid images={post.images} alt={post.text || 'Post photo'} />}
    {post.type === 'marketplace' && <ListingBlock post={post} />}
    {/* thingtime: the thing leads; opted-in photos and listing follow. The
    grid owns the photos, so the listing skips its header image (it would
    repeat the first photo). The thing mounts as the NATIVE Thingtime tree
    (sandboxed — see ThingView), rendered through its kind renderer when one
    resolves, with a corner icon flipping between the two views. */}
    {post.type === 'thingtime' && post.thing && <ThingView thing={post.thing} compact={compact} poll={poll} />}
		{post.type === 'thingtime' && !!post.images?.length && <ImageGrid images={post.images} alt={post.text || 'Thing photo'} />}
    {post.type === 'thingtime' && post.listing && <ListingBlock post={post} hideImage={!!post.images?.length} />}
    <PostAttachments attachments={attachments} mediaLayout={post.mediaLayout} compact={compact} />
    <TagChipRow tags={post.tags} compact={compact} />
  </Flex>
);

// Compact bordered sub-card for the original post inside a share (no actions).
// A shared poll shows its live tally read-only — voting happens on the
// original's own card/page.
const SharedPostCard = ({ post }: { post: PublicPost }) => (
  <Box border={BORDER} borderRadius={RADIUS_MD} padding={3}>
    <Flex alignItems="center" columnGap={2} marginBottom={2}>
      <AuthorAvatar author={post.author} size="22px" fontSize="10px" />
      <Text fontSize="xs" fontWeight={700} color={INK} noOfLines={1}>
        {authorName(post.author)}
      </Text>
      <AuthorFlairChip flair={post.authorFlair} size="xs" />
      <Text fontSize="xs" color={MUTED} flexShrink={0}>
        ·
      </Text>
      <Box flexShrink={0}>
        <TimestampLink id={post.id} createdAt={post.createdAt} />
      </Box>
    </Flex>
    <PostBody
      post={post}
      compact
      attachments={post.attachments}
      poll={post.pollVotes ? { ...post.pollVotes, canVote: false } : undefined}
    />
  </Box>
);

// The quick-reaction strip inside the picker popover — the standard emojis
// plus a ＋ opening the full custom picker (when the host provides one).
const QuickReactionRow = (props: { viewerSet: Set<string>; onPick: (emoji: string) => void; onMore?: () => void }) => {
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

// The full custom EmojiPicker in a popover, anchored to the top-right of its
// relative parent — shared by the post react button and every comment row.
const AnchoredEmojiPicker = (props: {
  isOpen: boolean;
  onClose: () => void;
  contentRef: React.RefObject<HTMLElement>;
  onPick: (emoji: string) => void;
  recent: string[];
  activeTokens: string[];
}) => (
  <Popover isOpen={props.isOpen} onClose={props.onClose} placement="top-end" isLazy closeOnBlur={false}>
    <PopoverAnchor>
      <Box position="absolute" right={0} bottom="100%" width="1px" height="1px" pointerEvents="none" />
    </PopoverAnchor>
    <PopoverContent
      ref={props.contentRef as any}
      width="auto"
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      background="var(--tt-card, #fff)"
      boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
      zIndex={20}
      _focusVisible={{ outline: 'none' }}
    >
      <EmojiPicker onPick={props.onPick} recent={props.recent} activeTokens={props.activeTokens} autoFocus />
    </PopoverContent>
  </Popover>
);

// Only one EMPTY reply input is open at a time across a card's comment tree:
// opening a reply announces itself here and rows whose draft is empty close
// themselves. Rows with a typed draft stay open — never lose user text.
const ReplyFocusContext = React.createContext<{ openId: string | null; requestOpen: (id: string) => void } | null>(null);

// Thread depth is UNBOUNDED, but only this many levels ever indent at once.
// Opening replies at the cap REFOCUSES the panel on that comment: it slides in
// as the new top-level row (back arrow slides you out) and its replies restart
// at depth 1 — so any depth stays readable on any viewport, no flattening.
const MAX_VISUAL_DEPTH = 4;

const ThreadFocusContext = React.createContext<{
  maxDepth: number;
  focusThread: (comment: PostComment) => void;
} | null>(null);

// Drill-down navigation: push slides the new panel in from the right, back
// (pop) slides the restored panel in from the left.
const SLIDE_IN_RIGHT = keyframes({
  from: { opacity: 0.3, transform: 'translateX(32px)' },
  to: { opacity: 1, transform: 'translateX(0)' }
});
const SLIDE_IN_LEFT = keyframes({
  from: { opacity: 0.3, transform: 'translateX(-32px)' },
  to: { opacity: 1, transform: 'translateX(0)' }
});

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
	attachments: [],
	mediaLayout: null,
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
    <Flex flexDirection="column" rowGap={4} paddingY={2} aria-label="Loading replies" role="status">
      {[0, 1, 2].map((index) => (
        <Flex key={index} columnGap={2} alignItems="flex-start">
          <SkeletonCircle size="20px" flexShrink={0} {...shimmer} />
          <Flex flex="1" minWidth={0} flexDirection="column" rowGap={1.5} paddingTop="2px">
            <Skeleton height="9px" width="30%" borderRadius="999px" {...shimmer} />
            <Skeleton height="13px" width={['82%', '62%', '72%'][index]} borderRadius="999px" {...shimmer} />
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
};

// A comment row — comments share the post schema, so each row is reactable
// (tap, touch-and-hold, or hover opens the merged reaction popup — applying a
// pick is optimistic, no wait; guests get a login nudge), renders rich post
// bodies, and replies INLINE: the reply icon opens a reply input and the
// thread right here (the /post/:id permalink stays on the timestamp).
const CommentRow = (props: {
  comment: PostComment;
  onChanged: (id: string, change: CommentChange) => void;
  onEngagement?: (event: EngagementEvent) => void;
  // 1 = a post's direct comment; grows down the thread. Only depth-1 rows
  // auto-open their preloaded replies (the default two-level view) — deeper
  // rows reveal ONE more depth per tap, and rows AT the visual cap refocus
  // the panel on themselves instead of nesting further.
  depth?: number;
  // the focused root of a drilled-in thread panel opens its replies on mount
  defaultOpen?: boolean;
}) => {
  const { comment, onChanged, onEngagement, depth = 1, defaultOpen } = props;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();
  const { recent, pushRecent } = useRecentReactions();
  const inFlightReactionTokensRef = React.useRef(new Set<string>());
  // emoji-splash origin: the comment's react button (chips/picker anchor here)
  const reactAnchorRef = React.useRef<HTMLDivElement | null>(null);
  const replyFocus = React.useContext(ReplyFocusContext);
  const threadFocus = React.useContext(ThreadFocusContext);
  // at the cap, reveals hand over to the drill-down panel instead of nesting
  const atVisualCap = !!threadFocus && depth >= threadFocus.maxDepth;

  // threads ship two levels deep — cached or preloaded replies render
  // immediately (the cache survives collapse/re-expand remounts and reloads)
  const [replies, setReplies] = React.useState<PostComment[] | null>(
    // both seeds are older than any tap this session: the cache merges its
    // own write-time through the reaction overlay, payload copies merge at
    // epoch 0 so a remount can't resurrect pre-tap reaction state
    () => getCachedThread(comment.id) ?? (comment.comments?.length ? mergeReactionOverlays(0, comment.comments) : null)
  );
  const [repliesOpen, setRepliesOpen] = React.useState((depth === 1 && !!comment.comments?.length) || !!defaultOpen);
  // the reply INPUT is separate from thread visibility: threads stay open,
  // but only one empty input exists at a time (ReplyFocusContext)
  const [replyInputOpen, setReplyInputOpen] = React.useState(false);
  const [visibleReplies, setVisibleReplies] = React.useState(5);
  const [richReplyOpen, setRichReplyOpen] = React.useState(false);
  const [repliesLoading, setRepliesLoading] = React.useState(false);
  // reply text persists as a per-user draft — leave and pick it up later
	const { value: replyText, setValue: setReplyText, clear: clearReplyDraft, hydrated: draftHydrated } = useCommentDraft(user?.id, comment.id);
  const pending = isPendingComment(comment);

  // ＋ in the quick row opens the full custom picker (same as posts)
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const pickerContentRef = useOutsideTapClose<HTMLElement>(pickerOpen, () => setPickerOpen(false));

  // a stored draft reopens its thread on mount — continue where you left off
  // (cap rows stay closed: their input lives in the drilled-in panel)
  React.useEffect(() => {
    if (draftHydrated && replyText.trim() && !atVisualCap) {
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

  // optimistic: repaint immediately, reconcile with the server's counts,
  // revert on failure — same principle as post reactions
  const handleReact = async (rawToken: string) => {
    if (!user) {
      lopu({ title: 'Log in to react 🗝️', status: 'info', duration: 6000 });
      return;
    }
    // an in-flight comment only has a provisional id — nothing to react to yet
    if (pending) return;
    const token = sanitizeReactionToken(rawToken);
    if (!token) return;
    // The endpoint is a toggle, so two same-token requests cannot safely run
    // concurrently. Ignore a duplicate tap until the first settles; distinct
    // tokens still paint and save independently.
    if (inFlightReactionTokensRef.current.has(token)) return;
    inFlightReactionTokensRef.current.add(token);

    const adding = !viewerSet.has(token);
    // pure delight: ADDING a reaction erupts it from the button (motion-gated
    // inside splashEmoji; removals stay quiet)
    if (adding) splashEmoji(token, reactAnchorRef.current);
    // note every local mutation so background fetches snapshotted BEFORE it
    // merge through instead of clobbering (reactionOverlay contract)
    onChanged(comment.id, (current) => {
      const next = applyReactionToggle(current, token, adding);
      noteLocalReactions(next.id, next.reactionCounts, next.viewerReactions);
      return next;
    });
    if (adding) onEngagement?.({ thingId: comment.id, signal: 'react' });

    const reconcileLocalToken = (reactionCounts: Record<string, number>, viewerReactions: string[]) => {
      onChanged(comment.id, (current) => {
        const next = reconcileReactionToken(current, token, reactionCounts, viewerReactions);
        noteLocalReactions(next.id, next.reactionCounts, next.viewerReactions);
        return next;
      });
    };

    try {
      const resp = await api.v1.things.react({ id: comment.id, emoji: token });
      reconcileLocalToken(resp.reactionCounts, resp.viewerReactions);
      if (adding) pushRecent(token, resp.recentReactions);
    } catch (err: any) {
      let reconciled = false;
      if (shouldReconcileReactionFailure(err)) {
        try {
          const fresh = await fetchReactionTruth(api, comment.id);
          if (fresh) {
            reconcileLocalToken(fresh.reactionCounts, fresh.viewerReactions);
            reconciled = true;
          }
        } catch {
          // Outcome remains unknown; keep the optimistic copy and tell the
          // viewer to refresh before retrying instead of guessing a rollback.
        }
      } else if (!isUnknownReactionFailure(err)) {
        reconcileLocalToken(comment.reactionCounts, comment.viewerReactions);
      }
      lopu({ ...reactionFailureMessage(err, reconciled), status: 'error' });
    } finally {
      inFlightReactionTokensRef.current.delete(token);
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
      fetchThreadInto(api, comment.id)
        .then((fetched) => {
          if (fetched === null) {
            setReplies((prev) => prev ?? []);
            return;
          }
          // stay one depth ahead: pull the level BELOW what just arrived
          prefetchNextDepth(api, fetched);
          setReplies((prev) => {
            // keep optimistic sends that raced the fetch, drop ones the
            // server copy now covers
						const pendings = (prev || []).filter((reply) => isPendingComment(reply) && !fetched.some((entry) => entry.id === reply.id));
            // defensive: never render the same reply twice whatever the payload
            const merged = [...fetched, ...pendings];
            return merged.filter((reply, index) => merged.findIndex((entry) => entry.id === reply.id) === index);
          });
        })
        .finally(() => {
          fetchingRef.current = false;
          setRepliesLoading(false);
        });
    },
    [api, comment.id, comment.commentCount, pending]
  );

  // prefetch-ahead: fill this row's missing depth as soon as it renders —
  // once; opens and show-mores force fresh fetches afterwards. Rows that
  // MOUNT with their thread open (the two-level ship, drill-panel roots)
  // force the refetch: a cache-complete thread would otherwise skip it and
  // freeze reply reactions/edits at the cached snapshot forever.
  const prefetchedRef = React.useRef(false);
  React.useEffect(() => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    fetchThread({ force: repliesOpen });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchThread]);

  const openThread = () => {
    setRepliesOpen(true);
    // instant reveal from cache + background live refresh
    fetchThread({ force: true });
  };

  const toggleThread = () => {
    // at the cap the thread never nests deeper — the panel REFOCUSES on this
    // comment (slide-in, back arrow) and its replies restart at depth 1
    if (atVisualCap) {
      threadFocus?.focusThread(comment);
      return;
    }
    if (repliesOpen) setRepliesOpen(false);
    else openThread();
  };

  const toggleReplyInput = () => {
    if (replyInputOpen) {
      setReplyInputOpen(false);
      return;
    }
    // replying at the cap also drills in, so the input (and the reply it
    // creates) is visible in context rather than hidden below the cap
    if (atVisualCap) {
      threadFocus?.focusThread(comment);
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
    onChanged(comment.id, (current) => ({ ...current, commentCount: current.commentCount + 1 }));
    onEngagement?.({ thingId: comment.id, signal: 'comment' });

    try {
      const resp = await api.v1.things.comment({ id: comment.id, text });
      setReplies((prev) => {
        const mapped = (prev || []).map((reply) => (reply.id === pendingReply.id ? resp.comment : reply));
        const deduped = mapped.filter((reply, index) => mapped.findIndex((entry) => entry.id === reply.id) === index);
				setCachedThread(
					comment.id,
					deduped.filter((reply) => !isPendingComment(reply))
				);
        return deduped;
      });
    } catch (err: any) {
      setReplies((prev) => (prev || []).filter((reply) => reply.id !== pendingReply.id));
      onChanged(comment.id, (current) => ({ ...current, commentCount: Math.max(0, current.commentCount - 1) }));
      setReplyText(text); // give the draft back
      lopu({ title: err?.error || 'Reply did not send 😞', status: 'error' });
    }
  };

  // the rich composer posts through api.v1.things.comment itself and hands
  // back the created reply (post-shaped)
  const handleRichReplied = (reply: PostComment) => {
    setReplies((prev) => {
      const next = [...(prev || []), reply];
			setCachedThread(
				comment.id,
				next.filter((entry) => !isPendingComment(entry))
			);
      return next;
    });
    setRepliesOpen(true);
    onChanged(comment.id, (current) => ({ ...current, commentCount: current.commentCount + 1 }));
    onEngagement?.({ thingId: comment.id, signal: 'comment' });
    setRichReplyOpen(false);
  };

  const handleReplyChanged = (id: string, change: CommentChange) => {
    setReplies((prev) => (prev || []).map((reply) => (reply.id === id ? applyCommentChange(reply, change) : reply)));
  };

  // parent comments carry the bigger avatar; replies step down (IG-style)
  const avatarSize = depth === 1 ? '28px' : '20px';
  const avatarFont = depth === 1 ? '11px' : '9px';

  // the merged react control: shows EVERYONE's reactions (top emojis + total,
  // heart outline when none) and sits INLINE beside the reply icon under the
  // bubble, mirroring the post's comments-then-react row. A single tap hearts
  // the comment (default ReactionControl mode — no tapOpens); hover or
  // touch-and-hold still opens the quick-react popup.
  // up/down vote pill beside the react control (compact); same optimistic
  // functional-update contract as the post-level pill
  const [commentPrefs] = useSubspacePrefs();
  const showVotesOnComments = commentPrefs.showVotes && commentPrefs.showVotesOnComments;
  const commentUpdownInFlightRef = React.useRef(false);
  const handleCommentUpdown = async (direction: UpdownDirection) => {
    if (!user) {
      lopu({ title: 'Log in to vote 🔼', status: 'info', duration: 6000 });
      return;
    }
    if (pending || commentUpdownInFlightRef.current) return;
    commentUpdownInFlightRef.current = true;
    const before = comment.votes;
    onChanged(comment.id, (current) => applyUpdownVote(current, direction));
    try {
      const resp = await api.v1.things.updown({ id: comment.id, direction });
      onChanged(comment.id, (current) => ({ ...current, votes: resp.votes }));
    } catch (err: any) {
      onChanged(comment.id, (current) => ({ ...current, votes: before }));
      lopu({ title: err?.error || 'Vote did not save 😞', status: 'error' });
    } finally {
      commentUpdownInFlightRef.current = false;
    }
  };
  const commentUpdown = <UpdownControl size="sm" votes={comment.votes} onVote={handleCommentUpdown} enabled={!!user && !pending} />;

  const reactControl = (
    <Box ref={reactAnchorRef} position="relative" display="flex" flexShrink={0}>
      <ReactionControl
        enabled={!!user && !pending}
        onQuickTap={() => handleReact('❤️')}
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
          <Flex
            as="button"
            type="button"
            alignItems="center"
            columnGap={1}
            padding={1}
            borderRadius="999px"
            color={viewerSet.size ? ACCENT : MUTED}
            _hover={{ color: viewerSet.size ? ACCENT : INK }}
            aria-label="React"
            title="React"
          >
            {reactionEntries.length ? (
              <Text as="span" fontSize="13px" lineHeight="1" sx={{ whiteSpace: 'nowrap' }}>
                {reactionDisplayEmojis(reactionEntries, viewerSet, 2)}
              </Text>
            ) : (
              <Heart size={13} strokeWidth={2.2} />
            )}
            {reactionTotal > 0 && (
              <Text as="span" fontSize="11px" lineHeight="1" fontWeight={viewerSet.size ? 700 : 600}>
                {reactionTotal}
              </Text>
            )}
          </Flex>
        }
      />
      {/* the full custom picker (multi-select), anchored above the column */}
      <AnchoredEmojiPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        contentRef={pickerContentRef}
        onPick={handleReact}
        recent={recent}
        activeTokens={comment.viewerReactions}
      />
    </Box>
  );

  return (
    <Flex columnGap={2} alignItems="flex-start" opacity={pending ? 0.6 : 1} transition="opacity 0.2s ease">
      <AuthorAvatar author={comment.author} size={avatarSize} fontSize={avatarFont} />
      <Box flex="1" minWidth={0}>
        <Flex columnGap={1.5} alignItems="flex-start">
          <Box flex="1" minWidth={0}>
            <Box background="var(--tt-surface-alt, #f5f5f7)" borderRadius={RADIUS_MD} paddingX={3} paddingY={2}>
              <Flex alignItems="center" columnGap={1.5} flexWrap="wrap">
                <Text fontSize="xs" fontWeight={700} color={INK} noOfLines={1}>
                  {authorName(comment.author)}
                </Text>
                <AuthorFlairChip flair={comment.authorFlair} size="xs" />
                <Box flexShrink={0}>
                  <TimestampLink id={comment.id} createdAt={comment.createdAt} fontSize="10px" />
                </Box>
              </Flex>
							<PostBody post={comment} compact attachments={comment.attachments} />
            </Box>
            {/* icon-only actions (no labels): reply toggles the inline input,
            and the merged react control sits right beside it */}
            <Flex alignItems="center" columnGap={1} paddingX={1} paddingTop={0.5}>
              <Flex
                as="button"
                type="button"
                alignItems="center"
                padding={1}
                borderRadius="999px"
                color={replyInputOpen ? INK : MUTED}
                _hover={{ color: INK }}
                aria-label={`Reply to ${authorName(comment.author)}`}
                title="Reply"
                aria-expanded={replyInputOpen}
                onClick={toggleReplyInput}
              >
                <MessageCircle size={13} strokeWidth={2.2} />
              </Flex>
              {reactControl}
              {showVotesOnComments && commentUpdown}
            </Flex>
            {/* thread reveal lives BELOW the comment (FB/IG-style), left
            edge flush with the reply icon */}
            {!pending && comment.commentCount > 0 && (
              <Flex alignItems="center" paddingX={1} paddingTop={0.5}>
                <Box
                  as="button"
                  type="button"
                  paddingX={1}
                  fontSize="11px"
                  fontWeight={600}
                  color={repliesOpen ? INK : MUTED}
                  _hover={{ color: INK }}
                  aria-expanded={repliesOpen}
                  onClick={toggleThread}
                >
                  {repliesOpen ? 'Hide replies' : `View ${comment.commentCount} repl${comment.commentCount === 1 ? 'y' : 'ies'}`}
                </Box>
              </Flex>
            )}
          </Box>
        </Flex>

        {/* inline thread: replies + reply input, right here on the page */}
        {(repliesOpen || replyInputOpen) && (
          <Flex flexDirection="column" rowGap={2} paddingTop={2}>
            {repliesLoading && replies === null && <ReplySkeleton />}
            {repliesOpen &&
							(replies || [])
								.slice(-visibleReplies)
								.map((reply) => (
									<CommentRow key={reply.id} comment={reply} onChanged={handleReplyChanged} onEngagement={onEngagement} depth={depth + 1} />
              ))}
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
                Show previous replies 💬
              </Box>
            )}
            {replyInputOpen &&
              (user ? (
                <Flex flexDirection="column" rowGap={2}>
                  <Flex columnGap={2}>
                    <Input
                      size="xs"
                      borderRadius="999px"
                      borderColor="var(--tt-border, #ececef)"
                      color="var(--tt-ink-soft, #4f4f58)"
                      _placeholder={{ color: MUTED }}
                      _hover={{ borderColor: MUTED }}
                      focusBorderColor={MUTED}
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
										<PostComposer parentId={comment.id} onPosted={handleRichReplied as any} onClose={() => setRichReplyOpen(false)} />
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
  const { post, onChanged, onEngagement, defaultCommentsOpen, mediaThing } = props;
	const permalinkPath = mediaThing ? mediaPageUrl(post.id) : `/post/${post.id}`;

  const api = useApi();
  const user = useCurrentUser();
  const lopu = useLopu();

  const [commentsOpen, setCommentsOpen] = React.useState(!!defaultCommentsOpen);
  // drill-down thread focus: the stack of comments the viewer zoomed into.
  // The top of the stack renders as the panel's top-level row (depth 1); the
  // back arrow pops one level. navDirRef picks the slide direction.
  const [focusStack, setFocusStack] = React.useState<PostComment[]>([]);
  const [threadNavCount, setThreadNavCount] = React.useState(0);
  const navDirRef = React.useRef<'push' | 'pop'>('push');
  const focusedComment = focusStack.length ? focusStack[focusStack.length - 1] : null;
  // the comment text persists as a per-user draft — leave and pick it up later
  const { value: commentText, setValue: setCommentText, clear: clearCommentDraft } = useCommentDraft(user?.id, post.id);
  const [richCommentOpen, setRichCommentOpen] = React.useState(false);
  // one EMPTY reply input at a time across this card's comment tree
  const [openReplyId, setOpenReplyId] = React.useState<string | null>(null);
  // comments page 5 at a time — "show more" reveals 5 older ones per click
  const [visibleComments, setVisibleComments] = React.useState(5);

  // stay a depth ahead from the moment the post arrives: warm shipped
  // avatars and prefetch the first HIDDEN depth (short level-1 threads and
  // every shipped level-2 comment with replies) into the thread cache
  const prefetchedPostRef = React.useRef(false);
  React.useEffect(() => {
    if (prefetchedPostRef.current) return;
    prefetchedPostRef.current = true;
    warmAvatars(post.comments);
    for (const comment of post.comments) {
      if (comment.commentCount > (comment.comments?.length || 0) && !getCachedThread(comment.id)) {
        void fetchThreadInto(api, comment.id);
      }
      prefetchNextDepth(api, comment.comments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);
  const replyFocus = React.useMemo(() => ({ openId: openReplyId, requestOpen: setOpenReplyId }), [openReplyId]);
  // repost split (X-style): instant repost or a QUOTE with caption + circle;
  // both default to the original post's circle (never widen the audience)
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const [quoteText, setQuoteText] = React.useState('');
  const [quoteVisibility, setQuoteVisibility] = React.useState<PostVisibility>(post.visibility);
  const [sharing, setSharing] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // outside-tap close (NOT closeOnBlur): dismissing the mobile keyboard blurs
  // the search/caption field and must not close these popovers
  const pickerContentRef = useOutsideTapClose<HTMLElement>(pickerOpen, () => setPickerOpen(false));
  const quoteContentRef = useOutsideTapClose<HTMLElement>(quoteOpen, () => setQuoteOpen(false));
  const expandSentRef = React.useRef(false);

  const { recent, pushRecent } = useRecentReactions();
  const inFlightReactionTokensRef = React.useRef(new Set<string>());
  // emoji-splash origin: the merged react button (picker + chips anchor here)
  const reactAnchorRef = React.useRef<HTMLDivElement | null>(null);

  const isOwner = !!user && !!post.author && user.id === post.author.id;
  // subspace moderation rights ride the projection (viewerCanModerate); the
  // vote pill is a per-browser preference (Settings → Subspaces)
  const canModerate = !!post.subspaceMod?.viewerCanModerate;
  const [subspacePrefs] = useSubspacePrefs();
  const showVotes = subspacePrefs.showVotes;

  // up/down vote — the separate focused reaction kind. Optimistic through the
  // same functional PostChange path reactions use (idempotent against the
  // freshest post), reconciled from the server tally, reverted on failure.
  const updownInFlightRef = React.useRef(false);
  const handleUpdown = async (direction: UpdownDirection) => {
    if (!user) {
      lopu({ title: 'Log in to vote 🔼', status: 'info', duration: 6000 });
      return;
    }
    if (updownInFlightRef.current) return;
    updownInFlightRef.current = true;
    const before = post.votes;
    onChanged?.(post.id, (current) => applyUpdownVote(current, direction));
    onEngagement?.({ thingId: post.id, signal: 'react' });
    try {
      const resp = await api.v1.things.updown({ id: post.id, direction });
      onChanged?.(post.id, (current) => ({ ...current, votes: resp.votes }));
    } catch (err: any) {
      onChanged?.(post.id, (current) => ({ ...current, votes: before }));
      lopu({ title: err?.error || 'Vote did not save 😞', status: 'error' });
    } finally {
      updownInFlightRef.current = false;
    }
  };

  // subspace moderation (mods only): each action round-trips through
  // /api/v1/subspaces/moderate and swaps in the re-projected post; the flair
  // list loads lazily when the menu opens (the embed stays lean) through the
  // same cached subspace loader the Remove modal uses for rules + reasons
  const [modFlairs, setModFlairs] = React.useState<{ id: string; label: string; emoji: string | null; modOnly: boolean }[] | null>(null);
  const loadFlairs = () => {
    if (modFlairs || !post.subspace) return;
    loadModerationSubspace(api, post.subspace.id)
      .then((detail) => setModFlairs(detail.flairs.map((flair) => ({ id: flair.id, label: flair.label, emoji: flair.emoji, modOnly: flair.modOnly }))))
      .catch(() => setModFlairs([]));
  };
  const handleModerate = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const resp: any = await api.v1.subspaces.moderate({ id: post.id, action, ...extra } as any);
      if (resp?.post) onChanged?.(post.id, resp.post);
      lopu({ title: `Done — ${action} 🎩`, status: 'success', duration: 4000 });
    } catch (err: any) {
      lopu({ title: err?.error || 'Moderation action failed 😞', status: 'error' });
    }
  };
  // Remove 🧹 goes through the RemoveModal (rules / removal reasons / custom,
  // note, also-lock, also-ban) and sequences moderate(remove) [+ lock]
  // [+ members ban]. Optimistic: the card paints removed + the reason at
  // once and reverts if the REMOVE is refused; a lock / ban that fails after
  // a successful removal keeps the removal (already reconciled) and toasts.
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const handleRemoveWithReason = async (choice: RemoveChoice) => {
    const before = post.subspaceMod || null;
    onChanged?.(post.id, (current) => ({
      ...current,
      subspaceMod: {
        status: 'removed',
        removed: true,
        reason: choice.previewReason,
        removedAt: new Date().toISOString(),
        pinned: current.subspaceMod?.pinned === true,
        locked: choice.lock || current.subspaceMod?.locked === true,
        nsfw: current.subspaceMod?.nsfw === true,
        spoiler: current.subspaceMod?.spoiler === true,
        viewerCanModerate: true
      }
    }));
    let latest: PublicPost | null = null;
    try {
      const resp: any = await api.v1.subspaces.moderate({ id: post.id, action: 'remove', ...(choice.reason ? { reason: choice.reason } : {}), ...(choice.reasonId ? { reasonId: choice.reasonId } : {}) });
      latest = resp?.post || null;
    } catch (err: any) {
      onChanged?.(post.id, (current) => ({ ...current, subspaceMod: before }));
      lopu({ title: err?.error || 'Could not remove that post 😞', status: 'error' });
      throw err;
    }
    const followUps: string[] = [];
    if (choice.lock && !latest?.subspaceMod?.locked) {
      try {
        const resp: any = await api.v1.subspaces.moderate({ id: post.id, action: 'lock' });
        latest = resp?.post || latest;
        followUps.push('locked 🔒');
      } catch (err: any) {
        lopu({ title: err?.error || 'Removed, but the comments did not lock 😞', status: 'error' });
      }
    }
    if (latest) onChanged?.(post.id, latest);
    if (choice.ban && post.subspace && post.author) {
      try {
        await api.v1.subspaces.mutateMember({ id: post.subspace.id, userId: post.author.id, action: 'ban', ...(latest?.subspaceMod?.reason || choice.previewReason ? { reason: latest?.subspaceMod?.reason || choice.previewReason } : {}), ...(choice.banDays ? { banDays: choice.banDays } : {}) });
        followUps.push(`@${post.author.username} banned${choice.banDays ? ` for ${choice.banDays}d` : ''} 🚫`);
      } catch (err: any) {
        lopu({ title: err?.error || 'Removed, but the ban did not go through 😞', status: 'error' });
      }
    }
    lopu({ title: `Removed 🧹${followUps.length ? ` · ${followUps.join(' · ')}` : ''}`, description: latest?.subspaceMod?.reason || undefined, status: 'success', duration: 5000 });
  };
  const handleOwnFlair = async (flairId: string | null) => {
    try {
      const resp: any = await api.v1.things.update({ id: post.id, crystal: { flairId } } as any);
      if (resp?.post) onChanged?.(post.id, resp.post);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not change the flair 😞', status: 'error' });
    }
  };
	const circle = mediaThing
		? { emoji: '🔗', label: 'Inherited audience', hint: 'This media follows the privacy of the Thing it belongs to' }
		: CIRCLE_META[post.visibility] || CIRCLE_META.public;

  // Every reaction token on the post, most-used first — feeds the merged
  // react button (top emojis + total count).
  const reactionEntries = Object.entries(post.reactionCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const reactionTotal = reactionEntries.reduce((sum, [, count]) => sum + count, 0);
  const viewerReactions = post.viewerReactions || [];
  const viewerSet = new Set(viewerReactions);

  const handleDelete = async () => {
    try {
      await api.v1.things.remove({ id: post.id });
      lopu({ title: 'Post deleted 🗑️', status: 'success', duration: 6000 });
      onChanged?.(post.id, null);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not delete that post 😞', status: 'error' });
    }
  };

  // Owner edit: the card body swaps to a textarea (media/original stay put
  // below it). Saving is optimistic — the new text paints immediately and the
  // editor closes; a failed write restores the old text and reopens the
  // editor with the draft.
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState('');

  const handleEditStart = () => {
    setEditText(post.text);
    setEditing(true);
  };

  // text is the whole body of a plain text post — only media-bearing types
  // (and share captions) may save it away to empty
  const canSaveEdit =
    !!editText.trim() || post.isShare || post.type === 'image' || post.type === 'marketplace' || post.type === 'thingtime';

  const handleEditSave = async () => {
    const text = editText.trim();
    const prevText = post.text;
    if (text === prevText) {
      setEditing(false);
      return;
    }
    // Inline #hashtags render as live tag links, so an edit must keep the
    // stored tags in step with the text (the composer harvests on publish —
    // without this, an added '#newtag' would linkify but its own search would
    // never find the post). Inline tags dropped from the text drop off; every
    // other stored tag (explicit composer tags, the folded marketplace
    // category) survives; canonicalPostTags dedupes the merge and caps it.
    const prevTags = post.tags;
    const nextInline = extractInlineHashtags(text);
    const removedInline = new Set(extractInlineHashtags(prevText).filter((tag) => !nextInline.includes(tag)));
    const tags = canonicalPostTags([...(prevTags || []).filter((tag) => !removedInline.has(tag)), ...nextInline]);
    setEditing(false);
    // a plain-text inline edit drops any rich-text doc the post carried, and
    // re-syncs the tag set recomputed from the edited text above
    onChanged?.(post.id, (prev) => ({ ...prev, text, richText: null, tags }));
    try {
      await api.v1.things.update({ id: post.id, crystal: { text, richText: null }, tags });
      lopu({ title: 'Post updated ✏️', status: 'success', duration: 4000 });
    } catch (err: any) {
      onChanged?.(post.id, (prev) => ({ ...prev, text: prevText, richText: post.richText, tags: prevTags }));
      setEditText(text); // give the draft back
      setEditing(true);
      lopu({ title: err?.error || 'Could not save that edit 😞', status: 'error' });
    }
  };

  // Change privacy from the post menu. Optimistic: the circle badge flips
  // immediately; the server response reconciles the derived acl, and a
  // failure flips it back.
  const handleVisibilityChange = async (next: PostVisibility) => {
    if (next === post.visibility) return;
    const prevVisibility = post.visibility;
    const prevAcl = post.acl;
    onChanged?.(post.id, (prev) => ({ ...prev, visibility: next }));
    try {
      const resp = await api.v1.things.update({ id: post.id, visibility: next });
      if (resp?.post) {
        onChanged?.(post.id, (prev) => ({ ...prev, visibility: resp.post.visibility, acl: resp.post.acl }));
      }
      const meta = CIRCLE_META[next];
      lopu({ title: `Privacy set to ${meta.label} ${meta.emoji}`, status: 'success', duration: 4000 });
    } catch (err: any) {
      onChanged?.(post.id, (prev) => ({ ...prev, visibility: prevVisibility, acl: prevAcl }));
      lopu({ title: err?.error || 'Could not change privacy 😞', status: 'error' });
    }
  };

  // menu copy-link: always the clipboard (the share icon owns the native sheet)
  const handleCopyLink = async () => {
		const url = `${window.location.origin}${permalinkPath}`;
    try {
      await navigator.clipboard.writeText(url);
      lopu({ title: 'Link copied 🔗', status: 'success', duration: 4000 });
    } catch {
      // clipboard unavailable (http origin) — hand the link over anyway
      lopu({ title: `Copy this link: ${url}`, status: 'info', duration: 10000 });
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
    // The API operation toggles rather than setting a desired value. Hold off
    // duplicate same-token taps until the active request settles so response
    // order can never invert that token; other tokens remain independent.
    if (inFlightReactionTokensRef.current.has(token)) return;
    inFlightReactionTokensRef.current.add(token);

    const adding = !viewerSet.has(token);
    // pure delight: ADDING a reaction erupts it from the button (motion-gated
    // inside splashEmoji; removals stay quiet)
    if (adding) splashEmoji(token, reactAnchorRef.current);

    // Optimistic + reconcile + revert all touch ONLY this token, applied to the
    // freshest post — so a concurrent reaction on another token isn't clobbered
    // by a stale full snapshot.
    // Each updater notes its applied result in the reaction overlay so
    // background fetches snapshotted before the tap merge instead of
    // clobbering (idempotent under strict-mode double-invoke).
    onChanged?.(post.id, (prev) => {
      const next = applyReactionToggle(prev, token, adding);
      noteLocalReactions(next.id, next.reactionCounts, next.viewerReactions);
      return next;
    });
    if (adding) onEngagement?.({ thingId: post.id, signal: 'react' });

    const reconcileLocalToken = (reactionCounts: Record<string, number>, viewerReactions: string[]) => {
      onChanged?.(post.id, (current) => {
        const next = reconcileReactionToken(current, token, reactionCounts, viewerReactions);
        noteLocalReactions(next.id, next.reactionCounts, next.viewerReactions);
        return next;
      });
    };

    try {
      const resp = await api.v1.things.react({ id: post.id, emoji: token });
      reconcileLocalToken(resp.reactionCounts, resp.viewerReactions);
      // record recents only on a successful ADD (server records the same)
      if (adding) pushRecent(token, resp.recentReactions);
    } catch (err: any) {
      let reconciled = false;
      if (shouldReconcileReactionFailure(err)) {
        try {
          const fresh = await fetchReactionTruth(api, post.id);
          if (fresh) {
            reconcileLocalToken(fresh.reactionCounts, fresh.viewerReactions);
            reconciled = true;
          }
        } catch {
          // A completed 5xx or unreadable response can arrive after the write
          // committed. Keep the optimistic copy when truth cannot be fetched;
          // a blind undo can make the UI lie and a retry can reverse the tap.
        }
      } else if (!isUnknownReactionFailure(err)) {
        reconcileLocalToken(post.reactionCounts, post.viewerReactions);
      }
      lopu({ ...reactionFailureMessage(err, reconciled), status: 'error' });
    } finally {
      inFlightReactionTokensRef.current.delete(token);
    }
  };

  // One-tap poll voting — optimistic like reactions: the bars fill
  // immediately, the server's authoritative tally reconciles when the
  // response lands, and a failure reverts to the pre-tap tally + toasts.
  const inFlightVoteRef = React.useRef(false);
  const handleVote = async (optionIndex: number, splash?: () => void) => {
    if (!user) {
      lopu({ title: 'Log in to vote 🗳️', status: 'info', duration: 6000 });
      return;
    }
    // one vote slot per user — hold off further taps until the active request
    // settles so response order can never invert the vote
    if (inFlightVoteRef.current) return;
    inFlightVoteRef.current = true;

    const prevTally = post.pollVotes;
    const adding = prevTally?.viewerVote === null;
    // emoji-splash (thunk from PollRenderer) fires with the optimistic apply —
    // past the guards above, and only when the vote LANDS on this option (new
    // or moved); tapping your own option removes the vote — no burst
    if (prevTally && prevTally.viewerVote !== optionIndex) splash?.();
    onChanged?.(post.id, (prev) => applyPollVoteToggle(prev, optionIndex));
    // a fresh vote is engagement of react strength for the feed algorithms
    if (adding) onEngagement?.({ thingId: post.id, signal: 'react' });

    try {
      const resp = await api.v1.things.vote({ id: post.id, optionIndex });
      onChanged?.(post.id, (prev) => ({ ...prev, pollVotes: resp.pollVotes }));
    } catch (err: any) {
      onChanged?.(post.id, (prev) => (prevTally ? { ...prev, pollVotes: prevTally } : prev));
      lopu({ title: err?.error || 'Your vote did not go through 😞', status: 'error' });
    } finally {
      inFlightVoteRef.current = false;
    }
  };

  // wired into the poll renderer through ThingView's context (only poll posts
  // carry pollVotes) — logged-out viewers get results-only + a login toast
  const pollContext: PollRenderPollContext | undefined = post.pollVotes
    ? { ...post.pollVotes, canVote: !!user, onVote: handleVote }
    : undefined;

  // Opening shows the first page of comments (5); "Show more" reveals 5 more
  // per click. The revealed count is REMEMBERED across close/reopen (it's
  // component state); closing exits any drilled-in thread so a reopen starts
  // at the conversation root.
  const toggleComments = () => {
    setCommentsOpen((open) => {
      if (open) {
        setFocusStack([]);
        setThreadNavCount(0);
      }
      return !open;
    });
    if (!expandSentRef.current) {
      expandSentRef.current = true;
      onEngagement?.({ thingId: post.id, signal: 'expand' });
    }
  };

  // Feed keyboard shortcuts (useFeedShortcuts): inside a shortcuts-enabled
  // page (feed/explore mount the provider) the card lends its OWN handlers —
  // handleReact for `l`, toggleComments for `c` — through a ref, so the hook
  // always calls the freshest closures without re-registering per render.
  // Outside a provider this is a no-op and the card renders exactly as before.
  const shortcutsRegistry = React.useContext(FeedShortcutsContext);
  const shortcutActionsRef = React.useRef<FeedPostShortcutActions | null>(null);
  shortcutActionsRef.current = { react: handleReact, toggleComments };
  React.useEffect(() => {
    if (!shortcutsRegistry) return;
    return shortcutsRegistry.register(post.id, shortcutActionsRef);
  }, [shortcutsRegistry, post.id]);

  // Drill into a deep comment: it slides in as the panel's new top level.
  const focusThread = React.useCallback((comment: PostComment) => {
    navDirRef.current = 'push';
    setThreadNavCount((count) => count + 1);
    setFocusStack((stack) => [...stack, comment]);
  }, []);

  const popThreadFocus = () => {
    navDirRef.current = 'pop';
    setThreadNavCount((count) => count + 1);
    setFocusStack((stack) => stack.slice(0, -1));
  };

	const threadFocusValue = React.useMemo(() => ({ maxDepth: MAX_VISUAL_DEPTH, focusThread }), [focusThread]);

  // reactions etc. on the focused row update the top-of-stack snapshot
  const handleFocusedChanged = (id: string, change: CommentChange) => {
    setFocusStack((stack) =>
      stack.map((entry, index) => (index === stack.length - 1 && entry.id === id ? applyCommentChange(entry, change) : entry))
    );
  };

  // optimistic: the comment renders the moment you hit send; the server copy
  // swaps in when the write lands, and a failure restores your text
  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) return;

    const pendingComment = buildPendingComment(user, post.id, text);
    clearCommentDraft();
    onChanged?.(post.id, (prev) => ({
      ...prev,
      comments: [...prev.comments, pendingComment],
      commentCount: prev.commentCount + 1
    }));
    onEngagement?.({ thingId: post.id, signal: 'comment' });

    try {
      const resp = await api.v1.things.comment({ id: post.id, text });
      onChanged?.(post.id, (prev) => ({
        ...prev,
        comments: prev.comments.map((comment) => (comment.id === pendingComment.id ? resp.comment : comment)),
        commentCount: resp.commentCount
      }));
    } catch (err: any) {
      onChanged?.(post.id, (prev) => ({
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
    onChanged?.(post.id, (prev) => ({
      ...prev,
      comments: [...prev.comments, comment],
      commentCount: prev.commentCount + 1
    }));
    onEngagement?.({ thingId: post.id, signal: 'comment' });
    setRichCommentOpen(false);
  };

  // a comment changed (reaction toggled) — swap it inside the freshest post
  const handleCommentChanged = (id: string, change: CommentChange) => {
    onChanged?.(post.id, (prev) => ({
      ...prev,
      comments: prev.comments.map((comment) => (comment.id === id ? applyCommentChange(comment, change) : comment))
    }));
  };

  // Instant repost (X-style "Repost" — no caption, straight out). Optimistic:
  // count + toast paint immediately, revert on failure. Inherits the original
  // post's circle so a non-public post never widens its audience.
  const handleRepost = async () => {
    if (sharing) return;
    setSharing(true);
    onChanged?.(post.id, (prev) => ({ ...prev, shareCount: prev.shareCount + 1 }));
    onEngagement?.({ thingId: post.id, signal: 'share' });
    lopu({ title: 'Reposted 🔁', status: 'success', duration: 6000 });
    try {
      await api.v1.things.share({ id: post.id, visibility: post.visibility });
    } catch (err: any) {
      onChanged?.(post.id, (prev) => ({ ...prev, shareCount: Math.max(0, prev.shareCount - 1) }));
      lopu({ title: err?.error || 'Repost failed 😞', status: 'error' });
    }
    setSharing(false);
  };

  // Quote repost — caption + circle picker, from the repost menu
  const handleQuote = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const caption = quoteText.trim();
      await api.v1.things.share({
        id: post.id,
        text: caption || undefined,
        // the caption linkifies #tags (HashtagText), so harvest them into real
        // tags exactly like the composer — otherwise a tapped caption tag's
        // own search would exclude the quote post itself. The server merges
        // these with the tags carried from the original.
        tags: extractInlineHashtags(caption),
        visibility: quoteVisibility
      });
      lopu({ title: 'Quoted ✨', status: 'success', duration: 6000 });
      onChanged?.(post.id, (prev) => ({ ...prev, shareCount: prev.shareCount + 1 }));
      onEngagement?.({ thingId: post.id, signal: 'share' });
      setQuoteOpen(false);
      setQuoteText('');
    } catch (err: any) {
      lopu({ title: err?.error || 'Quote failed 😞', status: 'error' });
    }
    setSharing(false);
  };

  // The share icon is OUTWARD share: the native share sheet where the
  // platform has one, copy-link everywhere else. Works logged out too.
  const handleShareLink = async () => {
		const url = `${window.location.origin}${permalinkPath}`;
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) {
        await (navigator as any).share({ url });
      } else {
        await navigator.clipboard.writeText(url);
        lopu({ title: 'Link copied 🔗', status: 'success', duration: 4000 });
      }
      onEngagement?.({ thingId: post.id, signal: 'share' });
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // dismissed the share sheet
      // clipboard unavailable (http origin) — hand the link over anyway
      lopu({ title: `Copy this link: ${url}`, status: 'info', duration: 10000 });
    }
  };

  // Bookmark toggle — save/unsave this post to the viewer's private library
  // (/saved). Optimistic: the icon fills immediately, the server's saved
  // boolean reconciles when the response lands, and a failure reverts + toasts.
  // Same-button taps hold off while a toggle is in flight (the endpoint
  // toggles rather than setting, so response order could invert the state).
  const inFlightSaveRef = React.useRef(false);
  const handleToggleSave = async () => {
    if (!user) return; // the button is hidden logged-out; belt-and-braces
    if (inFlightSaveRef.current) return;
    inFlightSaveRef.current = true;

    const prevSaved = post.viewerSaved === true;
    onChanged?.(post.id, (prev) => ({ ...prev, viewerSaved: !prevSaved }));
    try {
      const resp = await api.v1.things.save({ id: post.id });
      onChanged?.(post.id, (prev) => ({ ...prev, viewerSaved: resp.saved === true }));
      lopu({
        title: resp.saved ? 'Saved to your library 🔖' : 'Removed from Saved 🌫️',
        status: 'success',
        duration: 4000
      });
    } catch (err: any) {
      onChanged?.(post.id, (prev) => ({ ...prev, viewerSaved: prevSaved }));
      lopu({ title: err?.error || 'Could not update your Saved library 😞', status: 'error' });
    } finally {
      inFlightSaveRef.current = false;
    }
  };

  // The merged react button: everyone's reactions AT the button (top emojis +
  // total, heart outline when none); tap/hold/hover all open the picker.
  const reactButton = (
    <Flex
      as="button"
      type="button"
      alignItems="center"
      columnGap={1.5}
      paddingX={2}
      height="32px"
      borderRadius="999px"
      fontSize="sm"
      color={viewerReactions.length ? ACCENT : MUTED}
      _hover={{ background: 'var(--tt-surface-hover, #ececee)', color: viewerReactions.length ? ACCENT : INK }}
      aria-label="React"
      title="React"
    >
      {reactionEntries.length ? (
        <Text as="span" fontSize="md" lineHeight="1" sx={{ whiteSpace: 'nowrap' }}>
          {reactionDisplayEmojis(reactionEntries, viewerSet, 3)}
        </Text>
      ) : (
        <Heart size={18} strokeWidth={2.2} />
      )}
      {reactionTotal > 0 && (
        <Text as="span" fontWeight={viewerReactions.length ? 700 : 600}>
          {reactionTotal}
        </Text>
      )}
    </Flex>
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
              <AuthorFlairChip flair={post.authorFlair} />
              <Text as="span" fontSize="xs" color={MUTED}>
                {post.author ? `${getUserIdentityDetail(post.author)} · ` : ''}
              </Text>
							<TimestampLink id={post.id} createdAt={post.createdAt} to={mediaThing ? permalinkPath : undefined} />
              <Tooltip label={`${circle.label} — ${circle.hint}`} fontSize="xs" borderRadius="8px" hasArrow>
                <Text as="span" fontSize="xs" cursor="default">
                  {circle.emoji}
                </Text>
              </Tooltip>
            </Flex>
          </Box>
          {(isOwner || canModerate) && (
            <Menu placement="bottom-end" autoSelect={false} onOpen={loadFlairs}>
              <MenuButton
                as={IconButton}
				aria-label={mediaThing ? 'Media options' : 'Post options'}
                icon={<MoreHorizontal size={16} />}
                size="xs"
                variant="ghost"
                color={MUTED}
                borderRadius="8px"
              />
              <MenuList minWidth="190px" borderRadius={RADIUS_MD} zIndex={10}>
                {isOwner && !mediaThing && (
                  <MenuItem fontSize="sm" onClick={handleEditStart}>
                    Edit ✏️
                  </MenuItem>
                )}
                <MenuItem fontSize="sm" onClick={handleCopyLink}>
                  Copy link 🔗
                </MenuItem>
                {isOwner && !mediaThing && (
                  <>
                    <MenuDivider />
                    <MenuOptionGroup
                      title="Privacy"
                      type="radio"
                      value={post.visibility}
                      onChange={(value) => handleVisibilityChange(value as PostVisibility)}
                    >
                      {(Object.keys(CIRCLE_META) as PostVisibility[]).map((key) => (
                        <MenuItemOption key={key} value={key} fontSize="sm">
                          {CIRCLE_META[key].emoji} {CIRCLE_META[key].label}
                        </MenuItemOption>
                      ))}
                    </MenuOptionGroup>
                    <MenuDivider />
                    <MenuItem fontSize="sm" color="var(--tt-danger, #e5484d)" onClick={handleDelete}>
                      Delete 🗑️
                    </MenuItem>
                  </>
                )}
                {!mediaThing && post.subspace && (
                  <>
                    <MenuDivider />
                    {canModerate && (
                      <MenuGroup title="Moderation 🎩" fontSize="xs">
                        {post.subspaceMod?.removed ? (
                          <MenuItem fontSize="sm" onClick={() => handleModerate('approve')}>
                            Approve ✅
                          </MenuItem>
                        ) : (
                          <MenuItem fontSize="sm" onClick={() => setRemoveOpen(true)} data-testid="post-mod-remove">
                            Remove 🧹
                          </MenuItem>
                        )}
                        <MenuItem fontSize="sm" onClick={() => handleModerate(post.subspaceMod?.pinned ? 'unpin' : 'pin')}>
                          {post.subspaceMod?.pinned ? 'Unpin' : 'Pin'} 📌
                        </MenuItem>
                        <MenuItem fontSize="sm" onClick={() => handleModerate(post.subspaceMod?.locked ? 'unlock' : 'lock')}>
                          {post.subspaceMod?.locked ? 'Unlock comments' : 'Lock comments'} 🔒
                        </MenuItem>
                        <MenuItem fontSize="sm" onClick={() => handleModerate('nsfw', { value: !post.subspaceMod?.nsfw })}>
                          {post.subspaceMod?.nsfw ? 'Unmark 18+' : 'Mark 18+'} 🔞
                        </MenuItem>
                        <MenuItem fontSize="sm" onClick={() => handleModerate('spoiler', { value: !post.subspaceMod?.spoiler })}>
                          {post.subspaceMod?.spoiler ? 'Unmark spoiler' : 'Mark spoiler'} ⚠️
                        </MenuItem>
                      </MenuGroup>
                    )}
                    <MenuOptionGroup
                      title="Flair"
                      type="radio"
                      value={post.flair?.id || ''}
                      onChange={(value) => {
                        const flairId = (value as string) || null;
                        if (canModerate) handleModerate('flair', { flairId });
                        else handleOwnFlair(flairId);
                      }}
                    >
                      <MenuItemOption value="" fontSize="sm">
                        No flair
                      </MenuItemOption>
                      {(modFlairs || [])
                        .filter((flair) => canModerate || !flair.modOnly)
                        .map((flair) => (
                          <MenuItemOption key={flair.id} value={flair.id} fontSize="sm">
                            {flair.emoji ? `${flair.emoji} ` : ''}
                            {flair.label}
                          </MenuItemOption>
                        ))}
                      {modFlairs === null && (
                        <MenuItemOption value="__loading" fontSize="sm" isDisabled>
                          Loading flairs…
                        </MenuItemOption>
                      )}
                    </MenuOptionGroup>
                  </>
                )}
              </MenuList>
            </Menu>
          )}
          {canModerate && post.subspace && !mediaThing && (
            <RemoveModal
              isOpen={removeOpen}
              onClose={() => setRemoveOpen(false)}
              api={api}
              subspaceId={post.subspace.id}
              subspaceSlug={post.subspace.slug}
              authorName={post.author?.username || null}
              canBanAuthor={!!post.author && !isOwner}
              alreadyLocked={post.subspaceMod?.locked === true}
              onRemove={handleRemoveWithReason}
            />
          )}
        </Flex>

        {/* subspace context — where the post lives, its flair, mod badges */}
        {(post.subspace || post.subspaceMod?.removed) && (
          <Flex alignItems="center" columnGap={1.5} rowGap={1} flexWrap="wrap" fontSize="xs" data-testid="post-subspace-line">
            {post.subspace && (
              <Flex
                as={Link}
                to={`/s/${post.subspace.slug}`}
                alignItems="center"
                columnGap={1}
                fontWeight={700}
                color={INK}
                border={BORDER}
                borderRadius="999px"
                paddingX={2}
                paddingY="1px"
                _hover={{ borderColor: post.subspace.accent || ACCENT }}
                onClick={(event: React.MouseEvent) => event.stopPropagation()}
                title={post.subspace.name}
              >
                <Text as="span">{post.subspace.icon || '🪐'}</Text>
                <Text as="span" fontFamily="mono" fontWeight={600}>
                  s/{post.subspace.slug}
                </Text>
              </Flex>
            )}
            {post.flair && (
              <Text
                as="span"
                fontWeight={600}
                paddingX={2}
                paddingY="1px"
                borderRadius="999px"
                border={`1px solid ${post.flair.color || 'var(--tt-border, #ececef)'}`}
                color={post.flair.color || TEXT}
                data-testid="post-flair"
              >
                {post.flair.emoji ? `${post.flair.emoji} ` : ''}
                {post.flair.label}
              </Text>
            )}
            {post.subspaceMod?.pinned && (
              <Text as="span" color={MUTED} title="Pinned by moderators">
                📌 Pinned
              </Text>
            )}
            {post.subspaceMod?.locked && (
              <Text as="span" color={MUTED} title="Comments are locked">
                🔒 Locked
              </Text>
            )}
            {post.subspaceMod?.nsfw && (
              <Text as="span" color="var(--tt-danger, #e5484d)" fontWeight={700}>
                18+
              </Text>
            )}
            {post.subspaceMod?.spoiler && (
              <Text as="span" color={MUTED}>
                ⚠️ Spoiler
              </Text>
            )}
          </Flex>
        )}
        {post.title && !editing && (
          <Text as="h2" fontFamily="heading" fontSize="lg" fontWeight={700} color={INK} lineHeight="1.25" whiteSpace="normal" data-testid="post-title">
            {post.title}
          </Text>
        )}
        {post.subspaceMod?.removed && (
          <Flex alignItems="center" columnGap={2} fontSize="sm" color={MUTED} border="1px dashed var(--tt-border, #ececef)" borderRadius={RADIUS_MD} padding={3} data-testid="post-removed">
            🧹 Removed by moderators{post.subspaceMod.reason ? ` — ${post.subspaceMod.reason}` : ''}
          </Flex>
        )}

        {/* body — shares render caption + nested original; the owner's edit
        mode mounts the FULL composer (type tabs, photos, listing, thing,
        tags, circle, attachment order) pre-filled from the post. Shares edit
        their caption only — the shared original is the body. */}
        {editing && !post.isShare ? (
          <PostComposer
            editPost={post}
            onPosted={(updated) => {
              // the composer edits this exact post, so address the change to
              // post.id — `updated` replaces it wholesale
              onChanged?.(post.id, updated);
              setEditing(false);
            }}
            onClose={() => setEditing(false)}
          />
        ) : editing ? (
          <Flex flexDirection="column" rowGap={3}>
            <Textarea
              size="sm"
              rows={3}
              resize="vertical"
              borderRadius="var(--tt-radius-sm, 9px)"
              placeholder="Say something… ✨"
              autoFocus
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
            />
            <Flex alignItems="center" columnGap={2}>
              <Button
                size="xs"
                color="white"
                fontFamily="heading"
                fontWeight={600}
                background={RAINBOW}
                backgroundSize="calc(100px + 200%)"
                sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
                _hover={{ opacity: 0.9 }}
                borderRadius={RADIUS_MD}
                isDisabled={!canSaveEdit}
                onClick={handleEditSave}
              >
                Save ✨
              </Button>
              <Button size="xs" variant="ghost" borderRadius={RADIUS_MD} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Flex>
            {post.shareOf && <SharedPostCard post={post.shareOf} />}
          </Flex>
        ) : post.isShare ? (
          <Flex flexDirection="column" rowGap={3}>
            {/* quote captions linkify #tags too — PostTextBody does that for
            every surface now; the chip row stays on the nested original (a
            share copies a public original's tags, so a second chip row here
            would just duplicate it) */}
            <PostTextBody post={post} />
            <PostAttachments attachments={post.attachments} mediaLayout={post.mediaLayout} />
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
          <PostBody post={post} attachments={post.attachments} poll={pollContext} />
        )}

        {/* tags — each chip links to that tag's public feed (claude-todo/10 ✨) */}
        {post.tags?.length > 0 && (
          <Flex columnGap={1} rowGap={1} flexWrap="wrap">
            {post.tags.map((tag) => (
              <Text
                key={tag}
                as={Link}
                to={`/feed?tag=${encodeURIComponent(tag)}`}
                fontFamily="mono"
                fontSize="12px"
                fontWeight={600}
                color={MUTED}
                paddingX={2}
                paddingY="1px"
                borderRadius="999px"
                border={BORDER}
                _hover={{ color: INK, background: 'var(--tt-surface-hover, #ececee)' }}
                title={`See every post tagged #${tag}`}
              >
                #{tag}
              </Text>
            ))}
          </Flex>
        )}

        {/* action row — icons + counts only (X-style, no labels); the merged
        react control sits right beside the comments icon (comment rows keep
        their IG-style right-aligned react columns) */}
        <Flex borderTop={BORDER} paddingTop={2} alignItems="center" columnGap={[1, 2]}>
          <ActionIcon
            icon={<MessageCircle size={18} strokeWidth={2.2} />}
            count={post.commentCount}
            label={commentsOpen ? 'Hide comments' : 'Show comments'}
            active={commentsOpen}
            aria-expanded={commentsOpen}
            onClick={toggleComments}
          />
          {showVotes && <UpdownControl votes={post.votes} onVote={handleUpdown} enabled={!!user} accent={post.subspace?.accent} />}

          {user ? (
            <Box ref={reactAnchorRef} position="relative" display="flex">
              {/* tap, touch-and-hold, or hover: quick reactions + a ＋ that
              opens the full picker */}
              <ReactionControl
                tapOpens
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

              {/* ＋: the full native-emoji picker (multi-select), anchored here */}
              <AnchoredEmojiPicker
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                contentRef={pickerContentRef}
                onPick={handleReact}
                recent={recent}
                activeTokens={viewerReactions}
              />
            </Box>
          ) : (
							<ReactionControl enabled={false} trigger={reactButton} onQuickTap={() => handleReact('👍')} content={() => null} />
          )}

          {/* repost: instant repost OR quote (caption + circle) */}
			{!mediaThing && (user ? (
            <Box position="relative" display="flex">
              <Menu placement="top" autoSelect={false}>
									<MenuButton as={ActionIcon} icon={<Repeat2 size={18} strokeWidth={2.2} />} count={post.shareCount} label="Repost" />
                <MenuList minWidth="170px" borderRadius={RADIUS_MD} zIndex={10}>
                  <MenuItem fontSize="sm" onClick={handleRepost}>
                    Repost 🔁
                  </MenuItem>
                  <MenuItem fontSize="sm" onClick={() => setQuoteOpen(true)}>
                    Quote post ✏️
                  </MenuItem>
                </MenuList>
              </Menu>

              {/* the quote composer, anchored above the repost button */}
              <Popover isOpen={quoteOpen} onClose={() => setQuoteOpen(false)} placement="top" isLazy closeOnBlur={false}>
                <PopoverAnchor>
                  <Box position="absolute" left={0} bottom="100%" width="1px" height="1px" pointerEvents="none" />
                </PopoverAnchor>
                <PopoverContent
                  ref={quoteContentRef as any}
                  width="260px"
                  border={BORDER}
                  borderRadius={RADIUS_MD}
                  boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0, 0, 0, 0.22))"
                  zIndex={10}
                >
                  <Flex flexDirection="column" rowGap={2} padding={3}>
											<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
                      Quote this post ✏️
                    </Text>
                    <Textarea
                      size="sm"
                      rows={2}
                      resize="none"
                      borderRadius="var(--tt-radius-sm, 9px)"
                      placeholder="Add your thoughts…"
                      value={quoteText}
                      onChange={(event) => setQuoteText(event.target.value)}
                    />
                    <Select
                      size="sm"
                      borderRadius="var(--tt-radius-sm, 9px)"
                      value={quoteVisibility}
                      onChange={(event) => setQuoteVisibility(event.target.value as PostVisibility)}
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
                      onClick={handleQuote}
                    >
                      Quote ✨
                    </Button>
                  </Flex>
                </PopoverContent>
              </Popover>
            </Box>
          ) : (
            <ActionIcon
              icon={<Repeat2 size={18} strokeWidth={2.2} />}
              count={post.shareCount}
              label="Repost"
              onClick={() => lopu({ title: 'Log in to repost 🔁', status: 'info', duration: 6000 })}
            />
			))}

          {/* outward share: native sheet / copy link */}
          <ActionIcon icon={<Share size={18} strokeWidth={2.2} />} label="Share" onClick={handleShareLink} />

          {/* bookmark: save to the viewer's private library (/saved) —
          filled/accent when saved, hidden logged-out (nothing to save into) */}
          {user && (
            <ActionIcon
              icon={<Bookmark size={18} strokeWidth={2.2} fill={post.viewerSaved ? 'currentColor' : 'none'} />}
              label={post.viewerSaved ? 'Remove from Saved' : 'Save to library'}
              active={post.viewerSaved === true}
              color={post.viewerSaved ? ACCENT : MUTED}
              _hover={{ background: 'var(--tt-surface-hover, #ececee)', color: post.viewerSaved ? ACCENT : INK }}
              aria-pressed={post.viewerSaved === true}
              onClick={handleToggleSave}
            />
          )}

          {/* public view stats (X-style, right edge): count = unique viewers;
          the tooltip carries impressions + average time on screen */}
          <Tooltip
            label={`${post.viewCount || 0} unique ${(post.viewCount || 0) === 1 ? 'viewer' : 'viewers'} · ${
              post.viewStats?.impressions || 0
            } impressions · avg ${formatDwell(post.viewStats?.avgDwellMs || 0)} on screen`}
            fontSize="xs"
            borderRadius="8px"
            hasArrow
          >
            <Flex
              alignItems="center"
              columnGap={1.5}
              paddingX={2}
              height="32px"
              marginLeft="auto"
              borderRadius="999px"
              fontSize="sm"
              fontWeight={600}
              color={MUTED}
              cursor="default"
              aria-label={`${post.viewCount || 0} views`}
            >
              <Eye size={18} strokeWidth={2.2} />
              <Text as="span">{formatCompactCount(post.viewCount || 0)}</Text>
            </Flex>
          </Tooltip>
        </Flex>

        {/* comments — the post's conversation, or a FOCUSED thread panel:
        drilling past the visual depth cap slides the deep comment in as the
        new top level (back arrow slides out), so thread depth is unbounded
        without flattening or squeezing the layout */}
        {commentsOpen && focusedComment && (
          <ThreadFocusContext.Provider value={threadFocusValue}>
            <Flex
              key={focusedComment.id}
              flexDirection="column"
              rowGap={3}
              sx={{ animation: `${navDirRef.current === 'pop' ? SLIDE_IN_LEFT : SLIDE_IN_RIGHT} 0.22s ease-out` }}
            >
              <Flex alignItems="center" columnGap={2}>
                <Flex
                  as="button"
                  type="button"
                  alignItems="center"
                  padding={1}
                  borderRadius="999px"
                  color={MUTED}
                  _hover={{ color: INK, background: 'var(--tt-surface-hover, #ececee)' }}
                  aria-label="Back to the previous thread level"
                  title="Back"
                  onClick={popThreadFocus}
                >
                  <ArrowLeft size={16} strokeWidth={2.2} />
                </Flex>
                <Text fontSize="xs" fontWeight={700} color={MUTED}>
                  Thread 🧵
                </Text>
              </Flex>
								<CommentRow comment={focusedComment} onChanged={handleFocusedChanged} onEngagement={onEngagement} defaultOpen />
            </Flex>
          </ThreadFocusContext.Provider>
        )}
        {commentsOpen && !focusedComment && (
          <ThreadFocusContext.Provider value={threadFocusValue}>
							<Flex flexDirection="column" rowGap={3} sx={threadNavCount > 0 ? { animation: `${SLIDE_IN_LEFT} 0.22s ease-out` } : undefined}>
            {post.comments.slice(-visibleComments).map((comment) => (
              <CommentRow key={comment.id} comment={comment} onChanged={handleCommentChanged} onEngagement={onEngagement} />
            ))}

            {/* the reveal control sits BELOW the conversation (FB-style);
            the OLDER comments it reveals render above the visible list */}
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
                Show previous comments 💬
              </Box>
            )}

            {user ? (
              <Flex flexDirection="column" rowGap={2}>
                <Flex columnGap={2}>
                  <Input
                    size="sm"
                    borderRadius="999px"
                    borderColor="var(--tt-border, #ececef)"
                    color="var(--tt-ink-soft, #4f4f58)"
                    _placeholder={{ color: MUTED }}
                    _hover={{ borderColor: MUTED }}
                    focusBorderColor={MUTED}
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
          </ThreadFocusContext.Provider>
        )}
      </Flex>
    </Box>
    </ReplyFocusContext.Provider>
  );
});
