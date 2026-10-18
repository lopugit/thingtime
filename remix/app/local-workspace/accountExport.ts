import type { AccountAlgorithmSync } from './accountAlgorithms';
import { isTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import { localAttachmentFileId } from './attachments';
import { ACCOUNT_EXPORT_SNAPSHOTS, accountReadRefusals } from './accountReadRevocation';
import type { AccountThemeSync } from './accountThemes';
import { isTransferTheme } from '../utils/thingTransfer/theme';
import type { AccountFileSync } from './accountFiles';
import { rewriteTransferMedia } from '../api/utils/things/transferMediaCore';
import { type AccountThingSync, accountThingCanCache } from './accountSync';
import { exportLocalThingSnapshot, type LocalThing } from './things';
import { WorkspaceError, workspaceScopeKey, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceTransaction } from './storage';
import { parseTransfer, serializeTransfer, TRANSFER_LIMITS, type ThingTransfer } from '../utils/thingTransfer/format';
import { transferChecksum } from '../utils/thingTransfer/archive';

type Input = {
	ids: string[];
	key?: string;
	includeChildren?: boolean;
	includeDependencies?: boolean;
	includeFiles?: boolean;
	includeLinks?: boolean;
};
type State = Awaited<ReturnType<AccountThingSync['exportSnapshot']>>;
type Snapshot = {
	manifest: ThingTransfer;
	revisions: Record<string, number>;
	savedAt: string;
	refusals?: Record<string, number>;
	references?: string[];
};
const STORE = ACCOUNT_EXPORT_SNAPSHOTS;
class MissingExportSnapshot extends WorkspaceError {
	constructor(readonly id: string) {
		super(
			'EXPORT_CACHE_INCOMPLETE',
			`Complete export content for ${id} is not saved on this device. Download it online once, then retry offline.`,
			409
		);
	}
}
export const snapshotAccountExportInput = (input: Input) => {
	if (
		!input ||
		Object.keys(input).some((key) => !['ids', 'key', 'includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'].includes(key)) ||
		!Array.isArray(input.ids) ||
		!input.ids.length ||
		input.ids.length > TRANSFER_LIMITS.things ||
		input.ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) ||
		['includeChildren', 'includeDependencies', 'includeFiles', 'includeLinks'].some(
			(key) => (input as any)[key] !== undefined && typeof (input as any)[key] !== 'boolean'
		) ||
		(input.key !== undefined && typeof input.key !== 'string')
	)
		throw new WorkspaceError('INVALID_EXPORT', 'Choose valid Thing IDs and download options.');
	return {
		ids: [...new Set(input.ids)],
		key: input.key,
		includeChildren: input.includeChildren !== false,
		includeDependencies: input.includeDependencies !== false,
		includeFiles: input.includeFiles !== false,
		includeLinks: input.includeLinks !== false
	};
};

/** Scoped, bounded content snapshots are export data, never owned editable Things
 * or an authorization grant. A partial library page cannot prove completeness. */
export async function exportAccountThings(
	input: Input,
	deps: {
		sync: AccountThingSync;
		files?: AccountFileSync;
		themes?: AccountThemeSync;
		algorithms?: AccountAlgorithmSync;
		db: WorkspaceDatabase;
		lease: WorkspaceLease;
		canRefresh: () => boolean;
		remote: (input: Input, options?: { signal?: AbortSignal }) => Promise<any>;
	},
	signal?: AbortSignal
) {
	const args = snapshotAccountExportInput(input),
		{ sync, db, lease } = deps;
	if (deps.themes && workspaceScopeKey(deps.themes.scope) !== workspaceScopeKey(sync.scope))
		throw new WorkspaceError('WORKSPACE_CHANGED', 'Theme and content exports belong to different account workspaces.', 409);
	if (deps.algorithms && workspaceScopeKey(deps.algorithms.scope) !== workspaceScopeKey(sync.scope))
		throw new WorkspaceError('WORKSPACE_CHANGED', 'Algorithm and content exports belong to different home workspaces.', 409);
	const check = () => {
		lease.assertCurrent();
		signal?.throwIfAborted();
	};
	check();
	const key = await transferChecksum(new TextEncoder().encode(JSON.stringify({ ...args, ids: [...args.ids].sort() })));
	check();
	const tx = <T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) =>
		db.transaction(sync.scope, mode, { assertCurrent: check, onInvalidate: lease.onInvalidate }, run);
	const initial = await tx('readonly', async (tx) => ({
		snapshot: args.key ? null : await tx.get<Snapshot>(STORE, key),
		refusals: await accountReadRefusals(tx)
	}));
	let baseline = initial.snapshot;
	const watched = new Set(args.ids);
	let selected = new Set<string>();
	let selectedThemes = new Set<string>();
	let selectedAlgorithms = new Set<string>();
	const watch = (manifest: Pick<ThingTransfer, 'things'>) => {
		for (const row of manifest.things) {
			watched.add(row.id);
			if (row.targetId) watched.add(row.targetId);
		}
	};
	const unavailable = () =>
		new WorkspaceError(
			'EXPORT_ACCESS_REFUSED',
			'This export includes content that is no longer available. Reopen it online before downloading again.',
			409
		);
	const assertReadable = async (transaction: WorkspaceTransaction) => {
		const [current, states] = await Promise.all([accountReadRefusals(transaction), transaction.list<{ deleted?: unknown }>('thing-sync')]);
		const deleted = new Set(states.filter((row) => row.value.deleted).map((row) => row.id));
		for (const id of watched) {
			if (current.get(id)?.at !== initial.refusals.get(id)?.at || (selected.has(id) && deleted.has(id))) throw unavailable();
		}
	};
	// Dedicated and bearer-link plans are never retained as editable content,
	// but still belong to this in-process identity and observed access boundary.
	const remotePlan = async () => {
		const result = await deps.remote(args, { signal });
		check();
		if (!result?.ok || !result.plan)
			throw new WorkspaceError('EXPORT_FAILED', result?.error || 'Could not prepare complete export content.', result?.status || 503);
		const plan = result.plan;
		if (!Array.isArray(plan.things) || !Array.isArray(plan.files) || !Array.isArray(plan.roots))
			throw new WorkspaceError('INVALID_EXPORT', 'The account returned an invalid export plan.', 502);
		watch(plan);
		selected = new Set([...plan.roots, ...plan.things.map((row: any) => row.id)]);
		for (const row of [...plan.files, ...(plan.links || [])])
			for (const id of [row.id, row.sourceId, row.targetId, row.sharedRoot]) if (typeof id === 'string') watched.add(id);
		const assertCurrent = async (requestSignal?: AbortSignal) => {
			check();
			requestSignal?.throwIfAborted();
			await plan.assertCurrent?.(requestSignal);
			await tx('readonly', assertReadable);
			const library = await deps.files?.library(true);
			for (const id of watched)
				if (library?.aliases.has(id)) {
					const local = library.aliases.get(id);
					if (!local) throw unavailable();
					await deps.files!.assertFileReadable(local, requestSignal);
				}
			check();
			requestSignal?.throwIfAborted();
		};
		await assertCurrent();
		return { ...result, plan: { ...plan, assertCurrent } };
	};
	if (args.key) return remotePlan();
	if (baseline) {
		const baselineIds = [
			...new Set([
				...args.ids,
				...(baseline.references || []),
				...baseline.manifest.things.flatMap((row) => [row.id, ...(row.targetId ? [row.targetId] : [])])
			])
		];
		// Old snapshots predate refusal fencing. Require a new authorized export
		// whenever any of their content already has a refusal watermark.
		if (baselineIds.some((id) => initial.refusals.has(id) && baseline!.refusals?.[id] !== initial.refusals.get(id)!.at)) {
			await tx('readwrite', (tx) => tx.delete(STORE, key));
			throw unavailable();
		}
	}
	const attempted = new Set<string>();
	const collect = async (
		state: State,
		themeSnapshot: Awaited<ReturnType<AccountThemeSync['exportSnapshot']>> | undefined,
		algorithmSnapshot: Awaited<ReturnType<AccountAlgorithmSync['exportSnapshot']>> | undefined
	) => {
		const themeIds = new Set(themeSnapshot?.things.map((row) => row.id)),
			algorithmIds = new Set(algorithmSnapshot?.things.map((row) => row.id));
		if ([...themeIds].some((id) => algorithmIds.has(id)))
			throw new WorkspaceError('EXPORT_IDENTITY_CONFLICT', 'Protected library identities collide.', 409);
		const managedRows = new Map([...(themeSnapshot?.things || []), ...(algorithmSnapshot?.things || [])].map((row) => [row.id, row])),
			managedRecords = new Map([...(themeSnapshot?.records || []), ...(algorithmSnapshot?.records || [])].map((row) => [row.id, row]));
		if (state.records.some((row) => managedRecords.has(row.id)))
			throw new WorkspaceError('EXPORT_IDENTITY_CONFLICT', 'A protected identity conflicts with generic account content.', 409);
		const cacheable = (row: LocalThing | ThingTransfer['things'][number]) =>
			accountThingCanCache(row) || ((isTransferTheme(row) || isTransferAlgorithm(row)) && managedRows.has(row.id));
		const fileLibrary = await deps.files?.library(true);
		check();
		const files = new Map(fileLibrary?.things.map((row) => [row.id, row]) || []);
		const aliases = new Map([...(fileLibrary?.aliases || [])].filter((entry): entry is [string, string] => entry[1] !== null));
		const ids = args.ids.map((id) => {
			if (fileLibrary?.aliases.get(id) === null) throw new WorkspaceError('NOT_FOUND', 'File was deleted in this workspace.', 404);
			return aliases.get(id) || id;
		});
		const records = new Map<string, State['records'][number] & { complete?: boolean }>(
			[...state.records, ...(themeSnapshot?.records || []), ...(algorithmSnapshot?.records || [])].map((row) => [row.id, row])
		);
		const captured = new Map(baseline?.manifest.things.map((row) => [row.id, row]) || []);
		const docs = new Map<string, LocalThing>(
			[...captured]
				.filter(([, row]) => cacheable(row))
				.map(([id, row]) => [id, { ...row, createdAt: baseline!.savedAt, updatedAt: baseline!.savedAt, revision: 1 }])
		);
		for (const row of [...state.things.filter((row) => !managedRows.has(row.id)), ...managedRows.values()]) {
			const record = records.get(row.id);
			if (!record || record.deleted || !cacheable(row)) continue;
			// Fresh server plans outrank an unchanged old device copy. Pending edits and
			// subsequent device revisions always remain the user's export content.
			if (!docs.has(row.id) || record.state !== 'synced' || baseline?.revisions[row.id] !== row.revision) docs.set(row.id, row);
		}
		for (const row of records.values()) if (row.deleted) docs.delete(row.id);
		// Only live dedicated file records grant access to device bytes. Portable
		// attachment rows retained in an older export never resurrect a deletion.
		for (const row of files.values()) docs.set(row.id, row);
		// A saved export uses portable byte IDs; restore those bindings to the
		// live device records before collecting the next immutable bundle.
		const mediaAliases = new Map(args.includeFiles ? [...aliases, ...[...files.keys()].map((id) => [localAttachmentFileId(id), id] as const)] : []);
		const crystals = rewriteTransferMedia([...docs.values()], mediaAliases);
		for (const row of docs.values()) row.crystal = crystals.get(row.id)!;
		const bundle = await exportLocalThingSnapshot(
			[...docs.values()],
			[],
			ids,
			lease,
			async (id) => (await deps.files!.readFileBlob(id, signal)).blob,
			{ ...args, signal },
			(row) => {
				if (files.has(row.id)) return;
				if (managedRows.has(row.id)) {
					if (!managedRecords.get(row.id)?.complete)
						throw new WorkspaceError(
							'THEME_PLACEMENT_UNKNOWN',
							'Refresh this protected item online to retain its folder placement before exporting it.',
							409
						);
					return;
				}
				const record = records.get(row.id);
				if (record && !record.remote && !record.deleted) return;
				if (
					record?.postAttachmentIds &&
					row.thingtime.every((kind) => ['post', 'comment'].includes(kind)) &&
					(!row.targetId || docs.has(row.targetId))
				) {
					// Full owned post retention already admitted the complete body and binding
					// atomically. Intentional local deletions have null aliases; absent records
					// are incomplete caches and must never silently drop original media.
					if (
						args.includeFiles &&
						record.postAttachmentIds.some(
							(id) => !fileLibrary?.aliases.has(id) || (aliases.has(id) && files.get(aliases.get(id)!)?.targetId !== row.id)
						)
					)
						throw new WorkspaceError(
							'EXPORT_FILES_INCOMPLETE',
							'Complete post files are not saved on this device. Open the post online before downloading it.',
							409
						);
					return;
				}
				if (!captured.has(row.id)) throw new MissingExportSnapshot(row.id);
			},
			new Set(state.records.filter((row) => !row.deleted).map((row) => row.id))
		);
		for (const [remote, local] of aliases) if (bundle.files.has(localAttachmentFileId(local))) watched.add(remote);
		if (
			sync.scope.dataPlane !== 'home' &&
			bundle.manifest.things.some(
				(row) =>
					managedRows.has(row.id) &&
					row.folderId &&
					bundle.manifest.things.some((parent) => parent.id === row.folderId && parent.thingtime.includes('folder'))
			)
		)
			throw new WorkspaceError(
				'EXPORT_DATA_PLANE_CONFLICT',
				'A home protected-item folder cannot be joined to a folder in another database. Export these roots separately.',
				409
			);
		watch(bundle.manifest);
		selected = new Set(bundle.manifest.things.map((row) => row.id));
		selectedThemes = new Set([...selected].filter((id) => themeIds.has(id)));
		selectedAlgorithms = new Set([...selected].filter((id) => algorithmIds.has(id)));
		check();
		return bundle;
	};
	for (;;) {
		check();
		const state = await sync.exportSnapshot(),
			themeSnapshot = await deps.themes?.exportSnapshot(),
			algorithmSnapshot = await deps.algorithms?.exportSnapshot();
		check();
		try {
			const bundle = await collect(state, themeSnapshot, algorithmSnapshot);
			// Retain the entire known closure before a later sync acknowledges new IDs.
			// Missing children/files never reach this point or become a success snapshot.
			baseline = {
				manifest: bundle.manifest,
				revisions: Object.fromEntries(state.things.map((row) => [row.id, row.revision])),
				savedAt: new Date().toISOString(),
				references: [...watched],
				refusals: Object.fromEntries([...initial.refusals].filter(([id]) => watched.has(id)).map(([id, row]) => [id, row.at]))
			};
			const retainedOnDevice = await retain(baseline);
			check();
			const exportedThemes = [...selectedThemes],
				exportedAlgorithms = [...selectedAlgorithms];
			const assertCurrent = async (requestSignal?: AbortSignal) => {
				check();
				requestSignal?.throwIfAborted();
				// A prepared bundle must not outlive file cancellation/deletion either.
				// Check metadata only; repeatedly loading immutable bytes is unnecessary.
				for (const id of bundle.files.keys()) await deps.files!.assertFileReadable(id.slice(0, -':bytes'.length), requestSignal);
				await tx('readonly', assertReadable);
				await deps.themes?.assertExportReadable(exportedThemes);
				await deps.algorithms?.assertExportReadable(exportedAlgorithms);
				check();
				requestSignal?.throwIfAborted();
			};
			await assertCurrent();
			return {
				ok: true,
				localWorkspace: true,
				snapshotAt: baseline.savedAt,
				retainedOnDevice,
				plan: {
					assertCurrent,
					roots: bundle.manifest.roots,
					things: bundle.manifest.things,
					files: bundle.manifest.files,
					...(bundle.manifest.attachmentOrder ? { attachmentOrder: bundle.manifest.attachmentOrder } : {}),
					...(bundle.files.size
						? {
								readLocalFile: async (id: string, requestSignal?: AbortSignal) => {
									await assertCurrent(requestSignal);
									const bytes = bundle.files.get(id);
									if (!bytes) throw new WorkspaceError('MISSING_LOCAL_FILE', 'File is not in this export.', 404);
									return bytes;
								}
						  }
						: {})
				}
			};
		} catch (error) {
			check();
			if (!(error instanceof MissingExportSnapshot) || !deps.canRefresh() || attempted.has(error.id)) throw error;
			attempted.add(error.id);
			if (attempted.size > TRANSFER_LIMITS.things) throw new WorkspaceError('EXPORT_LIMIT', 'This export exceeds the Thing limit.');
			const result = await deps.remote({ ...args, ids: [error.id] }, { signal });
			check();
			if (!result?.ok || !result.plan)
				throw new WorkspaceError('EXPORT_FAILED', result?.error || 'Could not prepare complete export content.', result?.status || 503);
			const plan = result.plan;
			if (
				plan.files?.length ||
				plan.links?.length ||
				!plan.things?.every(
					(row: any) =>
						accountThingCanCache(row) ||
						(isTransferTheme(row) && themeSnapshot?.things.some((theme) => theme.id === row.id)) ||
						(isTransferAlgorithm(row) && algorithmSnapshot?.things.some((algorithm) => algorithm.id === row.id))
				)
			) {
				// Keep dedicated online exports working, but never replace pending local
				// content with an older server version just because it includes media.
				const library = await deps.files?.library(true),
					pendingFiles = new Set((await deps.files?.status())?.filter((row) => row.state !== 'synced').map((row) => row.id));
				const selected = new Set([
					...args.ids,
					...plan.things.map((row: any) => row.id),
					...(plan.files || []).map((row: any) => row.sourceId || row.id)
				]);
				for (const [remote, local] of library?.aliases || []) if (local && selected.has(remote)) selected.add(local);
				const affectedFiles = library?.things.some(
					(row) => pendingFiles.has(row.id) && (selected.has(row.id) || (args.includeChildren && row.folderId && selected.has(row.folderId)))
				);
				if (
					state.records.some((row) => row.state !== 'synced') ||
					themeSnapshot?.records.some((row) => row.state !== 'synced') ||
					algorithmSnapshot?.records.some((row) => row.state !== 'synced') ||
					affectedFiles
				)
					throw new WorkspaceError(
						'DEDICATED_EXPORT_REQUIRED',
						'This download needs its file or managed-content adapter. Sync your device edits before downloading it online.',
						409
					);
				return remotePlan();
			}
			const manifest = parseTransfer(
				serializeTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] })
			);
			watch(manifest);
			await tx('readonly', assertReadable);
			if (manifest.roots.length !== 1 || manifest.roots[0] !== error.id)
				throw new WorkspaceError('INVALID_EXPORT', 'The export returned a different root.');
			const merged = new Map(baseline?.manifest.things.map((row) => [row.id, row]) || []);
			for (const row of manifest.things) {
				const previous = merged.get(row.id);
				// Match the canonical server exporter: a dependency shared by separately
				// authorized roots must retain one meaning across their saved contexts.
				if (previous && row.id !== error.id && JSON.stringify(previous.crystal) !== JSON.stringify(row.crystal))
					throw new WorkspaceError('EXPORT_CONTEXT_CONFLICT', 'A dependency has conflicting saved contexts; export these roots separately.', 409);
				merged.set(row.id, row);
			}
			// Keep each authorized fragment's roots while the local collector assembles
			// the requested roots; no partial manifest is offered as a download.
			baseline = {
				manifest: parseTransfer(
					serializeTransfer({
						...manifest,
						roots: [...new Set([...(baseline?.manifest.roots || []), ...manifest.roots])],
						things: [...merged.values()]
					})
				),
				revisions: { ...baseline?.revisions, ...Object.fromEntries(state.things.map((row) => [row.id, row.revision])) },
				savedAt: new Date().toISOString()
			};
		}
	}
	async function retain(snapshot: Snapshot) {
		try {
			await tx('readwrite', async (tx) => {
				await assertReadable(tx);
				const entries = (await tx.list<Snapshot>(STORE))
					.filter((row) => row.id !== key)
					.sort((a, b) => a.value.savedAt.localeCompare(b.value.savedAt));
				// The normal workspace byte quota also applies to each retained snapshot.
				while (entries.length >= 16) await tx.delete(STORE, entries.shift()!.id);
				await tx.put(STORE, key, snapshot);
			});
			return true;
		} catch (error) {
			check();
			// Downloading is still useful when the device is full. Cache retention is
			// optional and must never make exporting the only copy depend on quota.
			if (error instanceof WorkspaceError && error.code === 'LOCAL_QUOTA') return false;
			throw error;
		}
	}
}
