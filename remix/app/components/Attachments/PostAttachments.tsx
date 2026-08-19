import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Download, File as FileIcon } from 'lucide-react';

import { attachmentContentUrl, attachmentTypeLabel, formatAttachmentBytes, normalizePublicAttachment } from './attachmentUiCore';
import { MediaLightbox } from './MediaLightbox';
import type { PublicAttachment } from './attachmentTypes';
import type { MediaLayoutSpan, PostMediaLayout } from '~/schemas/registry';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';

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
const rowAspectRatio = (size: number): string => (size === 1 ? '16 / 9' : size === 2 ? '4 / 3' : '1 / 1');

const spanFor = (layout: PostMediaLayout, id: string): MediaLayoutSpan => layout.spans?.[id] || 'normal';
export const spanColumns = (span: MediaLayoutSpan, columns: number): number => (span === 'wide' || span === 'big' ? Math.min(2, columns) : 1);
export const spanRows = (span: MediaLayoutSpan): number => (span === 'tall' || span === 'big' ? 2 : 1);
export const spanAspect = (span: MediaLayoutSpan, columns: number): string => {
	const cols = spanColumns(span, columns);
	const rows = spanRows(span);
	return `${cols} / ${rows}`;
};

const AttachmentFileRow = ({ attachment, compact }: { attachment: PublicAttachment; compact?: boolean }) => (
	<Flex
		as="a"
		href={attachmentContentUrl(attachment.id, true)}
		download={attachment.name}
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
				title={attachment.title || attachment.name}
			>
				{attachment.title || attachment.name}
			</Text>
			<Text fontSize="10px" color={MUTED} noOfLines={1}>
				{formatAttachmentBytes(attachment.size)} · {attachmentTypeLabel(attachment)}
			</Text>
		</Box>
		<Download size={15} color="var(--tt-link, #2f8fd6)" aria-label={`Download ${attachment.name}`} />
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
			src={attachmentContentUrl(attachment.id)}
			aria-label={attachment.title || attachment.name}
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

	const tile = (attachment: PublicAttachment, index: number, tileSx: Record<string, unknown>, fill: boolean) => (
		<Box
			key={attachment.id}
			as="button"
			type="button"
			display="block"
			width="100%"
			position="relative"
			borderRadius="var(--tt-radius-md, 12px)"
			overflow="hidden"
			cursor="zoom-in"
			sx={tileSx}
			aria-label={`View ${attachment.title || attachment.name}`}
			onClick={() => setLightbox({ open: true, index })}
		>
			<Box
				as="img"
				src={attachmentContentUrl(attachment.id)}
				alt={attachment.title || attachment.name || `Post image ${index + 1}`}
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
			{attachment.title ? (
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
				<Box
					display="grid"
					gridTemplateColumns={`repeat(${gridColumns}, minmax(0, 1fr))`}
					gap="6px"
					sx={{ gridAutoFlow: 'dense' }}
				>
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

			{videos.map((attachment) => (
				<AttachmentVideo key={attachment.id} attachment={attachment} compact={compact} />
			))}

			{files.length > 0 && (
				<Flex flexDirection="column" rowGap={1.5}>
					{files.map((attachment) => (
						<AttachmentFileRow key={attachment.id} attachment={attachment} compact={compact} />
					))}
				</Flex>
			)}

			<MediaLightbox
				attachments={images}
				index={lightbox.index}
				isOpen={lightbox.open}
				onClose={() => setLightbox((state) => ({ ...state, open: false }))}
			/>
		</Flex>
	);
};
