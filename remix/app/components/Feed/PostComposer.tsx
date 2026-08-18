import React from 'react';
import { Box, Button, Flex, IconButton, Input, Modal, ModalContent, ModalOverlay, Select, Text } from '@chakra-ui/react';
import { PictureInPicture2, Plus, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import { AttachmentReorderGallery } from '~/components/Attachments/AttachmentReorderGallery';
import type { AttachmentComposerSnapshot, PublicAttachment } from '~/components/Attachments/attachmentTypes';
import {
	canonicalPostTags,
	matchesCommittedPostCreate,
	normalizePublicAttachment,
	shouldFreezeAmbiguousPostSubmission,
	type CommittedPostExpectation
} from '~/components/Attachments/attachmentUiCore';
import { LongTextEditor } from '~/components/Editor/LongTextEditor';
import { useLopu } from '~/components/Lopu/useLopu';
import { LinkedImageGallery } from '~/components/Media/LinkedImageGallery';
import { canonicalLinkedImageUrls, createLinkedImageItem, type LinkedImageItem } from '~/components/Media/mediaGalleryCore';
import { UserAvatarCircle } from '~/components/Nav/Drawer/DrawerContent';
import { EditorSplit } from '~/components/Thingtime/EditorSplit';
import { ThingView } from '~/components/Thingtime/ThingView';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { RAINBOW } from '~/theme/rainbow';
import { extractInlineHashtags } from './hashtags';
import { CIRCLE_META, MARKETPLACE_CATEGORY_META, POST_TYPE_META } from './feedTypes';
import type { MarketplaceCategory, PostType, PostVisibility, PublicPost } from './feedTypes';

// "What's on your mind?" composer. Collapsed it's a one-line prompt beside
// the viewer's avatar; expanded it grows type tabs (text/photos/marketplace/
// thingtime), a block editor for the body (Editor.js — headings, lists,
// quotes, checklists serialise to a plain string), image URL rows, listing
// fields, tag chips and a circle picker. The thingtime tab mounts the real
// things editor (an embedded single-window EditorSplit) over the "New Thing"
// draft branch of the global thingtime store (localforage-persisted, so
// half-built things survive reloads) — height-draggable, and poppable into a
// floating, resizable, splittable editor window that stays live-synced with
// the in-post one. Thingtime posts can toggle on the Photos and Marketplace
// field groups too. Posts through api.v1.things.create and hands the
// returned post to onPosted for prepending.

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
  thingtime: 'Say something about this thing… 🌀 (optional)',
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
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
    {children}
  </Text>
);

export const PostComposer = (props: PostComposerProps) => {
  const { onPosted, parentId, onClose, editPost } = props;

  const isComment = !!parentId;
  const isEdit = !!editPost;

  const api = useApi();
	const user = useCurrentUser();
  const lopu = useLopu();
  const { getThingtime, setThingtime, loading: thingtimeLoading, events } = useThingtime();

  const [expanded, setExpanded] = React.useState(isComment || isEdit);
  const [type, setType] = React.useState<ComposeMode>(editPost?.type || 'text');
  const [text, setText] = React.useState(editPost?.text || '');
  // poll mode: the main text box is the question; these are the option rows
  const [pollOptions, setPollOptions] = React.useState<string[]>(['', '']);
	// edit mode pre-fills the linked-image rows from the post's saved URLs
	const [linkedImages, setLinkedImages] = React.useState<LinkedImageItem[]>(() =>
		(editPost?.images || []).map((url) => createLinkedImageItem(url))
	);
  const [title, setTitle] = React.useState(editPost?.listing?.title || '');
  const [price, setPrice] = React.useState(editPost?.listing ? String(editPost.listing.price) : '');
  const [currency, setCurrency] = React.useState(editPost?.listing?.currency || 'AUD');
  const [category, setCategory] = React.useState<MarketplaceCategory>(editPost?.listing?.category || 'other');
  const [condition, setCondition] = React.useState<string>(editPost?.listing?.condition || '');
  const [listingLocation, setListingLocation] = React.useState(editPost?.listing?.location || '');
  const [tagsInput, setTagsInput] = React.useState(editPost?.tags?.join(', ') || '');
  const [visibility, setVisibility] = React.useState<PostVisibility>(editPost?.visibility || 'public');
  const [posting, setPosting] = React.useState(false);
	const [submissionUncertain, setSubmissionUncertain] = React.useState(false);
	const [attachmentSnapshot, setAttachmentSnapshot] = React.useState<AttachmentComposerSnapshot>(EMPTY_ATTACHMENT_SNAPSHOT);

  // thingtime-tab extras: toggleable photos/marketplace field groups, the
  // in-post editor's draggable height, and its imperative API (the pop-out
  // button duplicates the window into one of the editor's own floating frames)
  const [thingPhotos, setThingPhotos] = React.useState(isEdit && editPost?.type === 'thingtime' && !!editPost.images?.length);
  const [thingListing, setThingListing] = React.useState(isEdit && editPost?.type === 'thingtime' && !!editPost.listing);
  // the thing edits in a bottom-sheet modal (nested comment composers can't
  // host a full editor inline, and mobile needs the room)
  const [thingModalOpen, setThingModalOpen] = React.useState(false);
  const editorApiRef = React.useRef<{ popOutDuplicate: () => void } | null>(null);
	const attachmentComposerRef = React.useRef<AttachmentComposerHandle | null>(null);
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

	// edit mode: the post's existing attachments, reorderable in place. Binding
	// is create-only, so edits can only re-sequence — saving sends the ordered
	// ids exactly when the order actually changed.
	const editAttachmentsSeedRef = React.useRef<PublicAttachment[]>(
		(editPost?.attachments || []).flatMap((attachment) => {
			const normalized = normalizePublicAttachment(attachment);
			return normalized ? [normalized] : [];
		})
	);
	const [editAttachments, setEditAttachments] = React.useState<PublicAttachment[]>(editAttachmentsSeedRef.current);
	const editAttachmentOrderChanged =
		isEdit &&
		editAttachments.length === editAttachmentsSeedRef.current.length &&
		editAttachments.some((attachment, index) => attachment.id !== editAttachmentsSeedRef.current[index].id);

	// explicit comma-separated tags first, then #hashtags typed inline in the
	// body (the literal #text stays in the post — PostCard linkifies it);
	// canonicalPostTags dedupes the merge and enforces the 12-tag/40-char caps.
	// Poll questions keep their hashtags too — the question renders on the card.
	const parsedTags = canonicalPostTags([...tagsInput.split(','), ...extractInlineHashtags(text)]);

	const validImages = canonicalLinkedImageUrls(linkedImages);

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

  // read the draft only when the tab is active (this render path runs per
  // keystroke)
  const draftThing = type === 'thingtime' ? getThingtime(draftPath) : null;
  const draftReady = !!draftThing && typeof draftThing === 'object' && !Array.isArray(draftThing);

  // Seed ONCE per mount, post-hydration: rewrite the tmp branch keeping any
  // user-authored keys, dropping only prior composer sessions (abandoned
  // drafts in the persisted blob), and starting this one clean. The once-guard
  // matters — setThingtime/getThingtime change identity on every store write,
  // and a re-running seed used to clobber the draft right after a change-type
  // action turned it into a non-object (string/boolean/…).
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || thingtimeLoading || type !== 'thingtime' || !expanded) return;
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
    setThingtime(DRAFT_TMP_KEY, {
      ...preserved,
      [draftSessionId]: editSeedRef.current ? { [DRAFT_ROOT_KEY]: editSeedRef.current } : {}
    });
  }, [type, expanded, thingtimeLoading, getThingtime, setThingtime, draftSessionId]);

  // which optional field groups are in play (marketplace always has both;
  // thingtime opts in per toggle)
  const showPhotos = type === 'image' || type === 'marketplace' || (type === 'thingtime' && thingPhotos);
  const showListing = type === 'marketplace' || (type === 'thingtime' && thingListing);

  const listingValid =
		title.trim().length > 0 && price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) >= 0 && !!currency && !!category;

	// edit mode has no upload snapshot — the post's existing bound attachments
	// are the content (an attachment-only post must stay saveable while its
	// media is being reordered)
	const hasReadyAttachment = attachmentSnapshot.attachments.length > 0 || (isEdit && editAttachments.length > 0);
	const hasReadyVisualAttachment =
		attachmentSnapshot.attachments.some((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video') ||
		(isEdit && editAttachments.some((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video'));

	const contentValid =
    type === 'text'
			? text.trim().length > 0 || hasReadyAttachment
      : type === 'image'
			? validImages.length > 0 || hasReadyVisualAttachment
        : type === 'thingtime'
          ? draftReady &&
            Object.keys(draftThing).length > 0 &&
            thingHasContent(draftThing) &&
            (!thingListing || listingValid) &&
			  // A toggled-on Photos group accepts either the existing URL flow
			  // or a securely uploaded image/video attachment.
			  (!thingPhotos || validImages.length > 0 || hasReadyVisualAttachment)
          : type === 'poll'
            ? text.trim().length > 0 && parsedPollOptions.length >= MIN_POLL_OPTIONS
            : listingValid;
	const valid = contentValid && !attachmentSnapshot.blocking;

  const reset = () => {
		pendingPostSubmissionRef.current = null;
		setSubmissionUncertain(false);
    setExpanded(isComment);
    setType('text');
    setText('');
    setPollOptions(['', '']);
    setComposerSession((session) => session + 1);
		setLinkedImages([]);
    setTitle('');
    setPrice('');
    setCurrency('AUD');
    setCategory('other');
    setCondition('');
    setListingLocation('');
    setTagsInput('');
    setVisibility('public');
    setThingPhotos(false);
    setThingListing(false);
		setAttachmentSnapshot(EMPTY_ATTACHMENT_SNAPSHOT);
  };

  const handlePost = async () => {
		if (!valid || posting || attachmentSnapshot.blocking) return;
		setThingModalOpen(false);

		const currentAttachmentIds = [...attachmentSnapshot.attachmentIds];
		const currentPostShareId = crypto.randomUUID();
		// polls publish as thingtime posts; the question lives on the thing (the
		// poll card renders it), so the post text stays empty — no double render
		const apiType: PostType = type === 'poll' ? 'thingtime' : type;
		const canonicalText = type === 'poll' ? '' : text.trim();
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
		const canonicalImages = showPhotos ? validImages : [];
		const canonicalThing =
			type === 'thingtime'
				? draftThing
				: type === 'poll'
					? { kind: 'poll', question: text.trim(), options: parsedPollOptions }
					: null;
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
							images: canonicalImages,
							listing: canonicalListing,
							thing: canonicalThing
						},
						tags: canonicalTags,
						visibility,
						attachmentIds: currentAttachmentIds
				  }
				: null;
		const currentPayload: Record<string, unknown> = {
        type: apiType,
        text: canonicalText,
        tags: parsedTags
      };
		if (currentPostShareId) currentPayload.shareId = currentPostShareId;
      // comments inherit the thread root's audience server-side
		if (!isComment) currentPayload.visibility = visibility;
		if (currentAttachmentIds.length > 0) currentPayload.attachmentIds = currentAttachmentIds;
		if (showPhotos) currentPayload.images = canonicalImages;
		if (apiType === 'thingtime') currentPayload.thing = canonicalThing;
		if (showListing) currentPayload.listing = canonicalListing;

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
			if (!isEdit && attachmentIds.length > 0) {
				// A successful or exactly reconciled post means the server atomically
				// claimed these drafts. Mark them before reset unmounts the uploader.
				// An edit saves through things.update, which claims no drafts.
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
			if (submittedPostType === 'thingtime') setThingtime(`${DRAFT_TMP_KEY}.${draftSessionId}`, {});
      // an edit keeps its pre-filled draft — the parent closes the composer
      if (!isEdit) reset();
			onPosted(created);
		};

		setPosting(true);
		try {
			if (isEdit) {
				// full-crystal replace: the server sanitizer rebuilds { type, text,
				// images, listing, thing } per type, so switching type clears the
				// fields that no longer apply. A changed attachment order rides along
				// as the reordered id list (a pure permutation of the bound set).
				const updated = await api.v1.things.update({
					id: editPost!.id,
					crystal: {
						type,
						text: text.trim(),
						images: canonicalImages,
						listing: canonicalListing,
						thing: canonicalThing
					},
					tags: parsedTags,
					visibility,
					...(editAttachmentOrderChanged ? { attachmentIds: editAttachments.map((attachment) => attachment.id) } : {})
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
      {/* type tabs — wrap on narrow screens so labels never overlap. The Poll
      tab is compose-only: an existing poll edits through the Thingtime tab
      (its thing IS the poll), so edit mode keeps the plain type tabs. */}
      <Flex columnGap={1} rowGap={1} alignItems="center" flexWrap="wrap">
        {(Object.keys(COMPOSE_MODE_META) as ComposeMode[])
          .filter((key) => key !== 'poll' || !isEdit)
          .map((key) => (
						<Button key={key} size="xs" variant={type === key ? 'solid' : 'ghost'} borderRadius={RADIUS_SM} onClick={() => setType(key)}>
            {COMPOSE_MODE_META[key].emoji} {COMPOSE_MODE_META[key].label}
          </Button>
        ))}
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

      <Flex columnGap={3}>
        <UserAvatarCircle size="36px" fontSize="sm" />
        <Box flex="1" minWidth={0}>
          <LongTextEditor
            // Editor.js reads its placeholder once at init, so entering/leaving
            // poll mode remounts the editor (the value prop reseeds the text) —
            // the question prompt must actually show for polls
            key={`${composerSession}-${type === 'poll' ? 'poll' : 'post'}`}
            value={text}
            onValueChange={(next) => setText(typeof next === 'string' ? next : '')}
            placeholder={TEXTAREA_PLACEHOLDERS[type]}
            minHeight="72px"
          />
        </Box>
      </Flex>

      {/* the thing itself — the real things editor over the draft branch */}
      {type === 'thingtime' && (
        <Flex flexDirection="column" rowGap={2}>
          <Flex alignItems="center" columnGap={1}>
            <Eyebrow>Thing 🌀</Eyebrow>
            <Flex marginLeft="auto" columnGap={1} alignItems="center">
              <Button
                size="xs"
                variant={thingPhotos ? 'solid' : 'ghost'}
                borderRadius={RADIUS_SM}
                onClick={() => setThingPhotos((on) => !on)}
                title="Add photos to this thing post"
              >
                {POST_TYPE_META.image.emoji} Photos
              </Button>
              <Button
                size="xs"
                variant={thingListing ? 'solid' : 'ghost'}
                borderRadius={RADIUS_SM}
                onClick={() => setThingListing((on) => !on)}
                title="Add marketplace listing fields to this thing post"
              >
                {POST_TYPE_META.marketplace.emoji} Marketplace
              </Button>
            </Flex>
          </Flex>

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
                <Eyebrow>Thing 🌀</Eyebrow>
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

      {/* photos */}
      {showPhotos && (
        <Flex flexDirection="column" rowGap={2}>
          <Eyebrow>Photos {type !== 'image' ? '(optional) ' : ''}🖼️</Eyebrow>
						<LinkedImageGallery
							items={linkedImages}
							onChange={setLinkedImages}
							disabled={posting || submissionUncertain}
							helperText="One URL per line. Linked images stay on the original site and don't use your private file-storage quota."
              />
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

				{user && !isEdit && (
					<AttachmentComposer
						ref={attachmentComposerRef}
						key={`attachments-${user.id}-${composerSession}`}
						ownerId={user.id}
						disabled={posting || submissionUncertain}
						purpose={isComment ? 'comment' : 'post'}
						ariaLabel={isComment ? 'Comment attachments' : 'Post attachments'}
						remainingBytes={user.storage.remainingBytes}
						storageStatus={user.storage.status}
						onChange={setAttachmentSnapshot}
					/>
				)}

				{/* edit mode: attachments bound at create time can only be
				re-sequenced — the upload panel (which could never save its files
				into an existing post) is replaced by the reorderable gallery */}
				{isEdit && editAttachments.length > 0 && (
					<AttachmentReorderGallery
						attachments={editAttachments}
						onChange={setEditAttachments}
						disabled={posting || submissionUncertain}
						ariaLabel="Reorder this post's attachments"
					/>
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

      {/* footer: circle + post (comments inherit the thread's circle) */}
      <Flex alignItems="center" columnGap={2} borderTop={BORDER} paddingTop={3}>
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
