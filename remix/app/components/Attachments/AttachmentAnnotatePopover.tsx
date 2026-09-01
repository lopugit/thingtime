import React from 'react';
import {
	Button,
	Flex,
	FormControl,
	FormLabel,
	IconButton,
	Input,
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	Textarea
} from '@chakra-ui/react';
import { Check, Pencil, X } from 'lucide-react';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { attachmentDisplayName, normalizePublicAttachment } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';

// Pencil affordance on a READY attachment tile: a compact popover editing the
// owner-authored title/description, saved through attachments/annotate (empty
// fields clear). Optimistic house rule: `onApply` receives the new projection
// immediately on save, the server-confirmed projection on success, and the
// previous attachment again on failure (revert + Lopu toast).
export type AttachmentAnnotatePopoverProps = {
	attachment: PublicAttachment;
	onApply: (next: PublicAttachment) => void;
	disabled?: boolean;
	// placement/visual overrides for the pencil trigger (position, background…)
	triggerProps?: Omit<React.ComponentProps<typeof IconButton>, 'aria-label' | 'icon' | 'onClick'>;
};

export const AttachmentAnnotatePopover = (props: AttachmentAnnotatePopoverProps) => {
	const { attachment, onApply, disabled, triggerProps } = props;
	const api = useApi();
	const lopu = useLopu();
	const [isOpen, setIsOpen] = React.useState(false);
	const [titleDraft, setTitleDraft] = React.useState('');
	const [descriptionDraft, setDescriptionDraft] = React.useState('');
	const [filenamePreviewDraft, setFilenamePreviewDraft] = React.useState('');

	const close = () => setIsOpen(false);

	const save = () => {
		const title = titleDraft.trim();
		const description = descriptionDraft.trim();
		const filenamePreview = filenamePreviewDraft.trim();
		const previous = attachment;
		const optimistic: PublicAttachment = { ...attachment };
		if (filenamePreview) optimistic.filenamePreview = filenamePreview;
		else delete optimistic.filenamePreview;
		if (title) optimistic.title = title;
		else delete optimistic.title;
		if (description) optimistic.description = description;
		else delete optimistic.description;
		close();
		onApply(optimistic);
		api.v1.attachments
			.annotate({ id: attachment.id, filenamePreview: filenamePreview || null, title: title || null, description: description || null })
			.then((response: any) => {
				const confirmed = normalizePublicAttachment(response?.attachment);
				if (confirmed) onApply(confirmed);
			})
			.catch((error: any) => {
				onApply(previous);
				lopu({ title: error?.error || 'Could not save those details 😞', status: 'error' });
			});
	};

	return (
		<Popover isOpen={isOpen} onClose={close} placement="bottom-end" isLazy>
			<PopoverTrigger>
				<IconButton
					aria-label={`Edit display filename, title and description for ${attachmentDisplayName(attachment)}`}
					title="Edit filename preview, title & description"
					icon={<Pencil size={14} />}
					size="sm"
					variant="ghost"
					color={MUTED}
					borderRadius="999px"
					isDisabled={disabled}
					onClick={(event) => {
						// controlled Popover: preventDefault blocks PopoverTrigger's own
						// onToggle (it runs after us and would close-then-reopen), and
						// stopPropagation keeps the tile's click/drag handlers out of it
						event.preventDefault();
						event.stopPropagation();
						if (isOpen) {
							close();
							return;
						}
						setTitleDraft(attachment.title || '');
						setDescriptionDraft(attachment.description || '');
						setFilenamePreviewDraft(attachment.filenamePreview || '');
						setIsOpen(true);
					}}
					{...triggerProps}
				/>
			</PopoverTrigger>
			<Portal>
				<PopoverContent
					width="min(320px, calc(100vw - 24px))"
					maxWidth="calc(100vw - 24px)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					boxShadow="var(--tt-shadow-popover, 0 8px 30px rgba(0,0,0,0.12))"
					zIndex={10220}
					onClick={(event) => event.stopPropagation()}
				>
					<PopoverBody padding={3}>
						<Flex flexDirection="column" rowGap={2}>
							<FormControl>
								<FormLabel fontSize="11px" fontWeight={600} color={MUTED} marginBottom={1}>
									Filename preview
								</FormLabel>
								<Input
									size="sm"
									borderRadius={RADIUS_SM}
									placeholder={attachment.name}
									maxLength={255}
									value={filenamePreviewDraft}
									onChange={(event) => setFilenamePreviewDraft(event.target.value)}
								/>
							</FormControl>
							<FormControl>
								<FormLabel fontSize="11px" fontWeight={600} color={MUTED} marginBottom={1}>
									Title
								</FormLabel>
								<Input
									size="sm"
									borderRadius={RADIUS_SM}
									placeholder="Give this media a title ✨"
									maxLength={200}
									value={titleDraft}
									onChange={(event) => setTitleDraft(event.target.value)}
								/>
							</FormControl>
							<FormControl>
								<FormLabel fontSize="11px" fontWeight={600} color={MUTED} marginBottom={1}>
									Description
								</FormLabel>
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
							</FormControl>
							<Flex columnGap={2}>
								<Button type="button" size="xs" leftIcon={<Check size={13} />} borderRadius={RADIUS_SM} onClick={save}>
									Save details ✨
								</Button>
								<Button type="button" size="xs" variant="ghost" leftIcon={<X size={13} />} borderRadius={RADIUS_SM} onClick={close}>
									Cancel
								</Button>
							</Flex>
						</Flex>
					</PopoverBody>
				</PopoverContent>
			</Portal>
		</Popover>
	);
};
