import React from 'react';
import { Box, Button, Flex, IconButton, Image, Progress, Text } from '@chakra-ui/react';
import { CheckCircle2, File as FileIcon, Image as ImageIcon, Paperclip, RotateCcw, UploadCloud, Video as VideoIcon, X } from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { formatAttachmentBytes, localFileMediaKind, MAX_POST_ATTACHMENTS } from './attachmentUiCore';
import type { AttachmentComposerSnapshot, ComposerAttachmentUpload } from './attachmentTypes';
import { useAttachmentUploads } from './useAttachmentUploads';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const TEXT = 'var(--tt-text, #5a5a66)';
const BORDER = '1px solid var(--tt-border, #ececef)';

export type AttachmentComposerProps = {
	ownerId: string;
	disabled?: boolean;
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
	onChange: (snapshot: AttachmentComposerSnapshot) => void;
};

export type AttachmentComposerHandle = {
	markCommitted: (attachmentIds: string[]) => void;
};

const statusLabel = (upload: ComposerAttachmentUpload) => {
	if (upload.status === 'queued') return 'Waiting…';
	if (upload.status === 'preparing') return 'Preparing secure upload…';
	if (upload.status === 'uploading') return `Uploading · ${upload.progress}%`;
	if (upload.status === 'finalizing') return 'Verifying upload…';
	if (upload.status === 'ready') return 'Ready';
	return upload.error || 'Upload failed.';
};

const UploadPreview = ({ upload }: { upload: ComposerAttachmentUpload }) => {
	const kind = localFileMediaKind(upload.file);
	if (kind === 'image' && upload.previewUrl) {
		return (
			<Image
				src={upload.previewUrl}
				alt=""
				boxSize="48px"
				borderRadius="var(--tt-radius-sm, 9px)"
				objectFit="cover"
				background="var(--tt-surface-alt, #f5f5f7)"
				flexShrink={0}
			/>
		);
	}
	if (kind === 'video' && upload.previewUrl) {
		return (
			<Box
				as="video"
				src={upload.previewUrl}
				aria-label={`Preview of ${upload.file.name}`}
				boxSize="48px"
				borderRadius="var(--tt-radius-sm, 9px)"
				objectFit="cover"
				background="var(--tt-ink, #16161a)"
				muted
				playsInline
				preload="metadata"
				flexShrink={0}
			/>
		);
	}
	const Icon = kind === 'image' ? ImageIcon : kind === 'video' ? VideoIcon : FileIcon;
	return (
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
			<Icon size={20} aria-hidden />
		</Flex>
	);
};

const UploadRow = (props: { upload: ComposerAttachmentUpload; disabled?: boolean; onRetry: () => void; onRemove: () => void }) => {
	const { upload, disabled, onRetry, onRemove } = props;
	const busy = upload.status !== 'ready' && upload.status !== 'error';
	return (
		<Flex
			alignItems="center"
			columnGap={3}
			padding={2}
			border={BORDER}
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-card, #ffffff)"
			minWidth={0}
		>
			<UploadPreview upload={upload} />
			<Box flex="1" minWidth={0}>
				<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={upload.file.name}>
					{upload.file.name}
				</Text>
				<Flex alignItems="center" columnGap={1.5} minWidth={0}>
					{upload.status === 'ready' && <CheckCircle2 size={12} color="var(--tt-positive, #2f9e68)" aria-hidden />}
					<Text
						fontSize="11px"
						color={upload.status === 'error' ? 'var(--tt-danger, #e5484d)' : MUTED}
						role={upload.status === 'error' ? 'status' : undefined}
						whiteSpace="normal"
					>
						{formatAttachmentBytes(upload.file.size)} · {statusLabel(upload)}
					</Text>
				</Flex>
				{busy && (
					<Progress
						value={upload.progress}
						size="xs"
						colorScheme="purple"
						borderRadius="999px"
						marginTop={1.5}
						aria-label={`Upload progress for ${upload.file.name}`}
					/>
				)}
			</Box>
			{upload.status === 'error' && upload.failedAt !== 'terminal' && (
				<IconButton
					aria-label={`Retry ${upload.file.name}`}
					icon={<RotateCcw size={14} />}
					size="sm"
					minWidth="44px"
					height="44px"
					variant="ghost"
					borderRadius="999px"
					isDisabled={disabled}
					onClick={onRetry}
				/>
			)}
			<IconButton
				aria-label={busy ? `Cancel upload for ${upload.file.name}` : `Remove ${upload.file.name}`}
				icon={<X size={14} />}
				size="sm"
				minWidth="44px"
				height="44px"
				variant="ghost"
				color={MUTED}
				borderRadius="999px"
				isDisabled={disabled}
				onClick={onRemove}
			/>
		</Flex>
	);
};

export const AttachmentComposer = React.forwardRef<AttachmentComposerHandle, AttachmentComposerProps>((props, ref) => {
	const { ownerId, disabled, remainingBytes, storageStatus, onChange } = props;
	const lopu = useLopu();
	const [dragging, setDragging] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const onCleanupError = React.useCallback((message: string) => lopu({ title: message, status: 'error' }), [lopu]);
	const onSelectionError = React.useCallback((message: string) => lopu({ title: message, status: 'info' }), [lopu]);
	const onCleanupDeferred = React.useCallback(
		() =>
			lopu({
				title: 'Storage cleanup is settling securely',
				description: 'Those bytes stay reserved for now and will be released automatically.',
				status: 'info',
				duration: 7000
			}),
		[lopu]
	);
	const { uploads, addFiles, retry, remove, markCommitted, snapshot } = useAttachmentUploads(
		ownerId,
		onCleanupError,
		onSelectionError,
		disabled === true,
		onCleanupDeferred
	);
	const pickerDisabled = disabled || uploads.length >= MAX_POST_ATTACHMENTS;

	React.useImperativeHandle(ref, () => ({ markCommitted }), [markCommitted]);

	React.useEffect(() => onChange(snapshot), [onChange, snapshot]);

	const choose = (files: FileList | null) => {
		if (files?.length) addFiles(Array.from(files));
	};

	const storageLabel =
		storageStatus === 'reconciling'
			? 'Storage is being verified; the server will check each file.'
			: storageStatus === 'unavailable'
			? 'Storage availability will be checked securely before upload.'
			: remainingBytes === null || remainingBytes === undefined
			? 'Your account tier is checked before every upload.'
			: `${formatAttachmentBytes(remainingBytes)} available on this account.`;

	return (
		<Flex flexDirection="column" rowGap={2} role="group" aria-label="Post attachments">
			<Flex alignItems="center" columnGap={2} flexWrap="wrap">
				<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
					Attachments 📎
				</Text>
				<Text fontSize="11px" color={MUTED} marginLeft="auto">
					{storageLabel}
				</Text>
			</Flex>

			<Box
				border={dragging ? '1px solid var(--tt-accent, #7c5cff)' : '1px dashed var(--tt-border, #d8d8df)'}
				borderRadius="var(--tt-radius-md, 12px)"
				background={dragging ? 'var(--tt-accent-tint, #fff5fa)' : 'var(--tt-surface, #fafafb)'}
				padding={3}
				onDragEnter={(event) => {
					event.preventDefault();
					if (!pickerDisabled) setDragging(true);
				}}
				onDragOver={(event) => event.preventDefault()}
				onDragLeave={(event) => {
					if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
					setDragging(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					if (!pickerDisabled) choose(event.dataTransfer.files);
				}}
			>
				<input
					ref={inputRef}
					type="file"
					multiple
					hidden
					disabled={pickerDisabled}
					onChange={(event) => {
						choose(event.currentTarget.files);
						event.currentTarget.value = '';
					}}
				/>
				<Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap">
					<Flex alignItems="center" justifyContent="center" boxSize="38px" borderRadius="999px" background="var(--tt-card, #ffffff)" color={TEXT}>
						<UploadCloud size={18} aria-hidden />
					</Flex>
					<Box flex="1" minWidth="180px">
						<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)">
							Photos, videos, or any file
						</Text>
						<Text fontSize="11px" color={MUTED} whiteSpace="normal">
							Drop files here or choose them. Up to 25 files stay private until the post is published.
						</Text>
					</Box>
					<Button
						size="sm"
						variant="outline"
						leftIcon={<Paperclip size={14} />}
						minHeight="44px"
						borderRadius="var(--tt-radius-md, 12px)"
						borderColor="var(--tt-border, #ececef)"
						isDisabled={pickerDisabled}
						onClick={() => inputRef.current?.click()}
					>
						Add files
					</Button>
				</Flex>
			</Box>

			{uploads.length > 0 && (
				<Flex flexDirection="column" rowGap={2} aria-live="polite" aria-relevant="additions removals">
					{uploads.map((upload) => (
						<UploadRow
							key={upload.localId}
							upload={upload}
							disabled={disabled}
							onRetry={() => retry(upload.localId)}
							onRemove={() => remove(upload.localId)}
						/>
					))}
				</Flex>
			)}
		</Flex>
	);
});

AttachmentComposer.displayName = 'AttachmentComposer';
