export const ATTACHMENT_THINGTIME = 'attachment' as const;
export const ATTACHMENT_ENVELOPE_VERSION = 1 as const;

export const ATTACHMENT_STATES = ['pending', 'finalizing', 'ready', 'deleting'] as const;
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];

// A purpose is stamped before any upload URL is issued and never changes.
// That keeps a private draft created for one surface from being replayed into
// a different audience (for example, a DM attachment becoming a public post).
export const ATTACHMENT_PURPOSES = ['post', 'comment', 'message', 'profile', 'emoji'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];
export const ATTACHMENT_PROFILE_SLOTS = ['avatar', 'banner'] as const;
export type ProfileAttachmentSlot = (typeof ATTACHMENT_PROFILE_SLOTS)[number];

export const ATTACHMENT_MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type AttachmentMediaKind = (typeof ATTACHMENT_MEDIA_KINDS)[number];

export const MAX_ATTACHMENT_NAME_CHARS = 255;
export const MAX_ATTACHMENT_TITLE_CHARS = 200;
export const MAX_ATTACHMENT_DESCRIPTION_CHARS = 2000;
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
	// owner-authored presentation metadata for the media's own Thing page and
	// lightbox — optional, absent on legacy attachments, never empty strings
	title?: string;
	description?: string;
	// Magic-byte-sniffed MIME type, present only when the served contentType
	// collapsed to application/octet-stream so downloads can still name the real
	// container. Server-written at finalization; never client input.
	detectedContentType?: string;
	// Present (true) only when the server-side moderation pipeline stamped the
	// attachment nsfw — the client renders it blurred behind a consent click
	nsfw?: boolean;
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
const SAFE_VIDEO_CONTENT_TYPES = new Set([
	'video/3gpp',
	'video/3gpp2',
	'video/mp4',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
	'video/x-matroska'
]);
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

export const isCanonicalAttachmentContentType = (value: string): boolean =>
	value.length > 0 && value.length <= MAX_ATTACHMENT_CONTENT_TYPE_CHARS && CONTENT_TYPE_RE.test(value);

export const attachmentMediaKindForContentType = (contentType: string): AttachmentMediaKind => {
	if (SAFE_IMAGE_CONTENT_TYPES.has(contentType)) return 'image';
	if (SAFE_VIDEO_CONTENT_TYPES.has(contentType)) return 'video';
	if (SAFE_AUDIO_CONTENT_TYPES.has(contentType)) return 'audio';
	return 'file';
};

// Single-line owner text (titles): the same hygiene as filenames.
const sanitizeAttachmentLine = (
	value: unknown,
	maxChars: number,
	label: string
): { ok: true; value?: string } | { ok: false; error: string } => {
	if (value === undefined || value === null) return { ok: true };
	if (typeof value !== 'string') return { ok: false, error: `Attachment ${label} must be text` };
	const trimmed = value.trim();
	if (!trimmed) return { ok: true };
	if (trimmed.length > maxChars) return { ok: false, error: `Attachment ${label}s can contain at most ${maxChars} characters` };
	if (UNSAFE_FILENAME_CHAR_RE.test(trimmed)) return { ok: false, error: `Attachment ${label}s cannot contain control or format characters` };
	if (!isWellFormedUnicode(trimmed)) return { ok: false, error: `Attachment ${label}s must contain valid Unicode` };
	return { ok: true, value: trimmed };
};

// Multi-line owner text (descriptions): newlines allowed, every other control
// or format character still rejected.
const UNSAFE_MULTILINE_CHAR_RE = /[\p{Cf}\p{Cs}]/u;
const sanitizeAttachmentBlock = (
	value: unknown,
	maxChars: number,
	label: string
): { ok: true; value?: string } | { ok: false; error: string } => {
	if (value === undefined || value === null) return { ok: true };
	if (typeof value !== 'string') return { ok: false, error: `Attachment ${label} must be text` };
	const trimmed = value.trim();
	if (!trimmed) return { ok: true };
	if (trimmed.length > maxChars) return { ok: false, error: `Attachment ${label}s can contain at most ${maxChars} characters` };
	for (let index = 0; index < trimmed.length; index += 1) {
		const code = trimmed.charCodeAt(index);
		if ((code <= 0x1f && code !== 0x0a) || code === 0x7f) {
			return { ok: false, error: `Attachment ${label}s cannot contain control characters` };
		}
	}
	if (UNSAFE_MULTILINE_CHAR_RE.test(trimmed)) {
		return { ok: false, error: `Attachment ${label}s cannot contain format characters` };
	}
	if (!isWellFormedUnicode(trimmed)) return { ok: false, error: `Attachment ${label}s must contain valid Unicode` };
	return { ok: true, value: trimmed };
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

	const title = sanitizeAttachmentLine(raw.title, MAX_ATTACHMENT_TITLE_CHARS, 'title');
	if (!title.ok) return title;
	const description = sanitizeAttachmentBlock(raw.description, MAX_ATTACHMENT_DESCRIPTION_CHARS, 'description');
	if (!description.ok) return description;

	return {
		ok: true,
		crystal: {
			name,
			size,
			contentType,
			// Always derive this from the normalized content type. A caller cannot
			// label HTML/SVG/arbitrary bytes as inline-safe image or video content.
			mediaKind: attachmentMediaKindForContentType(contentType),
			// blank owner text is stored as ABSENT, never as an empty string
			...(title.value ? { title: title.value } : {}),
			...(description.value ? { description: description.value } : {})
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

const REQUIRED_ATTACHMENT_CRYSTAL_KEYS = ['contentType', 'mediaKind', 'name', 'size'] as const;
// Owner-authored presentation text plus the server-written sniffed container
// type; each is validated below before a crystal counts as canonical.
const OPTIONAL_ATTACHMENT_CRYSTAL_KEYS = new Set(['title', 'description', 'detectedContentType']);

const canonicalAttachmentCrystal = (value: unknown): AttachmentCrystal | null => {
	const sanitized = sanitizeAttachmentPublicMetadata(value);
	if (!sanitized.ok || !value || typeof value !== 'object' || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	const keys = Object.keys(raw);
	// still a closed shape: every required key present, extras only from the
	// optional set (legacy four-key crystals stay canonical)
	if (REQUIRED_ATTACHMENT_CRYSTAL_KEYS.some((key) => !(key in raw))) return null;
	if (keys.some((key) => !(REQUIRED_ATTACHMENT_CRYSTAL_KEYS as readonly string[]).includes(key) && !OPTIONAL_ATTACHMENT_CRYSTAL_KEYS.has(key))) {
		return null;
	}
	const hasDetected = 'detectedContentType' in raw;
	if (hasDetected) {
		// The sniffed type is display metadata for opaque downloads only; it may
		// never restate or contradict a contentType the server serves inline.
		if (
			raw.contentType !== 'application/octet-stream' ||
			typeof raw.detectedContentType !== 'string' ||
			raw.detectedContentType === 'application/octet-stream' ||
			!isCanonicalAttachmentContentType(raw.detectedContentType)
		) {
			return null;
		}
	}
	return raw.name === sanitized.crystal.name &&
		raw.size === sanitized.crystal.size &&
		raw.contentType === sanitized.crystal.contentType &&
		raw.mediaKind === sanitized.crystal.mediaKind &&
		raw.title === sanitized.crystal.title &&
		raw.description === sanitized.crystal.description
		? { ...sanitized.crystal, ...(hasDetected ? { detectedContentType: raw.detectedContentType as string } : {}) }
		: null;
};

// `moderation` is the protected root stamp (api/utils/moderation). Pending and
// blocked attachments never project publicly: pending is the fail-closed
// quarantine while analysis/retry runs; blocked is the final quarantine.
export const toAttachmentPublicMetadata = (id: unknown, crystal: unknown, moderation?: unknown): AttachmentPublicMetadata | null => {
	const canonical = canonicalAttachmentCrystal(crystal);
	if (typeof id !== 'string' || !id || !canonical) return null;
	const status = (moderation as { status?: unknown } | null | undefined)?.status;
	if (status === 'pending' || status === 'blocked') return null;
	return { id, ...canonical, ...(status === 'nsfw' ? { nsfw: true as const } : {}) };
};

// The owner-chosen display position, stamped on each bound attachment thing at
// bind/reorder time. Order is per-target state on the child docs (relational,
// like every appended thing) — the parent post never stores an id list.
export const attachmentStoredSortValue = (value: unknown): number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER;

// Display order for one target's bound attachments. Callers pass docs already
// sorted by (createdAt, shareId); this stable sort applies the stamped index
// and leaves legacy unstamped docs in that createdAt order after stamped ones.
export const orderAttachmentDocsByStoredSort = <T extends { attachmentSortIndex?: unknown }>(docs: readonly T[]): T[] =>
	[...docs].sort((left, right) => attachmentStoredSortValue(left.attachmentSortIndex) - attachmentStoredSortValue(right.attachmentSortIndex));

export type AttachmentReorderPlan = { ok: true; orderedIds: string[] } | { ok: false; status: 400 | 409; error: string };

// A reorder must be a pure permutation of the target's currently-bound
// attachment ids — same set, new order. Additions and removals stay
// create/delete operations, never a side effect of sorting.
export const planAttachmentReorder = (
	requestedIds: readonly unknown[],
	boundIds: readonly string[],
	maxAttachments: number
): AttachmentReorderPlan => {
	const orderedIds: string[] = [];
	for (const value of requestedIds) {
		const id = typeof value === 'string' ? value.trim() : '';
		if (!id || id !== value) return { ok: false, status: 400, error: 'Invalid attachment id' };
		orderedIds.push(id);
	}
	if (orderedIds.length > maxAttachments) {
		return { ok: false, status: 400, error: `A post can contain at most ${maxAttachments} attachments` };
	}
	if (new Set(orderedIds).size !== orderedIds.length) {
		return { ok: false, status: 400, error: 'attachmentIds cannot repeat an attachment' };
	}
	const bound = new Set(boundIds);
	if (orderedIds.length !== bound.size || orderedIds.some((id) => !bound.has(id))) {
		return { ok: false, status: 409, error: 'The attachments on this post changed — refresh and reorder again' };
	}
	return { ok: true, orderedIds };
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
	// every stamped row is a closed union: non-profile purposes have no profile
	// slot; profile has exactly one bounded slot. Corrupt purpose/slot
	// combinations fail closed so they cannot participate in binding or quota
	// mutation as a canonical row.
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
