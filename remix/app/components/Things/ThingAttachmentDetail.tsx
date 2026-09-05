import { ProgressiveImage } from '~/components/Attachments/ProgressiveImage';
import React from 'react';
import { Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { ChevronDown, ChevronUp, Download, ExternalLink, EyeOff, Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router';

import {
	attachmentContentUrl,
	attachmentDisplayName,
	attachmentMediaSrc,
	attachmentTypeLabel,
	formatAttachmentBytes
} from '~/components/Attachments/attachmentUiCore';
import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { AudioAttachmentPlayer } from '~/components/Attachments/AudioAttachmentPlayer';
import type { PublicPost } from '~/components/Feed/feedTypes';
import { CARD_STYLES } from '~/theme/card';

const MUTED = 'var(--tt-muted, #9a9aa6)';

const readableDate = (value: string) => {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
};

const referenceLabel = (reference: PublicPost) => (reference.thingtime.includes('comment') ? 'Comment' : 'Post');

const referenceSummary = (reference: PublicPost) => {
	const text = reference.text.trim();
	if (text) return text;
	if (reference.richText) return 'Rich text';
	if (reference.attachments.length) return `${reference.attachments.length} attachment${reference.attachments.length === 1 ? '' : 's'}`;
	return 'No text';
};

const ReferenceRow = ({ reference }: { reference: PublicPost }) => {
	const author = reference.author?.displayName || reference.author?.username || 'Unknown author';
	return (
		<Flex
			as={Link}
			to={`/post/${encodeURIComponent(reference.id)}`}
			align="center"
			gap={3}
			minW={0}
			p={3}
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-surface, #fafafb)"
			_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)', textDecoration: 'none' }}
		>
			<Box color={MUTED} flexShrink={0} aria-hidden>
				<ExternalLink size={16} />
			</Box>
			<Box flex="1" minW={0}>
				<Flex align="baseline" gap={2} minW={0}>
					<Text fontSize="sm" fontWeight={700} noOfLines={1}>
						{author}
					</Text>
					<Text color={MUTED} fontSize="xs" noOfLines={1}>
						{referenceLabel(reference)} · {readableDate(reference.createdAt)}
					</Text>
				</Flex>
				<Text color="var(--tt-text, #5a5a66)" fontSize="sm" mt={0.5} noOfLines={2}>
					{referenceSummary(reference)}
				</Text>
			</Box>
		</Flex>
	);
};

export const ThingAttachmentDetail = ({ attachment, references }: { attachment: PublicAttachment; references: PublicPost[] }) => {
	const [referencesOpen, setReferencesOpen] = React.useState(false);
	const [showSensitiveImage, setShowSensitiveImage] = React.useState(false);
	const [imageFailed, setImageFailed] = React.useState(false);
	const isImage = attachment.mediaKind === 'image';
	const isAudio = attachment.mediaKind === 'audio';
	const imageVisible = isImage && (!attachment.nsfw || showSensitiveImage) && !imageFailed;
	const title = attachment.title || attachmentDisplayName(attachment);

	return (
		<Stack spacing={4} minW={0}>
			<Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0}>
				<Flex align="flex-start" justify="space-between" gap={4} wrap="wrap">
					<Box minW={0}>
						<Flex align="center" gap={2} mb={2} color={MUTED}>
							<ImageIcon size={16} aria-hidden />
							<Text fontFamily="mono" fontSize="10px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase">
								Attachment
							</Text>
						</Flex>
						<Heading as="h2" fontSize={{ base: 'lg', md: 'xl' }} overflowWrap="anywhere">
							{title}
						</Heading>
						{attachment.description ? (
							<Text mt={2} color="var(--tt-text, #5a5a66)" fontSize="sm" whiteSpace="pre-wrap">
								{attachment.description}
							</Text>
						) : null}
						<Text mt={2} color={MUTED} fontSize="xs" overflowWrap="anywhere">
							{attachmentDisplayName(attachment)} · {attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)} ·{' '}
							{attachmentTypeLabel(attachment)}
						</Text>
					</Box>
					<Button
						as="a"
						href={attachment.url || attachmentContentUrl(attachment.id, true)}
						{...(attachment.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: attachment.name })}
						size="sm"
						variant="outline"
						leftIcon={<Download size={15} />}
					>
						Download
					</Button>
				</Flex>

				{isImage ? (
					<Box mt={5} borderRadius="var(--tt-radius-lg, 14px)" overflow="hidden" background="var(--tt-surface-alt, #f5f5f7)">
						{imageVisible ? (
							<ProgressiveImage
								src={attachmentMediaSrc(attachment)}
								alt={attachment.description || title}
								display="block"
								maxH={{ base: '62vh', md: '72vh' }}
								maxW="100%"
								mx="auto"
								objectFit="contain"
								onError={() => setImageFailed(true)}
							/>
						) : (
							<Flex minH={{ base: '260px', md: '360px' }} align="center" direction="column" justify="center" gap={3} p={6} textAlign="center">
								<EyeOff size={24} color={MUTED} aria-hidden />
								<Text color={MUTED} fontSize="sm">
									{attachment.nsfw ? 'Sensitive image hidden' : 'This image could not be displayed'}
								</Text>
								{attachment.nsfw ? (
									<Button size="sm" onClick={() => setShowSensitiveImage(true)}>
										Show image
									</Button>
								) : null}
							</Flex>
						)}
					</Box>
				) : null}
				{isAudio ? (
					<Box mt={5}>
						<AudioAttachmentPlayer attachments={[attachment]} />
					</Box>
				) : null}
			</Box>

			<Box {...CARD_STYLES} p={{ base: 4, md: 5 }} minW={0}>
				<Flex align="center" justify="space-between" gap={3} wrap="wrap">
					<Box>
						<Heading as="h2" fontSize="md">
							Referenced by {references.length}
						</Heading>
						<Text color={MUTED} fontSize="sm" mt={1}>
							{references.length
								? `${references.length} direct ${
										references.length === 1 ? 'post or comment reference is' : 'post or comment references are'
								  } available.`
								: 'No viewable post or comment currently references this attachment.'}
						</Text>
					</Box>
					{references.length ? (
						<Button
							size="sm"
							variant="outline"
							aria-expanded={referencesOpen}
							onClick={() => setReferencesOpen((open) => !open)}
							rightIcon={referencesOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
						>
							{referencesOpen ? 'Hide reference' : 'Show reference'}
						</Button>
					) : null}
				</Flex>
				{referencesOpen ? (
					<Stack mt={4} spacing={2}>
						{references.map((reference) => (
							<ReferenceRow key={reference.id} reference={reference} />
						))}
					</Stack>
				) : null}
			</Box>
		</Stack>
	);
};
