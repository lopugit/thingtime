import React from 'react';
import { Box, Flex, IconButton, Text } from '@chakra-ui/react';
import { File as FileIcon, GripVertical, Trash2 } from 'lucide-react';

import { MediaGalleryGrid, MediaGalleryTile } from '~/components/Media/MediaGallery';
import { AttachmentAnnotatePopover } from './AttachmentAnnotatePopover';
import { movedToTargetPosition, nudgeTargetId, useMediaReorder, type MediaReorderNudge } from '~/components/Media/useMediaReorder';
import { attachmentDisplayName, attachmentMediaSrc, formatAttachmentBytes } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';

// Edit-mode "Media & files": the post's EXISTING attachments as reorderable
// tiles. Attachments bind atomically at create time, so an edit can only
// re-sequence them — no add/remove here, and nothing uploads from this panel.
// Saving sends the ordered ids; the server re-stamps each bound attachment's
// display position (a pure permutation, verified against live state).

export type AttachmentReorderGalleryProps = {
	attachments: PublicAttachment[];
	onChange: (next: PublicAttachment[]) => void;
	disabled?: boolean;
	ariaLabel?: string;
	// optional per-tile extra control (e.g. the grid-layout size badge) rendered
	// on visual tiles, bottom-left (grip top-left, pencil top-right)
	tileExtras?: (attachment: PublicAttachment) => React.ReactNode;
	embedded?: boolean;
	onRemove?: (attachment: PublicAttachment) => void;
};

const gripLabel = (name: string, position: number, count: number) =>
	`Reorder ${name} — position ${position} of ${count}. Drag, or use arrow keys to move.`;

const AttachmentPreview = ({ attachment }: { attachment: PublicAttachment }) => {
	if (attachment.mediaKind === 'image') {
		return (
			<Box
				as="img"
				src={attachmentMediaSrc(attachment)}
				alt=""
				loading="lazy"
				referrerPolicy="no-referrer"
				width="100%"
				height="100%"
				objectFit="cover"
				background="var(--tt-surface-alt, #f5f5f7)"
			/>
		);
	}
	return (
		<Box
			as="video"
			src={attachmentMediaSrc(attachment)}
			aria-label={`Preview of ${attachmentDisplayName(attachment)}`}
			width="100%"
			height="100%"
			objectFit="cover"
			background="var(--tt-ink, #16161a)"
			muted
			playsInline
			preload="metadata"
		/>
	);
};

export const AttachmentReorderGallery = (props: AttachmentReorderGalleryProps) => {
	const { attachments, onChange, disabled, ariaLabel = 'Reorder attachments', tileExtras, embedded = false, onRemove } = props;

	const attachmentsRef = React.useRef(attachments);
	attachmentsRef.current = attachments;

	const visual = attachments.filter((attachment) => attachment.mediaKind === 'image' || attachment.mediaKind === 'video');
	const files = attachments.filter((attachment) => attachment.mediaKind !== 'image' && attachment.mediaKind !== 'video');

	const handleMove = React.useCallback(
		(sourceId: string, targetId: string) => {
			const next = movedToTargetPosition(attachmentsRef.current, (attachment) => attachment.id, sourceId, targetId);
			if (next) onChange(next);
		},
		[onChange]
	);
	const handleNudge = React.useCallback(
		(sourceId: string, nudge: MediaReorderNudge) => {
			const current = attachmentsRef.current;
			const source = current.find((attachment) => attachment.id === sourceId);
			if (!source) return;
			const sectionIds = current
				.filter((attachment) =>
					source.mediaKind === 'image' || source.mediaKind === 'video'
						? attachment.mediaKind === 'image' || attachment.mediaKind === 'video'
						: attachment.mediaKind !== 'image' && attachment.mediaKind !== 'video'
				)
				.map((attachment) => attachment.id);
			const targetId = nudgeTargetId(sectionIds, sourceId, nudge);
			if (targetId) handleMove(sourceId, targetId);
		},
		[handleMove]
	);
	const { draggingId, dropTargetId, tileProps, gripProps } = useMediaReorder({ disabled, onMove: handleMove, onNudge: handleNudge });

	// annotate saves are already persisted server-side by the popover — this
	// only reflects the new title/description in the edit panel's local list
	// (id order is untouched, so it never reads as an order change)
	const handleAnnotated = React.useCallback(
		(next: PublicAttachment) => {
			onChange(attachmentsRef.current.map((attachment) => (attachment.id === next.id ? next : attachment)));
		},
		[onChange]
	);

	if (!attachments.length) return null;

	const reorderable = attachments.length > 1 && !disabled;

	return (
		<Flex flexDirection="column" rowGap={2} role="group" aria-label={ariaLabel}>
			{!embedded ? (
			<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
				<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
					Media & files 📎
				</Text>
				<Text fontSize="11px" color={MUTED} marginLeft="auto" whiteSpace="normal">
					{reorderable ? 'Drag the ⠿ handle to set the order' : 'Attached to this post'}
				</Text>
			</Flex>
			) : null}

			<Box
				border={embedded ? undefined : '1px dashed var(--tt-border, #d8d8df)'}
				borderRadius={embedded ? undefined : 'var(--tt-radius-md, 12px)'}
				background={embedded ? undefined : 'var(--tt-surface, #fafafb)'}
				padding={embedded ? 0 : 3}
			>
				{visual.length > 0 ? (
					<MediaGalleryGrid ariaLabel="Attached media">
						{visual.map((attachment, index) => (
							<MediaGalleryTile
								key={attachment.id}
								ariaLabel={attachmentDisplayName(attachment)}
								dragging={draggingId === attachment.id}
								dropTarget={dropTargetId === attachment.id}
								containerProps={tileProps(attachment.id, 'edit-visual')}
								preview={<AttachmentPreview attachment={attachment} />}
								action={
									<>
										{reorderable && visual.length > 1 ? (
											<IconButton
											aria-label={gripLabel(attachmentDisplayName(attachment), index + 1, visual.length)}
												title="Drag to reorder"
												icon={<GripVertical size={14} />}
												size="sm"
												minWidth="44px"
												height="44px"
												position="absolute"
												top={1}
												left={1}
												variant="solid"
												background="rgba(255, 255, 255, 0.9)"
												color={MUTED}
												borderRadius="999px"
												cursor={draggingId === attachment.id ? 'grabbing' : 'grab'}
												{...gripProps(attachment.id, 'edit-visual')}
											/>
										) : null}
										<AttachmentAnnotatePopover
											attachment={attachment}
											disabled={disabled}
											onApply={handleAnnotated}
											triggerProps={{
												minWidth: '44px',
												height: '44px',
												position: 'absolute',
												top: 1,
												right: 1,
												variant: 'solid',
												background: 'rgba(255, 255, 255, 0.9)'
											}}
										/>
										{onRemove ? (
											<IconButton
												aria-label={`Delete ${attachmentDisplayName(attachment)}`}
												title="Delete media"
												icon={<Trash2 size={14} />}
												size="sm"
												minWidth="44px"
												height="44px"
												position="absolute"
												bottom={1}
												right={1}
												variant="solid"
												background="rgba(255,255,255,0.9)"
												color="var(--tt-danger, #e5484d)"
												borderRadius="999px"
												isDisabled={disabled}
												onClick={() => onRemove(attachment)}
											/>
										) : null}
										{tileExtras ? (
											<Box position="absolute" bottom={1} left={1}>
												{tileExtras(attachment)}
											</Box>
										) : null}
									</>
								}
							>
								<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={attachmentDisplayName(attachment)}>
									{attachmentDisplayName(attachment)}
								</Text>
								<Text fontSize="10px" color={MUTED} whiteSpace="normal">
									{attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)}
								</Text>
							</MediaGalleryTile>
						))}
					</MediaGalleryGrid>
				) : null}

				{files.length > 0 ? (
					<Flex flexDirection="column" rowGap={2} paddingTop={visual.length > 0 ? 2 : 0}>
						{files.map((attachment, index) => (
							<Box
								key={attachment.id}
								padding={2}
								border={BORDER}
								borderRadius="var(--tt-radius-md, 12px)"
								background="var(--tt-card, #ffffff)"
								minWidth={0}
								opacity={draggingId === attachment.id ? 0.55 : undefined}
								outline={dropTargetId === attachment.id ? '2px solid var(--tt-accent, #7c5cff)' : undefined}
								outlineOffset={dropTargetId === attachment.id ? '1px' : undefined}
								{...tileProps(attachment.id, 'edit-file')}
							>
								<Flex alignItems="center" columnGap={3} minWidth={0}>
									{reorderable && files.length > 1 ? (
										<IconButton
										aria-label={gripLabel(attachmentDisplayName(attachment), index + 1, files.length)}
											title="Drag to reorder"
											icon={<GripVertical size={14} />}
											size="sm"
											minWidth="44px"
											height="44px"
											variant="ghost"
											color={MUTED}
											borderRadius="999px"
											flexShrink={0}
											cursor={draggingId === attachment.id ? 'grabbing' : 'grab'}
											{...gripProps(attachment.id, 'edit-file')}
										/>
									) : null}
									<Flex
										alignItems="center"
										justifyContent="center"
										boxSize="48px"
										border={BORDER}
										borderRadius="var(--tt-radius-sm, 9px)"
										background="var(--tt-surface-alt, #f5f5f7)"
										color={MUTED}
										flexShrink={0}
									>
										<FileIcon size={20} aria-hidden />
									</Flex>
									<Box flex="1" minWidth={0}>
										<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={attachmentDisplayName(attachment)}>
											{attachmentDisplayName(attachment)}
										</Text>
										<Text fontSize="11px" color={MUTED} whiteSpace="normal">
											{attachment.url ? 'Linked' : formatAttachmentBytes(attachment.size)} · {attachment.contentType || 'File'}
										</Text>
									</Box>
									<AttachmentAnnotatePopover
										attachment={attachment}
										disabled={disabled}
										onApply={handleAnnotated}
										triggerProps={{ minWidth: '44px', height: '44px', flexShrink: 0 }}
									/>
									{onRemove ? (
										<IconButton
											aria-label={`Delete ${attachmentDisplayName(attachment)}`}
											title="Delete file"
											icon={<Trash2 size={14} />}
											size="sm"
											minWidth="44px"
											height="44px"
											variant="ghost"
											color="var(--tt-danger, #e5484d)"
											borderRadius="999px"
											isDisabled={disabled}
											onClick={() => onRemove(attachment)}
										/>
									) : null}
								</Flex>
							</Box>
						))}
					</Flex>
				) : null}
			</Box>
		</Flex>
	);
};
