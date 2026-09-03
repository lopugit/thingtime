import React from 'react';
import { Box, Button, Flex, IconButton, Image, Input, Progress, Text } from '@chakra-ui/react';
import {
	CheckCircle2,
	File as FileIcon,
	GripVertical,
	Image as ImageIcon,
	Link2,
	RotateCcw,
	Trash2,
	UploadCloud,
	Video as VideoIcon
} from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MediaAddTile, MediaGalleryGrid, MediaGalleryTile } from '~/components/Media/MediaGallery';
import { AttachmentAnnotatePopover } from './AttachmentAnnotatePopover';
import { AttachmentReorderGallery } from './AttachmentReorderGallery';
import { nudgeTargetId, useMediaReorder, type MediaReorderNudge, type MediaReorderTileProps } from '~/components/Media/useMediaReorder';
import {
	attachmentFilesFromClipboard,
	attachmentUploadScopeForPurpose,
	attachmentDisplayName,
	formatAttachmentBytes,
	localFileMediaKind,
	MAX_POST_ATTACHMENTS,
	sameAttachmentSnapshot
} from './attachmentUiCore';
import type { AttachmentComposerSnapshot, AttachmentUploadPurpose, ComposerAttachmentUpload, PublicAttachment } from './attachmentTypes';
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
	// show the add-by-URL row below the grid: each valid URL mints a linked
	// attachment straight into this panel (image tile or file row, duplicates
	// allowed). Available even while uploads await approval — linked media
	// consumes no Thingtime storage.
	allowLinkedUrls?: boolean;
	// edit mode: the post's legacy crystal.images URLs, shown as linked tiles
	// in this panel; the composer mints them into real linked attachments when
	// the edit saves
	initialLinkedSeeds?: readonly string[];
	// optional per-tile extra control (e.g. the grid-layout size badge) rendered
	// on READY visual tiles only, bottom-left (grip top-left, X top-right,
	// pencil bottom-right)
	tileExtras?: (attachment: PublicAttachment) => React.ReactNode;
	existingAttachments?: PublicAttachment[];
	onExistingChange?: (attachments: PublicAttachment[]) => void;
	onExistingRemove?: (attachment: PublicAttachment) => void;
};

export type AttachmentComposerHandle = {
	markCommitted: (attachmentIds: string[]) => void;
	addFiles: (files: readonly File[]) => boolean;
};

const statusLabel = (upload: ComposerAttachmentUpload) => {
	if (upload.status === 'queued') return 'Waiting…';
	if (upload.status === 'preparing') return upload.linked ? 'Linking…' : 'Preparing secure upload…';
	if (upload.status === 'uploading') return `Uploading · ${upload.progress}%`;
	if (upload.status === 'finalizing') return 'Verifying upload…';
	if (upload.status === 'ready') return 'Ready';
	return upload.error || (upload.linked ? 'Link failed.' : 'Upload failed.');
};

// Linked entries carry an empty synthetic File — bytes/kind live on the
// attachment (or, mid-mint, on the optimistic preview); uploads keep the
// original file.type bucketing.
const uploadMediaKind = (upload: ComposerAttachmentUpload) =>
	upload.linked ? upload.attachment?.mediaKind ?? (upload.previewUrl ? 'image' : 'file') : localFileMediaKind(upload.file);

const uploadSizeLabel = (upload: ComposerAttachmentUpload) => (upload.linked ? 'Linked' : formatAttachmentBytes(upload.file.size));
const uploadDisplayName = (upload: ComposerAttachmentUpload) => (upload.attachment ? attachmentDisplayName(upload.attachment) : upload.file.name);

const uploadStatusRole = (upload: ComposerAttachmentUpload): 'alert' | 'status' | undefined => {
	if (upload.status === 'error') return 'alert';
	if (upload.status === 'ready') return 'status';
	return undefined;
};

const UploadVisualPreview = ({ upload }: { upload: ComposerAttachmentUpload }) => {
	const kind = uploadMediaKind(upload);
	if (kind === 'image' && upload.previewUrl) {
		return (
			<Image
				src={upload.previewUrl}
				alt=""
				width="100%"
				height="100%"
				objectFit="cover"
				background="var(--tt-surface-alt, #f5f5f7)"
				{...(upload.linked ? { referrerPolicy: 'no-referrer' as const, loading: 'lazy' as const } : {})}
			/>
		);
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

type UploadReorderProps = {
	// stable function identities from useMediaReorder — primitives + stable
	// callbacks keep React.memo effective across per-tile progress ticks
	reorderGroup?: string;
	reorderPosition?: number;
	reorderCount?: number;
	dragging?: boolean;
	dropTarget?: boolean;
	gripProps?: (id: string, group: string) => Record<string, unknown>;
	tileProps?: (id: string, group: string) => MediaReorderTileProps;
};

const uploadGripLabel = (name: string, position?: number, count?: number) =>
	`Reorder ${name} — position ${position} of ${count}. Drag, or use arrow keys to move.`;

const UploadVisualTile = React.memo(
	(
		props: {
		upload: ComposerAttachmentUpload;
		disabled?: boolean;
		onRetry: (localId: string) => void;
		onRemove: (localId: string) => void;
		onAnnotated: (localId: string, attachment: PublicAttachment) => void;
		tileExtras?: (attachment: PublicAttachment) => React.ReactNode;
		} & UploadReorderProps
	) => {
		const {
			upload,
			disabled,
			onRetry,
			onRemove,
			onAnnotated,
			tileExtras,
			reorderGroup,
			reorderPosition,
			reorderCount,
			dragging,
			dropTarget,
			gripProps,
			tileProps
		} = props;
		const busy = upload.status !== 'ready' && upload.status !== 'error';
		const showGrip = !disabled && !!gripProps && !!reorderGroup && (reorderCount ?? 0) > 1;
		return (
			<MediaGalleryTile
				ariaLabel={uploadDisplayName(upload)}
				invalid={upload.status === 'error'}
				dragging={dragging}
				dropTarget={dropTarget}
				containerProps={reorderGroup && tileProps ? tileProps(upload.localId, reorderGroup) : undefined}
				preview={<UploadVisualPreview upload={upload} />}
				action={
					<>
						{showGrip ? (
							<IconButton
								aria-label={uploadGripLabel(upload.file.name, reorderPosition, reorderCount)}
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
								cursor={dragging ? 'grabbing' : 'grab'}
								{...gripProps(upload.localId, reorderGroup)}
							/>
						) : null}
						{upload.status === 'ready' && upload.attachment ? (
							<AttachmentAnnotatePopover
								attachment={upload.attachment}
								disabled={disabled}
								onApply={(next) => onAnnotated(upload.localId, next)}
								triggerProps={{
									minWidth: '44px',
									height: '44px',
									position: 'absolute',
									bottom: 1,
									right: 1,
									variant: 'solid',
									background: 'rgba(255, 255, 255, 0.9)'
								}}
							/>
						) : null}
						{upload.status === 'ready' && upload.attachment && tileExtras ? (
							<Box position="absolute" bottom={1} left={1}>
								{tileExtras(upload.attachment)}
							</Box>
						) : null}
						<IconButton
							aria-label={busy ? `Cancel upload for ${upload.file.name}` : `Delete ${uploadDisplayName(upload)}`}
							icon={<Trash2 size={14} />}
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
					</>
				}
			>
				<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={uploadDisplayName(upload)}>
					{uploadDisplayName(upload)}
				</Text>
				<Flex alignItems="flex-start" columnGap={1.5} minWidth={0} paddingTop={0.5}>
					{upload.status === 'ready' ? <CheckCircle2 size={12} color="var(--tt-positive, #2f9e68)" aria-hidden /> : null}
					<Text
						fontSize="10px"
						color={upload.status === 'error' ? 'var(--tt-danger, #e5484d)' : MUTED}
						role={uploadStatusRole(upload)}
						whiteSpace="normal"
					>
						{uploadSizeLabel(upload)} · {statusLabel(upload)}
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
	(
		props: {
		upload: ComposerAttachmentUpload;
		disabled?: boolean;
		onRetry: (localId: string) => void;
		onRemove: (localId: string) => void;
		onAnnotated: (localId: string, attachment: PublicAttachment) => void;
		} & UploadReorderProps
	) => {
		const {
			upload,
			disabled,
			onRetry,
			onRemove,
			onAnnotated,
			reorderGroup,
			reorderPosition,
			reorderCount,
			dragging,
			dropTarget,
			gripProps,
			tileProps
		} = props;
		const busy = upload.status !== 'ready' && upload.status !== 'error';
		const showGrip = !disabled && !!gripProps && !!reorderGroup && (reorderCount ?? 0) > 1;
		return (
			<Box
				padding={2}
				border={upload.status === 'error' ? '1px solid var(--tt-danger, #e5484d)' : BORDER}
				borderRadius="var(--tt-radius-md, 12px)"
				background="var(--tt-card, #ffffff)"
				minWidth={0}
				opacity={dragging ? 0.55 : undefined}
				outline={dropTarget ? '2px solid var(--tt-accent, #7c5cff)' : undefined}
				outlineOffset={dropTarget ? '1px' : undefined}
				{...(reorderGroup && tileProps ? tileProps(upload.localId, reorderGroup) : {})}
			>
				<Flex alignItems="center" columnGap={3} minWidth={0}>
					{showGrip ? (
						<IconButton
							aria-label={uploadGripLabel(upload.file.name, reorderPosition, reorderCount)}
							title="Drag to reorder"
							icon={<GripVertical size={14} />}
							size="sm"
							minWidth="44px"
							height="44px"
							variant="ghost"
							color={MUTED}
							borderRadius="999px"
							flexShrink={0}
							cursor={dragging ? 'grabbing' : 'grab'}
							{...gripProps(upload.localId, reorderGroup)}
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
						<Text fontSize="sm" fontWeight={650} color="var(--tt-ink, #16161a)" noOfLines={1} title={uploadDisplayName(upload)}>
							{uploadDisplayName(upload)}
						</Text>
						{upload.status !== 'error' ? (
							<Flex alignItems="flex-start" columnGap={1.5} minWidth={0}>
								{upload.status === 'ready' ? <CheckCircle2 size={12} color="var(--tt-positive, #2f9e68)" aria-hidden /> : null}
								<Text fontSize="11px" color={MUTED} role={uploadStatusRole(upload)} whiteSpace="normal">
									{uploadSizeLabel(upload)} · {statusLabel(upload)}
								</Text>
							</Flex>
						) : null}
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
					{upload.status === 'ready' && upload.attachment ? (
						<AttachmentAnnotatePopover
							attachment={upload.attachment}
							disabled={disabled}
							onApply={(next) => onAnnotated(upload.localId, next)}
							triggerProps={{ minWidth: '44px', height: '44px', flexShrink: 0 }}
						/>
					) : null}
					<IconButton
						aria-label={busy ? `Cancel upload for ${upload.file.name}` : `Delete ${upload.file.name}`}
						icon={<Trash2 size={14} />}
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
				{upload.status === 'error' ? (
					<Text fontSize="11px" lineHeight="1.5" color="var(--tt-danger, #e5484d)" role="alert" marginTop={2} whiteSpace="normal">
						{uploadSizeLabel(upload)} · {statusLabel(upload)}
					</Text>
				) : null}
			</Box>
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
		helperText,
		allowLinkedUrls = false,
		initialLinkedSeeds,
		tileExtras,
		existingAttachments = [],
		onExistingChange,
		onExistingRemove
	} = props;
	const boundedMaxFiles = Number.isFinite(maxFiles) ? Math.max(1, Math.min(MAX_POST_ATTACHMENTS, Math.trunc(maxFiles))) : MAX_POST_ATTACHMENTS;
	const lopu = useLopu();
	const currentUser = useCurrentUser();
	const uploadScope = attachmentUploadScopeForPurpose(purpose);
	const scopeEnabled = currentUser ? (uploadScope === 'private' ? currentUser.privateUploadsEnabled : currentUser.publicUploadsEnabled) : undefined;
	const uploadsNotGranted = scopeEnabled === false;
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
	const { uploads, addFiles: enqueueFiles, addLinkedUrl, retry, remove, reorder, markCommitted, updateAttachment, snapshot } = useAttachmentUploads(
		ownerId,
		onCleanupError,
		onSelectionError,
		disabled === true,
		onCleanupDeferred,
		{ purpose, maxFiles: boundedMaxFiles, imageOnly, maxBytesPerFile, allowedContentTypes, remainingBytes, storageStatus, initialLinkedSeeds }
	);
	// the add-by-URL field below the grid — clears after each accepted Add so
	// the next link goes straight in
	const [linkUrl, setLinkUrl] = React.useState('');
	const submitLinkedUrl = React.useCallback(() => {
		const value = linkUrl.trim();
		if (!value) return;
		if (addLinkedUrl(value)) setLinkUrl('');
	}, [addLinkedUrl, linkUrl]);
	// Revocation stops new starts without hiding cleanup/retry controls for a
	// draft already in progress. Server lifecycle routes remain independently
	// usable after a scope is withheld.
	const totalCount = existingAttachments.length + uploads.length;
	const pickerDisabled = disabled || uploadsNotGranted || totalCount >= boundedMaxFiles;
	// linked mints stay available while uploads await approval — they consume
	// no Thingtime object storage
	const linkAddDisabled = disabled || totalCount >= boundedMaxFiles;
	const visualUploads: ComposerAttachmentUpload[] = [];
	const fileUploads: ComposerAttachmentUpload[] = [];
	for (const upload of uploads) {
		if (uploadMediaKind(upload) === 'file') fileUploads.push(upload);
		else visualUploads.push(upload);
	}

	// Reordering moves within a section (media grid or file list) — matching
	// how posts render them — while the underlying uploads array keeps one
	// combined order that becomes the snapshot's attachmentIds order.
	const visualIdsRef = React.useRef<string[]>([]);
	visualIdsRef.current = visualUploads.map((upload) => upload.localId);
	const fileIdsRef = React.useRef<string[]>([]);
	fileIdsRef.current = fileUploads.map((upload) => upload.localId);
	const handleReorderNudge = React.useCallback(
		(sourceId: string, nudge: MediaReorderNudge) => {
			const groupIds = visualIdsRef.current.includes(sourceId) ? visualIdsRef.current : fileIdsRef.current;
			const targetId = nudgeTargetId(groupIds, sourceId, nudge);
			if (targetId) reorder(sourceId, targetId);
		},
		[reorder]
	);
	const { draggingId, dropTargetId, tileProps, gripProps } = useMediaReorder({
		disabled,
		onMove: reorder,
		onNudge: handleReorderNudge
	});

	React.useEffect(() => {
		const previous = emittedSnapshotRef.current;
		if (previous && sameAttachmentSnapshot(previous, snapshot)) return;
		emittedSnapshotRef.current = snapshot;
		onChange(snapshot);
	}, [onChange, snapshot]);

	const choose = React.useCallback(
		(files: ArrayLike<File> | readonly File[] | null): boolean => {
			const selected = Array.from(files || []);
			if (!selected.length || disabled || uploadsNotGranted) return false;
			const availableSlots = Math.max(0, boundedMaxFiles - totalCount);
			if (!availableSlots) {
				onSelectionError(boundedMaxFiles === 1 ? 'Choose one image for this profile field.' : `Posts can include up to ${boundedMaxFiles} attachments.`);
				return false;
			}
			const accepted = selected.slice(0, availableSlots);
			if (accepted.length < selected.length) {
				onSelectionError(boundedMaxFiles === 1 ? 'Choose one image for this profile field.' : `Posts can include up to ${boundedMaxFiles} attachments.`);
			}
			enqueueFiles(accepted);
			return true;
		},
		[boundedMaxFiles, disabled, enqueueFiles, onSelectionError, totalCount, uploadsNotGranted]
	);

	React.useImperativeHandle(ref, () => ({ markCommitted, addFiles: choose }), [choose, markCommitted]);

	// With the URL adder available, the panel stays useful before upload
	// approval — file picking is disabled with the note, linked media works.
	if (uploadsNotGranted && uploads.length === 0 && !allowLinkedUrls) {
		return (
			<Flex flexDirection="column" rowGap={2} role="group" aria-label={ariaLabel}>
				<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
					Media & files 📎
				</Text>
				<Box border={BORDER} borderRadius="var(--tt-radius-md, 12px)" background="var(--tt-surface, #fafafb)" padding={3}>
					<Text fontSize="12px" color={MUTED} whiteSpace="normal">
						🔐 {uploadScope === 'private' ? 'Private' : 'Public'} media uploads need admin approval during the beta. After email verification, an
						admin is notified; uploads unlock as soon as this scope is approved.
					</Text>
				</Box>
			</Flex>
		);
	}

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
			{uploadsNotGranted ? (
				<Box border={BORDER} borderRadius="var(--tt-radius-md, 12px)" background="var(--tt-surface, #fafafb)" padding={3}>
					<Text fontSize="12px" color={MUTED} whiteSpace="normal">
						{uploads.some((upload) => !upload.linked)
							? '🔐 This upload scope was withheld. New files are disabled; you can still finish, retry, or remove the current draft safely.'
							: `🔐 ${
									uploadScope === 'private' ? 'Private' : 'Public'
							  } media uploads need admin approval during the beta — an admin is notified after email verification. Linked media by URL works right away.`}
					</Text>
				</Box>
			) : null}
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
				onPaste={(event) => {
					if (event.defaultPrevented) return;
					const files = attachmentFilesFromClipboard(event.clipboardData);
					if (!files.length) return;
					event.preventDefault();
					choose(files);
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
						`${
							imageOnly
								? `${boundedMaxFiles === 1 ? 'One image' : `Up to ${boundedMaxFiles} images`} · drop or paste (⌘/Ctrl+V) ${
										boundedMaxFiles === 1 ? 'it' : 'them'
								  } anywhere in this panel`
								: `Photos, videos, or any file · up to ${boundedMaxFiles} · drop or paste (⌘/Ctrl+V) anywhere in this panel`
						}${totalCount > 1 ? ' · drag the ⠿ handle to set the order' : ''}`}
				</Text>

				{existingAttachments.length > 0 && onExistingChange ? (
					<Box paddingBottom={uploads.length > 0 || totalCount < boundedMaxFiles ? 2 : 0}>
						<AttachmentReorderGallery
							attachments={existingAttachments}
							onChange={onExistingChange}
							onRemove={onExistingRemove}
							disabled={disabled}
							embedded
							tileExtras={tileExtras}
							ariaLabel="Existing media and files"
						/>
					</Box>
				) : null}

				{visualUploads.length > 0 || totalCount < boundedMaxFiles ? (
					<MediaGalleryGrid ariaLabel="Selected media uploads">
						{visualUploads.map((upload, index) => (
							<UploadVisualTile
								key={upload.localId}
								upload={upload}
								disabled={disabled}
								onRetry={retry}
								onRemove={remove}
								onAnnotated={updateAttachment}
								tileExtras={tileExtras}
								reorderGroup="composer-visual"
								reorderPosition={index + 1}
								reorderCount={visualUploads.length}
								dragging={draggingId === upload.localId}
								dropTarget={dropTargetId === upload.localId}
								gripProps={gripProps}
								tileProps={tileProps}
							/>
						))}
						{totalCount < boundedMaxFiles ? (
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
						{fileUploads.map((upload, index) => (
							<UploadFileRow
								key={upload.localId}
								upload={upload}
								disabled={disabled}
								onRetry={retry}
								onRemove={remove}
								onAnnotated={updateAttachment}
								reorderGroup="composer-file"
								reorderPosition={index + 1}
								reorderCount={fileUploads.length}
								dragging={draggingId === upload.localId}
								dropTarget={dropTargetId === upload.localId}
								gripProps={gripProps}
								tileProps={tileProps}
							/>
						))}
					</Flex>
				) : null}

				{allowLinkedUrls ? (
					<Flex flexDirection="column" rowGap={1} paddingTop={2}>
						<Flex columnGap={2} alignItems="center">
							<Input
								size="sm"
								value={linkUrl}
								placeholder="https://example.com/photo.jpg"
								aria-label="Add media by URL"
								borderRadius="var(--tt-radius-sm, 9px)"
								background="var(--tt-card, #ffffff)"
								isDisabled={linkAddDisabled}
								onChange={(event) => setLinkUrl(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== 'Enter') return;
									event.preventDefault();
									submitLinkedUrl();
								}}
							/>
							<Button
								type="button"
								size="sm"
								minHeight="44px"
								flexShrink={0}
								borderRadius="var(--tt-radius-md, 12px)"
								leftIcon={<Link2 size={14} />}
								isDisabled={linkAddDisabled || !linkUrl.trim()}
								onClick={submitLinkedUrl}
							>
								Add
							</Button>
						</Flex>
						<Text fontSize="11px" color={MUTED} whiteSpace="normal">
							Linked media stays on the original site and doesn&apos;t use your file-storage quota. Same URL twice adds it twice.
						</Text>
					</Flex>
				) : null}
			</Box>
		</Flex>
	);
});

AttachmentComposerInner.displayName = 'AttachmentComposerInner';

export const AttachmentComposer = React.memo(AttachmentComposerInner);
AttachmentComposer.displayName = 'AttachmentComposer';
