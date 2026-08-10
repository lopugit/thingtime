export const ATTACHMENT_THINGTIME = 'attachment' as const;
export const ATTACHMENT_ENVELOPE_VERSION = 1 as const;

export const ATTACHMENT_STATES = ['pending', 'finalizing', 'ready', 'deleting'] as const;
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];

export const ATTACHMENT_PURPOSES = ['post', 'profile'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];
export const ATTACHMENT_PROFILE_SLOTS = ['avatar', 'banner'] as const;
export type ProfileAttachmentSlot = (typeof ATTACHMENT_PROFILE_SLOTS)[number];

export const ATTACHMENT_MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AttachmentMediaKind = (typeof ATTACHMENT_MEDIA_KINDS)[number];

export const MAX_ATTACHMENT_NAME_CHARS = 255;
export const MAX_ATTACHMENT_CONTENT_TYPE_CHARS = 127;
export const MAX_ATTACHMENT_OBJECT_KEY_CHARS = 1024;
export const MAX_ATTACHMENT_OBJECT_VERSION_ID_CHARS = 1024;
export const ATTACHMENT_REQUEST_FINGERPRINT_CHARS = 64;
export const MAX_ATTACHMENT_FINALIZATION_LEASE_ID_CHARS = 128;

export type AttachmentPublicMetadata = {
	id: string;
	name: string;
	size: number;
	contentType: string;
	mediaKind: AttachmentMediaKind;
};

export type AttachmentCrystal = Omit<AttachmentPublicMetadata, 'id'>;

// These fields live on the protected Thing root, never in its public crystal.
// The upload service owns every value; generic Thing input has no path that
// copies them onto a document.
export type AttachmentPrivateObjectFields = {
	attachmentEnvelopeVersion: typeof ATTACHMENT_ENVELOPE_VERSION;
	attachmentState: AttachmentState;
	objectSizeBytes: number;
	objectKey: string;
	objectVersionId?: string;
	attachmentRequestFingerprint?: string;
	attachmentPurpose?: AttachmentPurpose;
	attachmentProfileSlot?: ProfileAttachmentSlot;
	attachmentFinalizationLeaseId?: string;
	attachmentPartsIssuedAt?: Date;
	attachmentObjectlessDelete?: true;
	attachmentMpuEmptyVerifiedAt?: Date;
	uploadId?: string;
	attachmentExpiresAt?: Date;
};

export type AttachmentStorageCandidate = {
	thingtime?: unknown;
	crystal?: unknown;
	attachmentEnvelopeVersion?: unknown;
	attachmentState?: unknown;
	objectSizeBytes?: unknown;
	objectKey?: unknown;
	objectVersionId?: unknown;
	attachmentRequestFingerprint?: unknown;
	attachmentPurpose?: unknown;
	attachmentProfileSlot?: unknown;
	attachmentFinalizationLeaseId?: unknown;
	attachmentPartsIssuedAt?: unknown;
	attachmentObjectlessDelete?: unknown;
	attachmentMpuEmptyVerifiedAt?: unknown;
	uploadId?: unknown;
	attachmentExpiresAt?: unknown;
};

export type AttachmentMetadataResult = { ok: true; crystal: AttachmentCrystal } | { ok: false; error: string };

const SAFE_IMAGE_CONTENT_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);
const SAFE_VIDEO_CONTENT_TYPES = new Set(['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm']);
const SAFE_AUDIO_CONTENT_TYPES = new Set([
	'audio/aac',
	'audio/flac',
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
	'audio/x-wav'
]);
const ATTACHMENT_PART_ISSUING_STATES = new Set<unknown>(['pending', 'finalizing', 'deleting']);

const CONTENT_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const UNSAFE_FILENAME_CHAR_RE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

const hasAsciiControlChar = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
};

const isWellFormedUnicode = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return false;
		}
	}
	return true;
};

export const attachmentMediaKindForContentType = (contentType: string): AttachmentMediaKind => {
	if (SAFE_IMAGE_CONTENT_TYPES.has(contentType)) return 'image';
	if (SAFE_VIDEO_CONTENT_TYPES.has(contentType)) return 'video';
	if (SAFE_AUDIO_CONTENT_TYPES.has(contentType)) return 'audio';
	return 'file';
};

export const sanitizeAttachmentPublicMetadata = (input: unknown): AttachmentMetadataResult => {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, error: 'Attachment metadata must be an object' };
	}
	const raw = input as Record<string, unknown>;
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	if (!name) return { ok: false, error: 'Attachment name is required' };
	if (name.length > MAX_ATTACHMENT_NAME_CHARS) {
		return { ok: false, error: `Attachment names can contain at most ${MAX_ATTACHMENT_NAME_CHARS} characters` };
	}
	if (UNSAFE_FILENAME_CHAR_RE.test(name)) {
		return { ok: false, error: 'Attachment names cannot contain control or format characters' };
	}
	if (!isWellFormedUnicode(name)) return { ok: false, error: 'Attachment names must contain valid Unicode' };

	if (!Number.isSafeInteger(raw.size) || Number(raw.size) < 0) {
		return { ok: false, error: 'Attachment size must be a non-negative whole number of bytes' };
	}
	const size = Number(raw.size);

	const contentType =
		typeof raw.contentType === 'string' && raw.contentType.trim() ? raw.contentType.trim().toLowerCase() : 'application/octet-stream';
	if (contentType.length > MAX_ATTACHMENT_CONTENT_TYPE_CHARS || !CONTENT_TYPE_RE.test(contentType)) {
		return { ok: false, error: 'Attachment contentType must be a valid MIME type' };
	}

	return {
		ok: true,
		crystal: {
			name,
			size,
			contentType,
			// Always derive this from the normalized content type. A caller cannot
			// label HTML/SVG/arbitrary bytes as inline-safe image or video content.
			mediaKind: attachmentMediaKindForContentType(contentType)
		}
	};
};

export const isAttachmentThing = (doc: { thingtime?: unknown }): boolean =>
	Array.isArray(doc.thingtime) && doc.thingtime.includes(ATTACHMENT_THINGTIME);

export const isAttachmentState = (value: unknown): value is AttachmentState =>
	typeof value === 'string' && (ATTACHMENT_STATES as readonly string[]).includes(value);

export const isAttachmentPurpose = (value: unknown): value is AttachmentPurpose =>
	typeof value === 'string' && (ATTACHMENT_PURPOSES as readonly string[]).includes(value);

export const isAttachmentProfileSlot = (value: unknown): value is ProfileAttachmentSlot =>
	typeof value === 'string' && (ATTACHMENT_PROFILE_SLOTS as readonly string[]).includes(value);

export const isAttachmentObjectVersionId = (value: unknown): value is string =>
	typeof value === 'string' && !!value && value.length <= MAX_ATTACHMENT_OBJECT_VERSION_ID_CHARS && !hasAsciiControlChar(value);

export const isAttachmentFinalizationLeaseId = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= MAX_ATTACHMENT_FINALIZATION_LEASE_ID_CHARS &&
	/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

const canonicalAttachmentCrystal = (value: unknown): AttachmentCrystal | null => {
	const sanitized = sanitizeAttachmentPublicMetadata(value);
	if (!sanitized.ok || !value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const keys = Object.keys(raw).sort();
	if (keys.join('\0') !== ['contentType', 'mediaKind', 'name', 'size'].join('\0')) return null;
	return raw.name === sanitized.crystal.name &&
		raw.size === sanitized.crystal.size &&
		raw.contentType === sanitized.crystal.contentType &&
		raw.mediaKind === sanitized.crystal.mediaKind
		? sanitized.crystal
		: null;
};

export const toAttachmentPublicMetadata = (id: unknown, crystal: unknown): AttachmentPublicMetadata | null => {
	const canonical = canonicalAttachmentCrystal(crystal);
	return typeof id === 'string' && id && canonical ? { id, ...canonical } : null;
};

// undefined means "not an attachment" and therefore contributes no object
// bytes. null means an attachment claim with an invalid server envelope; that
// is never safe for current-stamp arithmetic or reconciliation. A number is the
// exact verified object allocation added to the ordinary JSON payload bytes.
export const attachmentObjectSizeBytesForAccounting = (doc: AttachmentStorageCandidate): number | null | undefined => {
	if (!isAttachmentThing(doc)) return undefined;
	if (doc.attachmentEnvelopeVersion !== ATTACHMENT_ENVELOPE_VERSION) return null;
	if (!isAttachmentState(doc.attachmentState)) return null;
	if (!Number.isSafeInteger(doc.objectSizeBytes) || Number(doc.objectSizeBytes) < 0) return null;
	if (
		typeof doc.objectKey !== 'string' ||
		!doc.objectKey ||
		doc.objectKey.length > MAX_ATTACHMENT_OBJECT_KEY_CHARS ||
		hasAsciiControlChar(doc.objectKey)
	) {
		return null;
	}
	if (doc.objectVersionId !== undefined && !isAttachmentObjectVersionId(doc.objectVersionId)) return null;
	if (
		doc.attachmentRequestFingerprint !== undefined &&
		(typeof doc.attachmentRequestFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(doc.attachmentRequestFingerprint))
	) {
		return null;
	}
	// Pre-purpose post attachments remain accountable for a safe rollout, but
	// every stamped row is a closed union: post has no profile slot; profile has
	// exactly one bounded slot. Corrupt purpose/slot combinations fail closed so
	// they cannot participate in binding or quota mutation as a canonical row.
	if (doc.attachmentPurpose !== undefined && !isAttachmentPurpose(doc.attachmentPurpose)) return null;
	if (doc.attachmentProfileSlot !== undefined && !isAttachmentProfileSlot(doc.attachmentProfileSlot)) return null;
	if (doc.attachmentPurpose === 'profile') {
		if (!isAttachmentProfileSlot(doc.attachmentProfileSlot)) return null;
	} else if (doc.attachmentProfileSlot !== undefined) {
		return null;
	}
	if (
		doc.attachmentFinalizationLeaseId !== undefined &&
		(doc.attachmentState !== 'finalizing' || !isAttachmentFinalizationLeaseId(doc.attachmentFinalizationLeaseId))
	) {
		return null;
	}
	if (
		doc.attachmentPartsIssuedAt !== undefined &&
		(!ATTACHMENT_PART_ISSUING_STATES.has(doc.attachmentState) ||
			typeof doc.uploadId !== 'string' ||
			!(doc.attachmentPartsIssuedAt instanceof Date) ||
			!Number.isFinite(doc.attachmentPartsIssuedAt.getTime()))
	) {
		return null;
	}
	if (doc.attachmentObjectlessDelete !== undefined && doc.attachmentObjectlessDelete !== true) return null;
	if (
		doc.attachmentObjectlessDelete === true &&
		(doc.attachmentState !== 'deleting' || doc.uploadId !== undefined || doc.objectVersionId !== undefined)
	) {
		return null;
	}
	if (
		doc.attachmentMpuEmptyVerifiedAt !== undefined &&
		(doc.attachmentState !== 'deleting' ||
			typeof doc.uploadId !== 'string' ||
			!(doc.attachmentPartsIssuedAt instanceof Date) ||
			!(doc.attachmentMpuEmptyVerifiedAt instanceof Date) ||
			!Number.isFinite(doc.attachmentMpuEmptyVerifiedAt.getTime()) ||
			doc.attachmentMpuEmptyVerifiedAt.getTime() < doc.attachmentPartsIssuedAt.getTime())
	) {
		return null;
	}
	const crystal = canonicalAttachmentCrystal(doc.crystal);
	if (!crystal || crystal.size !== Number(doc.objectSizeBytes)) return null;
	return Number(doc.objectSizeBytes);
};
