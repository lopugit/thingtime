// Pure, dependency-free helpers for "download all" ZIP archives: the files a
// post, folder, page or single media Thing exposes as one download. Nothing
// here touches storage or authorization — the service (attachmentArchive.ts)
// enumerates and authorizes; these helpers only bound and name the result so
// the same rules are unit-testable without Mongo or S3.

export const ATTACHMENT_ARCHIVE_PATH = '/api/v1/attachments/archive';
export const ATTACHMENT_ARCHIVE_REQUIREMENTS = { 'api.attachment-archive': '1.0.0' } as const;

// fflate writes classic (non-ZIP64) archives, so every counter stays far below
// the 4 GiB / 65535-entry format limits; the byte cap also keeps one request
// inside the platform's function duration.
export const ARCHIVE_MAX_FILES = 500;
export const ARCHIVE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
// Folder traversal budgets: Things the viewer may see (all kinds), Things
// scanned to find them (private children cost a lookup but never a slot, so a
// hidden sibling count is never learnable from a 413), and nesting depth.
export const ARCHIVE_MAX_THINGS = 1000;
export const ARCHIVE_MAX_SCANNED_THINGS = ARCHIVE_MAX_THINGS * 10;
export const ARCHIVE_MAX_FOLDER_DEPTH = 64;
// Bound attachment rows read per folder level (posts × attachments); more than
// this is an explicit 413, never a silently shorter archive.
export const ARCHIVE_MAX_BOUND_ROWS = ARCHIVE_MAX_FILES * 4;
// Per-file authorization/signing runs this many at a time while planning.
export const ARCHIVE_SIGN_CONCURRENCY = 8;
// Wall clock for one request — planning AND streaming (Vercel functions run
// 300 s here). The route anchors it at request start.
export const ARCHIVE_WALL_CLOCK_MS = 280_000;
// Linked (external URL) media has no stored bytes; the archive lists it instead.
export const ARCHIVE_LINKS_FILE = 'links.txt';
export const ARCHIVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ArchiveRootKind = 'post' | 'folder' | 'webpage' | 'attachment';

// Comments share the post schema, so a comment root archives its own gallery.
export const archiveRootKind = (thingtime: readonly string[] | undefined | null): ArchiveRootKind | null => {
	const kinds = Array.isArray(thingtime) ? thingtime : [];
	if (kinds.includes('folder')) return 'folder';
	if (kinds.includes('attachment')) return 'attachment';
	if (kinds.includes('post')) return 'post';
	if (kinds.includes('webpage')) return 'webpage';
	return null;
};

export const shortArchiveId = (id: unknown): string => {
	const compact = typeof id === 'string' ? id.replace(/[^A-Za-z0-9]/g, '') : '';
	return compact.slice(0, 8) || 'thing';
};

const SEGMENT_MAX_CHARS = 100;
const EXTENSION = /\.[A-Za-z0-9]{1,16}$/;

// One ZIP path segment. Separators, traversal dots, control/format characters
// and Windows-reserved punctuation never reach an extracting filesystem; a
// segment that empties out falls back to a stable id-derived name. Long names
// lose stem characters, never their extension (uploads allow 255 characters).
export const safeArchiveSegment = (value: unknown, fallback: string): string => {
	const raw = typeof value === 'string' ? value : '';
	const cleaned = raw
		.normalize('NFC')
		.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '')
		.replace(/[\\/:*?"<>|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[. ]+|[. ]+$/g, '');
	const characters = Array.from(cleaned);
	let bounded = cleaned;
	if (characters.length > SEGMENT_MAX_CHARS) {
		const extension = EXTENSION.exec(cleaned)?.[0] || '';
		const stem = Array.from(cleaned.slice(0, cleaned.length - extension.length))
			.slice(0, SEGMENT_MAX_CHARS - Array.from(extension).length)
			.join('')
			.replace(/[. ]+$/g, '');
		bounded = `${stem}${extension}`;
	}
	bounded = bounded.replace(/[. ]+$/g, '');
	return bounded && bounded !== '.' && bounded !== '..' ? bounded : fallback;
};

const firstLine = (value: unknown): string => (typeof value === 'string' ? value.split(/\r?\n/, 1)[0].trim() : '');

// A human name for the archive root: folder name, media filename, page title
// or the post's opening words. Always non-empty and path-safe.
export const archiveDisplayName = (kind: ArchiveRootKind, crystal: Record<string, unknown> | null | undefined, id: string): string => {
	const values = crystal || {};
	const fallback = `${kind}-${shortArchiveId(id)}`;
	if (kind === 'folder') return safeArchiveSegment(values.name, fallback);
	if (kind === 'attachment') {
		const name = safeArchiveSegment(values.filenamePreview || values.title || values.name, fallback);
		return name.replace(/\.[A-Za-z0-9]{1,8}$/, '') || fallback;
	}
	if (kind === 'webpage') return safeArchiveSegment(values.title || values.name || values.slug, fallback);
	const words = Array.from(firstLine(values.title || values.text)).slice(0, 60).join('').trim();
	return safeArchiveSegment(words, fallback);
};

export const archiveFileName = (name: string): string => `${safeArchiveSegment(name, 'thingtime-files')}.zip`;

// Filesystems that extract archives are usually case-insensitive, so
// uniqueness is judged case-insensitively: "Photo.jpg" then "Photo (2).jpg".
// Folding through upper case first follows the filesystems' simple case
// mapping more closely than toLowerCase alone (dotless ı and long ſ collide
// with i and s on NTFS/APFS).
const caseFoldKey = (value: string): string => value.toUpperCase().toLowerCase();

export class ArchivePathAllocator {
	private readonly used = new Set<string>();

	claim(directory: string, fileName: string): string {
		const safe = safeArchiveSegment(fileName, 'file');
		const dot = safe.lastIndexOf('.');
		const stem = dot > 0 ? safe.slice(0, dot) : safe;
		const extension = dot > 0 ? safe.slice(dot) : '';
		const prefix = directory ? `${directory}/` : '';
		for (let attempt = 1; ; attempt += 1) {
			const candidate = `${prefix}${attempt === 1 ? safe : `${stem} (${attempt})${extension}`}`;
			const key = caseFoldKey(candidate);
			if (!this.used.has(key)) {
				this.used.add(key);
				return candidate;
			}
		}
	}

	claimDirectory(parent: string, name: string): string {
		return this.claim(parent, name);
	}
}

export type ArchiveLink = { name: string; url: string; from: string };

// The links.txt body: one line per linked media item, grouped by its Thing.
export const formatArchiveLinks = (links: readonly ArchiveLink[]): string =>
	['Linked media has no stored bytes in Thingtime. Original URLs:', '', ...links.map((link) => `${link.from ? `${link.from}/` : ''}${link.name}\t${link.url}`), ''].join(
		'\n'
	);

export type ArchiveManifestFile = { id: string; path: string; name: string; size: number };

export type ArchiveManifest = {
	ok: true;
	id: string;
	kind: ArchiveRootKind;
	name: string;
	fileName: string;
	fileCount: number;
	totalBytes: number;
	skipped: number;
	linkCount: number;
	files: ArchiveManifestFile[];
};
