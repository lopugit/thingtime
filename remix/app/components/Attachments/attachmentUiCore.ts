import type { AttachmentComposerSnapshot, AttachmentMediaKind, ComposerAttachmentUpload, PublicAttachment } from './attachmentTypes';

const INLINE_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const INLINE_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
export const MAX_POST_ATTACHMENTS = 25;
const MAX_POST_TAGS = 12;
const MAX_POST_TAG_CHARS = 40;

// Mirrors the createThing tag canonicalizer so ambiguous POST reconciliation
// compares the exact committed payload rather than the raw composer text.
export const canonicalPostTags = (values: readonly unknown[]): string[] => {
	const tags: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const tag = value.trim().toLowerCase().slice(0, MAX_POST_TAG_CHARS);
		if (tag && !tags.includes(tag)) tags.push(tag);
		if (tags.length >= MAX_POST_TAGS) break;
	}
	return tags;
};

export const safeAttachmentMediaKind = (contentType: unknown, requestedKind?: unknown): AttachmentMediaKind => {
	const type = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
	if (requestedKind === 'image' && INLINE_IMAGE_TYPES.has(type)) return 'image';
	if (requestedKind === 'video' && INLINE_VIDEO_TYPES.has(type)) return 'video';
	return 'file';
};

export const localFileMediaKind = (file: Pick<File, 'type'>): AttachmentMediaKind => {
	const type = file.type.trim().toLowerCase();
	if (INLINE_IMAGE_TYPES.has(type)) return 'image';
	if (INLINE_VIDEO_TYPES.has(type)) return 'video';
	return 'file';
};

export const normalizePublicAttachment = (value: unknown): PublicAttachment | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id.trim() : '';
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	const contentType = typeof record.contentType === 'string' ? record.contentType.trim().toLowerCase() : 'application/octet-stream';
	const size = Number(record.size);
	if (!id || !name || !Number.isSafeInteger(size) || size < 0) return null;
	return {
		id,
		name,
		size,
		contentType,
		// Audio is valid canonical server metadata, but is intentionally treated as
		// a generic download until Thingtime ships a vetted inline audio player.
		mediaKind: safeAttachmentMediaKind(contentType, record.mediaKind)
	};
};

export const attachmentContentUrl = (id: string, download = false): string => {
	const params = new URLSearchParams({ id });
	if (download) params.set('download', '1');
	return `/api/v1/attachments/content?${params.toString()}`;
};

export const formatAttachmentBytes = (bytes: number): string => {
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes / 1024;
	let unit = units[0];
	for (let index = 1; index < units.length && value >= 1024; index += 1) {
		value /= 1024;
		unit = units[index];
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
};

export type AttachmentUploadErrorContext = {
	fileSizeBytes?: number;
	remainingBytes?: number | null;
	storageStatus?: 'ready' | 'reconciling' | 'unavailable';
};

const ATTACHMENT_QUOTA_ERROR =
	'This account’s storage quota is full for this file. Delete stored media or upgrade the account’s storage tier, then retry.';

export const attachmentUploadError = (
	error: unknown,
	phase: 'prepare' | 'upload' | 'complete' | 'cleanup',
	context: AttachmentUploadErrorContext = {}
): string => {
	const status = Number((error as { status?: unknown } | null)?.status);
	const code = String((error as { code?: unknown } | null)?.code || '');
	const snapshotShowsQuota =
		phase === 'prepare' &&
		context.storageStatus === 'ready' &&
		Number.isSafeInteger(context.fileSizeBytes) &&
		Number(context.fileSizeBytes) > 0 &&
		Number.isSafeInteger(context.remainingBytes) &&
		Number(context.remainingBytes) >= 0 &&
		Number(context.fileSizeBytes) > Number(context.remainingBytes);
	if (status === 401) return 'Your session expired. Log in again before uploading this file.';
	if (code === 'media_upload_not_granted') {
		return 'Media uploads need admin approval during the beta. An admin has been notified — you can upload once your account is approved.';
	}
	if (status === 403) return 'This account is not allowed to upload that file.';
	if (status === 413) return 'This file is larger than Thingtime can accept.';
	if (status === 429) return 'Uploads are moving too quickly. Wait a moment, then retry this file.';
	if (status === 507 || code === 'quota_exceeded' || snapshotShowsQuota) return ATTACHMENT_QUOTA_ERROR;
	if (code === 'storage_unconfigured') {
		return 'Private uploads are unavailable in this environment. For images, use the public image URL option instead.';
	}
	if (code === 'accounting_unavailable' || code === 'storage_conflict' || code === 'storage_invariant') {
		return 'Thingtime is verifying this account’s storage balance. Wait a moment, then retry this file.';
	}
	if (code === 'storage_unavailable' || (status === 503 && phase === 'prepare')) {
		return 'Private storage is temporarily unavailable. Wait a moment, then retry this file.';
	}
	if (status === 410 || code === 'upload_unavailable') {
		return 'This upload can no longer resume. Remove the file, then add it again.';
	}
	if (
		status === 409 &&
		(error as { retryable?: unknown; code?: unknown } | null)?.retryable === true &&
		['upload_parts_retryable', 'upload_not_ready'].includes(code)
	) {
		return 'One or more file parts need uploading again. Retry to resume this secure upload.';
	}
	if (status === 409) return 'Thingtime is still settling this upload. Retry to verify it safely.';
	if (phase === 'upload') return 'The file could not reach storage. Check your connection and retry.';
	if (phase === 'complete') return 'Thingtime could not verify the uploaded file. Retry to upload it safely.';
	if (phase === 'cleanup') return 'Thingtime could not remove that draft file. It will be cleaned up automatically.';
	return 'Thingtime could not prepare this file. Please retry.';
};

export const attachmentCompleteRetryPhase = (error: unknown): 'upload' | 'complete' | 'terminal' => {
	const failure = error as { code?: unknown; retryable?: unknown } | null;
	if (failure?.code === 'upload_unavailable' || Number((error as { status?: unknown } | null)?.status) === 410) return 'terminal';
	return failure?.retryable === true && (failure.code === 'upload_parts_retryable' || failure.code === 'upload_not_ready') ? 'upload' : 'complete';
};

export const attachmentUploadFailurePhase = (error: unknown, fallback: 'prepare' | 'upload'): 'prepare' | 'upload' | 'terminal' =>
	attachmentCompleteRetryPhase(error) === 'terminal' ? 'terminal' : fallback;

export const shouldFreezeAmbiguousPostSubmission = (unknownNow: boolean, status: number, hadUnknownOutcome: boolean): boolean =>
	unknownNow || (status === 409 && hadUnknownOutcome);

export const attachmentSnapshot = (uploads: ComposerAttachmentUpload[]): AttachmentComposerSnapshot => {
	const attachments = uploads.flatMap((upload) => (upload.status === 'ready' && upload.attachment ? [upload.attachment] : []));
	return {
		attachmentIds: attachments.map((attachment) => attachment.id),
		attachments,
		blocking: uploads.some((upload) => upload.status !== 'ready'),
		hasSelection: uploads.length > 0
	};
};

export const sameAttachmentSnapshot = (left: AttachmentComposerSnapshot, right: AttachmentComposerSnapshot): boolean => {
	if (left.blocking !== right.blocking || left.hasSelection !== right.hasSelection) return false;
	if (left.attachments.length !== right.attachments.length || left.attachmentIds.length !== right.attachmentIds.length) return false;
	for (let index = 0; index < left.attachments.length; index += 1) {
		const leftAttachment = left.attachments[index];
		const rightAttachment = right.attachments[index];
		if (
			left.attachmentIds[index] !== right.attachmentIds[index] ||
			leftAttachment.id !== rightAttachment.id ||
			leftAttachment.name !== rightAttachment.name ||
			leftAttachment.size !== rightAttachment.size ||
			leftAttachment.contentType !== rightAttachment.contentType ||
			leftAttachment.mediaKind !== rightAttachment.mediaKind
		) {
			return false;
		}
	}
	return true;
};

export type AttachmentCleanupAction = { kind: 'delete'; attachmentId: string } | { kind: 'abort'; uploadId: string } | null;

export const attachmentCleanupAction = (upload: ComposerAttachmentUpload, committedAttachmentIds: ReadonlySet<string>): AttachmentCleanupAction => {
	if (upload.attachment) {
		return committedAttachmentIds.has(upload.attachment.id) ? null : { kind: 'delete', attachmentId: upload.attachment.id };
	}
	// `localId` is also the idempotency key sent to start(). If that response is
	// lost after the server reserved quota, aborting by the stable request id can
	// still find and clean the upload instead of stranding the account's bytes.
	return { kind: 'abort', uploadId: upload.uploadId || upload.localId };
};

export const dedupeSelectedFiles = (current: ComposerAttachmentUpload[], incoming: File[]): File[] => {
	const seen = new Set(current.map((upload) => `${upload.file.name}\u0000${upload.file.size}\u0000${upload.file.lastModified}`));
	return incoming.filter((file) => {
		const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

export const multipartPartRange = (partNumber: number, partSizeBytes: number, fileSize: number) => {
	const start = (partNumber - 1) * partSizeBytes;
	return { start, end: Math.min(fileSize, start + partSizeBytes) };
};

export type CommittedPostExpectation = {
	shareId: string;
	ownerId: string;
	crystal: Record<string, unknown>;
	tags: string[];
	visibility: string;
	attachmentIds: string[];
};

const recordOf = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const canonicalJson = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonicalJson);
	const record = recordOf(value);
	if (!record) return value;
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => [key, canonicalJson(record[key])])
	);
};

const sameJson = (left: unknown, right: unknown) => JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

const exactStringArray = (value: unknown, expected: readonly string[], unordered = false): boolean => {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return false;
	const actual = value as string[];
	if (actual.length !== expected.length) return false;
	if (unordered) {
		const sortedExpected = [...expected].sort();
		return [...actual].sort().every((entry, index) => entry === sortedExpected[index]);
	}
	return actual.every((entry, index) => entry === expected[index]);
};

// A lost post-create response is ambiguous: Mongo may already have committed
// the post and atomically bound its files. A client-generated shareId lets the
// composer read that exact id back, but it is considered success only when the
// complete immutable create snapshot matches. A 409 by itself is never enough.
export const matchesCommittedPostCreate = (response: unknown, expected: CommittedPostExpectation): boolean => {
	const root = recordOf(response);
	const thing = recordOf(root?.thing);
	const post = recordOf(root?.post);
	const thingAuthor = recordOf(thing?.author);
	const postAuthor = recordOf(post?.author);
	if (!thing || !post || !thingAuthor || !postAuthor) return false;
	if (thing.id !== expected.shareId || post.id !== expected.shareId) return false;
	if (thingAuthor.id !== expected.ownerId || postAuthor.id !== expected.ownerId) return false;
	if (!exactStringArray(thing.thingtime, ['post']) || thing.targetId !== null || post.isShare !== false) return false;
	if (!sameJson(thing.crystal, expected.crystal)) return false;
	if (!exactStringArray(thing.tags, expected.tags) || !exactStringArray(post.tags, expected.tags)) return false;
	if (post.visibility !== expected.visibility) return false;
	const attachments = Array.isArray(post.attachments) ? post.attachments : null;
	if (!attachments) return false;
	const attachmentIds = attachments.map((attachment) => recordOf(attachment)?.id);
	return exactStringArray(attachmentIds, expected.attachmentIds, true);
};
