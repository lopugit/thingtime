import { createHash } from 'node:crypto';
import { immutableReferenceIndex, validReferenceNodeRef, type ReferenceBlob } from './immutableReferenceIndex';
import {
	iterateBackupThingReferences,
	iterateBackupThingMedia,
	StoredReferenceUnsupportedError,
	type BackupReferenceIssue,
	type BackupReferenceEvidence
} from './storedReferences';
import type { BackupObjectStore } from './portableBackup';
import { backupJson, backupDigest, BACKUP_METADATA_BYTES } from '../../../backups/manifest';
import type { BackupAttachment } from './attachmentRecords';

/** Root only; all index, queue, ancestry, issues and large args live in immutable
 * sidecars. No source DB read is needed after the census has finished. */
type ReferenceState = {
	version: 1;
	snapshotId: string;
	ownerId: string;
	root: string | null;
	mode: 'build' | 'selections' | 'references' | 'media' | 'ancestry' | 'emit' | 'done';
	contexts: number;
	contextIndex: number;
	offset: number;
	selections: number;
	selectionIndex: number;
	issues: number;
	unresolved: number;
	unsupported: number;
	excluded: number;
	evidenceOffset: number;
	evidencePage: number;
	pendingTarget: string | null;
	pendingArgs: ReferenceBlob | null;
	ancestor: number | null;
};
type Context = { id: string; args: ReferenceBlob | null; parent: number | null };
export type AccountInventoryDescriptor = { id: string; parentId: string | null; name: string; kind: 'folder' | 'file' | 'data' };
type DescriptorSource = { shareId: string; ownerId: string; thingtime: string[]; folderId?: string | null; crystal?: { name?: unknown } };
function descriptorValue(value: any, id: string): AccountInventoryDescriptor {
	if (!value || Object.keys(value).sort().join(',') !== 'id,kind,name,parentId' || value.id !== id ||
		typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' ||
		!(value.parentId === null || (typeof value.parentId === 'string' && value.parentId.length > 0)) ||
		!['folder', 'file', 'data'].includes(value.kind)) throw Error('Invalid pinned presentation descriptor');
	return value;
}
const contextKey = (id: string, args: ReferenceBlob | null) => ['context-key', id, args?.sha256 ?? createHash('sha256').update('{}').digest('hex')];
export async function openAccountInventoryReferences(
	store: BackupObjectStore,
	snapshotId: string,
	ownerId: string,
	hash: string | null,
	check: () => Promise<void>,
	tick: () => void = () => {},
	unitIdentity?: string
) {
	if (unitIdentity !== undefined && !backupDigest(unitIdentity)) throw Error('Invalid accepted reference unit');
	const index = immutableReferenceIndex(
		store,
		`snapshots/${snapshotId}/references`,
		check,
		tick,
		createHash('sha256')
			.update(JSON.stringify([snapshotId, ownerId, unitIdentity ?? hash]))
			.digest('hex')
	);
	const state: ReferenceState = hash
		? await index.readState(hash)
		: {
				version: 1,
				snapshotId,
				ownerId,
				root: null,
				mode: 'build',
				contexts: 0,
				contextIndex: 0,
				offset: 0,
				selections: 0,
				selectionIndex: 0,
				issues: 0,
				unresolved: 0,
				unsupported: 0,
				excluded: 0,
				evidenceOffset: 0,
				evidencePage: 0,
				pendingTarget: null,
				pendingArgs: null,
				ancestor: null
		  };
	if (
		Object.keys(state).sort().join(',') !==
			'ancestor,contextIndex,contexts,evidenceOffset,evidencePage,excluded,issues,mode,offset,ownerId,pendingArgs,pendingTarget,root,selectionIndex,selections,snapshotId,unresolved,unsupported,version' ||
		state.version !== 1 ||
		(state.root !== null && !validReferenceNodeRef(state.root)) ||
		state.contextIndex > state.contexts ||
		state.selectionIndex > state.selections ||
		state.evidenceOffset > state.issues ||
		state.unresolved + state.unsupported + state.excluded !== state.issues ||
		(state.mode === 'ancestry'
			? typeof state.pendingTarget !== 'string' ||
			  state.pendingArgs === null ||
			  (state.ancestor !== null && (!Number.isSafeInteger(state.ancestor) || state.ancestor < 0 || state.ancestor > state.contextIndex))
			: state.pendingTarget !== null || state.pendingArgs !== null || state.ancestor !== null) ||
		state.snapshotId !== snapshotId ||
		state.ownerId !== ownerId ||
		!['build', 'selections', 'references', 'media', 'ancestry', 'emit', 'done'].includes(state.mode) ||
		![
			state.contexts,
			state.contextIndex,
			state.offset,
			state.selections,
			state.selectionIndex,
			state.issues,
			state.unresolved,
			state.unsupported,
			state.excluded,
			state.evidenceOffset,
			state.evidencePage
		].every((v) => Number.isSafeInteger(v) && v >= 0)
	)
		throw Error('Invalid pinned reference continuation');
	const get = (...parts: unknown[]) => index.get(state.root, index.key(parts));
	const set = async (value: any, ...parts: unknown[]) => {
		state.root = await index.set(state.root, index.key(parts), value);
	};
	const issue = async (sourceId: string, code: BackupReferenceIssue['code'], kind: string, reference: string | null) => {
		let entry: BackupReferenceIssue = { sourceId, code, kind, reference };
		if (reference !== null && reference.length > 200)
			entry = {
				sourceId,
				code,
				kind,
				reference: null,
				referenceDiagnostic: { encoding: 'utf8', bytes: Buffer.byteLength(reference), sha256: createHash('sha256').update(reference).digest('hex') }
			};
		const key = ['issue-key', entry];
		if (await get(...key)) return;
		await set(true, ...key);
		await set(entry, 'issue', state.issues++);
		if (code === 'ambiguous-alias' || code === 'unresolved-owned-or-external') state.unresolved++;
		else if (code === 'excluded-authority-state') state.excluded++;
		else state.unsupported++;
	};
	const enqueue = async (id: string, args: ReferenceBlob | null, parent: number | null) => {
		const key = contextKey(id, args);
		if (await get(...key)) return;
		await set(true, ...key);
		await set({ id, args, parent }, 'context', state.contexts++);
	};
	const resolve = async (source: string, kind: string, reference: string, optional = false): Promise<string | null> => {
		const exact = await get('identity', reference);
		const kinds = exact?.blob ? await index.openBlob(exact.blob) : exact;
		if (Array.isArray(kinds) && kinds.includes(kind)) return reference;
		if (kind !== 'data') {
			const alias = await get('alias', kind, reference);
			if (alias) {
				if (alias.ambiguous) {
					await issue(source, 'ambiguous-alias', kind, reference);
					return null;
				}
				return alias.id;
			}
		}
		if (!optional) await issue(source, 'unresolved-owned-or-external', kind, reference);
		return null;
	};
	const selection = async (sourceId: string, kind: string, id: unknown) => {
		if (id == null) return;
		if (typeof id !== 'string') throw Error('Invalid backup selection reference');
		const key = ['selection-key', sourceId, kind, id];
		if (await get(...key)) return;
		await set(true, ...key);
		await set({ sourceId, kind, id }, 'selection', state.selections++);
	};
	return {
		phase: () => state.mode,
		save: () => index.putState(state),
		/** Captured by the same pinned census read as the original content. Names
		 * may be large: the shared blob codec chunks them without truncation. */
		async presentation(doc: DescriptorSource) {
			if (state.mode !== 'build' || doc.ownerId !== ownerId) throw Error('Backup presentation census is closed or belongs to another owner');
			const value = descriptorValue({ id: doc.shareId, parentId: doc.folderId ?? null,
				name: typeof doc.crystal?.name === 'string' ? doc.crystal.name : doc.shareId,
				kind: doc.thingtime.includes('file') ? 'file' : doc.thingtime.includes('folder') ? 'folder' : 'data' }, doc.shareId);
			if (await get('presentation', doc.shareId)) throw Error('Duplicate backup presentation identity');
			await set(await index.blob(value), 'presentation', doc.shareId);
		},
		/** A read-only, owner-bound view of retained source ancestry. Presentation
		 * metadata never grants restore authority and never queries primary data. */
		async descriptor(id: string): Promise<AccountInventoryDescriptor | null> {
			await check();
			const ref = await get('presentation', id);
			const value = ref === null ? null : descriptorValue(await index.openBlob(ref), id);
			await check();
			return value;
		},
		async identity(id: string, kinds: string[]) {
			if (state.mode !== 'build') throw Error('Backup reference census is closed');
			if (await get('identity', id)) throw Error('Duplicate backup reference identity');
			let inline = true;
			try {
				backupJson(kinds, BACKUP_METADATA_BYTES - 1024);
			} catch {
				inline = false;
			}
			await set(inline ? kinds : { blob: await index.blob(kinds) }, 'identity', id);
		},
		async content(doc: { shareId: string; ownerId: string; thingtime: string[]; crystal?: any }) {
			if (state.mode !== 'build' || doc.ownerId !== ownerId) throw Error('Backup reference source changed');
			await set(await index.blob({ kinds: doc.thingtime, crystal: doc.crystal ?? {} }), 'content', doc.shareId);
			await enqueue(doc.shareId, null, null);
			for (const kind of ['component', 'action', 'schema']) {
				if (!doc.thingtime.includes(kind)) continue;
				const name = doc.crystal?.[kind === 'schema' ? 'name' : `${kind}Key`];
				if (typeof name !== 'string') continue;
				const old = await get('alias', kind, name);
				if (!old) await set({ id: doc.shareId, ambiguous: false }, 'alias', kind, name);
				else if (old.id !== doc.shareId && !old.ambiguous) await set({ id: old.id, ambiguous: true }, 'alias', kind, name);
			}
		},
		async attachment(value: BackupAttachment, durable: boolean) {
			if (state.mode !== 'build' || value.ownerId !== ownerId) throw Error('Backup reference attachment changed');
			await set({ blob: await index.blob(value), durable }, 'attachment', value.id);
		},
		async excluded(sourceId: string, kind: string) {
			await issue(sourceId, 'excluded-authority-state', kind, null);
		},
		selection,
		async closeCensus() {
			if (state.mode === 'build') state.mode = 'selections';
		},
		/** Thirty-two canonical iterator yields or ancestry edges per unit. Generator
		 * replay re-traverses only the current retained record, never the catalogue.
		 * This preserves existing substitution/null-tick semantics. Very large one-
		 * record contexts retain an O(R²/batch) replay cost pending a canonical
		 * serializable traversal stack; total archive size is not capped. */
		async advance(): Promise<BackupReferenceEvidence | null> {
			let cachedContextIndex = -1,
				cachedContext: Context | null = null,
				cachedStored: any,
				cachedArgs: any,
				iterator: Generator<any> | null = null,
				iteratorContext = -1,
				iteratorMode: string | null = null;
			for (let budget = 0; budget < 32; budget++) {
				tick();
				if (state.mode === 'build') throw Error('Backup reference census is still open');
				if (state.mode === 'done') return null;
				if (state.mode === 'emit') {
					const issues: BackupReferenceIssue[] = [];
					let bytes = 2;
					while (state.evidenceOffset < state.issues && issues.length < 128) {
						const entry = await get('issue', state.evidenceOffset);
						if (!entry) throw Error('Backup reference issue is missing');
						const size = Buffer.byteLength(backupJson(entry));
						if (issues.length && bytes + size + 1 > BACKUP_METADATA_BYTES - 2048) break;
						issues.push(entry);
						bytes += size + 1;
						state.evidenceOffset++;
					}
					const evidence: BackupReferenceEvidence = {
						page: state.evidencePage++,
						coverage: {
							census: 'owned-home-content',
							referenceDomain: 'ordinary-composition-and-account-selections',
							discovery: state.unsupported ? 'unsupported' : 'complete',
							resolution: state.unresolved ? 'unresolved' : 'closed',
							unresolved: state.unresolved,
							unsupported: state.unsupported,
							excluded: state.excluded,
							wholeAccountReady: false
						},
						issues
					};
					if (state.evidenceOffset === state.issues) state.mode = 'done';
					return evidence;
				}
				if (state.mode === 'selections') {
					if (state.selectionIndex === state.selections) {
						state.mode = 'references';
						continue;
					}
					const row = await get('selection', state.selectionIndex++);
					if (!row) throw Error('Backup account selection is missing');
					await resolve(row.sourceId, row.kind, row.id);
					continue;
				}
				if (state.contextIndex === state.contexts) {
					state.mode = 'emit';
					continue;
				}
				if (cachedContextIndex !== state.contextIndex) {
					cachedContext = await get('context', state.contextIndex);
					cachedContextIndex = state.contextIndex;
					cachedStored = undefined;
					cachedArgs = undefined;
				}
				const context = cachedContext!;
				if (!context) throw Error('Pinned reference context is missing');
				if (state.mode === 'ancestry') {
					if (state.ancestor === null) {
						await enqueue(state.pendingTarget!, state.pendingArgs, state.contextIndex);
						state.pendingTarget = null;
						state.pendingArgs = null;
						state.mode = 'references';
						continue;
					}
					const ancestor: Context = await get('context', state.ancestor);
					if (!ancestor) throw Error('Pinned context ancestry is missing');
					if (ancestor.id === state.pendingTarget) {
						await issue(context.id, 'recursive-context', 'component', state.pendingTarget);
						state.pendingTarget = null;
						state.pendingArgs = null;
						state.ancestor = null;
						state.mode = 'references';
					} else state.ancestor = ancestor.parent;
					continue;
				}
				if (cachedStored === undefined) {
					const blob = await get('content', context.id);
					if (!blob) throw Error('Pinned backup reference source is missing');
					cachedStored = await index.openBlob(blob);
					cachedArgs = context.args ? await index.openBlob(context.args) : {};
				}
				const stored = cachedStored,
					args = cachedArgs;
				let exhausted = false;
				try {
					if (!iterator || iteratorContext !== state.contextIndex || iteratorMode !== state.mode) {
						iterator =
							state.mode === 'references'
								? iterateBackupThingReferences(stored.kinds, stored.crystal, { args })
								: iterateBackupThingMedia(stored.kinds, stored.crystal, { args });
						iteratorContext = state.contextIndex;
						iteratorMode = state.mode;
						for (let skipped = 0; skipped < state.offset; skipped++) {
							tick();
							if (iterator.next().done) throw Error('Pinned reference traversal offset changed');
						}
					}
					const next = iterator.next();
					tick();
					exhausted = !!next.done;
					if (!next.done) {
						const reference = next.value;
						state.offset++;
						if (reference && state.mode === 'references') {
							const ref = reference as Exclude<ReturnType<typeof iterateBackupThingReferences> extends Generator<infer T> ? T : never, null>;
							const target = await resolve(context.id, ref.kind, ref.ref, ref.optional);
							if (target && ref.kind === 'component' && ref.args) {
								const next = await index.blob(ref.args);
								if (!(await get(...contextKey(target, next)))) {
									state.pendingTarget = target;
									state.pendingArgs = next;
									state.ancestor = state.contextIndex;
									state.mode = 'ancestry';
								}
							}
						} else if (reference) {
							const id = reference as string;
							if (await resolve(context.id, 'attachment', id)) {
								const attachment = await get('attachment', id);
								if (!attachment?.durable) await issue(context.id, 'unresolved-owned-or-external', 'durable-attachment', id);
								else {
									const value = (await index.openBlob(attachment.blob)) as BackupAttachment,
										target = (value.snapshot.value as any)?.targetId;
									if (value.linked || !target || !(await get('identity', target)))
										await issue(context.id, 'unresolved-owned-or-external', 'bound-attachment', id);
								}
							}
						}
					}
				} catch (error) {
					if (!(error instanceof StoredReferenceUnsupportedError)) throw error;
					await issue(context.id, 'unsupported-traversal', 'stored-composition', error.reference ?? null);
					state.contextIndex++;
					state.offset = 0;
					state.mode = 'references';
					continue;
				}
				if (exhausted) {
					if (state.mode === 'references') {
						state.mode = 'media';
						state.offset = 0;
					} else {
						state.contextIndex++;
						state.offset = 0;
						state.mode = 'references';
					}
				}
			}
			return null;
		}
	};
}
