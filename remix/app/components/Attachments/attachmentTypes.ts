export type AttachmentMediaKind = 'image' | 'video' | 'audio' | 'file';

export type AttachmentUploadPurpose = 'post' | 'comment' | 'message' | 'profile-avatar' | 'profile-banner' | 'custom-emoji';

export type AttachmentUploadOptions = {
	purpose?: AttachmentUploadPurpose;
	maxFiles?: number;
	imageOnly?: boolean;
	maxBytesPerFile?: number;
	allowedContentTypes?: readonly string[];
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
	// Edit mode: a post's legacy crystal.images URLs, seeded as ready LOCAL
	// linked entries (synthetic legacyurl- ids). They render/reorder/remove
	// like any linked tile; the composer mints them into real linked
	// attachments at save time. Read once on mount.
	initialLinkedSeeds?: readonly string[];
};

// Stable, public attachment metadata. S3 bucket names, object keys, upload ids,
// and presigned URLs never enter this shape. Content is always reached through
// the authenticated same-origin endpoint derived from `id`.
export type PublicAttachment = {
	id: string;
	name: string;
	size: number;
	contentType: string;
	mediaKind: AttachmentMediaKind;
	// owner-selected display label; the original upload name remains immutable
	filenamePreview?: string;
	// owner-authored presentation text (media page + lightbox); absent = none
	title?: string;
	description?: string;
	// Server-sniffed real container type, present only when contentType stays an
	// opaque application/octet-stream download (for example video/x-msvideo).
	detectedContentType?: string;
	// stamped true by the server moderation pipeline; media renders blurred
	// behind a "Show Anyway" consent click
	nsfw?: boolean;
	// linked attachments only: the external media URL — renderers use it
	// directly (img/video/anchor) instead of the content endpoint
	url?: string;
	// owner's view of their OWN moderation-pending attachment (projection-only
	// server flag) — renders with a "checking" badge instead of vanishing
	pending?: true;
};

export type AttachmentUploadStatus = 'queued' | 'preparing' | 'uploading' | 'finalizing' | 'ready' | 'error';

export type ComposerAttachmentUpload = {
	localId: string;
	file: File;
	previewUrl: string | null;
	status: AttachmentUploadStatus;
	progress: number;
	uploadId: string | null;
	attachment: PublicAttachment | null;
	error: string | null;
	failedAt: 'prepare' | 'upload' | 'complete' | 'terminal' | null;
	// present on URL-based entries: no bytes/S3 flow — the entry was minted (or
	// will be, for legacy seeds) through /api/v1/attachments/link
	linked?: { url: string; legacySeed?: boolean };
};

export type AttachmentComposerSnapshot = {
	attachmentIds: string[];
	attachments: PublicAttachment[];
	blocking: boolean;
	hasSelection: boolean;
};

export type MultipartUploadInit = {
	id: string;
	partSizeBytes: number;
	partCount: number;
	expiresAt: string;
};

export type SignedUploadPart = {
	partNumber: number;
	url: string;
	expiresAt: string;
	headers: Record<string, string>;
};
