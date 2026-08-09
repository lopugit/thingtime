import React from 'react';
import { Box, Flex, Grid, Image, Text } from '@chakra-ui/react';
import { Download, File as FileIcon } from 'lucide-react';

import { attachmentContentUrl, formatAttachmentBytes, normalizePublicAttachment } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';

export const PostAttachments = ({ attachments, compact }: { attachments?: PublicAttachment[]; compact?: boolean }) => {
	const normalized = (attachments || []).flatMap((attachment) => {
		const value = normalizePublicAttachment(attachment);
		return value ? [value] : [];
	});
	if (!normalized.length) return null;

	const images = normalized.filter((attachment) => attachment.mediaKind === 'image');
	const videos = normalized.filter((attachment) => attachment.mediaKind === 'video');
	const files = normalized.filter((attachment) => attachment.mediaKind === 'file');

	return (
		<Flex flexDirection="column" rowGap={compact ? 2 : 3} aria-label="Post attachments">
			{images.length > 0 && (
				<Grid templateColumns={images.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))'} gap={1.5}>
					{images.map((attachment, index) => (
						<Image
							key={attachment.id}
							src={attachmentContentUrl(attachment.id)}
							alt={attachment.name || `Post image ${index + 1}`}
							loading="lazy"
							referrerPolicy="no-referrer"
							width="100%"
							height={images.length === 1 ? 'auto' : compact ? '140px' : ['160px', '220px']}
							maxHeight={compact ? '320px' : '520px'}
							objectFit="cover"
							borderRadius="var(--tt-radius-md, 12px)"
							background="var(--tt-surface-alt, #f5f5f7)"
						/>
					))}
				</Grid>
			)}

			{videos.map((attachment) => (
				<Box
					key={attachment.id}
					as="video"
					src={attachmentContentUrl(attachment.id)}
					aria-label={attachment.name}
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
								<Text fontSize={compact ? 'xs' : 'sm'} fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={attachment.name}>
									{attachment.name}
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
		</Flex>
	);
};
