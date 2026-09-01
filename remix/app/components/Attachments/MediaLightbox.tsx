import React from 'react';
import { Box, Flex, IconButton, Modal, ModalContent, ModalOverlay, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from 'lucide-react';

import {
	attachmentContentUrl,
	attachmentDisplayName,
	attachmentMediaSrc,
	attachmentThingUrl,
	formatAttachmentBytes,
	mediaPageUrl
} from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

// Click-to-view lightbox for a post's visual attachments. Arrow keys / edge
// buttons move through the gallery, "Open" deeplinks to the media's own
// /media/:id Thing page (comments + reactions live there), and Download uses
// the stable authenticated content URL. Videos keep their inline players —
// this modal is for images.

const MUTED = 'rgba(255, 255, 255, 0.72)';

export type MediaLightboxProps = {
	attachments: PublicAttachment[];
	index: number;
	isOpen: boolean;
	onClose: () => void;
};

export const MediaLightbox = ({ attachments, index, isOpen, onClose }: MediaLightboxProps) => {
	const [current, setCurrent] = React.useState(index);
	React.useEffect(() => {
		if (isOpen) setCurrent(index);
	}, [isOpen, index]);

	const count = attachments.length;
	const attachment = attachments[Math.min(Math.max(current, 0), Math.max(count - 1, 0))];

	const step = React.useCallback(
		(delta: number) => {
			if (count < 2) return;
			setCurrent((value) => (value + delta + count) % count);
		},
		[count]
	);

	React.useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft') step(-1);
			if (event.key === 'ArrowRight') step(1);
			// autoFocus is off, so focus can sit outside the modal where Chakra's
			// own closeOnEsc handling never hears the key — close from here too.
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [isOpen, step, onClose]);

	if (!attachment) return null;

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="full" motionPreset="none" autoFocus={false}>
			<ModalOverlay background="rgba(10, 10, 14, 0.92)" />
			<ModalContent background="transparent" boxShadow="none" margin={0} height="100dvh" borderRadius={0} onClick={onClose}>
				<Flex
					flexDirection="column"
					height="100%"
					// The persistent navigation sits above Chakra's full-screen modal.
					// Keep the filename, download, and close controls below it.
					paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 8px)"
				>
					{/* top bar */}
					<Flex alignItems="center" columnGap={1} paddingX={3} paddingY={2} onClick={(event) => event.stopPropagation()}>
						<Text
							as={Link}
							to={attachmentThingUrl(attachment.id)}
							fontSize="xs"
							color={MUTED}
							noOfLines={1}
							minWidth={0}
							flex="1"
							title={`Open ${attachmentDisplayName(attachment)} as a Thing`}
							textDecoration="underline"
							textUnderlineOffset="2px"
							_hover={{ color: 'white' }}
						>
							{attachmentDisplayName(attachment)}
							{count > 1 ? ` · ${Math.min(current, count - 1) + 1} of ${count}` : ''}
						</Text>
						<IconButton
							as={Link}
							to={mediaPageUrl(attachment.id)}
							aria-label="Open this media's own page"
							title="Open media page — comments, reactions and details"
							icon={<ExternalLink size={16} />}
							size="sm"
							variant="ghost"
							color={MUTED}
							_hover={{ color: 'white', background: 'rgba(255,255,255,0.12)' }}
							borderRadius="999px"
						/>
						<IconButton
							as="a"
							href={attachment.url || attachmentContentUrl(attachment.id, true)}
							// cross-origin ignores the download attribute — linked media opens
							// the original URL in a new tab instead
							{...(attachment.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: attachment.name })}
							aria-label={`Download ${attachmentDisplayName(attachment)}`}
							title="Download"
							icon={<Download size={16} />}
							size="sm"
							variant="ghost"
							color={MUTED}
							_hover={{ color: 'white', background: 'rgba(255,255,255,0.12)' }}
							borderRadius="999px"
						/>
						<IconButton
							aria-label="Close image popup"
							title="Close"
							icon={<X size={18} />}
							size="sm"
							variant="ghost"
							color={MUTED}
							_hover={{ color: 'white', background: 'rgba(255,255,255,0.12)' }}
							borderRadius="999px"
							onClick={onClose}
						/>
					</Flex>

					{/* stage */}
					<Flex flex="1" minHeight={0} alignItems="center" justifyContent="center" position="relative" paddingX={[2, 12]}>
						{count > 1 && (
							<IconButton
								aria-label="Previous media"
								icon={<ChevronLeft size={22} />}
								position="absolute"
								left={[1, 3]}
								size="md"
								variant="ghost"
								color={MUTED}
								_hover={{ color: 'white', background: 'rgba(255,255,255,0.12)' }}
								borderRadius="999px"
								onClick={(event) => {
									event.stopPropagation();
									step(-1);
								}}
							/>
						)}
						<Box
							as="img"
							key={attachment.id}
							src={attachmentMediaSrc(attachment)}
							alt={attachment.title || attachmentDisplayName(attachment)}
							referrerPolicy="no-referrer"
							maxWidth="100%"
							maxHeight="100%"
							objectFit="contain"
							borderRadius="var(--tt-radius-md, 12px)"
							onClick={(event: React.MouseEvent) => event.stopPropagation()}
						/>
						{count > 1 && (
							<IconButton
								aria-label="Next media"
								icon={<ChevronRight size={22} />}
								position="absolute"
								right={[1, 3]}
								size="md"
								variant="ghost"
								color={MUTED}
								_hover={{ color: 'white', background: 'rgba(255,255,255,0.12)' }}
								borderRadius="999px"
								onClick={(event) => {
									event.stopPropagation();
									step(1);
								}}
							/>
						)}
					</Flex>

					{/* caption */}
					<Flex
						flexDirection="column"
						rowGap={0.5}
						paddingX={4}
						paddingY={3}
						maxWidth="720px"
						width="100%"
						marginX="auto"
						onClick={(event) => event.stopPropagation()}
					>
						{attachment.description ? (
							<Text fontSize="sm" color="white" whiteSpace="pre-wrap" noOfLines={4}>
								{attachment.description}
							</Text>
						) : null}
						<Text fontSize="11px" color={MUTED}>
							{attachmentDisplayName(attachment)} · {attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)}
						</Text>
					</Flex>
				</Flex>
			</ModalContent>
		</Modal>
	);
};
