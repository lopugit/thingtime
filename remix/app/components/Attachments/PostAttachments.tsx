import React from 'react';
// Grid/Image are gone: the owner-chosen layouts below render their own
// masonry/rows/grid containers, and each image tile is a Box `as="img"`.
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Download, File as FileIcon } from 'lucide-react';

import {
	attachmentContentUrl,
	attachmentDisplayName,
	attachmentMediaSrc,
	attachmentTypeLabel,
	formatAttachmentBytes,
	normalizePublicAttachment
} from './attachmentUiCore';
import { MediaLightbox } from './MediaLightbox';
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

// A post's attachment gallery. Images honor the post's owner-chosen
// crystal.mediaLayout: absent/masonry = natural-aspect CSS-columns masonry
// (first image top-left, order runs down each column); rows = fixed
// images-per-row pattern (extras repeat the last row size); grid = uniform
// columns with per-image spans (wide/tall/big). Clicking any image opens the
// MediaLightbox at that image's ATTACHMENT-ORDER index — layout never changes
// lightbox order. Videos keep inline players; generic files stay download rows.

// chunk images into row sizes per the pattern, repeating the last row size
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
const AttachmentFileRow = ({ attachment, compact }: { attachment: PublicAttachment; compact?: boolean }) => (
	<Flex
		as="a"
		href={attachment.url || attachmentContentUrl(attachment.id, true)}
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

const AttachmentVideo = ({ attachment, compact }: { attachment: PublicAttachment; compact?: boolean }) => {
	// The inline allowlist admits every container mainstream browsers can play,
	// but codec support inside a container still varies (for example HEVC
	// QuickTime on Firefox); an unplayable video degrades to its download row.
	const [failed, setFailed] = React.useState(false);
	if (failed) return <AttachmentFileRow attachment={attachment} compact={compact} />;
	return (
		<Box
			as="video"
			src={attachmentMediaSrc(attachment)}
			aria-label={attachment.title || attachmentDisplayName(attachment)}
			controls
			playsInline
			preload="metadata"
			width="100%"
			maxHeight={compact ? '320px' : '520px'}
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-ink, #16161a)"
			onError={() => setFailed(true)}
		/>
	);
};

export const PostAttachments = ({
	attachments,
	mediaLayout,
	compact,
	ariaLabel = 'Attachments'
}: {
	attachments?: PublicAttachment[];
	mediaLayout?: PostMediaLayout | null;
	compact?: boolean;
	ariaLabel?: string;
}) => {
	// Per-render reveal consent; navigating away re-shields.
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

	const images = normalized.filter((attachment) => attachment.mediaKind === 'image');
	const videos = normalized.filter((attachment) => attachment.mediaKind === 'video');
	// The public normalizer deliberately maps audio to the generic file kind so
	// it stays a safe download row rather than an autoplay-capable player.
	const files = normalized.filter((attachment) => attachment.mediaKind === 'file');

	const layout: PostMediaLayout = mediaLayout && images.length > 1 ? mediaLayout : { mode: 'masonry' };

	// Still-shielded media is withheld from the lightbox too. The modal renders
	// images unblurred and steps through them with arrow keys, so leaving them in
	// would walk a viewer onto media they never consented to see. Attachment
	// order is otherwise untouched; revealing puts the image straight back.
	const lightboxImages = images.filter((attachment) => !(attachment.nsfw === true && !revealedIds.has(attachment.id)));

	const tile = (attachment: PublicAttachment, index: number, tileSx: Record<string, unknown>, fill: boolean) => {
		// Server-tagged NSFW media stays shielded until this render's consent
		// click. A shielded tile is deliberately inert rather than a zoom button:
		// the lightbox renders the image unblurred, so it must not be reachable
		// before the viewer opts in. Revealing turns it back into a normal tile.
		const shielded = attachment.nsfw === true && !revealedIds.has(attachment.id);
		const image = (
			<Box
				as="img"
				src={attachmentMediaSrc(attachment)}
				alt={attachment.title || attachmentDisplayName(attachment) || `Post image ${index + 1}`}
				loading="lazy"
				referrerPolicy="no-referrer"
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
		return (
			<Box
				key={attachment.id}
				as={shielded ? 'div' : 'button'}
				type={shielded ? undefined : 'button'}
				display="block"
				width="100%"
				position="relative"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
				cursor={shielded ? 'default' : 'zoom-in'}
				sx={tileSx}
				aria-label={shielded ? undefined : `View ${attachment.title || attachmentDisplayName(attachment)}`}
				// the lightbox skips shielded media, so open it at this image's index
				// within that list rather than its attachment-order index
				onClick={shielded ? undefined : () => setLightbox({ open: true, index: Math.max(0, lightboxImages.indexOf(attachment)) })}
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
	if (layout.mode === 'rows' && images.length) {
		let cursor = 0;
		for (const size of mediaLayoutRows(images.length, layout.pattern || [1])) {
			const start = cursor;
			rowChunks.push(images.slice(start, start + size).map((attachment, offset) => ({ attachment, index: start + offset })));
			cursor = start + size;
		}
	}
	const gridColumns = Math.max(1, Math.min(layout.columns || 3, images.length, 6));

	return (
		<Flex flexDirection="column" rowGap={compact ? 2 : 3} aria-label={ariaLabel}>
			{images.length > 0 && layout.mode === 'masonry' && (
				<Box
					sx={{
						columnCount: images.length === 1 ? 1 : compact ? 2 : { base: 2, sm: Math.min(3, images.length) },
						columnGap: '6px'
					}}
				>
					{images.map((attachment, index) => tile(attachment, index, { breakInside: 'avoid', marginBottom: '6px' }, false))}
				</Box>
			)}

			{images.length > 0 && layout.mode === 'rows' && (
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

			{images.length > 0 && layout.mode === 'grid' && (
				<Box display="grid" gridTemplateColumns={`repeat(${gridColumns}, minmax(0, 1fr))`} gap="6px" sx={{ gridAutoFlow: 'dense' }}>
					{images.map((attachment, index) => {
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

			{videos.map((attachment) => {
				const video = <AttachmentVideo key={attachment.id} attachment={attachment} compact={compact} />;
				return attachment.nsfw && !revealedIds.has(attachment.id) ? (
					<NsfwShield key={attachment.id} name={attachmentDisplayName(attachment)} compact={compact} onReveal={() => reveal(attachment.id)}>
						{video}
					</NsfwShield>
				) : (
					video
				);
			})}

			{files.length > 0 && (
				<Flex flexDirection="column" rowGap={1.5}>
					{files.map((attachment) => (
						<AttachmentFileRow key={attachment.id} attachment={attachment} compact={compact} />
					))}
				</Flex>
			)}

			<MediaLightbox
				attachments={lightboxImages}
				index={lightbox.index}
				isOpen={lightbox.open}
				onClose={() => setLightbox((state) => ({ ...state, open: false }))}
			/>
		</Flex>
	);
};
