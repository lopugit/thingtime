import React from 'react';
import { Box, Button, Flex, IconButton, Input, Modal, ModalContent, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { PictureInPicture2, Plus, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import {
	MediaLayoutCanvas,
	MediaLayoutFinalPreview,
	MediaLayoutPicker,
	SpanCycleButton,
	type ComposerLayoutMode
} from '~/components/Attachments/MediaLayoutControls';
import type { AttachmentComposerSnapshot, PublicAttachment } from '~/components/Attachments/attachmentTypes';
import type { MediaLayoutSpan, PostMediaLayout } from '~/schemas/registry';
import {
	canonicalPostTags,
	matchesCommittedPostCreate,
	MAX_POST_ATTACHMENTS,
	normalizePublicAttachment,
	shouldFreezeAmbiguousPostSubmission,
	type CommittedPostExpectation
} from '~/components/Attachments/attachmentUiCore';
import { LongTextEditor, textToBlocks, type LongTextEditorHandle } from '~/components/Editor/LongTextEditor';
import { blocksToText, isEditorJsDoc, type EditorJsDoc } from '~/components/Editor/editorJsValue';
import { capturePostEditorValue } from '~/components/Editor/postEditorSubmission';
import { useLopu } from '~/components/Lopu/useLopu';
import { isLegacyLinkedSeedId } from '~/components/Attachments/useAttachmentUploads';
import { UserAvatarCircle } from '~/components/Nav/Drawer/DrawerContent';
import { EditorSplit } from '~/components/Thingtime/EditorSplit';
import { ThingView } from '~/components/Thingtime/ThingView';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { RAINBOW } from '~/theme/rainbow';
import { extractInlineHashtags } from './hashtags';
import { MentionAutocomplete } from './MentionAutocomplete';
import { CIRCLE_META, MARKETPLACE_CATEGORY_META, POST_TYPE_META } from './feedTypes';
import type { MarketplaceCategory, PostType, PostVisibility, PublicPost } from './feedTypes';
import { composerContextOf, type PublicSubspace, type SubspaceComposerContext } from '~/components/Subspaces/subspaceTypes';

// "What's on your mind?" composer. Collapsed it's a one-line prompt beside
// the viewer's avatar; expanded it grows type TOGGLES (Text is the always-on
// base; Photos, Marketplace and Things each switch their field group on top
// without deselecting the others), a block editor for the body (Editor.js —
// headings, lists, quotes, checklists, inline marks, whitespace, and style
// tunes), the
// secure media uploader + linked image URLs (under the Photos toggle),
// listing fields, tag chips and a circle picker. The stored crystal type is
// DERIVED from the live toggles (things > marketplace > photos-with-visual-
// media > text) so the server vocabulary is unchanged. The Things toggle
// mounts the real things editor (an embedded single-window EditorSplit) over
// the "New Thing" draft branch of the global thingtime store
// (localforage-persisted, so half-built things survive reloads) —
// height-draggable, and poppable into a floating, resizable, splittable
// editor window that stays live-synced with the in-post one. Posts through
// api.v1.things.create and hands the returned post to onPosted for
// prepending; edits save through api.v1.things.update, where the media panel
// stays live — new uploads ride the PATCH attachment sync into the existing
// post.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

const CURRENCIES = ['AUD', 'USD', 'EUR'];

const EMPTY_ATTACHMENT_SNAPSHOT: AttachmentComposerSnapshot = {
	attachmentIds: [],
	attachments: [],
	blocking: false,
	hasSelection: false
};

// The thingtime-tab draft lives under a SESSION-SCOPED branch of the global
// store: tmp.<sessionId>.New Thing. A fresh session id per composer mount (and
// pruning prior composer sessions on seed) means drafts never persist across
// reloads and no stale draft can ever resurface — the editor always opens on
// one clean "New Thing" root (the key IS the label the editor shows).
const DRAFT_ROOT_KEY = 'New Thing';
const DRAFT_TMP_KEY = 'tmp';

type PendingPostSubmission = {
	shareId: string;
	payload: Record<string, unknown>;
	expectation: CommittedPostExpectation | null;
	attachmentIds: string[];
	postType: PostType;
	unknownOutcome: boolean;
};

// A composer session id is `s` + 10 hex chars (see draftSessionId below). `tmp`
// is a plain user-writable root key in the Thingtime editor, so seeding must
// prune only these composer-owned branches and leave any user-authored `tmp`
// keys untouched.
const COMPOSER_SESSION_KEY = /^s[0-9a-f]{10}$/;

// the in-post editor's default height; drag the handle for anything else
const DEFAULT_EDITOR_HEIGHT = 440;
const MIN_EDITOR_HEIGHT = 120;

const clonePostJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// A thing "has content" once any leaf holds a real value — numbers, booleans,
// and deliberate nulls count; empty strings don't, so the auto-seeded
// { name: '' } alone never enables Post.
const thingHasContent = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(thingHasContent);
  if (value && typeof value === 'object') return Object.values(value).some(thingHasContent);
  return value !== undefined;
};

// The tabs cover the post types plus the Poll mode — a poll publishes as a
// thingtime post whose thing is { kind: 'poll', question, options }, so it
// rides the existing publish path and renders through the poll kind renderer
// (with live vote bars once the server aggregates vote things onto it).
type ComposeMode = PostType | 'poll';

const COMPOSE_MODE_META: Record<ComposeMode, { label: string; emoji: string }> = {
	...POST_TYPE_META,
	poll: { label: 'Poll', emoji: '🗳️' }
};

const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;
const MAX_POLL_OPTION_CHARS = 80;

const TEXTAREA_PLACEHOLDERS: Record<ComposeMode, string> = {
  text: "What's on your mind? ✨",
  image: 'Say something about these photos… 🖼️',
  marketplace: 'Describe your listing… 🏪',
  thingtime: 'Say something about this thing… 📦 (optional)',
  poll: 'Ask your question… 🗳️'
};

export type PostComposerProps = {
  // in comment mode this receives the created comment (post-shaped — comments
  // share the post schema); in edit mode it receives the UPDATED post
  onPosted: (post: PublicPost) => void;
  // compose a COMMENT on this thing instead of a top-level post — starts
  // expanded, hides the circle picker (comments inherit the thread root's
  // audience) and posts through api.v1.things.comment
  parentId?: string;
  // called when the comment/edit composer's close button is pressed
  onClose?: () => void;
  // EDIT an existing post: starts expanded and pre-filled from this post
  // (type tabs, photos, listing, thing, tags, circle all editable — the same
  // suite as a new post) and saves through api.v1.things.update
  editPost?: PublicPost;
  // post INTO a subspace: the /s/<slug> page passes its context (id, flairs,
  // rights) so the composer locks the destination, shows the title + flair
  // row, and stamps crystal.subspaceId. Without it the feed composer offers
  // the viewer's joined subspaces as an optional destination.
  subspace?: SubspaceComposerContext | null;
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
    {children}
  </Text>
);

export const PostComposer = (props: PostComposerProps) => {
  const { onPosted, parentId, onClose, editPost, subspace } = props;

  const isComment = !!parentId;
  const isEdit = !!editPost;
	// New uploads must mint the purpose their target's bound set carries: the
	// PATCH attachment sync binds purpose 'comment' drafts when editing a rich
	// comment (comments-are-posts), and purpose 'post' everywhere else.
	const attachmentPurpose = isComment || (isEdit && (editPost?.thingtime || []).includes('comment')) ? 'comment' : 'post';

  const api = useApi();
	const user = useCurrentUser();
  const lopu = useLopu();
  const { getThingtime, setThingtime, loading: thingtimeLoading, events } = useThingtime();

  const [expanded, setExpanded] = React.useState(isComment || isEdit);
	// Post-type badges are additive TOGGLES, not exclusive tabs: Text is the
	// always-on base and each toggle switches its field group on top. Edit mode
	// seeds them from whatever the post already carries.
	const [photosOn, setPhotosOn] = React.useState(
		isEdit && (editPost!.type === 'image' || (editPost!.images?.length ?? 0) > 0 || (editPost!.attachments?.length ?? 0) > 0)
  );
  const [marketOn, setMarketOn] = React.useState(isEdit && (editPost!.type === 'marketplace' || !!editPost!.listing));
  const [thingOn, setThingOn] = React.useState(isEdit && editPost!.type === 'thingtime');
  // Poll is the one EXCLUSIVE badge: a poll post's thing IS the poll, so it
  // owns the thing slot the other groups build into. Compose-only — an
  // existing poll edits through the Things badge, as its thing.
  const [pollOn, setPollOn] = React.useState(false);
  // poll mode: the main text box is the question; these are the option rows
  const [pollOptions, setPollOptions] = React.useState<string[]>(['', '']);
  const [postEditorValue, setPostEditorValue] = React.useState<EditorJsDoc>(() =>
    isEditorJsDoc(editPost?.richText)
      ? editPost.richText
      : { kind: 'rich-text', blocks: textToBlocks(editPost?.text || '') }
  );
  const text = blocksToText(postEditorValue.blocks);
  const [title, setTitle] = React.useState(editPost?.listing?.title || '');
  const [price, setPrice] = React.useState(editPost?.listing ? String(editPost.listing.price) : '');
  const [currency, setCurrency] = React.useState(editPost?.listing?.currency || 'AUD');
  const [category, setCategory] = React.useState<MarketplaceCategory>(editPost?.listing?.category || 'other');
  const [condition, setCondition] = React.useState<string>(editPost?.listing?.condition || '');
  const [listingLocation, setListingLocation] = React.useState(editPost?.listing?.location || '');
  const [tagsInput, setTagsInput] = React.useState(editPost?.tags?.join(', ') || '');
  const [visibility, setVisibility] = React.useState<PostVisibility>(editPost?.visibility || 'public');
  // subspace vocabulary: headline + destination + flair. Locked to the page's
  // subspace when one is passed; otherwise the feed composer offers the
  // viewer's joined subspaces (lazy-loaded on first expand).
  const [postTitle, setPostTitle] = React.useState(editPost?.title || '');
  const [subspaceId, setSubspaceId] = React.useState<string | null>(editPost?.subspace?.id || subspace?.id || null);
  const [flairId, setFlairId] = React.useState<string | null>(editPost?.flair?.id || null);
  const [mySubspaces, setMySubspaces] = React.useState<SubspaceComposerContext[] | null>(null);
	// gallery layout (crystal.mediaLayout): auto = masonry default, stored null
	const [layoutMode, setLayoutMode] = React.useState<ComposerLayoutMode>(
		editPost?.mediaLayout?.mode === 'rows' ? 'rows' : editPost?.mediaLayout?.mode === 'grid' ? 'grid' : 'auto'
	);
	const [layoutPattern, setLayoutPattern] = React.useState<number[]>(
		editPost?.mediaLayout?.mode === 'rows' && editPost.mediaLayout.pattern?.length ? [...editPost.mediaLayout.pattern] : [1, 2]
	);
	const [layoutColumns, setLayoutColumns] = React.useState(
		editPost?.mediaLayout?.mode === 'grid' && editPost.mediaLayout.columns ? editPost.mediaLayout.columns : 3
	);
	const [layoutSpans, setLayoutSpans] = React.useState<Record<string, MediaLayoutSpan>>(
		editPost?.mediaLayout?.mode === 'grid' && editPost.mediaLayout.spans ? { ...editPost.mediaLayout.spans } : {}
	);
  const [posting, setPosting] = React.useState(false);
	const [submissionUncertain, setSubmissionUncertain] = React.useState(false);
	const [attachmentSnapshot, setAttachmentSnapshot] = React.useState<AttachmentComposerSnapshot>(EMPTY_ATTACHMENT_SNAPSHOT);

  // the thing edits in a bottom-sheet modal (nested comment composers can't
  // host a full editor inline, and mobile needs the room)
  const [thingModalOpen, setThingModalOpen] = React.useState(false);
  const editorApiRef = React.useRef<{ popOutDuplicate: () => void } | null>(null);
	// the Box around the body editor — MentionAutocomplete watches typing inside
	// it and inserts `@username ` at the caret (posts and comments both)
	const editorBoxRef = React.useRef<HTMLDivElement | null>(null);
	const attachmentComposerRef = React.useRef<AttachmentComposerHandle | null>(null);
	const postTextEditorRef = React.useRef<LongTextEditorHandle | null>(null);
	// A stable client id turns a lost POST response into a safely reconcilable
	// read. It is rotated only after the draft is definitively committed/reset.
	const pendingPostSubmissionRef = React.useRef<PendingPostSubmission | null>(null);
	React.useEffect(() => {
		pendingPostSubmissionRef.current = null;
		setSubmissionUncertain(false);
	}, [user?.id]);
  const handleEditorApi = React.useCallback((api: { popOutDuplicate: () => void } | null) => {
    editorApiRef.current = api;
  }, []);

  // bumping the session remounts the block editor with a clean document
  // (while mounted, the editor owns the text)
  const [composerSession, setComposerSession] = React.useState(0);

  // edit mode: the thing to seed the draft branch with, captured at mount so
  // the seed effect's deps stay constant
  const editSeedRef = React.useRef(editPost?.thing || null);

	// edit mode: the post's existing attachments, reorderable in place. Saving
	// sends the full desired id list (this ordered set plus any new uploads)
	// whenever the order changed or new media joined — the PATCH attachment
	// sync re-stamps order and binds the additions.
	const editAttachmentsSeedRef = React.useRef<PublicAttachment[]>(
		(editPost?.attachments || []).flatMap((attachment) => {
			const normalized = normalizePublicAttachment(attachment);
			return normalized ? [normalized] : [];
		})
	);
	const [editAttachments, setEditAttachments] = React.useState<PublicAttachment[]>(editAttachmentsSeedRef.current);
	const removeExistingAttachment = React.useCallback(
		(attachment: PublicAttachment) => {
			const originalIndex = editAttachments.findIndex((entry) => entry.id === attachment.id);
			const originalSpan = layoutSpans[attachment.id];
			setEditAttachments((current) => current.filter((entry) => entry.id !== attachment.id));
			setLayoutSpans(
				(current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== attachment.id)) as Record<string, MediaLayoutSpan>
			);
			api.v1.attachments.remove({ id: attachment.id, targetId: editPost?.id }).catch((error: any) => {
				setEditAttachments((current) => {
					if (current.some((entry) => entry.id === attachment.id)) return current;
					const restored = [...current];
					restored.splice(Math.max(0, Math.min(originalIndex, restored.length)), 0, attachment);
					return restored;
				});
				if (originalSpan) setLayoutSpans((current) => ({ ...current, [attachment.id]: originalSpan }));
				lopu({ title: error?.error || `Could not delete ${attachment.filenamePreview || attachment.name} 😞`, status: 'error' });
			});
		},
		[api, editAttachments, editPost?.id, layoutSpans, lopu]
	);
	const remainingSeedAttachments = editAttachmentsSeedRef.current.filter((seed) =>
		editAttachments.some((attachment) => attachment.id === seed.id)
	);
	const editAttachmentOrderChanged =
		isEdit &&
		editAttachments.length === remainingSeedAttachments.length &&
		editAttachments.some((attachment, index) => attachment.id !== remainingSeedAttachments[index].id);

	// explicit comma-separated tags first, then #hashtags typed inline in the
	// body (the literal #text stays in the post — PostCard linkifies it);
	// canonicalPostTags dedupes the merge and enforces the 12-tag/40-char caps.
	// Poll questions keep their hashtags too — the question renders on the card.
	const parsedTags = canonicalPostTags([...tagsInput.split(','), ...extractInlineHashtags(text)]);

	// poll mode: trimmed, bounded, non-empty option labels in row order
	const parsedPollOptions = pollOptions.map((option) => option.trim().slice(0, MAX_POLL_OPTION_CHARS)).filter(Boolean);


  // this composer's session-scoped draft home (fresh per mount — see
  // DRAFT_ROOT_KEY above). State, not a const: renaming the draft's root key
  // in the editor emits 'path-renamed' and the binding follows.
  const [draftSessionId] = React.useState(() => `s${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`);
  const [draftPath, setDraftPath] = React.useState(`${DRAFT_TMP_KEY}.${draftSessionId}.${DRAFT_ROOT_KEY}`);

  React.useEffect(() => {
    const subscription = (events as any)?.subscribe?.((event: any) => {
      if (event?.type !== 'path-renamed' || typeof event.from !== 'string' || typeof event.to !== 'string') return;
			setDraftPath((prev) => (prev === event.from || prev.startsWith(`${event.from}.`) ? `${event.to}${prev.slice(event.from.length)}` : prev));
    });
    return () => {
      subscription?.unsubscribe?.();
    };
  }, [events]);

  // read the draft only when the Things toggle is on (this render path runs
  // per keystroke)
  const draftThing = thingOn ? getThingtime(draftPath) : null;
  const draftReady = !!draftThing && typeof draftThing === 'object' && !Array.isArray(draftThing);

  // Seed ONCE per mount, post-hydration: rewrite the tmp branch keeping any
  // user-authored keys, dropping only prior composer sessions (abandoned
  // drafts in the persisted blob), and starting this one clean. The once-guard
  // matters — setThingtime/getThingtime change identity on every store write,
  // and a re-running seed used to clobber the draft right after a change-type
  // action turned it into a non-object (string/boolean/…).
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || thingtimeLoading || !thingOn || !expanded) return;
    seededRef.current = true;
    const currentTmp = getThingtime(DRAFT_TMP_KEY);
    const preserved: Record<string, unknown> = {};
    if (currentTmp && typeof currentTmp === 'object' && !Array.isArray(currentTmp)) {
      for (const [key, value] of Object.entries(currentTmp as Record<string, unknown>)) {
        if (!COMPOSER_SESSION_KEY.test(key)) preserved[key] = value;
      }
    }
    // seed the session BRANCH only — the draft value itself starts undefined,
    // so the editor opens on a truly blank "Imagine.." slate instead of an
    // empty object rendering as {} chrome. Editing an existing thingtime post
    // seeds the draft with the post's thing as of mount (editSeedRef).
    //
    // tabLocal because this REPLACES the whole `tmp` branch and the pruning
    // above cannot tell an abandoned persisted session from another tab's live
    // one — every `s<hex>` key is dropped. Broadcast, that lands on a peer as
    // "your composer session no longer exists" and destroys a post someone is
    // part-way through typing there. Pruning stale sessions out of the
    // persisted blob is this tab's own housekeeping; `preserved` only copies
    // user-authored `tmp` keys through unchanged, so nothing a peer needs is
    // withheld by keeping it off the wire.
    setThingtime(
      DRAFT_TMP_KEY,
      {
        ...preserved,
        [draftSessionId]: editSeedRef.current ? { [DRAFT_ROOT_KEY]: editSeedRef.current } : {}
      },
      // Passing options replaces setThingtime's default object, so restate the
      // namespace this write has always used rather than silently dropping it.
      { namespace: 'default', tabLocal: true }
    );
    // `thingOn` (not `type`): this branch's guard above reads `thingOn`, and the
    // derived `type` const is declared further down, so naming it here would be
    // a TDZ ReferenceError during render.
  }, [thingOn, expanded, thingtimeLoading, getThingtime, setThingtime, draftSessionId]);

  // which optional field groups are in play — exactly the live toggles
  const showPhotos = photosOn;
  const showListing = marketOn;

  const listingValid =
		title.trim().length > 0 && price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) >= 0 && !!currency && !!category;

	// every attachment going out with this post: in edit mode the existing
	// bound set (reorderable) plus any NEW uploads from the live panel — an
	// attachment-only post must stay saveable while its media is reordered
	const composerAttachments = isEdit ? [...editAttachments, ...attachmentSnapshot.attachments] : attachmentSnapshot.attachments;
	const hasReadyAttachment = composerAttachments.length > 0;
	const hasReadyVisualAttachment = composerAttachments.some((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video');

	// gallery-layout picker visibility + the tier-2 per-tile size badge (grid)
	const visualLayoutCount = composerAttachments.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video').length;
	const layoutSpanBadge = React.useCallback(
		(attachment: PublicAttachment) =>
			attachment.mediaKind === 'image' || attachment.mediaKind === 'video' ? (
				<SpanCycleButton
					name={attachment.filenamePreview || attachment.name}
					span={layoutSpans[attachment.id] || 'normal'}
					onChange={(next) => setLayoutSpans((current) => ({ ...current, [attachment.id]: next }))}
				/>
			) : null,
		[layoutSpans]
	);

	// The stored crystal type, derived from the live toggles. Photos alone
	// counts only once visual media actually exists (uploaded OR linked) — a
	// files-only or empty media panel stays a valid text post. Poll wins
	// outright: it owns the thing slot, so its badge switches the others off.
	const type: ComposeMode = pollOn
		? 'poll'
		: thingOn
		? 'thingtime'
		: marketOn
		? 'marketplace'
		: photosOn && hasReadyVisualAttachment
		? 'image'
		: 'text';

	const contentValid =
    type === 'text'
			? text.trim().length > 0 || hasReadyAttachment
      : type === 'image'
			? hasReadyVisualAttachment
        : type === 'thingtime'
			? draftReady && Object.keys(draftThing).length > 0 && thingHasContent(draftThing) && (!marketOn || listingValid)
			: type === 'poll'
				? text.trim().length > 0 && parsedPollOptions.length >= MIN_POLL_OPTIONS
				: listingValid;
	const valid = contentValid && !attachmentSnapshot.blocking;

  // the viewer's joined subspaces for the destination picker — loaded once,
  // only for a top-level composer with no page-provided subspace
  React.useEffect(() => {
    if (!expanded || isComment || subspace || mySubspaces || !user) return;
    let cancelled = false;
    api.v1.subspaces
      .list({ mine: true, limit: 50 })
      .then((resp: any) => {
        if (cancelled) return;
        setMySubspaces(((resp?.subspaces || []) as PublicSubspace[]).filter((entry) => entry.viewer?.canPost).map(composerContextOf));
      })
      .catch(() => {
        if (!cancelled) setMySubspaces([]);
      });
    return () => {
      cancelled = true;
    };
    // api.v1.subspaces.list is a stable useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, isComment, subspace, mySubspaces, user?.id]);
  const activeSubspace: SubspaceComposerContext | null =
    subspace || (subspaceId ? mySubspaces?.find((entry) => entry.id === subspaceId) || null : null);
  const flairOptions = (activeSubspace?.flairs || []).filter((flair) => !flair.modOnly || activeSubspace?.canModerate);

  const reset = () => {
		pendingPostSubmissionRef.current = null;
		setSubmissionUncertain(false);
    setExpanded(isComment);
    setPhotosOn(false);
    setMarketOn(false);
    setThingOn(false);
    setPollOn(false);
    setPollOptions(['', '']);
    setPostEditorValue({ kind: 'rich-text', blocks: textToBlocks('') });
    setComposerSession((session) => session + 1);
    setTitle('');
    setPrice('');
    setCurrency('AUD');
    setCategory('other');
    setCondition('');
    setListingLocation('');
    setTagsInput('');
    setVisibility('public');
    setPostTitle('');
    setFlairId(null);
    if (!subspace) setSubspaceId(null);
		setAttachmentSnapshot(EMPTY_ATTACHMENT_SNAPSHOT);
  };

  const handlePost = async () => {
		if (!valid || posting || attachmentSnapshot.blocking) return;
		setPosting(true);
		setThingModalOpen(false);
		let submittedEditorValue = postEditorValue;
		if (!pendingPostSubmissionRef.current) {
			try {
				submittedEditorValue = await capturePostEditorValue(postTextEditorRef.current, postEditorValue);
				setPostEditorValue(submittedEditorValue);
			} catch {
				setPosting(false);
				lopu({ title: 'Rich text is still saving — please try again ✍️', status: 'error' });
				return;
			}
		}

		const currentAttachmentIds = [...attachmentSnapshot.attachmentIds];
		const currentPostShareId = crypto.randomUUID();
		// polls publish as thingtime posts; the question lives on the thing (the
		// poll card renders it), so the post text stays empty — no double render
		const apiType: PostType = type === 'poll' ? 'thingtime' : type;
		// the captured snapshot, not the last-rendered `text` — capture flushes
		// keystrokes Editor.js had not committed yet
		const submittedText = blocksToText(submittedEditorValue.blocks).trim();
		const canonicalText = type === 'poll' ? '' : submittedText;
		const canonicalListing = showListing
			? {
					title: title.trim().slice(0, 120),
					price: Math.round(Number(price) * 100) / 100,
					currency: currency.trim().toUpperCase(),
					category,
					condition: condition === 'new' || condition === 'used' ? condition : null,
					location: listingLocation.trim().slice(0, 120) || null,
					sold: false
			  }
			: null;
		// URL media is linked ATTACHMENTS now — new posts never write
		// crystal.images, and saving an edit clears the legacy list (its URLs
		// migrate into linked attachments via the seed mints below).
		const canonicalImages: string[] = [];
		// a poll's thing IS the poll: the question rides the thing (the poll
		// kind renderer draws it above the live tally), which is why the post
		// text stays empty for polls
		const canonicalThing =
			type === 'thingtime'
				? draftThing
				: type === 'poll'
					? { kind: 'poll', question: submittedText, options: parsedPollOptions }
					: null;
		const canonicalRichText: EditorJsDoc | null = canonicalText
			? { ...submittedEditorValue, kind: 'rich-text' }
			: null;
		if (!pendingPostSubmissionRef.current && type === 'text' && !canonicalText && !hasReadyAttachment) {
			setPosting(false);
			return;
		}
		// gallery layout: auto stores null; spans are pruned to the visual
		// attachments actually going out with this post
		const visualIdsForLayout = composerAttachments
			.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video')
			.map((attachment) => attachment.id);
		const prunedSpans = Object.fromEntries(
			Object.entries(layoutSpans).filter(([id, span]) => span !== 'normal' && visualIdsForLayout.includes(id))
		) as Record<string, MediaLayoutSpan>;
		const canonicalMediaLayout: PostMediaLayout | null =
			visualIdsForLayout.length < 2 || layoutMode === 'auto'
				? null
				: layoutMode === 'rows'
				? { mode: 'rows', pattern: layoutPattern }
				: { mode: 'grid', columns: layoutColumns, ...(Object.keys(prunedSpans).length ? { spans: prunedSpans } : {}) };
		const canonicalTags = [...parsedTags, ...(canonicalListing ? [canonicalListing.category] : [])].filter(
			(tag, index, all) => all.indexOf(tag) === index
		);
		const currentCommittedExpectation =
			!isComment && currentPostShareId && user?.id
				? {
						shareId: currentPostShareId,
						ownerId: user.id,
						crystal: {
							type: apiType,
							text: canonicalText,
							richText: canonicalRichText,
							images: canonicalImages,
							listing: canonicalListing,
							thing: canonicalThing,
							mediaLayout: canonicalMediaLayout
						},
						tags: canonicalTags,
						visibility,
						attachmentIds: currentAttachmentIds
				  }
				: null;
		const currentPayload: Record<string, unknown> = {
			type: apiType,
			text: canonicalText,
			richText: canonicalRichText,
			tags: parsedTags
		};
		if (currentPostShareId) currentPayload.shareId = currentPostShareId;
      // comments inherit the thread root's audience server-side
		if (!isComment) currentPayload.visibility = visibility;
		// subspace vocabulary rides the crystal: a headline, the destination
		// subspace, and its flair (the server re-validates posting rights)
		if (!isComment) {
			if (postTitle.trim()) currentPayload.title = postTitle.trim();
			if (subspaceId) {
				currentPayload.subspaceId = subspaceId;
				if (flairId) currentPayload.flairId = flairId;
			}
		}
		if (currentAttachmentIds.length > 0) currentPayload.attachmentIds = currentAttachmentIds;
		if (showPhotos) currentPayload.images = canonicalImages;
		if (apiType === 'thingtime') currentPayload.thing = canonicalThing;
		if (showListing) currentPayload.listing = canonicalListing;
		if (canonicalMediaLayout) currentPayload.mediaLayout = canonicalMediaLayout;

		if (!pendingPostSubmissionRef.current && currentPostShareId && (isComment || currentCommittedExpectation)) {
			pendingPostSubmissionRef.current = {
				shareId: currentPostShareId,
				// Thingtime editor writes may mutate nested draft objects in place.
				// Clone the JSON-safe submission so retry/reconciliation cannot drift.
				payload: clonePostJson(currentPayload),
				expectation: clonePostJson(currentCommittedExpectation),
				attachmentIds: currentAttachmentIds,
				postType: apiType,
				unknownOutcome: false
        };
      }
		const pendingSubmission = pendingPostSubmissionRef.current;
		const postShareId = pendingSubmission?.shareId ?? null;
		const committedExpectation = pendingSubmission?.expectation ?? null;
		const payload = pendingSubmission?.payload ?? currentPayload;
		const attachmentIds = pendingSubmission?.attachmentIds ?? currentAttachmentIds;
		const submittedPostType = pendingSubmission?.postType ?? type;

		const finishPost = (created: PublicPost) => {
			if (attachmentIds.length > 0) {
				// A successful or exactly reconciled save means the server claimed
				// these drafts (create binds in the insert transaction; an edit binds
				// through the PATCH attachment sync). Mark them before reset/close
				// unmounts the uploader so cleanup never deletes now-bound media.
				attachmentComposerRef.current?.markCommitted(attachmentIds);
			}
      lopu({
        title: isEdit ? 'Post updated ✏️' : isComment ? 'Commented 💬' : 'Posted ✨',
        status: 'success',
        duration: 6000
      });
      // the posted thing draft is spent — next thingtime tab starts fresh
      // (reset the whole session branch so the draft value is undefined again,
      // not an empty {} that would render as an object)
      //
      // tabLocal for the same reason the seed above is: `draftSessionId` is
      // minted per mount, so this key names THIS composer's session and no peer
      // has one. Broadcast, it lands in every other tab as a foreign `s<hex>`
      // branch — inert, but persisted into that tab's next full-tree autosave
      // and visible under `tt.tmp` in its tree editor until its own next
      // composer mount happens to prune it. Local clear and persistence are
      // unchanged; only the broadcast is suppressed. Passing options replaces
      // setThingtime's default object, so restate the namespace this write has
      // always used.
			if (submittedPostType === 'thingtime') setThingtime(`${DRAFT_TMP_KEY}.${draftSessionId}`, {}, { namespace: 'default', tabLocal: true });
      // an edit keeps its pre-filled draft — the parent closes the composer
      if (!isEdit) reset();
			onPosted(created);
		};

		try {
			if (isEdit) {
				// full-crystal replace: the server sanitizer rebuilds { type, text,
				// images, listing, thing } per type, so switching type clears the
				// fields that no longer apply. Attachment changes ride along as the
				// full desired id list — the reordered bound set plus the media
				// panel's entries — which the PATCH attachment sync binds/orders.
				// Legacy crystal.images URLs sat in the panel as LOCAL seed entries;
				// mint them into real linked attachments now, in panel order (a
				// failed PATCH afterwards just leaves 24h-TTL drafts behind).
				const resolvedPanelIds = await Promise.all(
					attachmentSnapshot.attachments.map(async (attachment) => {
						if (!isLegacyLinkedSeedId(attachment.id)) return attachment.id;
						if (!attachment.url) throw new Error('linked media url missing');
						const minted = await api.v1.attachments.link({
							url: attachment.url,
							...(attachmentPurpose === 'comment' ? { purpose: 'comment' as const } : {})
						});
						const mintedId = typeof minted?.attachment?.id === 'string' ? minted.attachment.id : '';
						if (!mintedId) throw new Error('linked media mint failed');
						return mintedId;
					})
				);
				const editAttachmentsChanged = resolvedPanelIds.length > 0 || editAttachmentOrderChanged;
				const updated = await api.v1.things.update({
					id: editPost!.id,
					crystal: {
						type,
						text: canonicalText,
						richText: canonicalRichText,
						images: canonicalImages,
						listing: canonicalListing,
						thing: canonicalThing,
						mediaLayout: canonicalMediaLayout,
						// empty/null clear — the sanitizer drops the keys, so a post can
						// lose its title or leave its subspace from here
						title: postTitle.trim(),
						subspaceId: subspaceId || null,
						flairId: subspaceId ? flairId || null : null
					},
					tags: parsedTags,
					visibility,
					...(editAttachmentsChanged ? { attachmentIds: [...editAttachments.map((attachment) => attachment.id), ...resolvedPanelIds] } : {})
				});
				finishPost(updated.post);
			} else {
				const resp = isComment ? await api.v1.things.comment({ id: parentId, ...payload }) : await api.v1.things.create(payload);
				finishPost(isComment ? resp.comment : resp.post);
			}
		} catch (error) {
			let reconciled: PublicPost | null = null;
			const status = Number((error as { status?: unknown } | null)?.status);
			// only a create can be reconciled by shareId read-back; an edit is a
			// full-crystal replace, so retrying it is already safe
			if (!isComment && !isEdit && postShareId && committedExpectation && (hasUnknownMutationOutcome(error) || status === 409)) {
				// The first GET may race a still-committing request. Keep this bounded;
				// if it remains absent, the next click resubmits the SAME shareId and
				// can reconcile the resulting duplicate safely.
				for (const delay of [0, 150, 400]) {
					if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
					try {
						const readBack = await api.v1.things.get({ id: postShareId });
						if (matchesCommittedPostCreate(readBack, committedExpectation)) {
							reconciled = readBack.post as PublicPost;
						}
						break;
					} catch {
						// A not-yet-visible or unavailable read is retried only within the
						// short bounded window above; no server/proxy text reaches the UI.
    }
				}
			}
			if (reconciled) {
				window.dispatchEvent(new Event('thingtime:root-data-refresh'));
				finishPost(reconciled);
			} else {
				const unknownNow = hasUnknownMutationOutcome(error);
				const preserveAmbiguousSubmission = shouldFreezeAmbiguousPostSubmission(unknownNow, status, pendingSubmission?.unknownOutcome === true);
				if (preserveAmbiguousSubmission) {
					// Freeze the immutable first submission. Its id, attachments and payload
					// must not drift while a lost response may still be committing.
					if (unknownNow && pendingPostSubmissionRef.current) {
						pendingPostSubmissionRef.current.unknownOutcome = true;
					}
					setSubmissionUncertain(true);
				} else {
					pendingPostSubmissionRef.current = null;
					setSubmissionUncertain(false);
				}
				lopu({ title: isComment ? 'Comment did not go through 😞' : 'Post did not go through 😞', status: 'error' });
			}
		} finally {
    setPosting(false);
		}
  };

  if (!expanded) {
    return (
      <Flex
        background="var(--tt-card, #ffffff)"
        border={BORDER}
        borderRadius="var(--tt-radius-lg, 16px)"
        boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
        padding={3}
        alignItems="center"
        columnGap={3}
      >
        <UserAvatarCircle size="36px" fontSize="sm" />
        <Box
          as="button"
          type="button"
          flex="1"
          textAlign="left"
          background="var(--tt-surface-alt, #f5f5f7)"
          borderRadius="999px"
          paddingX={4}
          paddingY={2}
          fontSize="sm"
          color={MUTED}
          _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
          onClick={() => setExpanded(true)}
        >
          What's on your mind? ✨
        </Box>
      </Flex>
    );
  }

  return (
    <Flex
			position="relative"
      flexDirection="column"
      rowGap={3}
      background="var(--tt-card, #ffffff)"
      border={BORDER}
      borderRadius="var(--tt-radius-lg, 16px)"
      boxShadow="var(--tt-shadow-card, 0px 1px 2px rgba(22, 22, 26, 0.05))"
      padding={4}
    >
			{(posting || submissionUncertain) && (
				<Flex
					position="absolute"
					inset={0}
					zIndex={20}
					alignItems="center"
					justifyContent="center"
					padding={4}
					borderRadius="inherit"
					background={submissionUncertain && !posting ? 'rgba(255, 255, 255, 0.94)' : 'transparent'}
				>
					{submissionUncertain && !posting && (
						<Flex flexDirection="column" alignItems="center" textAlign="center" rowGap={3} maxWidth="360px">
							<Text fontSize="sm" color={TEXT}>
								Thingtime is still checking whether this exact {isComment ? 'comment' : 'post'} went live. The draft is frozen so retrying cannot
								create a duplicate.
							</Text>
							<Button size="sm" borderRadius={RADIUS_MD} onClick={handlePost}>
								Check and retry safely
							</Button>
						</Flex>
					)}
				</Flex>
			)}
			<Box display="contents" {...((posting || submissionUncertain ? { inert: '' } : {}) as any)}>
      {/* type badges — additive toggles that wrap on narrow screens. Text is
      the always-on base; Photos/Marketplace/Things each switch their field
      group on without deselecting the others, and clicking Text switches
      every extra group off again. Poll is the exception: its thing IS the
      poll, so it is mutually exclusive with the other groups, and it is
      compose-only — an existing poll edits through the Things badge. */}
      <Flex columnGap={1} rowGap={1} alignItems="center" flexWrap="wrap">
					<Button
						size="xs"
						variant="solid"
						borderRadius={RADIUS_SM}
						title="Plain text post — switches the other groups off"
						onClick={() => {
							setPhotosOn(false);
							setMarketOn(false);
							setThingOn(false);
							setPollOn(false);
						}}
					>
						{POST_TYPE_META.text.emoji} {POST_TYPE_META.text.label}
					</Button>
					<Button
						size="xs"
						variant={photosOn ? 'solid' : 'ghost'}
						borderRadius={RADIUS_SM}
						aria-pressed={photosOn}
						title="Add photos, videos and files to this post"
						onClick={() => {
							setPollOn(false);
							setPhotosOn((on) => !on);
						}}
					>
						{POST_TYPE_META.image.emoji} {POST_TYPE_META.image.label}
					</Button>
					<Button
						size="xs"
						variant={marketOn ? 'solid' : 'ghost'}
						borderRadius={RADIUS_SM}
						aria-pressed={marketOn}
						title="Add marketplace listing fields to this post"
						onClick={() => {
							setPollOn(false);
							setMarketOn((on) => !on);
						}}
					>
						{POST_TYPE_META.marketplace.emoji} {POST_TYPE_META.marketplace.label}
					</Button>
					<Button
						size="xs"
						variant={thingOn ? 'solid' : 'ghost'}
						borderRadius={RADIUS_SM}
						aria-pressed={thingOn}
						title="Build a structured thing into this post"
						onClick={() => {
							setPollOn(false);
							setThingOn((on) => !on);
						}}
					>
						{POST_TYPE_META.thingtime.emoji} {POST_TYPE_META.thingtime.label}
					</Button>
					{!isEdit && (
						<Button
							size="xs"
							variant={pollOn ? 'solid' : 'ghost'}
							borderRadius={RADIUS_SM}
							aria-pressed={pollOn}
							title="Ask a question with a poll — the poll is the post's thing"
							onClick={() =>
								setPollOn((on) => {
									if (!on) {
										setPhotosOn(false);
										setMarketOn(false);
										setThingOn(false);
									}
									return !on;
								})
							}
						>
							{COMPOSE_MODE_META.poll.emoji} {COMPOSE_MODE_META.poll.label}
						</Button>
					)}
        <IconButton
          aria-label="Close composer"
          icon={<X size={14} />}
          size="xs"
          variant="ghost"
          color={MUTED}
          marginLeft="auto"
          borderRadius="8px"
						isDisabled={posting}
						onClick={() => {
							if (isComment || isEdit) onClose?.();
							else {
								setExpanded(false);
								setAttachmentSnapshot(EMPTY_ATTACHMENT_SNAPSHOT);
							}
						}}
        />
      </Flex>

      {!isComment && (subspaceId || subspace || postTitle) && (
        <Input
          size="md"
          variant="unstyled"
          fontFamily="heading"
          fontSize="lg"
          fontWeight={700}
          color={INK}
          placeholder={activeSubspace ? `Title for s/${activeSubspace.slug}` : 'Title (optional)'}
          value={postTitle}
          maxLength={300}
          onChange={(event) => setPostTitle(event.target.value)}
          aria-label="Post title"
          data-testid="composer-title"
        />
      )}
      <Flex columnGap={3}>
        <UserAvatarCircle size="36px" fontSize="sm" />
        <Box flex="1" minWidth={0} ref={editorBoxRef}>
          <LongTextEditor
            ref={postTextEditorRef}
            // Editor.js reads its placeholder once at init, so entering/leaving
            // poll mode remounts the editor (the value prop reseeds it) — the
            // question prompt must actually show for polls
            key={`${composerSession}-${type === 'poll' ? 'poll' : 'post'}`}
						value={postEditorValue}
						onValueChange={(next) => {
							if (isEditorJsDoc(next)) setPostEditorValue(next);
						}}
            placeholder={TEXTAREA_PLACEHOLDERS[type]}
            minHeight="72px"
          />
          <MentionAutocomplete containerRef={editorBoxRef} />
        </Box>
      </Flex>

      {/* the thing itself — the real things editor over the draft branch
      (photos and listing field groups toggle on via the type badges above) */}
      {thingOn && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Thing 📦</Eyebrow>

          {/* tappable preview — the real editing happens in the bottom-sheet
          modal (nested comment composers can't host a full editor inline, and
          mobile needs the room) */}
          <Box
            as="button"
            type="button"
            textAlign="left"
            width="100%"
            minHeight="88px"
            border={BORDER}
            borderRadius={RADIUS_MD}
            background="var(--tt-surface, #fafafb)"
            padding={3}
            _hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
            onClick={() => setThingModalOpen(true)}
          >
            {thingtimeLoading ? (
              <Text fontSize="sm" color={MUTED}>
                Summoning your thing… 🌀
              </Text>
            ) : draftReady && thingHasContent(draftThing) ? (
              <ThingView thing={draftThing as Record<string, any>} compact />
            ) : (
              <Text fontSize="md" color={MUTED}>
                Imagine.. 🌀
              </Text>
            )}
            <Text fontSize="10px" color={MUTED} paddingTop={2}>
              Tap to build your thing — fields, nested objects, arrays, whatever it needs ✨
            </Text>
          </Box>

          {/* bottom-sheet editor: flush left/right/bottom, padded + rounded
          top on mobile; a centered sheet on desktop */}
						<Modal isOpen={thingModalOpen} onClose={() => setThingModalOpen(false)} size="full" motionPreset="slideInBottom" autoFocus={false}>
            <ModalOverlay background="rgba(20, 20, 26, 0.45)" />
            <ModalContent
              position="fixed"
              left={0}
              right={0}
              bottom={0}
              top={['calc(var(--thingtime-safe-area-top, 0px) + 44px)', '8vh']}
              marginY={0}
              marginX={[0, 'auto']}
              width="100%"
              maxWidth={['100%', '680px']}
              // size="full" forces 100vh — pin the height to the anchored gap
              // so the sheet ends exactly at the bottom edge
              height={['calc(100dvh - var(--thingtime-safe-area-top, 0px) - 44px)', '92vh']}
              minHeight={0}
              borderTopRadius="var(--tt-radius-lg, 16px)"
              borderBottomRadius={0}
              overflow="hidden"
              display="flex"
              flexDirection="column"
              background="var(--tt-card, #ffffff)"
            >
								<Flex alignItems="center" columnGap={2} paddingX={4} paddingY={3} borderBottom={BORDER} flexShrink={0}>
                <Eyebrow>Thing 📦</Eyebrow>
                <Flex marginLeft="auto" columnGap={1} alignItems="center">
                  <IconButton
                    aria-label="Pop the editor out"
                    icon={<PictureInPicture2 size={13} />}
                    size="xs"
                    variant="ghost"
                    color={MUTED}
                    borderRadius="8px"
                    title="Pop out a floating, resizable, splittable editor window"
                    onClick={() => editorApiRef.current?.popOutDuplicate()}
                  />
                  <Button size="xs" borderRadius={RADIUS_SM} onClick={() => setThingModalOpen(false)}>
                    Done ✨
                  </Button>
                </Flex>
              </Flex>
              <Box flex="1" minHeight={0}>
                {!thingtimeLoading && thingModalOpen && (
                  <EditorSplit initialPath={draftPath} embedded chromeless height="100%" onApi={handleEditorApi} />
                )}
              </Box>
            </ModalContent>
          </Modal>
        </Flex>
      )}

      {/* poll options — the main text box above is the question */}
      {type === 'poll' && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Options 🗳️</Eyebrow>
          {pollOptions.map((option, idx) => (
            <Flex key={idx} columnGap={2} alignItems="center">
              <Input
                size="sm"
                borderRadius={RADIUS_SM}
                placeholder={`Option ${idx + 1}`}
                maxLength={MAX_POLL_OPTION_CHARS}
                value={option}
                onChange={(event) => {
                  const next = [...pollOptions];
                  next[idx] = event.target.value;
                  setPollOptions(next);
                }}
              />
              {pollOptions.length > MIN_POLL_OPTIONS && (
                <IconButton
                  aria-label={`Remove option ${idx + 1}`}
                  icon={<X size={13} />}
                  size="xs"
                  variant="ghost"
                  color={MUTED}
                  borderRadius="8px"
                  flexShrink={0}
                  onClick={() => setPollOptions(pollOptions.filter((_entry, index) => index !== idx))}
                />
              )}
            </Flex>
          ))}
          {pollOptions.length < MAX_POLL_OPTIONS && (
            <Button
              size="xs"
              variant="ghost"
              alignSelf="flex-start"
              borderRadius={RADIUS_SM}
              leftIcon={<Plus size={13} />}
              onClick={() => setPollOptions([...pollOptions, ''])}
            >
              Add option
            </Button>
          )}
          <Text fontSize="10px" color={MUTED}>
            {MIN_POLL_OPTIONS}–{MAX_POLL_OPTIONS} options · voters pick one and can change or remove their vote ✨
          </Text>
        </Flex>
      )}

      {/* photos + media — the whole media suite lives under the Photos
      toggle: the post's existing bound media (edit mode, reorderable), the
      secure uploader (live in edit mode too — new uploads bind through the
      PATCH attachment sync), the gallery layout controls, and the linked
      image URL adder BELOW the uploader grid (type a URL, hit Add, tile
      lands in the grid, field clears for the next one). */}
      {showPhotos && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Photos {type !== 'image' ? '(optional) ' : ''}🖼️</Eyebrow>

					{user && (
						<AttachmentComposer
							ref={attachmentComposerRef}
							key={`attachments-${user.id}-${composerSession}`}
							ownerId={user.id}
							disabled={posting || submissionUncertain}
							purpose={attachmentPurpose}
							ariaLabel={attachmentPurpose === 'comment' ? 'Comment attachments' : 'Post attachments'}
							remainingBytes={user.storage.remainingBytes}
							storageStatus={user.storage.status}
							onChange={setAttachmentSnapshot}
							allowLinkedUrls
							// legacy URL-images seed as linked tiles, capped so bound
							// attachments + seeds can never exceed the server's per-post
							// limit (a pathological >25-media legacy post drops overflow
							// URLs, matching the old composer's silent client-side filter)
							initialLinkedSeeds={
								isEdit ? (editPost?.images || []).slice(0, Math.max(0, MAX_POST_ATTACHMENTS - editAttachmentsSeedRef.current.length)) : undefined
							}
							tileExtras={layoutMode === 'grid' ? layoutSpanBadge : undefined}
								existingAttachments={isEdit ? editAttachments : undefined}
								onExistingChange={isEdit ? setEditAttachments : undefined}
								onExistingRemove={isEdit ? removeExistingAttachment : undefined}
						/>
					)}

					{/* gallery layout (crystal.mediaLayout) — meaningful from 2 visual
					attachments; Auto keeps the masonry default (stored null) */}
					{visualLayoutCount >= 2 && (
						<MediaLayoutPicker
							mode={layoutMode}
							onMode={setLayoutMode}
							pattern={layoutPattern}
							onPattern={setLayoutPattern}
							columns={layoutColumns}
							onColumns={setLayoutColumns}
							imageCount={visualLayoutCount}
						/>
					)}

					{/* tier 3: the grid canvas — live preview with drag-resize handles */}
					{visualLayoutCount >= 2 && layoutMode === 'grid' && (
						<MediaLayoutCanvas
								attachments={composerAttachments.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video')}
							columns={layoutColumns}
							onColumns={setLayoutColumns}
							spans={layoutSpans}
							onSpanChange={(id, span) => setLayoutSpans((current) => ({ ...current, [id]: span }))}
							disabled={posting || submissionUncertain}
						/>
					)}
						{visualLayoutCount >= 2 && layoutMode !== 'grid' && (
							<MediaLayoutFinalPreview
								attachments={composerAttachments.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video')}
								mode={layoutMode}
								pattern={layoutPattern}
							/>
						)}
            </Flex>
      )}

      {/* marketplace listing */}
      {showListing && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Listing 🏪</Eyebrow>
          <Input
            size="sm"
            borderRadius={RADIUS_SM}
            placeholder="What are you selling?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Flex columnGap={2}>
            <Input
              size="sm"
              type="number"
              min={0}
              borderRadius={RADIUS_SM}
              placeholder="Price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            <Select
              size="sm"
              width="110px"
              flexShrink={0}
              borderRadius={RADIUS_SM}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Flex>
          <Flex columnGap={2}>
            <Select
              size="sm"
              borderRadius={RADIUS_SM}
              value={category}
              onChange={(event) => setCategory(event.target.value as MarketplaceCategory)}
            >
              {(Object.keys(MARKETPLACE_CATEGORY_META) as MarketplaceCategory[]).map((key) => (
                <option key={key} value={key}>
                  {MARKETPLACE_CATEGORY_META[key].emoji} {MARKETPLACE_CATEGORY_META[key].label}
                </option>
              ))}
            </Select>
							<Select size="sm" borderRadius={RADIUS_SM} value={condition} onChange={(event) => setCondition(event.target.value)}>
              <option value="">Condition…</option>
              <option value="new">New ✨</option>
              <option value="used">Used ♻️</option>
            </Select>
          </Flex>
          <Input
            size="sm"
            borderRadius={RADIUS_SM}
            placeholder="Location 📍 (optional)"
            value={listingLocation}
            onChange={(event) => setListingLocation(event.target.value)}
          />
        </Flex>
      )}

      {/* tags */}
      <Flex flexDirection="column" rowGap={2}>
        <Input
          size="sm"
          borderRadius={RADIUS_SM}
          placeholder="Tags, comma separated 🏷️"
          value={tagsInput}
          onChange={(event) => setTagsInput(event.target.value)}
        />
        {parsedTags.length > 0 && (
          <Flex columnGap={1} rowGap={1} flexWrap="wrap">
            {parsedTags.map((tag) => (
              <Box
                key={tag}
                fontSize="xs"
                background="var(--tt-surface-alt, #f5f5f7)"
                color={TEXT}
                borderRadius="999px"
                paddingX={2}
                paddingY="2px"
              >
                #{tag}
              </Box>
            ))}
          </Flex>
        )}
      </Flex>

      {/* footer: subspace destination + flair + circle + post (comments
      inherit the thread's circle) */}
      <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap" borderTop={BORDER} paddingTop={3}>
        {!isComment && subspace && (
          <Flex
            alignItems="center"
            columnGap={1}
            fontSize="xs"
            fontWeight={700}
            color={INK}
            border={BORDER}
            borderRadius="999px"
            paddingX={2}
            height="32px"
            title={`Posting in s/${subspace.slug}`}
            data-testid="composer-subspace"
          >
            <Text as="span">{subspace.icon || '🪐'}</Text>
            <Text as="span" fontFamily="mono" fontWeight={600}>
              s/{subspace.slug}
            </Text>
          </Flex>
        )}
        {!isComment && !subspace && user && (
          <Select
            size="sm"
            width="170px"
            borderRadius={RADIUS_SM}
            value={subspaceId || ''}
            onChange={(event) => {
              setSubspaceId(event.target.value || null);
              setFlairId(null);
            }}
            aria-label="Post into a subspace"
            data-testid="composer-subspace-select"
          >
            <option value="">🪐 No subspace</option>
            {subspaceId && mySubspaces && !mySubspaces.some((entry) => entry.id === subspaceId) && editPost?.subspace && (
              <option value={subspaceId}>s/{editPost.subspace.slug}</option>
            )}
            {(mySubspaces || []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.icon || '🪐'} s/{entry.slug}
              </option>
            ))}
            {mySubspaces === null && <option disabled>Loading…</option>}
          </Select>
        )}
        {!isComment && activeSubspace && flairOptions.length > 0 && (
          <Select
            size="sm"
            width="150px"
            borderRadius={RADIUS_SM}
            value={flairId || ''}
            onChange={(event) => setFlairId(event.target.value || null)}
            aria-label="Post flair"
            data-testid="composer-flair-select"
          >
            <option value="">No flair</option>
            {flairOptions.map((flair) => (
              <option key={flair.id} value={flair.id}>
                {flair.emoji ? `${flair.emoji} ` : ''}
                {flair.label}
              </option>
            ))}
          </Select>
        )}
        {!isComment && (
          <Select
            size="sm"
            width="150px"
            borderRadius={RADIUS_SM}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as PostVisibility)}
            aria-label="Who can see this post"
          >
            {(Object.keys(CIRCLE_META) as PostVisibility[]).map((key) => (
              <option key={key} value={key}>
                {CIRCLE_META[key].emoji} {CIRCLE_META[key].label}
              </option>
            ))}
          </Select>
        )}
        <Button
          marginLeft="auto"
          size="sm"
          color="white"
          fontFamily="heading"
          fontWeight={600}
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
          _hover={{ opacity: 0.9 }}
          borderRadius={RADIUS_MD}
						isDisabled={!valid || attachmentSnapshot.blocking}
          isLoading={posting}
          onClick={handlePost}
        >
          {isEdit ? 'Save ✨' : isComment ? 'Comment 💬' : 'Post ✨'}
        </Button>
      </Flex>
			</Box>
    </Flex>
  );
};
