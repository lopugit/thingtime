import React from 'react';
import { Box, Button, Flex, Grid, Image, Text } from '@chakra-ui/react';
import { Download, File as FileIcon } from 'lucide-react';

import { attachmentContentUrl, formatAttachmentBytes, normalizePublicAttachment } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

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
	onReveal,
	children
}: {
	name: string;
	compact?: boolean;
	onReveal: () => void;
	children: React.ReactNode;
}) => (
	<Box
		position="relative"
		overflow="hidden"
		borderRadius="var(--tt-radius-md, 12px)"
		border={`2px solid ${DANGER}`}
		role="group"
		aria-label={`${name || 'Attachment'} is hidden as NSFW`}
	>
		{/* scale hides the blur's transparent edge bleed inside the crop */}
		<Box filter="blur(64px)" opacity={0.92} transform="scale(1.15)" pointerEvents="none" aria-hidden>
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

export const PostAttachments = ({
	attachments,
	compact,
	ariaLabel = 'Attachments'
}: {
	attachments?: PublicAttachment[];
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
	if (!normalized.length) return null;

	const images = normalized.filter((attachment) => attachment.mediaKind === 'image');
	const videos = normalized.filter((attachment) => attachment.mediaKind === 'video');
	// The public normalizer deliberately maps audio to the generic file kind so
	// it stays a safe download row rather than an autoplay-capable player.
	const files = normalized.filter((attachment) => attachment.mediaKind === 'file');

	return (
		<Flex flexDirection="column" rowGap={compact ? 2 : 3} aria-label={ariaLabel}>
			{images.length > 0 && (
				<Grid templateColumns={images.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))'} gap={1.5}>
					{images.map((attachment, index) => {
						const image = (
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
						);
						return attachment.nsfw && !revealedIds.has(attachment.id) ? (
							<NsfwShield key={attachment.id} name={attachment.name} compact={compact} onReveal={() => reveal(attachment.id)}>
								{image}
							</NsfwShield>
						) : (
							image
						);
					})}
				</Grid>
			)}

			{videos.map((attachment) => {
				const video = (
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
				);
				return attachment.nsfw && !revealedIds.has(attachment.id) ? (
					<NsfwShield key={attachment.id} name={attachment.name} compact={compact} onReveal={() => reveal(attachment.id)}>
						{video}
					</NsfwShield>
				) : (
					video
				);
			})}

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
