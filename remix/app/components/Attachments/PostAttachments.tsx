import { ProgressiveImage } from './ProgressiveImage';
import React from 'react';
import { SharedMediaProvider, useSharedMediaUrl } from '../Sharing/SharedMedia';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Download, File as FileIcon, FolderDown, Play } from 'lucide-react';

import {
	archiveDownloadLabel,
	attachmentContentUrl,
	attachmentDisplayName,
	attachmentMediaSrc,
	attachmentTypeLabel,
	downloadableAttachments,
	formatAttachmentBytes,
	normalizePublicAttachment
} from './attachmentUiCore';
import { useAttachmentArchive } from './useAttachmentArchive';
import type { ArchiveNoun } from './attachmentArchiveActions';
import { MediaLightbox } from './MediaLightbox';
import { AudioAttachmentPlayer } from './AudioAttachmentPlayer';
import type { PublicAttachment } from './attachmentTypes';
import type { MediaLayoutSpan, PostMediaLayout } from '~/schemas/registry';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const DANGER = 'var(--tt-danger, #e5484d)';

// Server-tagged NSFW media stays fetchable but renders unrecognizable until
// the viewer opts in: heavy blur + slight transparency under a light red wash,
// a red border, and a centered NSFW badge with a "Show Anyway" reveal. The
// tag comes from the protected moderation stamp — nothing client-side can
// clear it except this per-render reveal click.
const NsfwShield = ({
	name,
	compact,
	fill,
	onReveal,
	children
}: {
	name: string;
	compact?: boolean;
	// fill: the parent tile already owns the box (the aspect-ratio rows/grid
	// layouts absolutely position their image), so the shield and its blurred
	// child stretch to that box instead of flowing at the child's natural height.
	fill?: boolean;
	onReveal: () => void;
	children: React.ReactNode;
}) => (
	<Box
		position={fill ? 'absolute' : 'relative'}
		inset={fill ? 0 : undefined}
		overflow="hidden"
		borderRadius="var(--tt-radius-md, 12px)"
		border={`2px solid ${DANGER}`}
		role="group"
		aria-label={`${name || 'Attachment'} is hidden as NSFW`}
	>
		{/* scale hides the blur's transparent edge bleed inside the crop */}
		<Box
			filter="blur(64px)"
			opacity={0.92}
			transform="scale(1.15)"
			pointerEvents="none"
			aria-hidden
			position={fill ? 'absolute' : undefined}
			inset={fill ? 0 : undefined}
		>
			{children}
		</Box>
		<Flex
			position="absolute"
			inset={0}
			background="rgba(229, 72, 77, 0.22)"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			rowGap={compact ? 1.5 : 2.5}
			padding={2}
		>
			<Text
				fontFamily="mono"
				fontSize={compact ? '10px' : '11px'}
				fontWeight={700}
				letterSpacing="0.14em"
				textTransform="uppercase"
				color="#ffffff"
				background={DANGER}
				paddingX={2.5}
				paddingY={1}
				borderRadius="999px"
			>
				NSFW
			</Text>
			<Button
				size={compact ? 'xs' : 'sm'}
				borderRadius="999px"
				background="rgba(255, 255, 255, 0.92)"
				color="var(--tt-ink, #16161a)"
				_hover={{ background: '#ffffff' }}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					onReveal();
				}}
			>
				Show Anyway
			</Button>
		</Flex>
	</Box>
);

// Images and videos share one ordered gallery and lightbox. Audio and files
// retain their dedicated players/download rows. Layout never changes gallery order.

// Chunk visual media into row sizes per the pattern, repeating the last row size
export const mediaLayoutRows = (count: number, pattern: number[]): number[] => {
	const rows: number[] = [];
	let remaining = count;
	let index = 0;
	while (remaining > 0) {
		const size = Math.max(1, pattern[Math.min(index, pattern.length - 1)] || 1);
		rows.push(Math.min(size, remaining));
		remaining -= Math.min(size, remaining);
		index += 1;
	}
	return rows;
};

// hero rows get a cinematic ratio; pairs a gentle landscape; 3+ go square
export const rowAspectRatio = (size: number): string => (size === 1 ? '16 / 9' : size === 2 ? '4 / 3' : '1 / 1');

const spanFor = (layout: PostMediaLayout, id: string): MediaLayoutSpan => layout.spans?.[id] || 'normal';
export const spanColumns = (span: MediaLayoutSpan, columns: number): number => (span === 'wide' || span === 'big' ? Math.min(2, columns) : 1);
export const spanRows = (span: MediaLayoutSpan): number => (span === 'tall' || span === 'big' ? 2 : 1);
export const spanAspect = (span: MediaLayoutSpan, columns: number): string => {
	const cols = spanColumns(span, columns);
	const rows = spanRows(span);
	return `${cols} / ${rows}`;
};

// The owner's own moderation-pending media renders with this badge instead of
// silently vanishing while analysis runs (other viewers don't receive it).
const PendingBadge = () => (
	<Text
		fontFamily="mono"
		fontSize="9px"
		fontWeight={700}
		letterSpacing="0.1em"
		textTransform="uppercase"
		color="var(--tt-ink, #16161a)"
		background="rgba(255, 214, 102, 0.95)"
		paddingX={1.5}
		paddingY="1px"
		borderRadius="999px"
		flexShrink={0}
	>
		Checking…
	</Text>
);

// Linked (external URL) rows open the original URL — the HTML download
// attribute is ignored cross-origin, so they open in a new tab instead.
const AttachmentFileRow = ({ attachment, compact }: { attachment: PublicAttachment; compact?: boolean }) => {
	const mediaUrl = useSharedMediaUrl();
	return (
	<Flex
		as="a"
		href={mediaUrl(attachment.url || attachmentContentUrl(attachment.id, true))}
		{...(attachment.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: attachment.name })}
		alignItems="center"
		columnGap={2.5}
		minHeight="48px"
		paddingX={3}
		paddingY={2}
		border={BORDER}
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
		_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)', textDecoration: 'none' }}
		minWidth={0}
	>
		<Flex
			alignItems="center"
			justifyContent="center"
			boxSize="32px"
			borderRadius="8px"
			background="var(--tt-card, #ffffff)"
			color={MUTED}
			flexShrink={0}
		>
			<FileIcon size={15} aria-hidden />
		</Flex>
		<Box flex="1" minWidth={0}>
			<Text
				fontSize={compact ? 'xs' : 'sm'}
				fontWeight={650}
				color="var(--tt-ink, #16161a)"
				noOfLines={1}
				title={attachment.title || attachmentDisplayName(attachment)}
			>
				{attachment.title || attachmentDisplayName(attachment)}
			</Text>
			<Text fontSize="10px" color={MUTED} noOfLines={1}>
				{attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)} · {attachmentTypeLabel(attachment)}
			</Text>
		</Box>
		{attachment.pending ? <PendingBadge /> : null}
		<Download size={15} color="var(--tt-link, #2f8fd6)" aria-label={`Download ${attachmentDisplayName(attachment)}`} />
	</Flex>
);
};

type PostAttachmentsProps = {
	attachments?: PublicAttachment[];
	mediaLayout?: PostMediaLayout | null;
	compact?: boolean;
	ariaLabel?: string;
	// the owning post/comment: enables "Download all" (one ZIP of every stored file)
	postId?: string;
	// what the owning Thing is called in toasts and tooltips
	archiveNoun?: Extract<ArchiveNoun, 'post' | 'comment'>;
};

const PostAttachmentsGallery = ({
	attachments,
	mediaLayout,
	compact,
	ariaLabel = 'Attachments',
	postId,
	archiveNoun = 'post',
	onDownloadAll
}: PostAttachmentsProps & {
	// supplied only by galleries that can offer an archive (see PostAttachments)
	onDownloadAll?: (noun: ArchiveNoun) => void;
}) => {
	// Per-render reveal consent; navigating away re-shields.
	const mediaUrl = useSharedMediaUrl();
	const [revealedIds, setRevealedIds] = React.useState<ReadonlySet<string>>(new Set());
	const reveal = React.useCallback((id: string) => {
		setRevealedIds((current) => {
			const next = new Set(current);
			next.add(id);
			return next;
		});
	}, []);
	const normalized = (attachments || []).flatMap((attachment) => {
		const value = normalizePublicAttachment(attachment);
		return value ? [value] : [];
	});
	const [lightbox, setLightbox] = React.useState<{ open: boolean; index: number }>({ open: false, index: 0 });
	if (!normalized.length) return null;

	const visualMedia = normalized.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video');
	const audio = normalized.filter((attachment) => attachment.mediaKind === 'audio');
	const files = normalized.filter((attachment) => attachment.mediaKind === 'file');
	// "Download all" only earns its row once there are two or more stored files;
	// a lone file already has its own download control. Linked media has no bytes.
	const stored = downloadableAttachments(normalized);
	const storedBytes = stored.reduce((sum, attachment) => sum + (Number.isFinite(attachment.size) ? attachment.size : 0), 0);
	const downloadAll = postId && stored.length > 1 && onDownloadAll ? () => onDownloadAll(archiveNoun) : undefined;

	const layout: PostMediaLayout = mediaLayout && visualMedia.length > 1 ? mediaLayout : { mode: 'masonry' };

	// Still-shielded media is withheld from the lightbox too. The modal renders
	// media unblurred and steps through them with arrow keys, so leaving them in
	// would walk a viewer onto media they never consented to see. Attachment
	// order is otherwise untouched; revealing restores its original position.
	const lightboxMedia = visualMedia.filter((attachment) => !(attachment.nsfw === true && !revealedIds.has(attachment.id)));

	const tile = (attachment: PublicAttachment, index: number, tileSx: Record<string, unknown>, fill: boolean) => {
		// Server-tagged NSFW media stays shielded until this render's consent
		// click. A shielded tile is deliberately inert rather than a zoom button:
		// the lightbox renders the image unblurred, so it must not be reachable
		// before the viewer opts in. Revealing turns it back into a normal tile.
		const shielded = attachment.nsfw === true && !revealedIds.has(attachment.id);
		const image = attachment.mediaKind === 'video' ? (
			<Box as="video" src={mediaUrl(attachmentMediaSrc(attachment))} aria-label={attachment.title || attachmentDisplayName(attachment)}
				muted playsInline preload="metadata" width="100%" display="block" objectFit="cover" pointerEvents="none"
				{...(fill ? { height: '100%', position: 'absolute' as const, inset: 0 } : { aspectRatio: '4 / 3', maxHeight: compact ? '360px' : '640px' })}
				background="var(--tt-ink, #16161a)" />
		) : (
			<ProgressiveImage
				src={mediaUrl(attachmentMediaSrc(attachment))}
				alt={attachment.title || attachmentDisplayName(attachment) || `Post image ${index + 1}`}
				loading="lazy"
				width="100%"
				display="block"
				// fill mode: the tile's aspect-ratio owns the box, the image covers it
				{...(fill ? { height: '100%', position: 'absolute' as const, inset: 0 } : { maxHeight: compact ? '360px' : '640px' })}
				objectFit="cover"
				background="var(--tt-surface-alt, #f5f5f7)"
				transition="transform 120ms ease"
				_hover={{ transform: 'scale(1.015)' }}
			/>
		);
		const interactiveProps = shielded
			? {}
			: {
				as: 'button' as const,
				type: 'button' as const,
				'aria-label': `View ${attachment.title || attachmentDisplayName(attachment)}`,
				onClick: () => setLightbox({ open: true, index: Math.max(0, lightboxMedia.indexOf(attachment)) })
			};
		return (
			<Box
				key={attachment.id}
				{...interactiveProps}
				display="block"
				width="100%"
				position="relative"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
				cursor={shielded ? 'default' : 'zoom-in'}
				sx={tileSx}
			>
				{shielded ? (
					<NsfwShield
						name={attachment.title || attachmentDisplayName(attachment)}
						compact={compact}
						fill={fill}
						onReveal={() => reveal(attachment.id)}
					>
						{image}
					</NsfwShield>
				) : (
					image
				)}
				{attachment.mediaKind === 'video' && !shielded && (
					<Flex position="absolute" inset={0} align="center" justify="center" pointerEvents="none">
						<Flex boxSize="48px" borderRadius="full" background="rgba(0,0,0,0.55)" color="white" align="center" justify="center">
							<Play size={24} fill="currentColor" aria-hidden />
						</Flex>
					</Flex>
				)}

				{attachment.pending ? (
					<Box position="absolute" top={1.5} left={1.5}>
						<PendingBadge />
					</Box>
				) : null}
				{attachment.title && !shielded ? (
					<Box
						position="absolute"
						left={0}
						right={0}
						bottom={0}
						paddingX={2.5}
						paddingY={1.5}
						background="linear-gradient(transparent, rgba(10, 10, 14, 0.62))"
						textAlign="left"
					>
						<Text fontSize="11px" fontWeight={650} color="white" noOfLines={1}>
							{attachment.title}
						</Text>
					</Box>
				) : null}
			</Box>
		);
	};

	// rows mode: pre-compute each image's (row, index) placement in attachment order
	const rowChunks: { attachment: PublicAttachment; index: number }[][] = [];
	if (layout.mode === 'rows' && visualMedia.length) {
		let cursor = 0;
		for (const size of mediaLayoutRows(visualMedia.length, layout.pattern || [1])) {
			const start = cursor;
			rowChunks.push(visualMedia.slice(start, start + size).map((attachment, offset) => ({ attachment, index: start + offset })));
			cursor = start + size;
		}
	}
	const gridColumns = Math.max(1, Math.min(layout.columns || 3, visualMedia.length, 6));

	return (
		<Flex flexDirection="column" rowGap={compact ? 2 : 3} aria-label={ariaLabel}>
			{visualMedia.length > 0 && layout.mode === 'masonry' && (
				<Box
					sx={{
						display: 'grid',
						gridTemplateColumns: visualMedia.length === 1 ? '1fr' : compact ? 'repeat(2, minmax(0, 1fr))' : { base: 'repeat(2, minmax(0, 1fr))', sm: `repeat(${Math.min(3, visualMedia.length)}, minmax(0, 1fr))` },
						gap: '6px',
						alignItems: 'start'
					}}
				>
					{visualMedia.map((attachment, index) => tile(attachment, index, {}, false))}
				</Box>
			)}

			{visualMedia.length > 0 && layout.mode === 'rows' && (
				<Flex flexDirection="column" rowGap="6px">
					{rowChunks.map((row, rowIndex) => (
						<Flex key={rowIndex} columnGap="6px">
							{row.map(({ attachment, index }) =>
								tile(attachment, index, { flex: '1 1 0', minWidth: 0, aspectRatio: rowAspectRatio(row.length) }, true)
							)}
						</Flex>
					))}
				</Flex>
			)}

			{visualMedia.length > 0 && layout.mode === 'grid' && (
				<Box display="grid" gridTemplateColumns={`repeat(${gridColumns}, minmax(0, 1fr))`} gap="6px" sx={{ gridAutoFlow: 'row' }}>
					{visualMedia.map((attachment, index) => {
						const span = spanFor(layout, attachment.id);
						return tile(
							attachment,
							index,
							{
								gridColumn: `span ${spanColumns(span, gridColumns)}`,
								gridRow: `span ${spanRows(span)}`,
								aspectRatio: spanAspect(span, gridColumns),
								minWidth: 0
							},
							true
						);
					})}
				</Box>
			)}

			{audio.length > 0 ? <AudioAttachmentPlayer attachments={audio} compact={compact} /> : null}

			{files.length > 0 && (
				<Flex flexDirection="column" rowGap={1.5}>
					{files.map((attachment) => (
						<AttachmentFileRow key={attachment.id} attachment={attachment} compact={compact} />
					))}
				</Flex>
			)}

			{downloadAll ? (
				<Flex>
					<Button
						size="xs"
						variant="outline"
						borderRadius="999px"
						leftIcon={<FolderDown size={13} aria-hidden />}
						color="var(--tt-ink, #16161a)"
						borderColor="var(--tt-border, #ececef)"
						background="var(--tt-surface, #fafafb)"
						_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
						title={`Every stored file in this ${archiveNoun} as one ZIP`}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							downloadAll();
						}}
					>
						{archiveDownloadLabel(stored.length, storedBytes)}
					</Button>
				</Flex>
			) : null}

			<MediaLightbox
				attachments={lightboxMedia}
				index={lightbox.index}
				isOpen={lightbox.open}
				onClose={() => setLightbox((state) => ({ ...state, open: false }))}
				onDownloadAll={downloadAll && onDownloadAll ? () => onDownloadAll('gallery') : undefined}
			/>
		</Flex>
	);
};

// Only a gallery that can offer "Download all" (a post/comment with two or more
// stored files) mounts the archive hook and the API client behind it; every
// other card, comment row, chat and message row renders the plain gallery.
const PostAttachmentsWithArchive = (props: PostAttachmentsProps & { postId: string }) => {
	const archive = useAttachmentArchive();
	const onDownloadAll = React.useCallback((noun: ArchiveNoun) => void archive.download(props.postId, noun), [archive, props.postId]);
	return <PostAttachmentsGallery {...props} onDownloadAll={onDownloadAll} />;
};

const PostAttachmentsBody = (props: PostAttachmentsProps) =>
	props.postId && downloadableAttachments(props.attachments).length > 1 ? <PostAttachmentsWithArchive {...props} postId={props.postId} /> : <PostAttachmentsGallery {...props} />;

// Owners can share hidden post media with the same parent key; visitors inherit
// the already-presented page context. Never send that key to an external URL.
export const PostAttachments = (props: PostAttachmentsProps & { linkKey?: string }) =>
	props.linkKey ? <SharedMediaProvider linkKey={props.linkKey}><PostAttachmentsBody {...props} /></SharedMediaProvider> : <PostAttachmentsBody {...props} />;
