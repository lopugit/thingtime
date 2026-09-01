import React from 'react';
import { Box, Button, Center, Flex, IconButton, Input, Spinner, Text, Textarea } from '@chakra-ui/react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Check, Download, Pencil, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { PostCard } from '~/components/Feed/PostCard';
import { useViewTracking } from '~/components/Feed/useViewTracking';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import {
	attachmentContentUrl,
	attachmentDisplayName,
	formatAttachmentBytes,
	normalizePublicAttachment
} from '~/components/Attachments/attachmentUiCore';
import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';

// /media/:id — every attachment is a Thing, and this is its own page: the
// media large in a full Thingtime card with reactions, comments, and views of
// its OWN (relational things targeting the attachment id), owner-editable
// display filename/title/description (attachments/annotate), and a link back to the post the
// media is bound to. The lightbox and file rows deeplink here.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';

type MediaResponse = {
	attachment: PublicAttachment;
	post: PublicPost;
	parent: PublicPost | null;
};

export const MediaPage = () => {
	const { id } = useParams();
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const navigate = useNavigate();

	const [data, setData] = React.useState<MediaResponse | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const { observeView } = useViewTracking();

	// owner display metadata editing (attachments/annotate)
	const [editing, setEditing] = React.useState(false);
	const [filenamePreviewDraft, setFilenamePreviewDraft] = React.useState('');
	const [titleDraft, setTitleDraft] = React.useState('');
	const [descriptionDraft, setDescriptionDraft] = React.useState('');
	const [saving, setSaving] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setData(null);
		setEditing(false);

		const startedAt = Date.now();
		api.v1.things
			.get({ id: id || '' })
			.then((resp: any) => {
				if (cancelled) return;
				const thing = resp?.thing;
				const attachment = thing ? normalizePublicAttachment({ id: thing.id, ...thing.crystal }) : null;
				if (!attachment || !resp?.post || !thing?.thingtime?.includes?.('attachment')) {
					setError('This media is missing or private 🌫️');
					return;
				}
				setData({
					attachment,
					post: mergeReactionOverlay(startedAt, resp.post),
					parent: resp.parent ? mergeReactionOverlay(startedAt, resp.parent) : null
				});
			})
			.catch((err: any) => {
				if (cancelled) return;
				setError(err?.error || 'This media is missing or private 🌫️');
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

	const attachment = data?.attachment ?? null;
	const post = data?.post ?? null;
	const parentId = data?.parent?.id ?? null;
	const isOwner = !!user?.id && !!post?.author?.id && user.id === post.author.id;

	// the interaction card renders the media itself as the body — one visual
	// system with the feed (masonry/lightbox included via PostAttachments)
	const displayPost = React.useMemo(() => (post && attachment ? { ...post, attachments: [attachment] } : null), [post, attachment]);

	const handleChanged = (change: PostChange) => {
		setData((prev) => {
			if (!prev?.post) return prev;
			const applied = typeof change === 'function' ? change({ ...prev.post, attachments: [prev.attachment] }) : change;
			if (!applied) {
				navigate(parentId ? `/post/${parentId}` : '/feed');
				return prev;
			}
			// keep the canonical projection attachment-free; the card re-injects it
			const { attachments: _ignored, ...rest } = applied as PublicPost & { attachments?: unknown };
			return { ...prev, post: { ...prev.post, ...rest } };
		});
	};

	const startEditing = () => {
		if (!attachment) return;
		setFilenamePreviewDraft(attachment.filenamePreview || '');
		setTitleDraft(attachment.title || '');
		setDescriptionDraft(attachment.description || '');
		setEditing(true);
	};

	const saveAnnotation = async () => {
		if (!attachment || saving) return;
		setSaving(true);
		try {
			const resp = await api.v1.attachments.annotate({
				id: attachment.id,
				filenamePreview: filenamePreviewDraft.trim() || null,
				title: titleDraft.trim() || null,
				description: descriptionDraft.trim() || null
			});
			const updated = normalizePublicAttachment(resp?.attachment) || {
				...attachment,
				filenamePreview: filenamePreviewDraft.trim() || undefined,
				title: titleDraft.trim() || undefined,
				description: descriptionDraft.trim() || undefined
			};
			setData((prev) => (prev ? { ...prev, attachment: updated } : prev));
			setEditing(false);
			lopu({ title: 'Media details saved ✨', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save those details 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
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
			<Flex flexDirection="column" rowGap={4} width={['100%', '680px']} maxWidth="100%" paddingX={4} paddingTop={[4, 6]}>
				{/* header */}
				<Flex flexDirection="column" rowGap={1}>
					<Box fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
						Thingtime · Media 🖼️
					</Box>
					<Flex alignItems="flex-start" columnGap={2}>
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
							minWidth={0}
							wordBreak="break-word"
						>
							{attachment?.title || (attachment ? attachmentDisplayName(attachment) : '') || 'Media 🖼️'}
						</Box>
						{isOwner && !editing && !loading && (
							<IconButton
								aria-label="Edit media display filename, title and description"
								title="Edit display filename, title & description"
								icon={<Pencil size={14} />}
								size="xs"
								variant="ghost"
								color={MUTED}
								borderRadius="8px"
								marginTop={2}
								onClick={startEditing}
							/>
						)}
					</Flex>
					{attachment?.description && !editing ? (
						<Text fontSize="sm" color="var(--tt-text, #5a5a66)" whiteSpace="pre-wrap">
							{attachment.description}
						</Text>
					) : null}
					{attachment ? (
						<Text fontSize="11px" color={MUTED}>
							{attachmentDisplayName(attachment)} · {attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)} · {attachment.contentType}
						</Text>
					) : null}
				</Flex>

				{/* owner annotate editor */}
				{editing && attachment && (
					<Flex
						flexDirection="column"
						rowGap={2}
						padding={3}
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-md, 12px)"
						background="var(--tt-card, #ffffff)"
					>
						<Input
							size="sm"
							borderRadius={RADIUS_SM}
							placeholder={attachment.name}
							aria-label="Filename preview"
							maxLength={255}
							value={filenamePreviewDraft}
							onChange={(event) => setFilenamePreviewDraft(event.target.value)}
						/>
						<Input
							size="sm"
							borderRadius={RADIUS_SM}
							placeholder="Give this media a title ✨"
							maxLength={200}
							value={titleDraft}
							onChange={(event) => setTitleDraft(event.target.value)}
						/>
						<Textarea
							size="sm"
							rows={3}
							resize="vertical"
							borderRadius={RADIUS_SM}
							placeholder="Describe it… (optional)"
							maxLength={2000}
							value={descriptionDraft}
							onChange={(event) => setDescriptionDraft(event.target.value)}
						/>
						<Flex columnGap={2}>
							<Button size="xs" leftIcon={<Check size={13} />} borderRadius={RADIUS_SM} isLoading={saving} onClick={saveAnnotation}>
								Save details ✨
							</Button>
							<Button size="xs" variant="ghost" leftIcon={<X size={13} />} borderRadius={RADIUS_SM} isDisabled={saving} onClick={() => setEditing(false)}>
								Cancel
							</Button>
						</Flex>
					</Flex>
				)}

				{/* context row */}
				{(parentId || attachment) && (
					<Flex alignItems="center" columnGap={2} flexWrap="wrap">
						{parentId && (
							<Link to={`/post/${parentId}`}>
								<Button size="xs" variant="outline" borderRadius="999px" leftIcon={<ArrowLeft size={12} />}>
									View the post this media lives in 📌
								</Button>
							</Link>
						)}
						{attachment && (
							<Button
								as="a"
								href={attachment.url || attachmentContentUrl(attachment.id, true)}
								// cross-origin ignores the download attribute — linked media
								// opens the original URL in a new tab instead
								{...(attachment.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: attachment.name })}
								size="xs"
								variant="ghost"
								borderRadius="999px"
								leftIcon={<Download size={12} />}
							>
								Download
							</Button>
						)}
					</Flex>
				)}

				{loading && (
					<Center paddingY={16}>
						<Spinner size="lg" color={MUTED} />
					</Center>
				)}

				{!loading && (error || !displayPost) && (
					<Flex flexDirection="column" alignItems="center" rowGap={3} paddingY={16}>
						<Text fontSize="sm" color={MUTED}>
							{error || 'This media is missing or private 🌫️'}
						</Text>
						<Link to="/feed">
							<Button size="sm" variant="outline" borderRadius="999px">
								Back to the feed 📰
							</Button>
						</Link>
					</Flex>
				)}

				{!loading && displayPost && (
					<Box ref={(element: HTMLDivElement | null) => observeView(element, displayPost.id)}>
						<PostCard post={displayPost} onChanged={handleChanged} defaultCommentsOpen mediaThing />
					</Box>
				)}
			</Flex>
		</Flex>
	);
};

export default MediaPage;
