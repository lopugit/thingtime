export type AttachmentMediaKind = 'image' | 'video' | 'file';

export type AttachmentUploadPurpose = 'post' | 'comment' | 'message' | 'profile-avatar' | 'profile-banner' | 'custom-emoji';

export type AttachmentUploadOptions = {
	purpose?: AttachmentUploadPurpose;
	maxFiles?: number;
	imageOnly?: boolean;
	maxBytesPerFile?: number;
	allowedContentTypes?: readonly string[];
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
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
	// Server-sniffed real container type, present only when contentType stays an
	// opaque application/octet-stream download (for example video/x-msvideo).
	detectedContentType?: string;
	// stamped true by the server moderation pipeline; media renders blurred
	// behind a "Show Anyway" consent click
	nsfw?: boolean;
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
