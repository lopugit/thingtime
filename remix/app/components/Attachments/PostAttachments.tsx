import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Download, File as FileIcon } from 'lucide-react';

import { attachmentContentUrl, formatAttachmentBytes, normalizePublicAttachment } from './attachmentUiCore';
import { MediaLightbox } from './MediaLightbox';
import type { PublicAttachment } from './attachmentTypes';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';

// A post's attachment gallery. Images flow as a natural-aspect masonry (CSS
// columns — first image top-left, order runs down each column); clicking one
// opens the MediaLightbox, which deeplinks to each media's own /media/:id
// Thing page. Videos keep inline players; generic files stay download rows.

export const PostAttachments = ({
	attachments,
	compact,
	ariaLabel = 'Attachments'
}: {
	attachments?: PublicAttachment[];
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

	return (
		<Flex flexDirection="column" rowGap={compact ? 2 : 3} aria-label={ariaLabel}>
			{images.length > 0 && (
				<Box
					sx={{
						columnCount: images.length === 1 ? 1 : compact ? 2 : { base: 2, sm: Math.min(3, images.length) },
						columnGap: '6px'
					}}
				>
					{images.map((attachment, index) => (
						<Box
							key={attachment.id}
							as="button"
							type="button"
							display="block"
							width="100%"
							marginBottom="6px"
							position="relative"
							borderRadius="var(--tt-radius-md, 12px)"
							overflow="hidden"
							cursor="zoom-in"
							sx={{ breakInside: 'avoid' }}
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
								maxHeight={compact ? '360px' : '640px'}
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
					))}
				</Box>
			)}

			{videos.map((attachment) => (
				<Box
					key={attachment.id}
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
				/>
			))}

			{files.length > 0 && (
				<Flex flexDirection="column" rowGap={1.5}>
					{files.map((attachment) => (
						<Flex
							key={attachment.id}
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
								<Text fontSize={compact ? 'xs' : 'sm'} fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={attachment.title || attachment.name}>
									{attachment.title || attachment.name}
								</Text>
								<Text fontSize="10px" color={MUTED} noOfLines={1}>
									{formatAttachmentBytes(attachment.size)} · {attachment.contentType || 'File'}
								</Text>
							</Box>
							<Download size={15} color="var(--tt-link, #2f8fd6)" aria-label={`Download ${attachment.name}`} />
						</Flex>
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
