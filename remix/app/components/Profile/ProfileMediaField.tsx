import React from 'react';
import { Box, Button, Flex, IconButton, Image, Input, Progress, Text } from '@chakra-ui/react';
import { ImagePlus, Link2, RotateCcw, Trash2, X } from 'lucide-react';

import { formatAttachmentBytes } from '~/components/Attachments/attachmentUiCore';
import type { ComposerAttachmentUpload } from '~/components/Attachments/attachmentTypes';
import { useAttachmentUploads } from '~/components/Attachments/useAttachmentUploads';
import { useLopu } from '~/components/Lopu/useLopu';
import { MediaAddTile, MediaGalleryGrid, MediaGalleryTile } from '~/components/Media/MediaGallery';
import {
	initialExternalProfileImageUrl,
	isExternalProfileImageUrl,
	isManagedProfileMediaUrl,
	profileImageFileError,
	type ProfileMediaFieldSnapshot,
	type ProfileMediaMutation,
	type ProfileMediaSlot
} from './profileMediaCore';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const ACCEPTED_PROFILE_IMAGES = 'image/avif,image/gif,image/jpeg,image/png,image/webp';

type ProfileMediaIntent = ProfileMediaMutation['kind'];

export type ProfileMediaFieldProps = {
	slot: ProfileMediaSlot;
	ownerId: string;
	savedUrl: string | null;
	savedLinkedUrl: string | null;
	disabled?: boolean;
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
	onChange: (snapshot: ProfileMediaFieldSnapshot) => void;
};

export type ProfileMediaFieldHandle = {
	commit: (savedUrl: string | null, savedLinkedUrl: string | null) => void;
};

const statusText = (upload: ComposerAttachmentUpload | undefined): string | null => {
	if (!upload) return null;
	if (upload.status === 'queued') return 'Waiting to upload…';
	if (upload.status === 'preparing') return 'Preparing private upload…';
	if (upload.status === 'uploading') return `Uploading privately · ${upload.progress}%`;
	if (upload.status === 'finalizing') return 'Verifying image…';
	if (upload.status === 'ready') return 'Ready to save';
	return upload.error || 'This image could not be uploaded.';
};

const ProfileMediaFieldInner = React.forwardRef<ProfileMediaFieldHandle, ProfileMediaFieldProps>((props, ref) => {
	const { slot, ownerId, savedUrl, savedLinkedUrl, disabled, remainingBytes, storageStatus, onChange } = props;
	const lopu = useLopu();
	const label = slot === 'avatar' ? 'Avatar' : 'Banner';
	const purpose = slot === 'avatar' ? 'profile-avatar' : 'profile-banner';
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const [baselineUrl, setBaselineUrl] = React.useState<string | null>(savedUrl);
	const [baselineLinkedUrl, setBaselineLinkedUrl] = React.useState<string | null>(savedLinkedUrl);
	const [externalInput, setExternalInput] = React.useState(() => initialExternalProfileImageUrl(savedLinkedUrl));
	const [showExternal, setShowExternal] = React.useState(false);
	const [intent, setIntent] = React.useState<ProfileMediaIntent>('preserve');
	const [brokenPreview, setBrokenPreview] = React.useState(false);

	const onCleanupError = React.useCallback(
		(message: string) =>
			lopu({
				title: `${label} draft cleanup needs another try`,
				description: message,
				status: 'error',
				duration: 7000
			}),
		[label, lopu]
	);
	const onSelectionError = React.useCallback(
		(message: string) => lopu({ title: `Choose a different ${label.toLowerCase()}`, description: message, status: 'info', duration: 7000 }),
		[label, lopu]
	);
	const onCleanupDeferred = React.useCallback(
		() =>
			lopu({
				title: 'Storage cleanup is settling securely',
				description: 'Those bytes remain reserved for now and will be released automatically.',
				status: 'info',
				duration: 7000
			}),
		[lopu]
	);
	const { uploads, replaceFiles, retry, remove, markCommitted } = useAttachmentUploads(
		ownerId,
		onCleanupError,
		onSelectionError,
		false,
		onCleanupDeferred,
		{ purpose, maxFiles: 1, imageOnly: true }
	);
	const upload = uploads[0];

	React.useEffect(() => {
		setBaselineUrl(savedUrl);
		setBaselineLinkedUrl(savedLinkedUrl);
		setExternalInput(initialExternalProfileImageUrl(savedLinkedUrl));
		setShowExternal(false);
		setIntent('preserve');
		setBrokenPreview(false);
		// ownerId keys the profile form; resetting here also fences account-switch
		// state even if two accounts happen to project the same image URL.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ownerId]);

	const cancelSelectedUpload = React.useCallback(() => {
		for (const selected of uploads) remove(selected.localId);
		setIntent('preserve');
		setBrokenPreview(false);
	}, [remove, uploads]);

	const choose = React.useCallback(
		(files: FileList | null) => {
			const file = files?.[0];
			if (!file) return;
			const error = profileImageFileError(file);
			if (error) {
				onSelectionError(error);
				return;
			}
			setIntent('attachment');
			setShowExternal(false);
			setBrokenPreview(false);
			replaceFiles([file]);
		},
		[onSelectionError, replaceFiles]
	);

	const beginExternal = React.useCallback(() => {
		for (const selected of uploads) remove(selected.localId);
		const linkedUrl = initialExternalProfileImageUrl(baselineLinkedUrl);
		setIntent(linkedUrl ? 'external' : 'preserve');
		setExternalInput(linkedUrl);
		setShowExternal(true);
		setBrokenPreview(false);
	}, [baselineLinkedUrl, remove, uploads]);

	const cancelExternal = React.useCallback(() => {
		setExternalInput(initialExternalProfileImageUrl(baselineLinkedUrl));
		setShowExternal(false);
		setIntent('preserve');
		setBrokenPreview(false);
	}, [baselineLinkedUrl]);

	const clearMedia = React.useCallback(() => {
		for (const selected of uploads) remove(selected.localId);
		setExternalInput('');
		setShowExternal(false);
		setIntent('clear');
		setBrokenPreview(false);
	}, [remove, uploads]);

	const externalUrl = externalInput.trim();
	const externalValid = isExternalProfileImageUrl(externalUrl);
	const readyAttachmentId = upload?.status === 'ready' ? upload.attachment?.id || null : null;
	const mutation = React.useMemo<ProfileMediaMutation>(() => {
		if (intent === 'clear') return { kind: 'clear' };
		if (intent === 'external' && externalValid) return { kind: 'external', url: externalUrl };
		if (intent === 'attachment' && readyAttachmentId) return { kind: 'attachment', attachmentId: readyAttachmentId };
		return { kind: 'preserve' };
	}, [externalUrl, externalValid, intent, readyAttachmentId]);
	const blocking = (intent === 'attachment' && (!upload || upload.status !== 'ready')) || (intent === 'external' && !externalValid);
	const previewUrl =
		intent === 'clear'
			? null
			: intent === 'attachment' && upload?.previewUrl
			? upload.previewUrl
			: intent === 'external' && externalValid
			? externalUrl
			: baselineUrl;

	React.useEffect(() => setBrokenPreview(false), [previewUrl]);

	const snapshot = React.useMemo<ProfileMediaFieldSnapshot>(
		() => ({ mutation, previewUrl: previewUrl || null, blocking }),
		[blocking, mutation, previewUrl]
	);
	const emittedRef = React.useRef('');
	React.useEffect(() => {
		const signature = JSON.stringify(snapshot);
		if (signature === emittedRef.current) return;
		emittedRef.current = signature;
		onChange(snapshot);
	}, [onChange, snapshot]);

	React.useImperativeHandle(
		ref,
		() => ({
			commit: (nextSavedUrl, nextSavedLinkedUrl) => {
				const committedIds = uploads.flatMap((selected) => (selected.attachment ? [selected.attachment.id] : []));
				markCommitted(committedIds);
				for (const selected of uploads) remove(selected.localId);
				setBaselineUrl(nextSavedUrl);
				setBaselineLinkedUrl(nextSavedLinkedUrl);
				setExternalInput(initialExternalProfileImageUrl(nextSavedLinkedUrl));
				setShowExternal(false);
				setIntent('preserve');
				setBrokenPreview(false);
			}
		}),
		[markCommitted, remove, uploads]
	);

	const uploadLabel = statusText(upload);
	const hasDisplayedMedia = Boolean(previewUrl) || intent === 'clear' || Boolean(upload);
	const currentLabel =
		intent === 'clear'
			? 'Will be removed when you save'
			: uploadLabel
			? uploadLabel
			: baselineUrl
			? isManagedProfileMediaUrl(baselineUrl)
				? 'Saved privately in Thingtime'
				: 'Public image URL'
			: 'No image selected';
	const storageLabel =
		storageStatus === 'reconciling'
			? 'Storage is being verified; the server will check this image.'
			: storageStatus === 'unavailable'
			? 'Storage availability will be checked before upload.'
			: remainingBytes === null || remainingBytes === undefined
			? 'Your storage tier is checked before upload.'
			: `${formatAttachmentBytes(remainingBytes)} currently available.`;

	const preview =
		previewUrl && !brokenPreview ? (
			slot === 'avatar' ? (
				<Flex width="100%" height="100%" alignItems="center" justifyContent="center" padding={3}>
					<Image
						src={previewUrl}
						alt="Avatar preview"
						boxSize="82%"
						borderRadius="999px"
						objectFit="cover"
						referrerPolicy="no-referrer"
						onError={() => setBrokenPreview(true)}
					/>
				</Flex>
			) : (
				<Image
					src={previewUrl}
					alt="Banner preview"
					width="100%"
					height="100%"
					objectFit="cover"
					referrerPolicy="no-referrer"
					onError={() => setBrokenPreview(true)}
				/>
			)
		) : (
			<Flex width="100%" height="100%" alignItems="center" justifyContent="center" padding={3} textAlign="center">
				<Text fontSize="xs" color={MUTED} whiteSpace="normal">
					{brokenPreview ? 'Preview unavailable' : intent === 'clear' ? `${label} will be removed` : `Add a ${label.toLowerCase()}`}
				</Text>
			</Flex>
		);

	return (
		<Flex flexDirection="column" rowGap={2} role="group" aria-label={`${label} media`}>
			<Flex alignItems="flex-start" columnGap={2} rowGap={1} flexWrap="wrap">
				<Box>
					<Text fontSize="xs" fontWeight={650} color="var(--tt-text, #5a5a66)">
						{label} image
					</Text>
					<Text fontSize="11px" color={MUTED} whiteSpace="normal">
						Private uploads count toward this account’s storage. {storageLabel}
					</Text>
				</Box>
			</Flex>

			<input
				ref={inputRef}
				type="file"
				accept={ACCEPTED_PROFILE_IMAGES}
				hidden
				disabled={disabled}
				aria-label={`Choose ${label.toLowerCase()} image`}
				onChange={(event) => {
					choose(event.currentTarget.files);
					event.currentTarget.value = '';
				}}
			/>

			<Box width="100%" maxWidth={slot === 'avatar' ? '360px' : '520px'}>
				<MediaGalleryGrid ariaLabel={`${label} media preview`} templateColumns="minmax(0, 1fr)">
					{hasDisplayedMedia ? (
						<MediaGalleryTile
							ariaLabel={`${label} image`}
							invalid={upload?.status === 'error' || (intent === 'external' && !externalValid)}
							aspectRatio={slot === 'avatar' ? 1 : 16 / 7}
							preview={preview}
							action={
								<IconButton
									aria-label={
										upload
											? `Cancel selected ${label.toLowerCase()} upload`
											: intent === 'clear'
											? `Keep current ${label.toLowerCase()}`
											: `Remove ${label.toLowerCase()}`
									}
									icon={intent === 'clear' ? <RotateCcw size={14} /> : <X size={14} />}
									size="sm"
									minWidth="44px"
									height="44px"
									position="absolute"
									top={1}
									right={1}
									variant="solid"
									background="rgba(255,255,255,0.92)"
									color={MUTED}
									borderRadius="999px"
									isDisabled={disabled}
									onClick={upload ? cancelSelectedUpload : intent === 'external' || intent === 'clear' ? cancelExternal : clearMedia}
								/>
							}
						>
							<Text
								fontSize="11px"
								color={upload?.status === 'error' ? 'var(--tt-danger, #e5484d)' : MUTED}
								role={upload ? (upload.status === 'error' ? 'alert' : 'status') : undefined}
								whiteSpace="normal"
							>
								{upload ? `${formatAttachmentBytes(upload.file.size)} · ${currentLabel}` : currentLabel}
							</Text>
							{upload && upload.status !== 'ready' && upload.status !== 'error' ? (
								<Progress
									value={upload.progress}
									size="xs"
									colorScheme="purple"
									borderRadius="999px"
									marginTop={1.5}
									aria-label={`${label} upload progress`}
								/>
							) : null}
							{upload?.status === 'error' && upload.failedAt !== 'terminal' ? (
								<Button
									type="button"
									size="sm"
									width="100%"
									minHeight="44px"
									marginTop={1.5}
									variant="ghost"
									leftIcon={<RotateCcw size={14} />}
									isDisabled={disabled}
									onClick={() => retry(upload.localId)}
								>
									Retry upload
								</Button>
							) : null}
							<Button
								type="button"
								size="sm"
								width="100%"
								minHeight="44px"
								marginTop={1.5}
								variant="outline"
								leftIcon={<ImagePlus size={14} />}
								isDisabled={disabled}
								onClick={() => inputRef.current?.click()}
							>
								Replace media
							</Button>
						</MediaGalleryTile>
					) : (
						<MediaAddTile
							ariaLabel={`Add ${label.toLowerCase()} media`}
							disabled={disabled}
							minHeight={slot === 'avatar' ? '150px' : '120px'}
							onClick={() => inputRef.current?.click()}
						>
							<Flex flexDirection="column" alignItems="center" rowGap={2}>
								<ImagePlus size={22} aria-hidden />
								<Box as="span">🏞️ Add Media</Box>
							</Flex>
						</MediaAddTile>
					)}
				</MediaGalleryGrid>
			</Box>

			<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
				<Button
					type="button"
					size="sm"
					minHeight="44px"
					variant="outline"
					leftIcon={<Link2 size={14} />}
					isDisabled={disabled}
					aria-expanded={showExternal}
					aria-controls={`${slot}-external-image-panel`}
					onClick={showExternal ? cancelExternal : beginExternal}
				>
					{showExternal ? 'Cancel public URL' : 'Use public image URL'}
				</Button>
				{(baselineUrl || upload || intent === 'external') && intent !== 'clear' ? (
					<Button type="button" size="sm" minHeight="44px" variant="ghost" leftIcon={<Trash2 size={14} />} isDisabled={disabled} onClick={clearMedia}>
						Remove {label.toLowerCase()}
					</Button>
				) : null}
			</Flex>

			{showExternal ? (
				<Flex
					id={`${slot}-external-image-panel`}
					flexDirection="column"
					rowGap={1.5}
					padding={3}
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="12px"
				>
					<Text as="label" htmlFor={`${slot}-external-image-url`} fontSize="xs" fontWeight={650}>
						Public http(s) image URL
					</Text>
					<Input
						id={`${slot}-external-image-url`}
						value={externalInput}
						placeholder="https://…"
						minHeight="44px"
						isDisabled={disabled}
						aria-invalid={intent === 'external' && !externalValid}
						aria-describedby={`${slot}-external-image-help`}
						onChange={(event) => {
							const value = event.target.value;
							setExternalInput(value);
							setBrokenPreview(false);
							if (value.trim()) setIntent('external');
							else setIntent(initialExternalProfileImageUrl(baselineLinkedUrl) ? 'clear' : 'preserve');
						}}
					/>
					<Text
						id={`${slot}-external-image-help`}
						fontSize="11px"
						color={intent === 'external' && !externalValid ? 'var(--tt-danger, #e5484d)' : MUTED}
						role={intent === 'external' && !externalValid ? 'alert' : undefined}
						whiteSpace="normal"
					>
						{intent === 'external' && !externalValid
							? 'Enter one full http(s) image URL without credentials or spaces.'
							: 'Public image hosts can see viewers’ network requests. Thingtime uploads stay private in S3.'}
					</Text>
				</Flex>
			) : null}
		</Flex>
	);
});

ProfileMediaFieldInner.displayName = 'ProfileMediaFieldInner';

export const ProfileMediaField = React.memo(ProfileMediaFieldInner);
ProfileMediaField.displayName = 'ProfileMediaField';
