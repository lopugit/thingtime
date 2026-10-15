import { sanitizeTags } from '../schemas/thingTags';
import { selectComponent } from '../api/utils/webpages/componentResolutionCore';
import { isProtectedThingtime, sanitizeExtended, validateThingtimeCrystal } from '../schemas/registry';
import { compositionReferences } from '../api/utils/actions/sharedCompositionCore';
import { rewriteComposition } from '../api/utils/actions/forkCompositionCore';
import { collectTransfer, type CollectTransferOptions } from '../utils/thingTransfer/collect';
import { serializeTransfer, validateTransfer, type JsonValue, type TransferThing } from '../utils/thingTransfer/format';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

export type LocalThing = TransferThing & { createdAt: string; updatedAt: string; revision: number };
export type LocalThingMutation = (tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing | null, input: ThingWrite) => Promise<void>;
export type ThingWrite = {
	id?: string; thingtime?: unknown; crystal?: unknown; extended?: unknown; tags?: unknown;
	folderId?: string | null; targetId?: string | null; expectedUpdatedAt?: string; replaceCrystal?: boolean;
};
export const localThingProjection = (thing: LocalThing, ownerId: string) => ({
	...thing, author: { id: ownerId, username: 'local', displayName: 'Local workspace', avatarUrl: null },
	acl: ['tt:user'], visibility: 'private' as const, folderId: thing.folderId || null, targetId: thing.targetId || null,
	tags: thing.tags || [], extended: thing.extended ?? null, localOnly: true
});
const fail = (code: string, message: string, status = 400): never => { throw new WorkspaceError(code, message, status); };
const content = (thing: TransferThing): TransferThing => ({
	id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal,
	...(thing.extended === undefined ? {} : { extended: thing.extended }),
	...(thing.tags === undefined ? {} : { tags: thing.tags }),
	...(thing.folderId ? { folderId: thing.folderId } : {}), ...(thing.targetId ? { targetId: thing.targetId } : {})
});
const validated = (input: ThingWrite): Pick<TransferThing, 'thingtime' | 'crystal' | 'extended' | 'tags'> => {
	// Apply the same lossless JSON boundary before the shared schema sanitizers.
	const crystal = snapshotTransferValue(input.crystal ?? {});
	const result = validateThingtimeCrystal(input.thingtime, crystal);
	if (result.ok === false) return fail('INVALID_THING', result.error, result.status);
	if (result.requiresTarget && !input.targetId) return fail('INVALID_TARGET', 'This kind requires a target Thing');
	if (isProtectedThingtime(result.thingtime)) return fail('MANAGED_KIND', 'This kind uses its dedicated workspace operation', 403);
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
		private builtins: readonly TransferThing[] = [], private now = () => new Date().toISOString(), private uuid = () => crypto.randomUUID(), private onWrite?: LocalThingMutation) {}
	private transaction<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
	private async placement(tx: WorkspaceTransaction, row: TransferThing) {
		const seen = new Set([row.id]); let parent = row.folderId;
		while (parent) {
			if (seen.has(parent)) fail('FOLDER_CYCLE', 'A folder cannot contain itself');
			seen.add(parent); const folder = await tx.get<LocalThing>('things', parent);
			if (!folder?.thingtime.includes('folder')) fail('INVALID_FOLDER', 'Destination folder is not in this workspace');
			parent = folder!.folderId;
		}
		if (row.targetId && !await tx.get('things', row.targetId)) fail('INVALID_TARGET', 'Target is not in this workspace');
		if (row.thingtime.includes('data') && typeof row.crystal.schemaId === 'string') {
			const schema = await tx.get<LocalThing>('things', row.crystal.schemaId) || this.builtins.find(doc => doc.id === row.crystal.schemaId);
			if (!schema?.thingtime.includes('schema')) fail('INVALID_SCHEMA', 'Schema is not in this workspace');
			row.crystal.schema = schema!.crystal.name;
		}
	}
	async create(input: ThingWrite) {
		const checked = validated(input); const stamp = this.now();
		const row: LocalThing = { ...checked, id: this.scope.kind === 'anonymous' ? `local-${this.uuid()}` : this.uuid(), createdAt: stamp, updatedAt: stamp, revision: 1,
			...(input.folderId ? { folderId: input.folderId } : {}), ...(input.targetId ? { targetId: input.targetId } : {}) };
		return this.transaction('readwrite', async tx => {
			await this.placement(tx, row); await tx.put('things', row.id, row); await this.onWrite?.(tx, row, null, input); return row;
		});
	}
	async get(id: string): Promise<LocalThing> {
		return this.transaction('readonly', async tx => {
			const found = await tx.get<LocalThing>('things', id);
			if (!found) return fail('NOT_FOUND', 'Thing is not in this workspace', 404);
			return found;
		});
	}
	async snapshot(): Promise<LocalThing[]> {
		return this.transaction('readonly', async tx => (await tx.list<LocalThing>('things')).map(row => row.value));
	}
	async list(query: { thingtime?: string | string[]; folder?: string; target?: string; cursor?: string; limit?: number } = {}) {
		const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
		const kinds = typeof query.thingtime === 'string' ? query.thingtime.split(',') : query.thingtime || [];
		return this.transaction('readonly', async tx => {
			let rows = (await tx.list<LocalThing>('things')).map(({ value }) => value)
				.filter(row => kinds.every(kind => row.thingtime.includes(kind)) &&
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
		return this.transaction('readwrite', async tx => {
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
		});
	}
	async remove(ids: string[], recursive = false) {
		if (!Array.isArray(ids) || !ids.length || ids.length > 200) fail('INVALID_IDS', 'Choose between 1 and 200 Things');
		return this.transaction('readwrite', async tx => {
			const all = await tx.list<LocalThing>('things'); const selected = new Set(ids);
			for (const id of selected) if (!all.some(row => row.id === id)) fail('NOT_FOUND', 'Thing is not in this workspace', 404);
			let changed = true;
			while (changed) {
				changed = false;
				for (const { value: row } of all) if (!selected.has(row.id) && ((row.folderId && selected.has(row.folderId)) || (row.targetId && selected.has(row.targetId)))) {
					if (!recursive) fail('HAS_CHILDREN', 'This Thing has children. Choose recursive deletion to remove them.');
					selected.add(row.id); changed = true;
				}
			}
			for (const id of selected) await tx.delete('things', id);
			return { ok: true, deleted: [...selected] };
		});
	}
	async move(ids: string[], folderId: string | null) {
		if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length) fail('INVALID_IDS', 'Choose between 1 and 200 distinct Things');
		return this.transaction('readwrite', async tx => {
			const rows: LocalThing[] = [];
			for (const id of ids) {
				const previous = await tx.get<LocalThing>('things', id);
				if (!previous) return fail('NOT_FOUND', 'Thing is not in this workspace', 404);
				const row = { ...previous, revision: previous.revision + 1, updatedAt: new Date(Math.max(Date.parse(this.now()), Date.parse(previous.updatedAt) + 1)).toISOString() };
				if (folderId) row.folderId = folderId; else delete row.folderId;
				await this.placement(tx, row); await tx.put('things', id, row); rows.push(row);
			}
			return { ok: true, moved: ids, things: rows };
		});
	}
	async export(ids: string[], options: CollectTransferOptions = {}) {
		// Take one consistent snapshot, then collect outside the IDB transaction.
		const saved = await this.snapshot();
		const docs = new Map([...this.builtins.map(doc => [doc.id, content(doc)] as const), ...saved.map(value => [value.id, content(value)] as const)]);
		const timestamps = new Map(saved.map(row => [row.id, row.updatedAt]));
		const builtinIds = new Set(this.builtins.map(row => row.id));
		const componentCandidates = [...docs.values()].filter(row => row.thingtime.includes('component'))
			.sort((a, b) => (timestamps.get(b.id) || '').localeCompare(timestamps.get(a.id) || '') || a.id.localeCompare(b.id))
			.map(row => ({ row, shareId: row.id, ownerId: builtinIds.has(row.id) ? 'system' : 'workspace', crystal: row.crystal }));
		const resolve = (kind: string, ref: string) => {
			const exact = docs.get(ref); if (exact?.thingtime.includes(kind)) return exact;
			if (kind === 'component') return selectComponent(ref, componentCandidates, 'workspace')?.row;
			return [...docs.values()].find(row => row.thingtime.includes(kind) && (row.crystal.actionKey === ref || row.crystal.name === ref));
		};
		// Canonicalize aliases using the existing composition rewriter; portable
		// dependencies may not depend on a database's seeded key resolution.
		for (const doc of docs.values()) doc.crystal = rewriteComposition(doc.thingtime, doc.crystal, (kind, ref) => resolve(kind, ref)?.id || ref);
		const bundle = await collectTransfer(ids, {
			read: async id => { this.lease.assertCurrent(); return docs.get(id) || fail('MISSING_DEPENDENCY', `Missing Thing: ${id}`, 404); },
			children: async id => ({ ids: [...docs.values()].filter(doc => doc.folderId === id).map(doc => doc.id) }),
			dependencies: async doc => compositionReferences(doc.thingtime, doc.crystal).flatMap(ref => {
				const found = resolve(ref.kind, ref.ref);
				if (!found && !ref.optional) fail('MISSING_DEPENDENCY', `Missing ${ref.kind}: ${ref.ref}`, 404);
				return found ? [found.id] : [];
			}),
			files: async function* () {}
		}, options);
		this.lease.assertCurrent(); return bundle;
	}
	async import(input: unknown, folderId?: string | null) {
		const manifest = validateTransfer(input); serializeTransfer(manifest);
		if (manifest.files.length || manifest.links?.length) fail('ATTACHMENT_IMPORT_REQUIRED', 'Import attached files through the workspace attachment importer');
		const map = new Map(manifest.things.map(row => [row.id, `local-${this.uuid()}`]));
		const stamp = this.now();
		const rows: LocalThing[] = manifest.things.map(original => ({
			...validated({ ...original, crystal: rewriteComposition(original.thingtime, original.crystal, (_kind, ref) => map.get(ref) || ref) }),
			id: map.get(original.id)!, revision: 1, createdAt: stamp, updatedAt: stamp,
			...(original.folderId ? { folderId: map.get(original.folderId)! } : folderId && manifest.roots.includes(original.id) ? { folderId } : {}),
			...(original.targetId ? { targetId: map.get(original.targetId)! } : {})
		}));
		await this.transaction('readwrite', async tx => {
			// All IDs exist before relationship checks, including forward refs.
			for (const row of rows) await tx.put('things', row.id, row);
			for (const row of rows) { await this.placement(tx, row); await tx.put('things', row.id, row); }
		});
		return { ok: true, roots: manifest.roots.map(id => map.get(id)!), idMap: Object.fromEntries(map), things: rows };
	}
}
