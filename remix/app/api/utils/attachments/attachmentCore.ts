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
export const MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS = 255;
export const MAX_ATTACHMENT_TITLE_CHARS = 200;
export const MAX_ATTACHMENT_DESCRIPTION_CHARS = 2000;
export const MAX_ATTACHMENT_CONTENT_TYPE_CHARS = 127;
export const MAX_ATTACHMENT_OBJECT_KEY_CHARS = 1024;
export const MAX_ATTACHMENT_OBJECT_VERSION_ID_CHARS = 1024;
export const ATTACHMENT_REQUEST_FINGERPRINT_CHARS = 64;
export const MAX_ATTACHMENT_FINALIZATION_LEASE_ID_CHARS = 128;
// Linked attachments reference media by external URL instead of an S3 object.
// Mirrors the post-crystal image URL bound (schemas/registry MAX_IMAGE_URL_CHARS).
export const MAX_LINKED_ATTACHMENT_URL_CHARS = 2048;
// Namespaced synthetic object key for linked docs — the real upload keys live
// under objects/<id>, so a linked key can never collide with (or address) a
// stored S3 object.
export const LINKED_ATTACHMENT_OBJECT_KEY_PREFIX = 'linked/';

export type AttachmentPublicMetadata = {
	id: string;
	name: string;
	size: number;
	contentType: string;
	mediaKind: AttachmentMediaKind;
	filenamePreview?: string;
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
	// Linked attachments only: the external media URL. Content renders straight
	// from the original site (safe sinks: img/video/anchor) — these bytes never
	// touch Thingtime storage and the content endpoint never serves them.
	url?: string;
	// Projection-only (never persisted in the crystal, like nsfw): the owner's
	// view of their OWN moderation-pending attachment. Everyone else still gets
	// the fail-closed hide while analysis runs.
	pending?: true;
};

export type AttachmentCrystal = Omit<AttachmentPublicMetadata, 'id' | 'pending' | 'nsfw'>;

export type AttachmentAnnotationPatch = {
	// undefined = leave untouched, null/'' = clear, string = set (trimmed)
	filenamePreview?: string | null;
	title?: string | null;
	description?: string | null;
};

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
	// true only on linked (external URL) attachments — no S3 object exists, so
	// every S3 lifecycle step is skipped and object bytes are always zero
	attachmentLinked?: true;
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
	attachmentLinked?: unknown;
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
	'audio/3gpp',
	'audio/3gpp2',
	'audio/aac',
	'audio/aiff',
	'audio/amr',
	'audio/flac',
	'audio/midi',
	'audio/mp4',
	'audio/mpeg',
	'audio/ogg',
	'audio/opus',
	'audio/vnd.wave',
	'audio/wav',
	'audio/webm',
	'audio/x-aiff',
	'audio/x-caf',
	'audio/x-flac',
	'audio/x-m4a',
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
	// Audio is only ever rendered in an <audio> sink. Unlike an image/video
	// container, it cannot turn arbitrary uploaded bytes into an active
	// document, so preserve any canonical audio MIME for the browser's decoder
	// instead of losing uncommon recorders to an opaque download row.
	if (SAFE_AUDIO_CONTENT_TYPES.has(contentType) || contentType.startsWith('audio/')) return 'audio';
	return 'file';
};

// Linked media renders only in safe sinks (img/video elements, plain anchors)
// and the client can override the render hint after probing, so linked kinds
// collapse to the media kinds the safe renderers know.
export type LinkedAttachmentMediaKind = 'image' | 'video' | 'audio' | 'file';

export const isLinkedAttachmentMediaKind = (value: unknown): value is LinkedAttachmentMediaKind =>
	value === 'image' || value === 'video' || value === 'audio' || value === 'file';

// The same hygiene the post-crystal image URL sanitizer applies
// (schemas/registry isHttpUrl): plain absolute http(s), no credentials, no
// control/format/space characters, bounded length. Returns the trimmed URL or
// null. The server NEVER fetches these URLs — no SSRF surface — so hostname
// shape is deliberately not restricted beyond URL well-formedness.
export const canonicalLinkedAttachmentUrl = (value: unknown): string | null => {
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

// Extension → (contentType, render hint) for linked URLs. Deliberately small:
// it covers what the renderers can actually do something with; anything else
// is an opaque linked file. The client mirrors this table
// (attachmentUiCore linkedMediaTypeForUrl) — a pin test keeps them equal.
export const LINKED_MEDIA_EXTENSION_TYPES: Record<string, { contentType: string; mediaKind: LinkedAttachmentMediaKind }> = {
	apng: { contentType: 'image/png', mediaKind: 'image' },
	avif: { contentType: 'image/avif', mediaKind: 'image' },
	gif: { contentType: 'image/gif', mediaKind: 'image' },
	jfif: { contentType: 'image/jpeg', mediaKind: 'image' },
	jpeg: { contentType: 'image/jpeg', mediaKind: 'image' },
	jpg: { contentType: 'image/jpeg', mediaKind: 'image' },
	png: { contentType: 'image/png', mediaKind: 'image' },
	webp: { contentType: 'image/webp', mediaKind: 'image' },
	m4v: { contentType: 'video/x-m4v', mediaKind: 'video' },
	mkv: { contentType: 'video/x-matroska', mediaKind: 'video' },
	mov: { contentType: 'video/quicktime', mediaKind: 'video' },
	mp4: { contentType: 'video/mp4', mediaKind: 'video' },
	ogv: { contentType: 'video/ogg', mediaKind: 'video' },
	webm: { contentType: 'video/webm', mediaKind: 'video' },
	'3ga': { contentType: 'audio/3gpp', mediaKind: 'audio' },
	'7z': { contentType: 'application/x-7z-compressed', mediaKind: 'file' },
	aac: { contentType: 'audio/aac', mediaKind: 'audio' },
	aif: { contentType: 'audio/aiff', mediaKind: 'audio' },
	aiff: { contentType: 'audio/aiff', mediaKind: 'audio' },
	amr: { contentType: 'audio/amr', mediaKind: 'audio' },
	caf: { contentType: 'audio/x-caf', mediaKind: 'audio' },
	csv: { contentType: 'text/csv', mediaKind: 'file' },
	doc: { contentType: 'application/msword', mediaKind: 'file' },
	docx: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mediaKind: 'file' },
	gz: { contentType: 'application/gzip', mediaKind: 'file' },
	flac: { contentType: 'audio/flac', mediaKind: 'audio' },
	json: { contentType: 'application/json', mediaKind: 'file' },
	md: { contentType: 'text/markdown', mediaKind: 'file' },
	m4a: { contentType: 'audio/mp4', mediaKind: 'audio' },
	mid: { contentType: 'audio/midi', mediaKind: 'audio' },
	midi: { contentType: 'audio/midi', mediaKind: 'audio' },
	mp2: { contentType: 'audio/mpeg', mediaKind: 'audio' },
	mp3: { contentType: 'audio/mpeg', mediaKind: 'audio' },
	oga: { contentType: 'audio/ogg', mediaKind: 'audio' },
	ogg: { contentType: 'audio/ogg', mediaKind: 'audio' },
	opus: { contentType: 'audio/opus', mediaKind: 'audio' },
	pdf: { contentType: 'application/pdf', mediaKind: 'file' },
	ppt: { contentType: 'application/vnd.ms-powerpoint', mediaKind: 'file' },
	pptx: { contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mediaKind: 'file' },
	rar: { contentType: 'application/vnd.rar', mediaKind: 'file' },
	svg: { contentType: 'image/svg+xml', mediaKind: 'file' },
	txt: { contentType: 'text/plain', mediaKind: 'file' },
	wav: { contentType: 'audio/wav', mediaKind: 'audio' },
	weba: { contentType: 'audio/webm', mediaKind: 'audio' },
	xls: { contentType: 'application/vnd.ms-excel', mediaKind: 'file' },
	xlsx: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mediaKind: 'file' },
	zip: { contentType: 'application/zip', mediaKind: 'file' }
};

const linkedUrlExtension = (url: string): string | null => {
	try {
		const pathname = new URL(url).pathname;
		const basename = pathname.split('/').pop() || '';
		const dot = basename.lastIndexOf('.');
		if (dot <= 0 || dot === basename.length - 1) return null;
		return basename.slice(dot + 1).toLowerCase();
	} catch {
		return null;
	}
};

// Server-side detection for a linked URL. An unknown or missing extension
// defaults to an IMAGE hint — that matches the legacy crystal.images behavior
// (any URL rendered in an <img>), and the client may demote to 'file' after a
// real load probe. mediaKind here is a render hint for external safe sinks,
// never an inline-serving claim about bytes our server stores.
export const linkedMediaTypeForUrl = (url: string): { contentType: string; mediaKind: LinkedAttachmentMediaKind } => {
	const extension = linkedUrlExtension(url);
	if (extension && LINKED_MEDIA_EXTENSION_TYPES[extension]) return LINKED_MEDIA_EXTENSION_TYPES[extension];
	return { contentType: 'application/octet-stream', mediaKind: 'image' };
};

// A display name for the linked media, from the URL path basename (decoded
// when possible), falling back to the hostname. The result must survive the
// crystal name sanitizer's round-trip EXACTLY (trimmed, well-formed unicode,
// no control/format chars, ≤255) — a name that doesn't would make the freshly
// minted crystal non-canonical and fail the mint.
export const linkedAttachmentNameForUrl = (url: string): string => {
	const canonicalName = (value: string): string | null => {
		const sliced = value.slice(0, MAX_ATTACHMENT_NAME_CHARS).trim();
		return sliced && !UNSAFE_FILENAME_CHAR_RE.test(sliced) && isWellFormedUnicode(sliced) ? sliced : null;
	};
	try {
		const parsed = new URL(url);
		const rawBasename = parsed.pathname.split('/').filter(Boolean).pop() || '';
		let basename = rawBasename;
		try {
			basename = decodeURIComponent(rawBasename);
		} catch {
			// keep the raw basename when percent-decoding fails
		}
		return canonicalName(basename) ?? canonicalName(parsed.hostname) ?? 'linked-media';
	} catch {
		return 'linked-media';
	}
};

// Single-line owner text (titles): the same hygiene as filenames.
const sanitizeAttachmentLine = (value: unknown, maxChars: number, label: string): { ok: true; value?: string } | { ok: false; error: string } => {
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
const sanitizeAttachmentBlock = (value: unknown, maxChars: number, label: string): { ok: true; value?: string } | { ok: false; error: string } => {
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
	if (title.ok === false) return title;
	const description = sanitizeAttachmentBlock(raw.description, MAX_ATTACHMENT_DESCRIPTION_CHARS, 'description');
	if (description.ok === false) return description;
	const filenamePreview = sanitizeAttachmentLine(raw.filenamePreview, MAX_ATTACHMENT_FILENAME_PREVIEW_CHARS, 'filename preview');
	if (filenamePreview.ok === false) return filenamePreview;

	return {
		ok: true,
		crystal: {
			name,
			size,
			contentType,
			// Always derive this from the normalized content type. A caller cannot
			// label HTML/SVG/arbitrary bytes as inline-safe image or video content.
			mediaKind: attachmentMediaKindForContentType(contentType),
			...(filenamePreview.value ? { filenamePreview: filenamePreview.value } : {}),
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
const OPTIONAL_ATTACHMENT_CRYSTAL_KEYS = new Set(['filenamePreview', 'title', 'description', 'detectedContentType']);
// Linked crystals swap detectedContentType (a stored-bytes sniff) for the
// external url; every other key keeps the base hygiene.
const LINKED_ATTACHMENT_CRYSTAL_KEYS = new Set([...REQUIRED_ATTACHMENT_CRYSTAL_KEYS, 'url', 'filenamePreview', 'title', 'description']);

// Linked (external URL) crystal: size is always 0 (the bytes are not ours),
// and mediaKind is a DECLARED render hint — the media renders in safe sinks
// (img/video/anchor) straight from the original site, so the derive-from-
// contentType rule that protects our own inline serving does not apply.
const canonicalLinkedAttachmentCrystal = (raw: Record<string, unknown>): AttachmentCrystal | null => {
	const url = canonicalLinkedAttachmentUrl(raw.url);
	if (!url || raw.url !== url) return null;
	if (REQUIRED_ATTACHMENT_CRYSTAL_KEYS.some((key) => !(key in raw))) return null;
	if (Object.keys(raw).some((key) => !LINKED_ATTACHMENT_CRYSTAL_KEYS.has(key))) return null;
	if (raw.size !== 0 || !isLinkedAttachmentMediaKind(raw.mediaKind)) return null;
	const sanitized = sanitizeAttachmentPublicMetadata({
		name: raw.name,
		size: raw.size,
		contentType: raw.contentType,
		title: raw.title,
		description: raw.description,
		filenamePreview: raw.filenamePreview
	});
	if (!sanitized.ok) return null;
	return raw.name === sanitized.crystal.name &&
		raw.contentType === sanitized.crystal.contentType &&
		raw.title === sanitized.crystal.title &&
		raw.description === sanitized.crystal.description &&
		raw.filenamePreview === sanitized.crystal.filenamePreview
		? { ...sanitized.crystal, mediaKind: raw.mediaKind, url }
		: null;
};

const canonicalAttachmentCrystal = (value: unknown): AttachmentCrystal | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if ('url' in (value as Record<string, unknown>)) return canonicalLinkedAttachmentCrystal(value as Record<string, unknown>);
	const sanitized = sanitizeAttachmentPublicMetadata(value);
	if (!sanitized.ok) return null;
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
		raw.description === sanitized.crystal.description &&
		raw.filenamePreview === sanitized.crystal.filenamePreview
		? { ...sanitized.crystal, ...(hasDetected ? { detectedContentType: raw.detectedContentType as string } : {}) }
		: null;
};

// Apply owner-authored presentation text to an already-canonical attachment
// crystal. The magic-byte detector's optional detectedContentType is
// server-owned metadata: annotation must preserve it exactly, never accept it
// from the patch and never silently erase it.
export const applyAttachmentAnnotationPatch = (value: unknown, patch: AttachmentAnnotationPatch): AttachmentMetadataResult => {
	const before = canonicalAttachmentCrystal(value);
	if (!before) return { ok: false, error: 'Attachment metadata is not canonical' };
	const sanitized = sanitizeAttachmentPublicMetadata({
		name: before.name,
		size: before.size,
		contentType: before.contentType,
		title: patch.title === undefined ? before.title : patch.title,
		description: patch.description === undefined ? before.description : patch.description,
		filenamePreview: patch.filenamePreview === undefined ? before.filenamePreview : patch.filenamePreview
	});
	if (!sanitized.ok) return sanitized;
	return {
		ok: true,
		crystal: {
			...sanitized.crystal,
			// linked crystals keep their declared render hint and external URL —
			// sanitize re-derives mediaKind from contentType, which only holds for
			// stored-object crystals
			...(before.url ? { mediaKind: before.mediaKind, url: before.url } : {}),
			...(before.detectedContentType ? { detectedContentType: before.detectedContentType } : {})
		}
	};
};

// A moderation status that keeps the attachment out of public projections and
// the client-facing bound-set contract. Shared with the PATCH attachment sync
// so the projection and the cover check can never disagree about what a
// client could possibly have seen.
export const attachmentModerationHidesFromPublic = (moderation: unknown): boolean => {
	const status = (moderation as { status?: unknown } | null | undefined)?.status;
	return status === 'pending' || status === 'blocked';
};

// `moderation` is the protected root stamp (api/utils/moderation). Pending and
// blocked attachments never project publicly: pending is the fail-closed
// quarantine while analysis/retry runs; blocked is the final quarantine.
// ownerView (the viewer owns this attachment) keeps PENDING visible with a
// `pending: true` badge so an owner's media never silently vanishes from
// their own post while analysis runs — blocked stays hidden for everyone,
// matching the text-thing rule.
export const toAttachmentPublicMetadata = (
	id: unknown,
	crystal: unknown,
	moderation?: unknown,
	options: { ownerView?: boolean } = {}
): AttachmentPublicMetadata | null => {
	const canonical = canonicalAttachmentCrystal(crystal);
	if (typeof id !== 'string' || !id || !canonical) return null;
	const status = (moderation as { status?: unknown } | null | undefined)?.status;
	if (status === 'blocked') return null;
	if (status === 'pending') {
		return options.ownerView === true ? { id, ...canonical, pending: true as const } : null;
	}
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

export type AttachmentSyncPlan =
	| { ok: true; orderedIds: string[]; addedIds: string[]; hiddenTrailingIds: string[] }
	| { ok: false; status: 400 | 409; error: string };

// A PATCH-time attachment list is the target's full desired display order:
// every VISIBLE bound id must still be present (removal stays a delete
// operation, never a side effect of saving an edit), and any id beyond the
// bound set is a NEW ready draft the edit is adding to the post.
//
// hiddenBoundIds are bound docs the projection hides (moderation pending for
// non-owners historically, blocked for everyone) — a client can never have
// seen them, so their absence from the request is NOT a conflict. They keep
// their binding and are re-stamped after the requested list, preserving their
// stored relative order (pass them pre-sorted). A hidden id the client DOES
// know (owner-visible pending) may appear in the request and then orders like
// any other bound id.
export const planAttachmentSync = (
	requestedIds: readonly unknown[],
	boundIds: readonly string[],
	hiddenBoundIds: readonly string[],
	maxAttachments: number
): AttachmentSyncPlan => {
	const orderedIds: string[] = [];
	for (const value of requestedIds) {
		const id = typeof value === 'string' ? value.trim() : '';
		if (!id || id !== value) return { ok: false, status: 400, error: 'Invalid attachment id' };
		orderedIds.push(id);
	}
	if (new Set(orderedIds).size !== orderedIds.length) {
		return { ok: false, status: 400, error: 'attachmentIds cannot repeat an attachment' };
	}
	const requested = new Set(orderedIds);
	const hidden = new Set(hiddenBoundIds);
	if (boundIds.some((id) => !requested.has(id) && !hidden.has(id))) {
		return { ok: false, status: 409, error: 'The attachments on this post changed — refresh and try again' };
	}
	const hiddenTrailingIds = hiddenBoundIds.filter((id) => !requested.has(id));
	if (orderedIds.length + hiddenTrailingIds.length > maxAttachments) {
		return { ok: false, status: 400, error: `A post can contain at most ${maxAttachments} attachments` };
	}
	const bound = new Set(boundIds);
	return { ok: true, orderedIds, addedIds: orderedIds.filter((id) => !bound.has(id) && !hidden.has(id)), hiddenTrailingIds };
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
	// Linked attachments are a closed variant: the marker, the namespaced
	// synthetic key, the zero object size, the url-bearing crystal, and the
	// absence of every S3 upload field all imply each other. Any partial
	// combination is a forged or corrupt claim and fails closed.
	if (doc.attachmentLinked !== undefined && doc.attachmentLinked !== true) return null;
	const looksLinked =
		doc.attachmentLinked === true ||
		(typeof doc.objectKey === 'string' && doc.objectKey.startsWith(LINKED_ATTACHMENT_OBJECT_KEY_PREFIX)) ||
		!!(doc.crystal && typeof doc.crystal === 'object' && !Array.isArray(doc.crystal) && 'url' in (doc.crystal as Record<string, unknown>));
	if (looksLinked) {
		if (
			doc.attachmentLinked !== true ||
			typeof doc.objectKey !== 'string' ||
			!doc.objectKey.startsWith(LINKED_ATTACHMENT_OBJECT_KEY_PREFIX) ||
			doc.objectSizeBytes !== 0 ||
			doc.uploadId !== undefined ||
			doc.objectVersionId !== undefined ||
			doc.attachmentPartsIssuedAt !== undefined ||
			doc.attachmentFinalizationLeaseId !== undefined ||
			doc.attachmentProfileSlot !== undefined
		) {
			return null;
		}
		const linkedCrystal = canonicalAttachmentCrystal(doc.crystal);
		if (!linkedCrystal || !linkedCrystal.url || linkedCrystal.size !== 0) return null;
		return 0;
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
