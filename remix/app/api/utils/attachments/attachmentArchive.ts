import { isProtectedThingtime } from '../../../schemas/registry';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { getThingsCollection } from '../mongodb/collections';
import { canViewInherited, fail, findViewableThing, type Fail, type ThingDoc, type Viewer } from '../things/things';
import { getAttachmentDownload } from './attachments';
import { orderAttachmentDocsByStoredSort } from './attachmentCore';
import {
	ARCHIVE_LINKS_FILE,
	ARCHIVE_MAX_BYTES,
	ARCHIVE_MAX_FILES,
	ARCHIVE_MAX_FOLDER_DEPTH,
	ARCHIVE_MAX_THINGS,
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
// reader (hidden Things open by exact id, private ones need a real audience),
// every folder child is re-judged on its own inherited ACL, and each file is
// then signed through getAttachmentDownload — the same purpose/target,
// moderation, ready-state and object-version gates the content endpoint uses.
// Files that fail any gate are counted as skipped, never silently served.

export type ArchiveAttachmentDoc = Pick<ThingDoc, 'shareId' | 'ownerId' | 'targetId' | 'crystal'> & {
	attachmentPurpose?: string;
	attachmentSortIndex?: unknown;
	attachmentLinked?: boolean;
	attachmentState?: string;
};

export type ArchiveEntry = {
	id: string;
	path: string;
	name: string;
	size: number;
	contentType: string;
	url: string;
};

export type ArchivePlan = {
	ok: true;
	id: string;
	kind: ArchiveRootKind;
	name: string;
	fileName: string;
	entries: ArchiveEntry[];
	links: ArchiveLink[];
	linksPath?: string;
	skipped: number;
	totalBytes: number;
};

export type ArchivePlanOptions = { sharedRoot?: string | null; isAdmin?: boolean };

type ArchiveDependencies = {
	findViewable: (id: string, viewer: Viewer) => Promise<ThingDoc | null>;
	canView: (doc: ThingDoc, viewer: Viewer) => Promise<boolean>;
	listChildren: (ownerId: string, folderId: string, limit: number) => Promise<ThingDoc[]>;
	listBound: (targets: readonly ThingDoc[]) => Promise<ArchiveAttachmentDoc[]>;
	loadAttachment: (id: string) => Promise<ArchiveAttachmentDoc | null>;
	download: typeof getAttachmentDownload;
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

const kindsOf = (doc: Pick<ThingDoc, 'thingtime'>): string[] => (Array.isArray(doc.thingtime) ? doc.thingtime : []);

// Post-purpose media binds to posts and pages; comment media to comments.
// Anything else (messages, profile slots, emoji) never belongs to a gallery.
const boundPurposeAllows = (target: ThingDoc, attachment: ArchiveAttachmentDoc): boolean => {
	if (attachment.ownerId !== target.ownerId) return false;
	const purpose = attachment.attachmentPurpose;
	return kindsOf(target).includes('comment') ? purpose === 'comment' : purpose === undefined || purpose === 'post';
};

const defaultDependencies: ArchiveDependencies = {
	findViewable: findViewableThing,
	canView: canViewInherited,
	listChildren: async (ownerId, folderId, limit) =>
		(await (await getThingsCollection())
			.find({ ownerId, folderId, thingtime: { $exists: true } } as any, { projection: ARCHIVE_CHILD_PROJECTION })
			.sort({ createdAt: 1, shareId: 1 })
			.limit(limit)
			.toArray()) as any as ThingDoc[],
	listBound: async (targets) => {
		if (!targets.length) return [];
		const docs = (await (await getThingsCollection())
			.find({ thingtime: 'attachment', targetId: { $in: targets.map((target) => target.shareId) }, attachmentState: 'ready' } as any, {
				projection: ARCHIVE_ATTACHMENT_PROJECTION
			})
			.sort({ createdAt: 1, shareId: 1 })
			.limit(ARCHIVE_MAX_FILES * 4)
			.toArray()) as any as ArchiveAttachmentDoc[];
		return orderAttachmentDocsByStoredSort(docs);
	},
	loadAttachment: async (id) =>
		(await (await getThingsCollection()).findOne({ shareId: id, thingtime: 'attachment' } as any, { projection: ARCHIVE_ATTACHMENT_PROJECTION })) as any as ArchiveAttachmentDoc | null,
	download: getAttachmentDownload,
	customMongoActive: isCustomMongoEndpointActive,
	fetch: (input, init) => fetch(input, init),
	now: Date.now
};

const crystalOf = (doc: Pick<ThingDoc, 'crystal'>): Record<string, unknown> => (doc.crystal && typeof doc.crystal === 'object' ? doc.crystal : {});

type Candidate = { doc: ArchiveAttachmentDoc; directory: string; from: string };

export const createAttachmentArchiveService = (overrides: Partial<ArchiveDependencies> = {}) => {
	const dependencies: ArchiveDependencies = { ...defaultDependencies, ...overrides };

	const plan = async (viewer: Viewer, idInput: unknown, options: ArchivePlanOptions = {}): Promise<ArchivePlan | Fail> => {
		const id = typeof idInput === 'string' ? idInput.trim() : '';
		if (!id) return fail(400, 'Invalid archive id');
		// Post attachments never authorize a home object against a caller-selected
		// data plane (same rule as the content endpoint).
		if (dependencies.customMongoActive()) return fail(404, 'Thing not found');
		const root = await dependencies.findViewable(id, viewer);
		const kind = root ? archiveRootKind(root.thingtime) : null;
		if (!root || !kind) return fail(404, 'Thing not found');
		const name = archiveDisplayName(kind, crystalOf(root), root.shareId);

		const candidates: Candidate[] = [];
		const paths = new ArchivePathAllocator();
		let visited = 0;
		const budget = () => {
			visited += 1;
			if (visited > ARCHIVE_MAX_THINGS) throw fail(413, 'This folder has too many Things to archive in one download');
		};

		const addBound = async (targets: readonly ThingDoc[], directoryFor: (target: ThingDoc) => string) => {
			if (!targets.length) return;
			const byTarget = new Map(targets.map((target) => [target.shareId, target]));
			for (const doc of await dependencies.listBound(targets)) {
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
				budget();
				const childKinds = kindsOf(child);
				const childKind = archiveRootKind(childKinds);
				// Saved recordings are attachment Things filed in folders; every other
				// protected/managed kind is never gallery content.
				if (!childKind || child.ownerId !== folder.ownerId || (childKind !== 'attachment' && isProtectedThingtime(childKinds))) continue;
				// Folder audience never leaks into its contents: each child is judged
				// on its own inherited ACL for THIS viewer.
				if (!(await dependencies.canView(child, viewer))) continue;
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

		try {
			if (kind === 'folder') await walkFolder(root, '', 0);
			else if (kind === 'attachment') {
				const doc = await dependencies.loadAttachment(root.shareId);
				if (doc) candidates.push({ doc, directory: '', from: root.shareId });
			} else await addBound([root], () => '');
		} catch (error) {
			if (error && typeof error === 'object' && (error as Fail).ok === false) return error as Fail;
			throw error;
		}

		const entries: ArchiveEntry[] = [];
		const links: ArchiveLink[] = [];
		let skipped = 0;
		let totalBytes = 0;
		const downloadViewer: AttachmentAccessViewer =
			viewer || options.sharedRoot || options.isAdmin
				? { id: '', ...viewer, ...(options.isAdmin ? { isAdmin: true } : {}), ...(options.sharedRoot ? { sharedRoot: options.sharedRoot } : {}) }
				: null;
		for (const candidate of candidates) {
			const crystal = crystalOf(candidate.doc);
			const fileName = safeArchiveSegment(crystal.name, `file-${shortArchiveId(candidate.doc.shareId)}`);
			if (candidate.doc.attachmentLinked === true) {
				if (typeof crystal.url === 'string' && crystal.url) links.push({ name: fileName, url: crystal.url, from: candidate.directory });
				continue;
			}
			const signed = await dependencies.download(downloadViewer, candidate.doc.shareId, true);
			if (signed.ok === false) {
				skipped += 1;
				continue;
			}
			if (entries.length + 1 > ARCHIVE_MAX_FILES || totalBytes + signed.size > ARCHIVE_MAX_BYTES) {
				return fail(413, 'These files are too large to download as one ZIP — download the folders inside separately');
			}
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
		if (!entries.length && !links.length) return fail(404, skipped ? 'No downloadable files are available to you here' : 'There are no files to download here');
		return {
			ok: true,
			id: root.shareId,
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

	const manifest = (value: ArchivePlan): ArchiveManifest => ({
		ok: true,
		id: value.id,
		kind: value.kind,
		name: value.name,
		fileName: value.fileName,
		fileCount: value.entries.length,
		totalBytes: value.totalBytes,
		skipped: value.skipped,
		linkCount: value.links.length,
		files: value.entries.map((entry) => ({ id: entry.id, path: entry.path, name: entry.name, size: entry.size }))
	});

	// Signed URLs are fetched server-side, one at a time, and piped straight into
	// the archive; the client only ever sees the stable first-party endpoint.
	const stream = (value: ArchivePlan, signal?: AbortSignal): ReadableStream<Uint8Array> => {
		const startedAt = dependencies.now();
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
		return createZipStream(entries, texts, { deadlineAt: startedAt + ARCHIVE_WALL_CLOCK_MS, now: dependencies.now });
	};

	return { plan, manifest, stream };
};

const service = createAttachmentArchiveService();
export const planAttachmentArchive = service.plan;
export const attachmentArchiveManifest = service.manifest;
export const streamAttachmentArchive = service.stream;
