import React from 'react';
import { Box, Button, Flex, IconButton, Image, Progress, Text } from '@chakra-ui/react';
import { CheckCircle2, File as FileIcon, Image as ImageIcon, RotateCcw, UploadCloud, Video as VideoIcon, X } from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { MediaAddTile, MediaGalleryGrid, MediaGalleryTile } from '~/components/Media/MediaGallery';
import { formatAttachmentBytes, localFileMediaKind, MAX_POST_ATTACHMENTS, sameAttachmentSnapshot } from './attachmentUiCore';
import type { AttachmentComposerSnapshot, AttachmentUploadPurpose, ComposerAttachmentUpload } from './attachmentTypes';
import { useAttachmentUploads } from './useAttachmentUploads';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';

export type AttachmentComposerProps = {
	ownerId: string;
	disabled?: boolean;
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
	onChange: (snapshot: AttachmentComposerSnapshot) => void;
	purpose?: AttachmentUploadPurpose;
	maxFiles?: number;
	imageOnly?: boolean;
	maxBytesPerFile?: number;
	allowedContentTypes?: readonly string[];
	ariaLabel?: string;
	helperText?: string;
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

const uploadStatusRole = (upload: ComposerAttachmentUpload): 'alert' | 'status' | undefined => {
	if (upload.status === 'error') return 'alert';
	if (upload.status === 'ready') return 'status';
	return undefined;
};

const UploadVisualPreview = ({ upload }: { upload: ComposerAttachmentUpload }) => {
	const kind = localFileMediaKind(upload.file);
	if (kind === 'image' && upload.previewUrl) {
		return <Image src={upload.previewUrl} alt="" width="100%" height="100%" objectFit="cover" background="var(--tt-surface-alt, #f5f5f7)" />;
	}
	if (kind === 'video' && upload.previewUrl) {
		return (
			<Box
				as="video"
				src={upload.previewUrl}
				aria-label={`Preview of ${upload.file.name}`}
				width="100%"
				height="100%"
				objectFit="cover"
				background="var(--tt-ink, #16161a)"
				muted
				playsInline
				preload="metadata"
			/>
		);
	}
	const Icon = kind === 'image' ? ImageIcon : VideoIcon;
	return (
		<Flex width="100%" height="100%" alignItems="center" justifyContent="center" color={MUTED}>
			<Icon size={28} aria-hidden />
		</Flex>
	);
};

const UploadVisualTile = React.memo(
	(props: { upload: ComposerAttachmentUpload; disabled?: boolean; onRetry: (localId: string) => void; onRemove: (localId: string) => void }) => {
		const { upload, disabled, onRetry, onRemove } = props;
		const busy = upload.status !== 'ready' && upload.status !== 'error';
		return (
			<MediaGalleryTile
				ariaLabel={upload.file.name}
				invalid={upload.status === 'error'}
				preview={<UploadVisualPreview upload={upload} />}
				action={
					<IconButton
						aria-label={busy ? `Cancel upload for ${upload.file.name}` : `Remove ${upload.file.name}`}
						icon={<X size={14} />}
						size="sm"
						minWidth="44px"
						height="44px"
						position="absolute"
						top={1}
						right={1}
						variant="solid"
						background="rgba(255, 255, 255, 0.9)"
			color={MUTED}
						borderRadius="999px"
						isDisabled={disabled}
						onClick={() => onRemove(upload.localId)}
					/>
				}
		>
				<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={upload.file.name}>
					{upload.file.name}
				</Text>
				<Flex alignItems="flex-start" columnGap={1.5} minWidth={0} paddingTop={0.5}>
					{upload.status === 'ready' ? <CheckCircle2 size={12} color="var(--tt-positive, #2f9e68)" aria-hidden /> : null}
					<Text
						fontSize="10px"
						color={upload.status === 'error' ? 'var(--tt-danger, #e5484d)' : MUTED}
						role={uploadStatusRole(upload)}
						whiteSpace="normal"
					>
						{formatAttachmentBytes(upload.file.size)} · {statusLabel(upload)}
					</Text>
		</Flex>
				{busy ? (
					<Progress
						value={upload.progress}
						size="xs"
						colorScheme="purple"
						borderRadius="999px"
						marginTop={1.5}
						aria-label={`Upload progress for ${upload.file.name}`}
					/>
				) : null}
				{upload.status === 'error' && upload.failedAt !== 'terminal' ? (
					<Button
						type="button"
						size="xs"
						width="100%"
						minHeight="44px"
						marginTop={1.5}
						variant="ghost"
						leftIcon={<RotateCcw size={13} />}
						isDisabled={disabled}
						onClick={() => onRetry(upload.localId)}
					>
						Retry
					</Button>
				) : null}
			</MediaGalleryTile>
	);
	}
);

UploadVisualTile.displayName = 'UploadVisualTile';

const UploadFileRow = React.memo(
	(props: { upload: ComposerAttachmentUpload; disabled?: boolean; onRetry: (localId: string) => void; onRemove: (localId: string) => void }) => {
	const { upload, disabled, onRetry, onRemove } = props;
	const busy = upload.status !== 'ready' && upload.status !== 'error';
	return (
		<Flex
			alignItems="center"
			columnGap={3}
			padding={2}
				border={upload.status === 'error' ? '1px solid var(--tt-danger, #e5484d)' : BORDER}
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-card, #ffffff)"
			minWidth={0}
		>
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
				<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={upload.file.name}>
					{upload.file.name}
				</Text>
					<Flex alignItems="flex-start" columnGap={1.5} minWidth={0}>
						{upload.status === 'ready' ? <CheckCircle2 size={12} color="var(--tt-positive, #2f9e68)" aria-hidden /> : null}
					<Text
						fontSize="11px"
						color={upload.status === 'error' ? 'var(--tt-danger, #e5484d)' : MUTED}
							role={uploadStatusRole(upload)}
						whiteSpace="normal"
					>
						{formatAttachmentBytes(upload.file.size)} · {statusLabel(upload)}
					</Text>
				</Flex>
					{busy ? (
					<Progress
						value={upload.progress}
						size="xs"
						colorScheme="purple"
						borderRadius="999px"
						marginTop={1.5}
						aria-label={`Upload progress for ${upload.file.name}`}
					/>
					) : null}
			</Box>
				{upload.status === 'error' && upload.failedAt !== 'terminal' ? (
				<IconButton
					aria-label={`Retry ${upload.file.name}`}
					icon={<RotateCcw size={14} />}
					size="sm"
					minWidth="44px"
					height="44px"
					variant="ghost"
					borderRadius="999px"
					isDisabled={disabled}
						onClick={() => onRetry(upload.localId)}
				/>
				) : null}
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
					onClick={() => onRemove(upload.localId)}
			/>
		</Flex>
	);
	}
);

UploadFileRow.displayName = 'UploadFileRow';

const AttachmentComposerInner = React.forwardRef<AttachmentComposerHandle, AttachmentComposerProps>((props, ref) => {
	const {
		ownerId,
		disabled,
		remainingBytes,
		storageStatus,
		onChange,
		purpose = 'post',
		maxFiles = MAX_POST_ATTACHMENTS,
		imageOnly = false,
		maxBytesPerFile,
		allowedContentTypes,
		ariaLabel = 'Post attachments',
		helperText
	} = props;
	const boundedMaxFiles = Number.isFinite(maxFiles) ? Math.max(1, Math.min(MAX_POST_ATTACHMENTS, Math.trunc(maxFiles))) : MAX_POST_ATTACHMENTS;
	const lopu = useLopu();
	const [dragging, setDragging] = React.useState(false);
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const emittedSnapshotRef = React.useRef<AttachmentComposerSnapshot | null>(null);
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
		onCleanupDeferred,
		{ purpose, maxFiles: boundedMaxFiles, imageOnly, maxBytesPerFile, allowedContentTypes, remainingBytes, storageStatus }
	);
	const pickerDisabled = disabled || uploads.length >= boundedMaxFiles;
	const visualUploads: ComposerAttachmentUpload[] = [];
	const fileUploads: ComposerAttachmentUpload[] = [];
	for (const upload of uploads) {
		if (localFileMediaKind(upload.file) === 'file') fileUploads.push(upload);
		else visualUploads.push(upload);
	}

	React.useImperativeHandle(ref, () => ({ markCommitted }), [markCommitted]);

	React.useEffect(() => {
		const previous = emittedSnapshotRef.current;
		if (previous && sameAttachmentSnapshot(previous, snapshot)) return;
		emittedSnapshotRef.current = snapshot;
		onChange(snapshot);
	}, [onChange, snapshot]);

	const choose = React.useCallback(
		(files: FileList | null) => {
		if (files?.length) addFiles(Array.from(files));
		},
		[addFiles]
	);

	const storageLabel =
		storageStatus === 'reconciling'
			? 'Storage is being verified; the server will check each file.'
			: storageStatus === 'unavailable'
			? 'Storage availability will be checked securely before upload.'
			: remainingBytes === null || remainingBytes === undefined
			? 'Your account tier is checked before every upload.'
			: `${formatAttachmentBytes(remainingBytes)} available on this account.`;

	return (
		<Flex flexDirection="column" rowGap={2} role="group" aria-label={ariaLabel}>
			<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
				<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
					Media & files 📎
				</Text>
				<Text fontSize="11px" color={MUTED} marginLeft="auto" whiteSpace="normal">
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
					multiple={boundedMaxFiles > 1}
					accept={allowedContentTypes?.join(',') || (imageOnly ? 'image/gif,image/jpeg,image/png,image/webp' : undefined)}
					hidden
					disabled={pickerDisabled}
					onChange={(event) => {
						choose(event.currentTarget.files);
						event.currentTarget.value = '';
					}}
				/>
				<Text fontSize="11px" color={MUTED} paddingBottom={2} whiteSpace="normal">
					{helperText ||
						(imageOnly
							? `${boundedMaxFiles === 1 ? 'One image' : `Up to ${boundedMaxFiles} images`} · drop ${
									boundedMaxFiles === 1 ? 'it' : 'them'
							  } anywhere in this panel`
							: `Photos, videos, or any file · up to ${boundedMaxFiles} · drop files anywhere in this panel`)}
						</Text>

				{visualUploads.length > 0 || uploads.length < boundedMaxFiles ? (
					<MediaGalleryGrid ariaLabel="Selected media uploads">
						{visualUploads.map((upload) => (
							<UploadVisualTile key={upload.localId} upload={upload} disabled={disabled} onRetry={retry} onRemove={remove} />
						))}
						{uploads.length < boundedMaxFiles ? (
							<MediaAddTile ariaLabel="Add media files" disabled={pickerDisabled} onClick={() => inputRef.current?.click()}>
								<Flex flexDirection="column" alignItems="center" rowGap={2}>
									<UploadCloud size={22} aria-hidden />
									<Box as="span">🏞️ Add Media</Box>
				</Flex>
							</MediaAddTile>
						) : null}
					</MediaGalleryGrid>
				) : null}

				{fileUploads.length > 0 ? (
					<Flex flexDirection="column" rowGap={2} paddingTop={visualUploads.length > 0 || uploads.length < boundedMaxFiles ? 2 : 0}>
						{fileUploads.map((upload) => (
							<UploadFileRow key={upload.localId} upload={upload} disabled={disabled} onRetry={retry} onRemove={remove} />
					))}
				</Flex>
				) : null}
			</Box>
		</Flex>
	);
});

AttachmentComposerInner.displayName = 'AttachmentComposerInner';

export const AttachmentComposer = React.memo(AttachmentComposerInner);
AttachmentComposer.displayName = 'AttachmentComposer';
