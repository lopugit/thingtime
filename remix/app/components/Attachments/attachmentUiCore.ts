import type {
	AttachmentComposerSnapshot,
	AttachmentMediaKind,
	AttachmentUploadPurpose,
	ComposerAttachmentUpload,
	PublicAttachment
} from './attachmentTypes';

const INLINE_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
// Mirrors the server's ATTACHMENT_INLINE_CONTENT_TYPES video set. Codec support
// inside a container still varies per browser; PostAttachments degrades an
// unplayable video to its download row via the element's error event.
const INLINE_VIDEO_TYPES = new Set([
	'video/3gpp',
	'video/3gpp2',
	'video/mp4',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
	'video/x-matroska'
]);
const isAudioContentType = (value: string) => value.startsWith('audio/');
export const MAX_POST_ATTACHMENTS = 25;
const MAX_POST_TAGS = 12;
const MAX_POST_TAG_CHARS = 40;

type ClipboardFileData = {
	files?: ArrayLike<File> | null;
	items?: ArrayLike<Pick<DataTransferItem, 'kind' | 'getAsFile'>> | null;
};

// Clipboard implementations normally expose pasted files through `files`,
// but WebKit and embedded webviews can leave that list empty while retaining
// file-kind items. Prefer the canonical list so the same item is never queued
// twice, then fall back to item extraction for those browsers.
export const attachmentFilesFromClipboard = (clipboardData: ClipboardFileData | null | undefined): File[] => {
	const files = Array.from(clipboardData?.files || []);
	if (files.length) return files;
	return Array.from(clipboardData?.items || []).flatMap((item) => {
		if (item.kind !== 'file') return [];
		const file = item.getAsFile();
		return file ? [file] : [];
	});
};

export type AttachmentUploadScope = 'public' | 'private';

export const attachmentUploadScopeForPurpose = (purpose: AttachmentUploadPurpose): AttachmentUploadScope =>
	purpose === 'message' || purpose === 'profile-avatar' || purpose === 'profile-banner' ? 'private' : 'public';

// Mirrors the createThing tag canonicalizer so ambiguous POST reconciliation
// compares the exact committed payload rather than the raw composer text.
// Like the server, tags are NFC-normalized (composed and decomposed spellings
// of one visible tag share a bucket), the cap counts code points (never
// bisecting a surrogate pair) and lone surrogates are dropped so a tag can
// never make encodeURIComponent throw when rendered.
export const canonicalPostTags = (values: readonly unknown[]): string[] => {
	const tags: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string') continue;
		const tag = Array.from(value.trim().toLowerCase().normalize('NFC'))
			.filter((char) => {
				const codePoint = char.codePointAt(0) ?? 0;
				return codePoint < 0xd800 || codePoint > 0xdfff;
			})
			.slice(0, MAX_POST_TAG_CHARS)
			.join('');
		if (tag && !tags.includes(tag)) tags.push(tag);
		if (tags.length >= MAX_POST_TAGS) break;
	}
	return tags;
};

export const safeAttachmentMediaKind = (contentType: unknown, requestedKind?: unknown): AttachmentMediaKind => {
	const type = typeof contentType === 'string' ? contentType.trim().toLowerCase() : '';
	if (requestedKind === 'image' && INLINE_IMAGE_TYPES.has(type)) return 'image';
	if (requestedKind === 'video' && INLINE_VIDEO_TYPES.has(type)) return 'video';
	// Older server rows deliberately marked audio as `file`; unlike visual
	// media, an audio element is a safe sink, so recover every declared audio
	// MIME regardless of that legacy render hint.
	if (isAudioContentType(type)) return 'audio';
	return 'file';
};

// Linked (external URL) attachments: the derive-from-contentType rule above
// protects bytes OUR server serves inline; linked media renders straight from
// the original site in safe sinks, so the server's declared render hint is
// trusted as-is (clamped to the kinds the renderers know).
const safeLinkedMediaKind = (requestedKind: unknown): AttachmentMediaKind =>
	requestedKind === 'image' || requestedKind === 'video' || requestedKind === 'audio' ? requestedKind : 'file';

// Mirrors the server's canonicalLinkedAttachmentUrl (attachmentCore) — plain
// absolute http(s), no credentials, no control/format/space characters,
// bounded length.
export const MAX_LINKED_ATTACHMENT_URL_CHARS = 2048;
export const canonicalLinkedMediaUrl = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.length > MAX_LINKED_ATTACHMENT_URL_CHARS ||
		/[\p{Cc}\p{Cf}\p{Cs}\s]/u.test(trimmed) ||
		trimmed.includes('\\') ||
		!/^https?:\/\//i.test(trimmed)
	) {
		return null;
	}
	try {
		const parsed = new URL(trimmed);
		if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) {
			return null;
		}
		return trimmed;
	} catch {
		return null;
	}
};

// Client mirror of the server's linkedMediaTypeForUrl extension table
// (attachmentCore LINKED_MEDIA_EXTENSION_TYPES) — a pin test keeps the two
// tables equal. Unknown/missing extensions default to an image hint, matching
// the legacy crystal.images behavior; the composer demotes to 'file' after a
// failed load probe.
export const LINKED_MEDIA_EXTENSION_KINDS: Record<string, AttachmentMediaKind> = {
	apng: 'image',
	avif: 'image',
	gif: 'image',
	jfif: 'image',
	jpeg: 'image',
	jpg: 'image',
	png: 'image',
	webp: 'image',
	m4v: 'video',
	mkv: 'video',
	mov: 'video',
	mp4: 'video',
	ogv: 'video',
	webm: 'video',
	'3ga': 'audio',
	'7z': 'file',
	aac: 'audio',
	aif: 'audio',
	aiff: 'audio',
	amr: 'audio',
	caf: 'audio',
	csv: 'file',
	doc: 'file',
	docx: 'file',
	gz: 'file',
	flac: 'audio',
	json: 'file',
	md: 'file',
	m4a: 'audio',
	mid: 'audio',
	midi: 'audio',
	mp2: 'audio',
	mp3: 'audio',
	oga: 'audio',
	ogg: 'audio',
	opus: 'audio',
	pdf: 'file',
	ppt: 'file',
	pptx: 'file',
	rar: 'file',
	svg: 'file',
	txt: 'file',
	wav: 'audio',
	weba: 'audio',
	xls: 'file',
	xlsx: 'file',
	zip: 'file'
};

// The client-side detection the composer uses BEFORE minting: a known
// extension decides immediately; anything else is 'probe' — try loading the
// URL as an image and demote to 'file' if it never loads.
export const linkedMediaKindForUrl = (url: string): AttachmentMediaKind | 'probe' => {
	try {
		const basename = new URL(url).pathname.split('/').pop() || '';
		const dot = basename.lastIndexOf('.');
		if (dot <= 0 || dot === basename.length - 1) return 'probe';
		const extension = basename.slice(dot + 1).toLowerCase();
		return LINKED_MEDIA_EXTENSION_KINDS[extension] ?? 'probe';
	} catch {
		return 'probe';
	}
};

// The display name the composer shows while a linked mint is in flight —
// mirrors the server's linkedAttachmentNameForUrl.
export const linkedMediaNameForUrl = (url: string): string => {
	try {
		const parsed = new URL(url);
		const rawBasename = parsed.pathname.split('/').filter(Boolean).pop() || '';
		let basename = rawBasename;
		try {
			basename = decodeURIComponent(rawBasename);
		} catch {
			// keep the raw basename when percent-decoding fails
		}
		basename = basename.trim();
		return basename || parsed.hostname;
	} catch {
		return 'linked-media';
	}
};

export const localFileMediaKind = (file: Pick<File, 'type'>): AttachmentMediaKind => {
	const type = file.type.trim().toLowerCase();
	if (INLINE_IMAGE_TYPES.has(type)) return 'image';
	if (INLINE_VIDEO_TYPES.has(type)) return 'video';
	if (isAudioContentType(type)) return 'audio';
	return 'file';
};

const MAX_ATTACHMENT_TITLE_CHARS = 200;
const MAX_ATTACHMENT_DESCRIPTION_CHARS = 2000;
const MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS = 255;

const normalizedOwnerText = (value: unknown, maxChars: number): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, maxChars) : undefined;
};

export const normalizePublicAttachment = (value: unknown): PublicAttachment | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === 'string' ? record.id.trim() : '';
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	const contentType = typeof record.contentType === 'string' ? record.contentType.trim().toLowerCase() : 'application/octet-stream';
	const size = Number(record.size);
	if (!id || !name || !Number.isSafeInteger(size) || size < 0) return null;
	const title = normalizedOwnerText(record.title, MAX_ATTACHMENT_TITLE_CHARS);
	const description = normalizedOwnerText(record.description, MAX_ATTACHMENT_DESCRIPTION_CHARS);
	const filenamePreview = normalizedOwnerText(record.filenamePreview, MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS);
	const detectedRaw = typeof record.detectedContentType === 'string' ? record.detectedContentType.trim().toLowerCase() : '';
	const detectedContentType =
		detectedRaw && detectedRaw !== contentType && detectedRaw !== 'application/octet-stream' && detectedRaw.includes('/') ? detectedRaw : '';
	const linkedUrl = canonicalLinkedMediaUrl(record.url);
	return {
		id,
		name,
		size,
		contentType,
		...(detectedContentType ? { detectedContentType } : {}),
		// Linked attachments keep the server's declared render hint instead — their
		// bytes render straight from the external URL in safe sinks. Legacy opaque
		// rows may still carry a detected audio container, which lets the player
		// offer playback without trusting a caller-provided media kind.
		mediaKind: linkedUrl
			? safeLinkedMediaKind(record.mediaKind)
			: safeAttachmentMediaKind(contentType === 'application/octet-stream' && detectedContentType ? detectedContentType : contentType, record.mediaKind),
		...(filenamePreview ? { filenamePreview } : {}),
		...(title ? { title } : {}),
		...(description ? { description } : {}),
		// only an explicit server true survives — nothing client-side can set it
		...(record.nsfw === true ? { nsfw: true } : {}),
		...(linkedUrl ? { url: linkedUrl } : {}),
		...(record.pending === true ? { pending: true as const } : {})
	};
};

export const attachmentDisplayName = (attachment: Pick<PublicAttachment, 'name' | 'filenamePreview'>): string =>
	attachment.filenamePreview || attachment.name;

// The stable deeplink to a media attachment's own Thing page.
export const mediaPageUrl = (id: string): string => `/media/${encodeURIComponent(id)}`;

// Attachments are persisted Things too. Keep the generic Thing permalink
// separate from the richer media page so callers can explicitly choose which
// detail view they need.
export const attachmentThingUrl = (id: string): string => `/thing/${encodeURIComponent(id)}`;

// Display names for containers the server can sniff but never renders inline,
// plus common claimed types; anything unmapped shows its raw MIME string.
const FRIENDLY_CONTENT_TYPE_LABELS: Record<string, string> = {
	'application/gzip': 'GZIP archive',
	'application/pdf': 'PDF document',
	'application/vnd.rar': 'RAR archive',
	'application/x-7z-compressed': '7-Zip archive',
	'application/zip': 'ZIP archive',
	'audio/aac': 'AAC audio',
	'audio/flac': 'FLAC audio',
	'audio/mp4': 'M4A audio',
	'audio/midi': 'MIDI audio',
	'audio/mpeg': 'MP3 audio',
	'audio/ogg': 'Ogg audio',
	'audio/opus': 'Opus audio',
	'audio/vnd.wave': 'WAV audio',
	'audio/wav': 'WAV audio',
	'audio/x-m4a': 'M4A audio',
	'audio/x-wav': 'WAV audio',
	'image/bmp': 'BMP image',
	'image/heic': 'HEIC image',
	'image/heif': 'HEIF image',
	'image/tiff': 'TIFF image',
	'video/mp2t': 'MPEG-TS video',
	'video/mpeg': 'MPEG video',
	'video/quicktime': 'QuickTime video',
	'video/vnd.avi': 'AVI video',
	'video/x-flv': 'FLV video',
	'video/x-ms-asf': 'ASF video',
	'video/x-ms-wmv': 'WMV video',
	'video/x-msvideo': 'AVI video'
};

export const attachmentTypeLabel = (attachment: Pick<PublicAttachment, 'contentType' | 'detectedContentType'>): string => {
	const shown =
		attachment.contentType === 'application/octet-stream' && attachment.detectedContentType ? attachment.detectedContentType : attachment.contentType;
	if (!shown || shown === 'application/octet-stream') return 'File';
	return FRIENDLY_CONTENT_TYPE_LABELS[shown] || shown;
};

export const attachmentContentUrl = (id: string, download = false): string => {
	const params = new URLSearchParams({ id });
	if (download) params.set('download', '1');
	return `/api/v1/attachments/content?${params.toString()}`;
};

// The src every renderer should use: linked attachments render straight from
// their external URL; everything else goes through the authenticated content
// endpoint.
export const attachmentMediaSrc = (attachment: Pick<PublicAttachment, 'id' | 'url'>): string => attachment.url || attachmentContentUrl(attachment.id);

// Older opaque rows retain their sniffed container in metadata. Supplying it
// to <source type> lets browsers attempt playback while the migration updates
// their content response on the next maintenance pass.
export const attachmentPlaybackContentType = (attachment: Pick<PublicAttachment, 'contentType' | 'detectedContentType'>): string =>
	attachment.contentType === 'application/octet-stream' && attachment.detectedContentType ? attachment.detectedContentType : attachment.contentType;

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
	if (code === 'public_uploads_not_approved') {
		return 'Public media uploads need admin approval during the beta. After email verification, an admin can approve this account.';
	}
	if (code === 'private_uploads_not_approved') {
		return 'Private media uploads need admin approval during the beta. After email verification, an admin can approve this account.';
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
			leftAttachment.detectedContentType !== rightAttachment.detectedContentType ||
			leftAttachment.mediaKind !== rightAttachment.mediaKind ||
			leftAttachment.nsfw !== rightAttachment.nsfw ||
			leftAttachment.url !== rightAttachment.url ||
			leftAttachment.pending !== rightAttachment.pending
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
