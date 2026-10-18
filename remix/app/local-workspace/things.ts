import { normalizeLibraryTitle } from '../utils/libraryTitle';
import { LOCAL_TIMELINE_FOLDER, localTimelineFolder, recordLocalThingChanges, type LocalMutationCapture } from './timeline';
import { captureThingChanges, type ThingTransactionCapture } from './thingChanges';
import { isLocalInteraction } from './interactions';
import { attachmentCountLimit } from '../schemas/attachmentLimits';
import type { StoredDraft } from './drafts';
import { compositionAttachmentIds } from '../api/utils/actions/compositionMediaCore';
import { rewriteTransferMedia } from '../api/utils/things/transferMediaCore';
import { verifyTransferFiles, transferChecksum } from '../utils/thingTransfer/archive';
import { isTransferRecording, recordingTransferFile } from '../utils/thingTransfer/recording';
import { createLocalAttachment, isLocalAttachment, localAttachmentFileId, localAttachmentExpired, reapLocalAttachmentDrafts, LOCAL_ATTACHMENT_DRAFT_MS, type LocalAttachment } from './attachments';
import { applyAttachmentAnnotationPatch, isStandaloneAttachmentPurpose, type AttachmentAnnotationPatch } from '../api/utils/attachments/attachmentCore';
import { sanitizeTags } from '../schemas/thingTags';
import { selectComponent } from '../api/utils/webpages/componentResolutionCore';
import { isProtectedThingtime, sanitizeExtended, validateThingtimeCrystal } from '../schemas/registry';
import { compositionReferences } from '../api/utils/actions/sharedCompositionCore';
import { rewriteComposition } from '../api/utils/actions/forkCompositionCore';
import { collectTransfer, type CollectTransferOptions } from '../utils/thingTransfer/collect';
import { serializeTransfer, parseTransfer, validateTransfer, transferAnnotations, type JsonValue, type TransferThing } from '../utils/thingTransfer/format';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { importedThingCrystal, orderTransferImports } from '../utils/thingTransfer/importContent';
import { algorithmTransferContent, isTransferAlgorithm, validateTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import { MAX_SAVED_ALGORITHMS } from '../api/utils/algorithms/algorithmContent';
import { isTransferTheme, validateTransferTheme } from '../utils/thingTransfer/theme';
import { normalizeSavedTheme, MAX_SAVED_THEMES } from '../theme/savedTheme';
import { type WorkspaceDatabase, WorkspaceError, LEGACY_FILE_BUFFER_LIMITS, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export type LocalThing = TransferThing & { createdAt: string; updatedAt: string; revision: number; localSubmission?: string };
export type LocalFileMutation = (tx: WorkspaceTransaction, row: LocalAttachment, previous?: LocalAttachment) => Promise<void>;
export type LocalThingRecovery = (tx: WorkspaceTransaction, id: string) => Promise<Pick<LocalThing, 'revision' | 'updatedAt' | 'createdAt'> | undefined>;
export type LocalThingMutation = (tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing | null, input: ThingWrite) => Promise<void>;
export type ThingWrite = {
	id?: string; thingtime?: unknown; crystal?: unknown; extended?: unknown; tags?: unknown;
	folderId?: string | null; targetId?: string | null; expectedUpdatedAt?: string; replaceCrystal?: boolean;
};
export const localThingProjection = (thing: LocalThing, ownerId: string) => ({
	...thing, author: { id: ownerId, username: 'local', displayName: 'Local workspace', avatarUrl: null, localOnly: true as const },
	acl: ['tt:user'], visibility: 'private' as const, folderId: thing.folderId || null, targetId: thing.targetId || null,
	tags: thing.tags || [], extended: thing.extended ?? null, localOnly: true,
	// Derived from a scoped stored row, never an ID convention or import field.
	canEditLocalFileDetails: isLocalAttachment(thing) && isStandaloneAttachmentPurpose(thing.localAttachment.purpose) &&
		!thing.targetId && !thing.localAttachment.draftId && !thing.localAttachment.expiresAt
});
const isLocalActivity = (row: Pick<LocalThing, 'thingtime'>) => isLocalInteraction(row) || row.thingtime.includes('action-run');
export const isLocalLibraryThing = (row: LocalThing, target?: string) => !isLocalActivity(row) && (!isLocalAttachment(row) || ((!row.targetId && !row.localAttachment.draftId && !row.localAttachment.expiresAt) || (!!target && row.targetId === target)));
const fail = (code: string, message: string, status = 400): never => { throw new WorkspaceError(code, message, status); };
const content = (thing: TransferThing): TransferThing => ({
	id: thing.id, thingtime: thing.thingtime, crystal: isLocalAttachment(thing as LocalThing) ? { recordingFileId: localAttachmentFileId(thing.id), ...((thing as LocalAttachment).localAttachment.purpose === 'file' ? { filePurpose: 'file' } : {}) } : isTransferAlgorithm(thing) ? snapshotTransferValue(algorithmTransferContent(thing.crystal)) as TransferThing['crystal'] : thing.crystal,
	...(thing.extended === undefined ? {} : { extended: thing.extended }),
	...(thing.tags === undefined ? {} : { tags: thing.tags }),
	...(thing.folderId ? { folderId: thing.folderId } : {}), ...(thing.targetId ? { targetId: thing.targetId } : {})
});
const validated = (input: ThingWrite, postAttachments?: { hasAny: boolean; hasVisual: boolean }): Pick<TransferThing, 'thingtime' | 'crystal' | 'extended' | 'tags'> => {
	// Apply the same lossless JSON boundary before the shared schema sanitizers.
	const crystal = snapshotTransferValue(input.crystal ?? {});
	const result = validateThingtimeCrystal(input.thingtime, crystal, { postAttachments });
	if (result.ok === false) return fail('INVALID_THING', result.error, result.status);
	if (result.requiresTarget && !input.targetId) return fail('INVALID_TARGET', 'This kind requires a target Thing');
	if (isProtectedThingtime(result.thingtime) || isLocalInteraction({ thingtime: result.thingtime })) return fail('MANAGED_KIND', 'This kind uses its dedicated workspace operation', 403);
	const extended = input.extended === undefined ? undefined : sanitizeExtended(snapshotTransferValue(input.extended));
	if (extended?.ok === false) return fail('INVALID_THING', extended.error, extended.status);
	const tags = sanitizeTags(input.tags);
	if (!Array.isArray(tags)) return fail('INVALID_THING', tags.error, tags.status);
	return { thingtime: result.thingtime, crystal: result.crystal as TransferThing['crystal'],
		...(extended?.ok ? { extended: extended.value as JsonValue } : {}),
		...(input.tags === undefined ? {} : { tags }) };
};

/** Same content contract as Things, with explicit browser storage authority.
 * No fetch, credentials, remote IDs, publication, or account migration here. */
export class LocalThings {
	constructor(private db: WorkspaceDatabase, readonly scope: WorkspaceScope, private lease: WorkspaceLease,
		private builtins: readonly TransferThing[] = [], private now = () => new Date().toISOString(), private uuid = () => crypto.randomUUID(), private onWrite?: LocalThingMutation,
		private onFileWrite?: LocalFileMutation, private acceptsExternalTarget?: (tx: WorkspaceTransaction, id: string) => Promise<boolean>,
		private captureAccountChanges?: ThingTransactionCapture, private onRecover?: LocalThingRecovery,
		private themeMutations?: { import(tx: WorkspaceTransaction, row: LocalThing): Promise<void>; move(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing): Promise<void>; rename(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing): Promise<void> },
		private algorithmMutations?: { import(tx: WorkspaceTransaction, row: LocalThing): Promise<void>; move(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing): Promise<void>; rename(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing): Promise<void> }) {}
	private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, captures?: Map<string, LocalMutationCapture>, signal?: AbortSignal) {
		const lease: WorkspaceLease = signal ? { assertCurrent: () => { this.lease.assertCurrent(); signal.throwIfAborted(); }, onInvalidate: cb => { const off = this.lease.onInvalidate(cb); signal.addEventListener('abort', cb, { once: true }); return () => { off(); signal.removeEventListener('abort', cb); }; } } : this.lease;
		return this.db.transaction(this.scope, mode, lease, async tx => {
			if (mode !== 'readwrite') return run(tx);
			if (this.scope.kind !== 'anonymous') return this.captureAccountChanges ? this.captureAccountChanges(tx, run, captures) : run(tx);
			return captureThingChanges(tx, run, (tx, changes) => recordLocalThingChanges(tx, changes, this.now, this.uuid, captures));
		});
	}
	private async placement(tx: WorkspaceTransaction, row: TransferThing) {
		if (row.folderId === LOCAL_TIMELINE_FOLDER || row.targetId === LOCAL_TIMELINE_FOLDER) fail('MANAGED_KIND', 'Timeline is managed by History. Choose an ordinary folder or Thing.');
		const seen = new Set([row.id]); let parent = row.folderId;
		while (parent) {
			if (seen.has(parent)) fail('FOLDER_CYCLE', 'A folder cannot contain itself');
			seen.add(parent); const folder = await tx.get<LocalThing>('things', parent);
			if (!folder?.thingtime.includes('folder')) fail('INVALID_FOLDER', 'Destination folder is not in this workspace');
			parent = folder!.folderId;
		}
		if (row.targetId && !await tx.get('things', row.targetId) && !await this.acceptsExternalTarget?.(tx, row.targetId)) fail('INVALID_TARGET', 'Target is not in this workspace');
		if (row.thingtime.includes('data') && typeof row.crystal.schemaId === 'string') {
			const schema = await tx.get<LocalThing>('things', row.crystal.schemaId) || this.builtins.find(doc => doc.id === row.crystal.schemaId);
			if (!schema?.thingtime.includes('schema')) fail('INVALID_SCHEMA', 'Schema is not in this workspace');
			row.crystal.schema = schema!.crystal.name;
		}
	}
	async create(input: ThingWrite) {
		return this.transaction('readwrite', tx => this.createIn(tx, input));
	}
	private async createIn(tx: WorkspaceTransaction, input: ThingWrite, identity?: string, recovered?: Pick<LocalThing, 'revision' | 'updatedAt' | 'createdAt'>) {
		if (identity && await tx.get('things', identity)) fail('WRITE_CONFLICT', 'This Thing is already present. Refresh before restoring.', 409);
		const checked = validated(input); const stamp = this.now();
		const row: LocalThing = { ...checked, id: identity ?? (this.scope.kind === 'anonymous' ? `local-${this.uuid()}` : this.uuid()), createdAt: stamp, updatedAt: stamp, revision: 1, ...recovered,
			...(input.folderId ? { folderId: input.folderId } : {}), ...(input.targetId ? { targetId: input.targetId } : {}) };
		await this.placement(tx, row); await tx.put('things', row.id, row); await this.onWrite?.(tx, row, null, input); return row;
	}
	/** Trusted composition adapters can reuse ordinary validation and writes in
	 * one transaction. The callback may await only these storage operations. */
	async atomic<T>(run: (writer: Pick<LocalThings, 'snapshot' | 'create' | 'update'>) => Promise<T>): Promise<T> {
		return this.transaction('readwrite', tx => run({
			snapshot: async () => (await tx.list<LocalThing>('things')).map(row => row.value),
			create: input => this.createIn(tx, input),
			update: input => this.updateIn(tx, input)
		}));
	}
	/** Trusted Timeline adapter: normal validators, quota, content and canonical
	 * revision capture share one transaction. Public writes cannot supply captures. */
	async versionTransaction<T>(run: (writer: {
		tx: WorkspaceTransaction;
		create(input: ThingWrite, id: string, capture: LocalMutationCapture): Promise<LocalThing>;
		recover(input: ThingWrite, id: string, capture: LocalMutationCapture): Promise<LocalThing>;
		update(input: ThingWrite & { id: string }, capture: LocalMutationCapture): Promise<LocalThing>;
	}) => Promise<T>, signal?: AbortSignal): Promise<T> {
		if (this.scope.kind !== 'anonymous' && (!this.captureAccountChanges || !this.onWrite)) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account versions require their sync adapter');
		const captures = new Map<string, LocalMutationCapture>();
		return this.transaction('readwrite', tx => run({ tx,
			create: async (input, id, capture) => { captures.set(id, capture); return this.createIn(tx, input, id); },
			recover: async (input, id, capture) => {
				if (this.scope.kind === 'account' && !this.onRecover) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account recovery requires its sync adapter');
				captures.set(id, capture);
				return this.createIn(tx, input, id, await this.onRecover?.(tx, id));
			},
			update: async (input, capture) => { captures.set(input.id, capture); return this.updateIn(tx, input); }
		}), captures, signal);
	}
	/** Local post content uses the normal schema and relational attachments. No
	 * audience setting here can publish or authorize a remote operation. */
	async savePost(input: ThingWrite & { shareId?: string; attachmentIds?: unknown }, update = false) {
		this.lease.assertCurrent();
		if (this.scope.kind !== 'anonymous' && !this.onWrite) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account posts require their sync adapter');
		input = JSON.parse(JSON.stringify(input));
		const requestId = input.shareId || this.uuid();
		if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(requestId)) fail('INVALID_ID', 'Invalid local post request id');
		const id = update ? input.id! : this.scope.kind === 'account' ? requestId : requestId.startsWith('local-') ? requestId : `local-post-${requestId}`;
		const previous = update ? await this.get(id) : undefined;
		if (previous && !previous.thingtime.includes('post')) fail('INVALID_THING', 'Select a local post');
		const currentFiles = update ? (await this.snapshot()).filter(row => isLocalAttachment(row) && row.targetId === id).sort((a, b) => (a as LocalAttachment).localAttachment.order - (b as LocalAttachment).localAttachment.order) : [];
		const ids = input.attachmentIds === undefined ? currentFiles.map(row => row.id) : input.attachmentIds;
		const kinds = previous?.thingtime || input.thingtime;
		const purpose = Array.isArray(kinds) && kinds.includes('comment') ? 'comment' : 'post';
		if (!Array.isArray(ids) || ids.length > attachmentCountLimit(purpose) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) fail('INVALID_ATTACHMENT', 'Invalid local attachment selection');
		const files = new Map<string, Awaited<ReturnType<LocalThings['readFile']>>>();
		for (const fileId of ids as string[]) files.set(fileId, await this.readFile(fileId));
		const crystal = previous ? input.replaceCrystal ? input.crystal : { ...previous.crystal, ...input.crystal as object } : input.crystal;
		const checked = validated({ ...previous, ...input, thingtime: previous?.thingtime || input.thingtime, crystal }, { hasAny: files.size > 0, hasVisual: [...files.values()].some(({ row }) => ['image', 'video'].includes(String(row.crystal.mediaKind))) });
		if (!checked.thingtime.includes('post') || checked.thingtime.some(kind => !['post', 'comment'].includes(kind))) fail('INVALID_THING', 'Select a local post or comment');
		if (this.scope.kind === 'anonymous' && (checked.crystal.subspaceId || checked.crystal.flairId)) fail('REMOTE_ACCOUNT_REQUIRED', 'Posting into a subspace requires a signed-in account');
		const fingerprint = await transferChecksum(new TextEncoder().encode(JSON.stringify({ checked, ids, targetId: input.targetId || null })));
		return this.transaction('readwrite', async tx => {
			const stored = await tx.get<LocalThing>('things', id);
			if (!update && stored) {
				if (stored.localSubmission !== fingerprint) fail('WRITE_CONFLICT', 'This post request was already used for different content', 409);
				return stored;
			}
			if (update && (!stored || stored.revision !== previous!.revision || (input.expectedUpdatedAt !== undefined && stored.updatedAt !== input.expectedUpdatedAt))) fail('WRITE_CONFLICT', 'This post changed in another editor', 409);
			const stamp = new Date(Math.max(Date.parse(this.now()), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
			const row: LocalThing = { ...checked, id, createdAt: previous?.createdAt || stamp, updatedAt: stamp, revision: (previous?.revision || 0) + 1,
				localSubmission: previous?.localSubmission || fingerprint, ...(input.targetId || previous?.targetId ? { targetId: input.targetId || previous?.targetId } : {}),
				...(input.folderId || previous?.folderId ? { folderId: input.folderId || previous?.folderId } : {}) };
			for (const field of ['folderId', 'targetId'] as const) if (field in input) {
				if (input[field]) row[field] = input[field]!; else delete row[field];
			}
			await this.placement(tx, row);
			for (const [order, fileId] of (ids as string[]).entries()) {
				const expected = files.get(fileId)!, file = await tx.get<LocalThing>('things', fileId), bytes = await tx.getBytes(fileId);
				if (!file || !isLocalAttachment(file) || JSON.stringify(file) !== JSON.stringify(expected.row) || !bytes || bytes.length !== expected.bytes.length || !bytes.every((byte, n) => byte === expected.bytes[n])) fail('WRITE_CONFLICT', 'Post files changed; retry with the current selection', 409);
				const attachment = file as LocalAttachment;
				if (attachment.localAttachment.purpose !== purpose || (attachment.targetId && attachment.targetId !== id)) fail('INVALID_ATTACHMENT', 'Post files belong to another Thing');
				if (attachment.localAttachment.draftId) {
					const draft = await tx.get<StoredDraft>('drafts', attachment.localAttachment.draftId);
					if (!draft || draft.deleted || draft.draft.mode !== 'draft') fail('INVALID_ATTACHMENT', 'Only active working drafts can donate files');
				}
				const next = { ...attachment, targetId: id, localAttachment: { ...attachment.localAttachment, order } };
				delete next.localAttachment.draftId; delete next.localAttachment.expiresAt;
				await tx.put('things', fileId, next);
			}
			for (const file of currentFiles as LocalAttachment[]) if (!(ids as string[]).includes(file.id)) {
				const latest = await tx.get<LocalAttachment>('things', file.id);
				if (latest?.targetId !== id) continue;
				delete latest.targetId; latest.localAttachment.expiresAt = new Date(Date.parse(this.now()) + LOCAL_ATTACHMENT_DRAFT_MS).toISOString();
				await tx.put('things', file.id, latest);
			}
			await tx.put('things', id, row); await this.onWrite?.(tx, row, previous || null, input); return row;
		});
	}
	async saveFile(input: { requestId: string; name: string; contentType: string; bytes: Uint8Array; folderId?: string | null; purpose?: 'file' | 'recording' | 'post' | 'comment' }, signal?: AbortSignal) {
		this.lease.assertCurrent(); signal?.throwIfAborted();
		if (this.scope.kind !== 'anonymous' && !this.onFileWrite) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account files require their dedicated sync adapter');
		if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)) fail('INVALID_REQUEST', 'A stable file save request ID is required');
		if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > LEGACY_FILE_BUFFER_LIMITS.binaryBytes) fail('LOCAL_QUOTA', 'A local file cannot exceed 16 MiB', 413);
		const bytes = Uint8Array.from(input.bytes), sha256 = await transferChecksum(bytes);
		this.lease.assertCurrent(); signal?.throwIfAborted();
		const purpose = input.purpose ?? 'file';
		if (!['file', 'recording', 'post', 'comment'].includes(purpose) || (!['file', 'recording'].includes(purpose) && input.folderId)) fail('INVALID_ATTACHMENT', 'Invalid local file purpose or placement');
		const id = `local-file-${input.requestId}`;
		const row = createLocalAttachment(id, { id: 'bytes', targetId: id, path: 'files/000000', name: input.name, mime: input.contentType, bytes: bytes.byteLength, sha256 }, this.now(), purpose, 0, input.folderId ? { folderId: input.folderId } : {});
		row.localAttachment.requestId = input.requestId; row.localAttachment.initialFolderId = input.folderId || null;
		if (!['file', 'recording'].includes(purpose)) row.localAttachment.expiresAt = new Date(Date.parse(this.now()) + LOCAL_ATTACHMENT_DRAFT_MS).toISOString();
		return this.transaction('readwrite', async tx => {
			signal?.throwIfAborted();
			await reapLocalAttachmentDrafts(tx, Date.parse(this.now()));
			const previous = await tx.get<LocalThing>('things', id);
			if (previous) {
				if (!isLocalAttachment(previous) || previous.localAttachment.purpose !== purpose || previous.localAttachment.requestId !== input.requestId || previous.localAttachment.sha256 !== sha256 || previous.crystal.name !== row.crystal.name || previous.crystal.contentType !== row.crystal.contentType || (previous.localAttachment.initialFolderId === undefined ? previous.folderId || null : previous.localAttachment.initialFolderId) !== (row.folderId || null)) fail('WRITE_CONFLICT', 'This file save request was already used for different content', 409);
				const stored = await tx.getBytes(id);
				if (!stored || stored.length !== bytes.length || !stored.every((byte, index) => byte === bytes[index])) fail('MISSING_LOCAL_FILE', 'Local file bytes are missing or changed');
				return previous as LocalAttachment;
			}
			await this.placement(tx, row); await tx.put('things', id, row); await tx.putBytes(id, bytes);
			await this.onFileWrite?.(tx, row);
			signal?.throwIfAborted(); return row;
		});
	}
	/** Rename a theme through its dedicated local transaction and sync adapter. */
	async renameLibrary(input: { id: string; displayTitle: unknown; expectedUpdatedAt?: string }) {
		const title = normalizeLibraryTitle(input.displayTitle);
		if (title === null || Object.keys(input).some(key => !['id', 'displayTitle', 'expectedUpdatedAt'].includes(key)))
			fail('INVALID_TITLE', 'Choose a title of 1–120 characters');
		if (input.expectedUpdatedAt !== undefined && (typeof input.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(input.expectedUpdatedAt))))
			fail('INVALID_VERSION', 'Invalid rename version');
		return this.transaction('readwrite', async tx => {
			const previous = await tx.get<LocalThing>('things', input.id);
			if (!previous || (!isTransferTheme(previous) && !isTransferAlgorithm(previous))) return fail('LOCAL_OPERATION_UNAVAILABLE', 'This item requires its dedicated title adapter', 409);
			const adapter = isTransferTheme(previous) ? this.themeMutations : this.algorithmMutations;
			if (input.expectedUpdatedAt !== undefined && previous.updatedAt !== input.expectedUpdatedAt)
				fail('WRITE_CONFLICT', 'This item changed. Reload before renaming.', 409);
			if (previous.crystal.title === title) return previous;
			const row: LocalThing = {
				...previous, crystal: { ...previous.crystal, title: title! }, revision: previous.revision + 1,
				updatedAt: new Date(Math.max(Date.parse(this.now()), Date.parse(previous.updatedAt) + 1)).toISOString()
			};
			if (isTransferTheme(row)) validateTransferTheme(row);
			else validateTransferAlgorithm({ ...row, crystal: algorithmTransferContent(row.crystal) });
			if (this.scope.kind === 'account' && !adapter)
				fail('LOCAL_OPERATION_UNAVAILABLE', 'Account library items require their dedicated sync adapter');
			await tx.put('things', row.id, row);
			if (this.scope.kind === 'account') await adapter!.rename(tx, row, previous);
			return row;
		});
	}
	/** Owner display text on a stored local file, reusing the shared canonical
	 * annotation patch. Bytes, purpose, placement and device bookkeeping are
	 * untouched; the file's immutable original name stays the download name. */
	async annotateFile(input: { id: string; title?: string | null; description?: string | null; filenamePreview?: string | null }) {
		this.lease.assertCurrent();
		if (this.scope.kind !== 'anonymous' && !this.onFileWrite) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account files require their dedicated sync adapter');
		if (Object.keys(input).some(key => !['id','title','description','filenamePreview'].includes(key))) fail('INVALID_ATTACHMENT', 'Unsupported file annotation fields');
		// Same patch contract as the account route: undefined leaves a field
		// alone, null or '' clears it, and a non-string is a caller error.
		const field = (value: string | null | undefined, label: string) => {
			if (value === undefined) return undefined;
			if (value !== null && typeof value !== 'string') fail('INVALID_ATTACHMENT', `Attachment ${label} must be text`);
			return value;
		};
		const patch: AttachmentAnnotationPatch = { title: field(input.title, 'title'),
			description: field(input.description, 'description'), filenamePreview: field(input.filenamePreview, 'filename preview') };
		if (patch.title === undefined && patch.description === undefined && patch.filenamePreview === undefined) fail('INVALID_ATTACHMENT', 'Provide a filename preview, title or description to update');
		return this.transaction('readwrite', async tx => {
			const previous = await tx.get<LocalThing>('things', input.id);
			if (!previous || !isLocalAttachment(previous) || localAttachmentExpired(previous, Date.parse(this.now()))) return fail('MISSING_LOCAL_FILE', 'File is not stored in this workspace', 404);
			const annotated = applyAttachmentAnnotationPatch(previous.crystal, patch);
			if (annotated.ok === false) return fail('INVALID_ATTACHMENT', annotated.error);
			const row: LocalAttachment = { ...previous, crystal: { ...annotated.crystal },
				updatedAt: new Date(Math.max(Date.parse(this.now()), Date.parse(previous.updatedAt) + 1)).toISOString(), revision: previous.revision + 1 };
			await tx.put('things', row.id, row); await this.onFileWrite?.(tx, row, previous); return row;
		});
	}
	async readFile(id: string, signal?: AbortSignal) {
		this.lease.assertCurrent(); signal?.throwIfAborted();
		const result = await this.transaction('readonly', async tx => {
			const row = await tx.get<LocalThing>('things', id);
			if (!row || !isLocalAttachment(row) || localAttachmentExpired(row, Date.parse(this.now()))) return fail('MISSING_LOCAL_FILE', 'File is not stored in this workspace', 404);
			const bytes = await tx.getBytes(id);
			if (!bytes || bytes.byteLength !== row.crystal.size) return fail('MISSING_LOCAL_FILE', 'Local file bytes are missing or changed');
			return { row, bytes };
		});
		if (await transferChecksum(result.bytes) !== result.row.localAttachment.sha256) fail('MISSING_LOCAL_FILE', 'Local file bytes are missing or changed');
		this.lease.assertCurrent(); signal?.throwIfAborted(); return result;
	}
	/** A routing hint from this partition, not an ownership grant. Retained
	 * history also keeps deleted local identities from falling through to public
	 * reads. The actual operation still resolves/validates the scoped Thing. */
	async hasReference(id: string): Promise<boolean> {
		return this.transaction('readonly', async tx => (this.scope.kind === 'anonymous' && id === LOCAL_TIMELINE_FOLDER && !!await localTimelineFolder(tx)) || !!(await tx.get('things', id)) || !!(await tx.get('timeline-meta', `head:${id}`)));
	}
	async get(id: string): Promise<LocalThing> {
		return this.transaction('readonly', async tx => {
			const found = this.scope.kind === 'anonymous' && id === LOCAL_TIMELINE_FOLDER ? await localTimelineFolder(tx) : await tx.get<LocalThing>('things', id);
			if (!found || found.thingtime.includes('action-run')) return fail('NOT_FOUND', 'Thing is not in this workspace', 404);
			return found;
		});
	}
	async snapshot(): Promise<LocalThing[]> {
		return this.transaction('readonly', async tx => (await tx.list<LocalThing>('things')).map(row => row.value));
	}
	/** User-facing library only; content snapshots and portable exports exclude
	 * managed containers. Account partitions never receive anonymous History. */
	private async librarySnapshotIn(tx: WorkspaceTransaction, includeTimeline = true): Promise<LocalThing[]> {
		const rows = (await tx.list<LocalThing>('things')).map(row => row.value);
		const folder = includeTimeline && this.scope.kind === 'anonymous' ? await localTimelineFolder(tx) : null;
		return folder ? [...rows, folder] : rows;
	}
	async librarySnapshot(): Promise<LocalThing[]> {
		return this.transaction('readonly', tx => this.librarySnapshotIn(tx));
	}
	async list(query: { thingtime?: string | string[]; folder?: string; target?: string; cursor?: string; limit?: number } = {}) {
		const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
		const kinds = typeof query.thingtime === 'string' ? query.thingtime.split(',') : query.thingtime || [];
		return this.transaction('readonly', async tx => {
			let rows = (await this.librarySnapshotIn(tx, !query.target && (!query.folder || query.folder === 'root') && kinds.every(kind => kind === 'folder')))
				.filter(row => isLocalLibraryThing(row, query.target) && kinds.every(kind => row.thingtime.includes(kind)) &&
					(!query.folder || (query.folder === 'root' ? !row.folderId : row.folderId === query.folder)) &&
					(!query.target || row.targetId === query.target))
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
			if (query.cursor) {
				const index = rows.findIndex(row => row.id === query.cursor);
				if (index < 0) fail('INVALID_CURSOR', 'The local list changed. Reload it before continuing.');
				rows = rows.slice(index + 1);
			}
			return { things: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
		});
	}
	async update(input: ThingWrite & { id: string }) {
		return this.transaction('readwrite', tx => this.updateIn(tx, input));
	}
	private async updateIn(tx: WorkspaceTransaction, input: ThingWrite & { id: string }) {
			if (input.id === LOCAL_TIMELINE_FOLDER) fail('MANAGED_KIND', 'Timeline is managed by History.');
			const previous = await tx.get<LocalThing>('things', input.id);
			if (!previous) return fail('NOT_FOUND', 'Thing is not in this workspace', 404);
			if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== previous.updatedAt) fail('WRITE_CONFLICT', 'This Thing changed in another editor. Reload before saving.', 409);
			const crystal = input.crystal === undefined ? previous.crystal : input.replaceCrystal ? input.crystal : { ...previous.crystal, ...input.crystal as object };
			const checked = validated({ ...previous, ...input, thingtime: previous.thingtime, crystal });
			const updatedAt = new Date(Math.max(Date.parse(this.now()), Date.parse(previous.updatedAt) + 1)).toISOString();
			const row: LocalThing = { ...previous, ...checked, updatedAt, revision: previous.revision + 1 };
			for (const field of ['folderId', 'targetId'] as const) if (field in input) {
				if (input[field]) row[field] = input[field]!; else delete row[field];
			}
			await this.placement(tx, row); await tx.put('things', row.id, row); await this.onWrite?.(tx, row, previous, input); return row;
	}
	async remove(ids: string[], recursive = false) {
		if (Array.isArray(ids) && ids.includes(LOCAL_TIMELINE_FOLDER)) fail('MANAGED_KIND', 'Timeline is managed by History.');
		if (!Array.isArray(ids) || !ids.length || ids.length > 200) fail('INVALID_IDS', 'Choose between 1 and 200 Things');
		return this.transaction('readwrite', async tx => {
			const all = await tx.list<LocalThing>('things'); const selected = new Set(ids);
			for (const id of selected) {
 const row = all.find(row => row.id === id)?.value;
 if (!row) fail('NOT_FOUND', 'Thing is not in this workspace', 404);
 if (row!.thingtime.includes('action-run')) fail('MANAGED_KIND', 'Delete the Action to remove its protected run history');
 }
			let changed = true;
			while (changed) {
				changed = false;
				for (const { value: row } of all) if (!selected.has(row.id) && ((recursive && row.folderId && selected.has(row.folderId)) || (row.targetId && selected.has(row.targetId)))) {
					if (!recursive && !((isLocalAttachment(row) || isLocalActivity(row) || row.thingtime.includes('comment')) && row.targetId && selected.has(row.targetId))) fail('HAS_CHILDREN', 'This Thing has children. Choose recursive deletion to remove them.');
					selected.add(row.id); changed = true;
				}
			}
			for (const id of selected) { if (isLocalAttachment(all.find(row => row.id === id)!.value)) await tx.deleteBytes(id); await tx.delete('things', id); }
			// Ordinary folder deletion preserves its contents, matching the canonical
			// account writer. Explicit recursive deletion still removes descendants.
			for (const {value:row} of all) if (!selected.has(row.id) && row.folderId && selected.has(row.folderId)) {
				let folderId:string|null=row.folderId; const seen=new Set<string>();
				while (folderId && selected.has(folderId)) {
					if (seen.has(folderId)) fail('INVALID_FOLDER','The folder chain is cyclic.');
					seen.add(folderId); folderId=all.find(item=>item.id===folderId)?.value.folderId || null;
				}
				const moved={...row,folderId,revision:row.revision+1,updatedAt:new Date(Math.max(Date.parse(this.now()),Date.parse(row.updatedAt)+1)).toISOString()};
				await this.placement(tx,moved);await tx.put('things',row.id,moved);
			}
			if (this.scope.kind === 'anonymous') for (const key of ['active-theme','active-algorithm']) {
				const id=await tx.get<string>('settings',key); if (id && selected.has(id)) await tx.delete('settings',key);
			}

			return { ok: true, deleted: [...selected] };
		});
	}
	async move(ids: string[], folderId: string | null) {
		if (Array.isArray(ids) && ids.includes(LOCAL_TIMELINE_FOLDER)) fail('MANAGED_KIND', 'Timeline is managed by History.');
		if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length) fail('INVALID_IDS', 'Choose between 1 and 200 distinct Things');
		return this.transaction('readwrite', async tx => {
			const rows: LocalThing[] = [];
			for (const id of ids) {
				const previous = await tx.get<LocalThing>('things', id);
				if (!previous) return fail('NOT_FOUND', 'Thing is not in this workspace', 404);
				if (isLocalActivity(previous)) fail('MANAGED_KIND', 'Interactions cannot be filed or moved');
				const row = { ...previous, revision: previous.revision + 1, updatedAt: new Date(Math.max(Date.parse(this.now()), Date.parse(previous.updatedAt) + 1)).toISOString() };
				if (folderId) row.folderId = folderId; else delete row.folderId;
				await this.placement(tx, row); await tx.put('things', id, row);
				if (isLocalAttachment(row)) {
					if (this.scope.kind === 'account' && !this.onFileWrite) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account files require their dedicated sync adapter');
					await this.onFileWrite?.(tx, row, previous as LocalAttachment);
				} else if (isTransferTheme(row) && this.scope.kind === 'account') {
					if (!this.themeMutations) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account themes require their dedicated sync adapter');
					await this.themeMutations!.move(tx, row, previous);
				} else if (isTransferAlgorithm(row) && this.scope.kind === 'account') {
					if (!this.algorithmMutations) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account algorithms require their dedicated sync adapter');
					await this.algorithmMutations!.move(tx, row, previous);
				} else await this.onWrite?.(tx, row, previous, { folderId });
				rows.push(row);
			}
			return { ok: true, moved: ids, things: rows };
		});
	}
	async export(ids: string[], options: CollectTransferOptions = {}) {
		return exportLocalThingSnapshot(await this.snapshot(), this.builtins, ids, this.lease,
			id => this.transaction('readonly', tx => tx.getBytes(id)), options);
	}
	async import(input: unknown, folderId?: string | null, fileBytes = new Map<string, Uint8Array>(), signal?: AbortSignal) {
		this.lease.assertCurrent(); signal?.throwIfAborted();
		const manifest = parseTransfer(serializeTransfer(validateTransfer(input)));
		orderTransferImports(manifest);
		if (manifest.links?.length) fail('ATTACHMENT_IMPORT_REQUIRED', 'Linked galleries require the workspace linked-attachment adapter');
		if (manifest.files.length && this.scope.kind !== 'anonymous' && !this.onFileWrite) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account files require their dedicated sync adapter');
		// Snapshot caller-owned bytes before asynchronous hashing or persistence.
		if (!(fileBytes instanceof Map) || fileBytes.size !== manifest.files.length) fail('INVALID_LOCAL_FILE', 'The transfer has missing or unexpected file bytes');
		if (manifest.files.some(file => file.bytes > LEGACY_FILE_BUFFER_LIMITS.binaryBytes) || manifest.files.reduce((total, file) => total+file.bytes, 0) > LEGACY_FILE_BUFFER_LIMITS.bytes) fail('LOCAL_QUOTA', 'Local files exceed the 16 MiB per-file or 64 MiB workspace limit', 413);
		const bytes = new Map(manifest.files.map(file => { const value = fileBytes.get(file.id); if (!(value instanceof Uint8Array) || value.byteLength !== file.bytes) return fail('INVALID_LOCAL_FILE', 'Transferred bytes do not match the manifest'); return [file.id, Uint8Array.from(value)] as const; }));
		await verifyTransferFiles({ manifest, files: bytes }, signal); this.lease.assertCurrent();
		const recordings = manifest.things.filter(isTransferRecording);
		for (const row of recordings) recordingTransferFile(row, manifest);
		const accountFileTargets = new Set([...recordings, ...manifest.things.filter(row => row.thingtime.includes('post'))].map(row => row.id));
		if (this.scope.kind === 'account' && manifest.files.some(file => !accountFileTargets.has(file.targetId))) fail('LOCAL_OPERATION_UNAVAILABLE', 'This media target requires its dedicated account import adapter');
		const map = new Map(manifest.things.map(row => [row.id, this.scope.kind === 'anonymous' ? `local-${this.uuid()}` : this.uuid()]));
		const accountSuffix = this.scope.kind === 'account' ? this.uuid().slice(0, 8) : null;
		const fileMap = new Map(manifest.files.map(file => [file.id, `${this.scope.kind === 'account' ? 'local-file' : 'local'}-${this.uuid()}`]));
		for (const recording of recordings) { const id = fileMap.get(String(recording.crystal.recordingFileId))!; map.set(recording.id, id); fileMap.set(recording.id, id); }
		const crystals = rewriteTransferMedia(manifest.things, fileMap);
		const stamp = this.now();
		const importedAlgorithms = manifest.things.filter(isTransferAlgorithm);
		if (importedAlgorithms.length && this.scope.kind !== 'anonymous' && !this.algorithmMutations) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account algorithms require their dedicated sync adapter');
		for (const algorithm of importedAlgorithms) { validateTransferAlgorithm(algorithm); if (manifest.files.some(file => file.targetId === algorithm.id) || manifest.things.some(row => row.targetId === algorithm.id || row.folderId === algorithm.id)) fail('INVALID_ALGORITHM', 'Algorithm transfers cannot contain child Things'); }
		const importedThemes = manifest.things.filter(isTransferTheme);
		if (importedThemes.length && this.scope.kind !== 'anonymous' && !this.themeMutations) fail('LOCAL_OPERATION_UNAVAILABLE', 'Account themes require their dedicated sync adapter');
		for (const theme of importedThemes) {
			validateTransferTheme(theme);
			if (manifest.files.some(file => file.targetId === theme.id) || manifest.things.some(row => row.targetId === theme.id || row.folderId === theme.id)) fail('INVALID_THEME', 'Theme transfers cannot contain child Things');
		}
		const standaloneTargets = new Set(recordings.map(row => row.id));
		const attachmentRows = manifest.files.flatMap((file, order) => standaloneTargets.has(file.targetId) ? [] : [
			createLocalAttachment(fileMap.get(file.id)!, file, stamp, manifest.things.find(row => row.id === file.targetId)?.thingtime.includes('comment') ? 'comment' : 'post', manifest.attachmentOrder?.indexOf(file.id) ?? order, { targetId: map.get(file.targetId)! })
		]);
		const importedContent = (original: TransferThing) => {
			if (isTransferRecording(original)) { const file = recordingTransferFile(original, manifest); return createLocalAttachment(map.get(original.id)!, file, stamp, original.crystal.filePurpose === 'file' ? 'file' : 'recording', 0); }
			if (isTransferAlgorithm(original)) return { thingtime: ['feed-algorithm'], crystal: snapshotTransferValue(algorithmTransferContent(original.crystal)) as TransferThing['crystal'] };
			if (!isTransferTheme(original)) {
				const bound = attachmentRows.filter(file => file.targetId === map.get(original.id));
				if (original.thingtime.includes('post')) {
					if (original.crystal.subspaceId || original.crystal.flairId) fail('REMOTE_ACCOUNT_REQUIRED', 'Local post imports cannot select a remote subspace');
					if (bound.length > attachmentCountLimit(original.thingtime.includes('comment') ? 'comment' : 'post')) fail('INVALID_ATTACHMENT', 'Too many files for this local post');
				}
				const crystal = accountSuffix ? importedThingCrystal(original, crystals.get(original.id)!, map, accountSuffix)
					: rewriteComposition(original.thingtime, crystals.get(original.id)!, (_kind, ref) => map.get(ref) || ref);
				return validated({ ...original, crystal },
					{ hasAny: bound.length > 0, hasVisual: bound.some(file => ['image', 'video'].includes(String(file.crystal.mediaKind))) });
			}

			const normalized = normalizeSavedTheme(original.crystal);
			if (!normalized.ok) return fail('INVALID_THEME', normalized.error);
			return { thingtime: ['theme'], crystal: snapshotTransferValue({ name: normalized.name, theme: normalized.theme, ...('title' in original.crystal ? {title:original.crystal.title} : {}) }) as TransferThing['crystal'] };
		};
		const rows: LocalThing[] = manifest.things.map(original => ({
			...importedContent(original),
			id: map.get(original.id)!, revision: 1, createdAt: stamp, updatedAt: stamp,
			...(original.folderId ? { folderId: map.get(original.folderId)! } : folderId && (this.scope.kind === 'account' || manifest.roots.includes(original.id)) ? { folderId } : {}),
			...(original.targetId ? { targetId: map.get(original.targetId)! } : {})
		}));
		rows.push(...attachmentRows);
		signal?.throwIfAborted();
		await this.transaction('readwrite', async tx => {
			signal?.throwIfAborted();
			if (importedAlgorithms.length && importedAlgorithms.length + (await tx.list<LocalThing>('things')).filter(row => isTransferAlgorithm(row.value)).length > MAX_SAVED_ALGORITHMS) fail('LOCAL_QUOTA', 'This import exceeds the algorithm limit', 413);
			if (importedThemes.length && importedThemes.length + (await tx.list<LocalThing>('things')).filter(row => isTransferTheme(row.value)).length > MAX_SAVED_THEMES) fail('LOCAL_QUOTA', 'This import exceeds the saved-theme limit', 413);
			// All IDs exist before relationship checks, including forward refs.
			for (const row of rows) await tx.put('things', row.id, row);
			for (const row of rows) {
				signal?.throwIfAborted(); await this.placement(tx, row);
				if (isLocalAttachment(row) && this.scope.kind === 'account') {
					row.localAttachment.requestId = row.id.slice('local-file-'.length);
					row.localAttachment.initialFolderId = row.folderId || null;
				}
				await tx.put('things', row.id, row);
				if (isLocalAttachment(row)) await this.onFileWrite?.(tx, row);
				else if (isTransferTheme(row) && this.scope.kind === 'account') await this.themeMutations!.import(tx, row);
				else if (isTransferAlgorithm(row) && this.scope.kind === 'account') await this.algorithmMutations!.import(tx, row);
				else await this.onWrite?.(tx, row, null, row);
			}
			for (const file of manifest.files) { signal?.throwIfAborted(); await tx.putBytes(fileMap.get(file.id)!, bytes.get(file.id)!); }
		}, undefined, signal);
		return { ok: true, roots: manifest.roots.map(id => map.get(id)!), idMap: Object.fromEntries(map), things: rows };
	}
}

/** Collect one immutable device snapshot through the canonical transfer pipeline.
 * Account adapters must prove cache completeness before each selected read. */
export async function exportLocalThingSnapshot(saved: LocalThing[], builtins: readonly TransferThing[], ids: string[],
 lease: WorkspaceLease, readBytes: (id: string) => Promise<Uint8Array | undefined>, options: CollectTransferOptions = {},
 assertAvailable?: (thing: TransferThing) => void, aliasIds?: ReadonlySet<string>) {
	if (ids.includes(LOCAL_TIMELINE_FOLDER)) fail('MANAGED_KIND', 'Open History to export a saved version.');
	if (saved.some(row => ids.includes(row.id) && isLocalActivity(row))) fail('MANAGED_KIND', 'Export the content Thing; local interaction and run state is not portable account authority');
	const attachments = saved.filter(isLocalAttachment);
	const mediaCopies = new Map(attachments.map(row => [row.id, localAttachmentFileId(row.id)]));
	const docs = new Map([...builtins.map(doc => [doc.id, content(doc)] as const), ...saved.filter(row => !isLocalActivity(row)).map(value => [value.id, content(value)] as const)]);
	const timestamps = new Map(saved.map(row => [row.id, row.updatedAt]));
	const builtinIds = new Set(builtins.map(row => row.id));
	const componentCandidates = [...docs.values()].filter(row => row.thingtime.includes('component') && (!aliasIds || aliasIds.has(row.id)))
		.sort((a, b) => (timestamps.get(b.id) || '').localeCompare(timestamps.get(a.id) || '') || a.id.localeCompare(b.id))
		.map(row => ({ row, shareId: row.id, ownerId: builtinIds.has(row.id) ? 'system' : 'workspace', crystal: row.crystal }));
	const resolve = (kind: string, ref: string) => {
		const exact = docs.get(ref); if (exact?.thingtime.includes(kind)) return exact;
		if (kind === 'component') return selectComponent(ref, componentCandidates, 'workspace')?.row;
		return [...docs.values()].find(row => (!aliasIds || aliasIds.has(row.id)) && row.thingtime.includes(kind) && (row.crystal.actionKey === ref || row.crystal.name === ref));
	};
	// Canonicalize aliases using the existing composition rewriter; portable
	// dependencies may not depend on a database's seeded key resolution.
	for (const doc of docs.values()) doc.crystal = rewriteComposition(doc.thingtime, doc.crystal, (kind, ref) => resolve(kind, ref)?.id || ref);
	const bundle = await collectTransfer(ids, {
		read: async id => { lease.assertCurrent(); const found = docs.get(id); if (found) assertAvailable?.(found); const file = attachments.find(row => row.id === id); if (file && (file.targetId || options.includeFiles === false)) fail('FILE_EXPORT_REQUIRED', 'Export the containing Thing, or include file bytes in a ZIP for a standalone file'); return docs.get(id) || fail('MISSING_DEPENDENCY', `Missing Thing: ${id}`, 404); },
		children: async id => ({ ids: [...docs.values()].filter(doc => doc.folderId === id && !doc.targetId).map(doc => doc.id) }),
		dependencies: async doc => compositionReferences(doc.thingtime, doc.crystal).flatMap(ref => {
			const found = resolve(ref.kind, ref.ref);
			if (!found && !ref.optional) fail('MISSING_DEPENDENCY', `Missing ${ref.kind}: ${ref.ref}`, 404);
			return found ? [found.id] : [];
		}),
		files: async function* (doc) {
			const ids = new Set(attachments.filter(row => row.targetId === doc.id || row.id === doc.id).sort((a,b) => a.localAttachment.order-b.localAttachment.order || a.id.localeCompare(b.id)).map(row => row.id));
			for (const id of compositionAttachmentIds(doc.thingtime, doc.crystal, { component: ref => resolve('component', ref)?.crystal })) ids.add(id);
			for (const id of ids) {
				lease.assertCurrent(); options.signal?.throwIfAborted();
				const row = attachments.find(row => row.id === id);
				if (!row) fail('MISSING_LOCAL_FILE', `File ${id} is not stored in this workspace`, 404);
				const data = await readBytes(id);
				if (!data || data.byteLength !== row!.crystal.size || await transferChecksum(data) !== row!.localAttachment.sha256) fail('MISSING_LOCAL_FILE', 'Local file bytes are missing or changed; no partial export was created');
				lease.assertCurrent();
				yield { id: localAttachmentFileId(id), name: String(row!.crystal.name), mime: String(row!.crystal.contentType), data: data!, ...transferAnnotations(row!.crystal as any) };
			}
		}
	}, options);
	// Embedded use can be visited before the standalone file itself. When
	// both are included, the byte entry belongs to that file Thing so its normal
	// import contract remains valid regardless of folder/UUID traversal order.
	const included = new Set(bundle.manifest.things.map(row => row.id));
	for (const row of attachments) if (!row.targetId && included.has(row.id)) {
		const file = bundle.manifest.files.find(file => file.id === localAttachmentFileId(row.id));
		if (file) file.targetId = row.id;
	}
	const includedCopies = new Map([...mediaCopies].filter(([, fileId]) => bundle.files.has(fileId)));
	const crystals = rewriteTransferMedia(bundle.manifest.things, includedCopies);
	for (const row of bundle.manifest.things) row.crystal = crystals.get(row.id)!;
	serializeTransfer(bundle.manifest);
	lease.assertCurrent(); return bundle;
}
