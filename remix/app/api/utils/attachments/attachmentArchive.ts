import { isProtectedThingtime } from '../../../schemas/registry';
import { canViewSharedCompositionAttachment } from '../actions/sharedComposition';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { getThingsCollection } from '../mongodb/collections';
import { canViewInherited, fail, findViewableThing, type Fail, type ThingDoc, type Viewer } from '../things/things';
import { getAttachmentDownload, inspectAttachmentDownload } from './attachments';
import { fetchStoredObject } from './localAttachmentStorage';
import { orderAttachmentDocsByStoredSort } from './attachmentCore';
import {
	ARCHIVE_LINKS_FILE,
	ARCHIVE_MAX_BOUND_ROWS,
	ARCHIVE_MAX_BYTES,
	ARCHIVE_MAX_FILES,
	ARCHIVE_MAX_FOLDER_DEPTH,
	ARCHIVE_MAX_SCANNED_THINGS,
	ARCHIVE_MAX_THINGS,
	ARCHIVE_SIGN_CONCURRENCY,
	ARCHIVE_WALL_CLOCK_MS,
	ArchivePathAllocator,
	archiveDisplayName,
	archiveFileName,
	archiveRootKind,
	formatArchiveLinks,
	safeArchiveSegment,
	shortArchiveId,
	type ArchiveLink,
	type ArchiveManifest,
	type ArchiveRootKind
} from './attachmentArchiveCore';
import type { AttachmentAccessViewer } from './attachmentAccess';
import { createZipStream, type ZipStreamEntry } from './zipStream';

// "Download all": one ZIP of every stored file a viewer may already read on a
// post/comment, page, folder (recursively) or single media Thing.
//
// Discovery is not authorization. Roots resolve through the canonical Thing
// reader (hidden Things open by exact id, private ones need a real audience;
// page-composition media additionally through the shared-composition gate the
// content endpoint uses), every folder child is re-judged on its own inherited
// ACL, and each file is then authorized — and, for a real download, signed —
// through getAttachmentDownload: the same purpose/target, moderation,
// ready-state and object-version gates the content endpoint uses. Files that
// fail any gate are counted as skipped (a count only the root's owner or an
// administrator ever sees), never silently served — and never silently dropped
// either: every bound exceeded is an explicit 413.

export type ArchiveAttachmentDoc = Pick<ThingDoc, 'shareId' | 'ownerId' | 'targetId' | 'crystal'> & {
	attachmentPurpose?: string;
	attachmentSortIndex?: unknown;
	attachmentLinked?: boolean;
	attachmentState?: string;
	moderation?: unknown;
};

export type ArchiveEntry = {
	id: string;
	path: string;
	name: string;
	size: number;
	contentType: string;
	// Empty when the plan was built without presigning (manifest / HEAD).
	url: string;
};

export type ArchivePlan = {
	ok: true;
	id: string;
	ownerId: string;
	kind: ArchiveRootKind;
	name: string;
	fileName: string;
	entries: ArchiveEntry[];
	links: ArchiveLink[];
	linksPath?: string;
	skipped: number;
	totalBytes: number;
};

export type ArchivePlanOptions = {
	sharedRoot?: string | null;
	isAdmin?: boolean;
	// false: authorize every file but mint no signed URLs (manifest, HEAD).
	presign?: boolean;
	// Absolute deadline (ms epoch) shared with the stream; planning past it
	// fails with 504 instead of running into the platform's function limit.
	deadlineAt?: number;
};

export type ArchiveManifestOptions = {
	// The skipped count reveals moderation/audience state of files the viewer
	// cannot see, so only the root's owner or an administrator receives it.
	revealSkipped?: boolean;
};

type ArchiveDependencies = {
	findViewable: (id: string, viewer: Viewer) => Promise<ThingDoc | null>;
	// Raw attachment root for the shared-composition path (no audience applied).
	findAttachmentRoot: (id: string) => Promise<ThingDoc | null>;
	canViewShared: (viewer: AttachmentAccessViewer, attachment: ThingDoc, rootId: string) => Promise<boolean>;
	canView: (doc: ThingDoc, viewer: Viewer) => Promise<boolean>;
	listChildren: (ownerId: string, folderId: string, limit: number) => Promise<ThingDoc[]>;
	listBound: (targets: readonly ThingDoc[]) => Promise<ArchiveAttachmentDoc[]>;
	loadAttachment: (id: string) => Promise<ArchiveAttachmentDoc | null>;
	download: typeof getAttachmentDownload;
	inspect: typeof inspectAttachmentDownload;
	customMongoActive: () => boolean;
	fetch: typeof fetch;
	now: () => number;
};

// Mongo rejects a projection that names both a document and one of its own
// sub-paths ("Path collision"), so every projection here lists whole fields
// only; the canView gate reads crystal.subspaceId through the full crystal.
export const ARCHIVE_ATTACHMENT_PROJECTION = {
	shareId: 1,
	ownerId: 1,
	targetId: 1,
	crystal: 1,
	attachmentPurpose: 1,
	attachmentSortIndex: 1,
	attachmentLinked: 1,
	attachmentState: 1,
	moderation: 1,
	createdAt: 1
} as const;

export const ARCHIVE_CHILD_PROJECTION = {
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	crystal: 1,
	acl: 1,
	visibility: 1,
	targetId: 1,
	folderId: 1,
	linkKey: 1,
	moderation: 1,
	subspacePrivate: 1,
	createdAt: 1
} as const;

// A media root judged through a page composition needs its attachment fields
// AND its Thing envelope (kinds, acl) in one document.
export const ARCHIVE_SHARED_ROOT_PROJECTION = { ...ARCHIVE_ATTACHMENT_PROJECTION, thingtime: 1, acl: 1, visibility: 1 } as const;

const kindsOf = (doc: Pick<ThingDoc, 'thingtime'>): string[] => (Array.isArray(doc.thingtime) ? doc.thingtime : []);

// Post-purpose media binds to posts and pages; comment media to comments.
// Anything else (messages, profile slots, emoji) never belongs to a gallery.
const boundPurposeAllows = (target: ThingDoc, attachment: ArchiveAttachmentDoc): boolean => {
	if (attachment.ownerId !== target.ownerId) return false;
	const purpose = attachment.attachmentPurpose;
	return kindsOf(target).includes('comment') ? purpose === 'comment' : purpose === undefined || purpose === 'post';
};

const moderationStatus = (moderation: unknown): string | undefined => {
	const status = (moderation as { status?: unknown } | null | undefined)?.status;
	return typeof status === 'string' ? status : undefined;
};

// Linked media has no stored bytes, so the download gate never sees it; apply
// the projection rule here: blocked stays hidden for everyone, pending for
// everyone but its owner (toAttachmentPublicMetadata does the same).
const linkedMediaHidden = (doc: ArchiveAttachmentDoc, viewer: Viewer): boolean => {
	const status = moderationStatus(doc.moderation);
	return status === 'blocked' || (status === 'pending' && viewer?.id !== doc.ownerId);
};

const defaultDependencies: ArchiveDependencies = {
	findViewable: findViewableThing,
	findAttachmentRoot: async (id) =>
		(await (await getThingsCollection()).findOne({ shareId: id, thingtime: 'attachment' } as any, { projection: ARCHIVE_SHARED_ROOT_PROJECTION })) as any as ThingDoc | null,
	canViewShared: (viewer, attachment, rootId) => canViewSharedCompositionAttachment(viewer, attachment as any, rootId),
	canView: canViewInherited,
	listChildren: async (ownerId, folderId, limit) =>
		(await (await getThingsCollection())
			.find({ ownerId, folderId, thingtime: { $exists: true } } as any, { projection: ARCHIVE_CHILD_PROJECTION })
			.sort({ createdAt: 1, shareId: 1 })
			.limit(limit)
			.toArray()) as any as ThingDoc[],
	// One more row than the bound so the planner can tell "full" from "over".
	listBound: async (targets) => {
		if (!targets.length) return [];
		const docs = (await (await getThingsCollection())
			.find({ thingtime: 'attachment', targetId: { $in: targets.map((target) => target.shareId) }, attachmentState: 'ready' } as any, {
				projection: ARCHIVE_ATTACHMENT_PROJECTION
			})
			.sort({ createdAt: 1, shareId: 1 })
			.limit(ARCHIVE_MAX_BOUND_ROWS + 1)
			.toArray()) as any as ArchiveAttachmentDoc[];
		return orderAttachmentDocsByStoredSort(docs);
	},
	loadAttachment: async (id) =>
		(await (await getThingsCollection()).findOne({ shareId: id, thingtime: 'attachment' } as any, { projection: ARCHIVE_ATTACHMENT_PROJECTION })) as any as ArchiveAttachmentDoc | null,
	download: getAttachmentDownload,
	inspect: inspectAttachmentDownload,
	customMongoActive: isCustomMongoEndpointActive,
	// signed object URLs: real S3 over the network, the local stand-in in-process
	fetch: (input, init) => fetchStoredObject(String(input), { signal: init?.signal, redirect: init?.redirect }),
	now: Date.now
};

const crystalOf = (doc: Pick<ThingDoc, 'crystal'>): Record<string, unknown> => (doc.crystal && typeof doc.crystal === 'object' ? doc.crystal : {});

type Candidate = { doc: ArchiveAttachmentDoc; directory: string; from: string };

const TOO_MANY_THINGS = 'This folder has too many Things to archive in one download';
const TOO_MANY_FILES = 'These files are too large to download as one ZIP — download the folders inside separately';
const NOTHING_HERE = 'There are no files to download here';
const TOOK_TOO_LONG = 'Preparing this download took too long — try a smaller folder';

export const createAttachmentArchiveService = (overrides: Partial<ArchiveDependencies> = {}) => {
	const dependencies: ArchiveDependencies = { ...defaultDependencies, ...overrides };

	const plan = async (viewer: Viewer, idInput: unknown, options: ArchivePlanOptions = {}): Promise<ArchivePlan | Fail> => {
		const id = typeof idInput === 'string' ? idInput.trim() : '';
		if (!id) return fail(400, 'Invalid archive id');
		// Post attachments never authorize a home object against a caller-selected
		// data plane (same rule as the content endpoint).
		if (dependencies.customMongoActive()) return fail(404, 'Thing not found');
		const deadline = () => {
			if (options.deadlineAt !== undefined && dependencies.now() > options.deadlineAt) throw fail(504, TOOK_TOO_LONG);
		};
		const downloadViewer: AttachmentAccessViewer =
			viewer || options.sharedRoot || options.isAdmin
				? { id: '', ...viewer, ...(options.isAdmin ? { isAdmin: true } : {}), ...(options.sharedRoot ? { sharedRoot: options.sharedRoot } : {}) }
				: null;

		let root = await dependencies.findViewable(id, viewer);
		// A media Thing bound to a private post yet composed on a page the viewer
		// can read: the content endpoint authorizes it through the composition,
		// so its archive (one-file ZIP, share link) must resolve the same way.
		if (!root && options.sharedRoot) {
			const raw = await dependencies.findAttachmentRoot(id);
			if (raw && archiveRootKind(raw.thingtime) === 'attachment' && (await dependencies.canViewShared(downloadViewer, raw, options.sharedRoot))) root = raw;
		}
		const kind = root ? archiveRootKind(root.thingtime) : null;
		if (!root || !kind) return fail(404, 'Thing not found');
		const name = archiveDisplayName(kind, crystalOf(root), root.shareId);

		const candidates: Candidate[] = [];
		const paths = new ArchivePathAllocator();
		let visible = 0;
		let scanned = 0;
		// Only Things this viewer may see take a slot, so a 413 never counts the
		// private siblings of what they can download; scanning is bounded apart.
		const budget = () => {
			visible += 1;
			if (visible > ARCHIVE_MAX_THINGS) throw fail(413, TOO_MANY_THINGS);
		};
		const scan = () => {
			scanned += 1;
			if (scanned > ARCHIVE_MAX_SCANNED_THINGS) throw fail(413, TOO_MANY_THINGS);
		};

		const addBound = async (targets: readonly ThingDoc[], directoryFor: (target: ThingDoc) => string) => {
			if (!targets.length) return;
			const byTarget = new Map(targets.map((target) => [target.shareId, target]));
			const docs = await dependencies.listBound(targets);
			// Past the row bound the archive would be silently shorter than the
			// galleries it claims to hold; say so instead.
			if (docs.length > ARCHIVE_MAX_BOUND_ROWS) throw fail(413, TOO_MANY_FILES);
			for (const doc of docs) {
				const target = typeof doc.targetId === 'string' ? byTarget.get(doc.targetId) : undefined;
				if (!target || !boundPurposeAllows(target, doc)) continue;
				candidates.push({ doc, directory: directoryFor(target), from: target.shareId });
			}
		};

		const walkFolder = async (folder: ThingDoc, directory: string, depth: number): Promise<void> => {
			if (depth > ARCHIVE_MAX_FOLDER_DEPTH) throw fail(413, 'This folder is nested too deeply to archive');
			const children = await dependencies.listChildren(folder.ownerId, folder.shareId, ARCHIVE_MAX_THINGS + 1);
			const targets: ThingDoc[] = [];
			const targetDirectories = new Map<string, string>();
			for (const child of children) {
				scan();
				deadline();
				const childKinds = kindsOf(child);
				const childKind = archiveRootKind(childKinds);
				// Saved recordings are attachment Things filed in folders; every other
				// protected/managed kind is never gallery content.
				if (!childKind || child.ownerId !== folder.ownerId || (childKind !== 'attachment' && isProtectedThingtime(childKinds))) continue;
				// Folder audience never leaks into its contents: each child is judged
				// on its own inherited ACL for THIS viewer. Unlisted (hidden) children
				// open by exact id only and are never enumerated through a folder.
				if (!(await dependencies.canView(child, viewer))) continue;
				budget();
				if (childKind === 'folder') {
					await walkFolder(child, paths.claimDirectory(directory, archiveDisplayName('folder', crystalOf(child), child.shareId)), depth + 1);
				} else if (childKind === 'attachment') {
					const doc = await dependencies.loadAttachment(child.shareId);
					if (doc) candidates.push({ doc, directory, from: child.shareId });
				} else if (childKind === 'post' || childKind === 'webpage') {
					targets.push(child);
					targetDirectories.set(child.shareId, directory);
				}
			}
			// One bounded query per folder level; each post keeps its own sub-folder
			// so galleries from different posts never collide.
			const named = new Map<string, string>();
			await addBound(targets, (target) => {
				let claimed = named.get(target.shareId);
				if (!claimed) {
					claimed = paths.claimDirectory(targetDirectories.get(target.shareId) || directory, archiveDisplayName(archiveRootKind(kindsOf(target)) === 'webpage' ? 'webpage' : 'post', crystalOf(target), target.shareId));
					named.set(target.shareId, claimed);
				}
				return claimed;
			});
		};

		const entries: ArchiveEntry[] = [];
		const links: ArchiveLink[] = [];
		let skipped = 0;
		let totalBytes = 0;
		try {
			if (kind === 'folder') await walkFolder(root, '', 0);
			else if (kind === 'attachment') {
				const doc = await dependencies.loadAttachment(root.shareId);
				if (doc) candidates.push({ doc, directory: '', from: root.shareId });
			} else await addBound([root], () => '');

			// Authorize (and, for a real download, presign) a bounded number of files
			// at a time, in stored order; bounds are still applied in that order so
			// the first file past a limit is the one that trips 413.
			const authorize = async (attachmentId: string) => {
				if (options.presign === false) {
					const inspected = await dependencies.inspect(downloadViewer, attachmentId);
					return inspected.ok === false ? inspected : { ok: true as const, url: '', size: inspected.size, contentType: inspected.contentType };
				}
				return dependencies.download(downloadViewer, attachmentId, true);
			};
			for (let index = 0; index < candidates.length; index += ARCHIVE_SIGN_CONCURRENCY) {
				deadline();
				const batch = candidates.slice(index, index + ARCHIVE_SIGN_CONCURRENCY);
				const results = await Promise.all(batch.map((candidate) => (candidate.doc.attachmentLinked === true ? null : authorize(candidate.doc.shareId))));
				for (const [offset, candidate] of batch.entries()) {
					const crystal = crystalOf(candidate.doc);
					const fileName = safeArchiveSegment(crystal.name, `file-${shortArchiveId(candidate.doc.shareId)}`);
					if (candidate.doc.attachmentLinked === true) {
						if (linkedMediaHidden(candidate.doc, viewer)) skipped += 1;
						else if (typeof crystal.url === 'string' && crystal.url) links.push({ name: fileName, url: crystal.url, from: candidate.directory });
						continue;
					}
					const signed = results[offset]!;
					if (signed.ok === false) {
						skipped += 1;
						continue;
					}
					if (entries.length + 1 > ARCHIVE_MAX_FILES || totalBytes + signed.size > ARCHIVE_MAX_BYTES) throw fail(413, TOO_MANY_FILES);
					entries.push({
						id: candidate.doc.shareId,
						path: paths.claim(candidate.directory, fileName),
						name: fileName,
						size: signed.size,
						contentType: signed.contentType,
						url: signed.url
					});
					totalBytes += signed.size;
				}
			}
		} catch (error) {
			if (error && typeof error === 'object' && (error as Fail).ok === false) return error as Fail;
			throw error;
		}
		// One message whether the root is empty or every file was withheld: the
		// difference is exactly what a stranger must not learn.
		if (!entries.length && !links.length) return fail(404, NOTHING_HERE);
		return {
			ok: true,
			id: root.shareId,
			ownerId: root.ownerId,
			kind,
			name,
			fileName: archiveFileName(name),
			entries,
			links,
			// claimed last so a real "links.txt" upload keeps its own name
			linksPath: links.length ? paths.claim('', ARCHIVE_LINKS_FILE) : undefined,
			skipped,
			totalBytes
		};
	};

	const manifest = (value: ArchivePlan, options: ArchiveManifestOptions = {}): ArchiveManifest => ({
		ok: true,
		id: value.id,
		kind: value.kind,
		name: value.name,
		fileName: value.fileName,
		fileCount: value.entries.length,
		totalBytes: value.totalBytes,
		skipped: options.revealSkipped ? value.skipped : 0,
		linkCount: value.links.length,
		files: value.entries.map((entry) => ({ id: entry.id, path: entry.path, name: entry.name, size: entry.size }))
	});

	// Signed URLs are fetched server-side, one at a time, and piped straight into
	// the archive; the client only ever sees the stable first-party endpoint.
	const stream = (value: ArchivePlan, signal?: AbortSignal, options: { deadlineAt?: number } = {}): ReadableStream<Uint8Array> => {
		if (value.entries.some((entry) => !entry.url)) throw new Error('Archive plan was built without signed URLs');
		const entries: ZipStreamEntry[] = value.entries.map((entry) => ({
			path: entry.path,
			size: entry.size,
			open: async (abort) => {
				const upstream = await dependencies.fetch(entry.url, {
					redirect: 'error',
					signal: signal ? AbortSignal.any([abort, signal]) : abort
				});
				if (!upstream.ok || !upstream.body) throw new Error('A stored file could not be read');
				return upstream.body;
			}
		}));
		const texts = value.links.length ? [{ path: value.linksPath || ARCHIVE_LINKS_FILE, bytes: new TextEncoder().encode(formatArchiveLinks(value.links)) }] : [];
		return createZipStream(entries, texts, { deadlineAt: options.deadlineAt ?? dependencies.now() + ARCHIVE_WALL_CLOCK_MS, now: dependencies.now });
	};

	return { plan, manifest, stream };
};

const service = createAttachmentArchiveService();
export const planAttachmentArchive = service.plan;
export const attachmentArchiveManifest = service.manifest;
export const streamAttachmentArchive = service.stream;
