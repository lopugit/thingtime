import type { PagedRunSpec, PagedRunJournal } from './pagedRunJournal';
import type { FileSyncConfiguration } from './configuration';
import { localTrashContexts, parseLocalTrashContext } from './localTrash';
import { createCloudDownloadSource } from './cloudDownloadSource';
import { validateLocalStage, type LocalSyncTarget } from './localSyncTarget';
import { cloudRequests } from './cloudTransport';
import { readCloudPathEntry } from './cloudPath.client';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { createCloudFileTransport, createCloudRetentionTransport, createCloudFolderTransport, type CloudTransportRuntime } from './cloudTransport';
import { parseCloudSyncRun, parseCloudWrite, isCloudFolderWrite, type CloudWrite } from './cloudWrite';
import type { FingerprintSource } from './contentFingerprint';
import { sameSyncScope, sameSyncStamp, type SyncEntry, type SyncScope } from './reconcile';
import type { SyncExecutionPort, SyncRun } from './execute';

import type { CloudOperationBinding } from './cloudBinding';
export type { CloudOperationBinding } from './cloudBinding';
export type CloudOperationBindings = {
	byId(id: string): Promise<CloudOperationBinding | null>;
	byPath(path: string): Promise<CloudOperationBinding | null>;
};
export type CloudSyncPortInput = {
	currentScope(): SyncScope;
	readLocal(path: string): Promise<SyncEntry | null>;
	openSource(expected: SyncEntry): Promise<FingerprintSource>;
	signal?: AbortSignal;
	localTarget?: LocalSyncTarget;
	/** Validated saved root for older runs without per-operation roots. */
	cloudRootId?: string;
	progress?: (path: string, bytes: number, total: number) => void;
};
const defaultRuntime = (input: CloudSyncPortInput): CloudTransportRuntime => ({ currentScope: input.currentScope,
	origin: () => window.location.origin, fetch: (url, init) => fetch(url, init), requireCapability: requireThingtimeCapability });

/** The same per-operation transport for legacy arrays and durable indexed
 * bindings. A binding is preparation metadata, never current authorization. */
export function createBoundCloudSyncPort(savedScope: SyncScope, version: 1 | 2, bindings: CloudOperationBindings,
	input: CloudSyncPortInput, runtime: CloudTransportRuntime = defaultRuntime(input)): Omit<SyncExecutionPort, 'persist'> {
	const scope = structuredClone(savedScope), { check } = cloudRequests(runtime, scope, input.signal);
	const fileTransport = version === 2 ? createCloudRetentionTransport : createCloudFileTransport;
	const parsed = (value: CloudOperationBinding | null) => {
		check(); if (!value) throw Error('Unknown cloud sync operation.');
		const write = parseCloudWrite(value.write);
		if (!sameSyncScope(write.scope, scope)) throw Error('Cloud binding belongs to another scope.');
		if (write.cloudRootId && input.cloudRootId && write.cloudRootId !== input.cloudRootId) throw Error('Saved cloud roots disagree.');
		const m = write.operation.mutation;
		if (m.kind === 'copy' && m.from === 'remote' && !input.localTarget) throw Error('Native staged publication is required for downloads.');
		if (m.kind === 'trash' && m.side === 'local' && !input.localTarget?.trash) throw Error('Recoverable native Trash is required for local deletion.');
		return { write, trashContext: parseLocalTrashContext(write.operation, value.trashContext) };
	};
	const get = async (id: string, requestedScope: SyncScope) => {
		check(); if (!sameSyncScope(scope, requestedScope)) throw Error('Unknown cloud sync scope.');
		const binding = parsed(await bindings.byId(id));
		if (binding.write.operation.id !== id) throw Error('Cloud binding operation identity changed.');
		return binding;
	};
	const byPath = async (path: string) => {
		check(); const binding = parsed(await bindings.byPath(path));
		if (binding.write.operation.mutation.path !== path) throw Error('Cloud binding path changed.');
		return binding;
	};
	const isLocalTrash = (write: CloudWrite) => write.operation.mutation.kind === 'trash' && write.operation.mutation.side === 'local';
	const isDownload = (write: CloudWrite) => write.operation.mutation.kind === 'copy' && write.operation.mutation.from === 'remote';
	const readLocalSource = async (write: CloudWrite) => {
		const m = write.operation.mutation;
		if (!isDownload(write) && !isLocalTrash(write)) throw Error('Expected a local destination.');
		const rootId = write.cloudRootId ?? input.cloudRootId;
		if (!rootId) throw Error('This saved download has no pinned cloud root; reconcile it before publishing.');
		if (write.cloudRootId && input.cloudRootId && write.cloudRootId !== input.cloudRootId) throw Error('Saved cloud roots disagree.');
		return readCloudPathEntry(runtime, scope, rootId, m.path, input.signal);
	};
	const transport = ({ write, trashContext }: CloudOperationBinding) =>
		isDownload(write) || isLocalTrash(write)
			? {
					read: () => readLocalSource(write),
					lookup: async () => {
						const { check } = cloudRequests(runtime, scope, input.signal);
						check();
						const result = await input.localTarget!.lookup(structuredClone(write.operation), { ...scope }, trashContext);
						check();
						return result;
					}
			  }
			: isCloudFolderWrite(write)
			? createCloudFolderTransport(runtime, write, input.signal)
			: fileTransport(runtime, write, input.signal);

	return {
		currentScope: input.currentScope,
		read: async (side, path) => {
			check();
			if (side === 'local') { const entry = await input.readLocal(path); check(); return entry; }
			const binding = await byPath(path);
			return transport(binding).read();
		},
		lookup: async (id, requestedScope) => transport(await get(id, requestedScope)).lookup(),
		trashExpected: async (operation, scope) => {
			const { write, trashContext: context } = await get(operation.id, scope),
				m = operation.mutation;
			if (m.kind !== 'trash') throw Error('Expected a Trash operation.');
			if (JSON.stringify({ ...operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false })) throw Error('Cloud sync operation changed.');
			if (!isLocalTrash(write)) return m.expected;
			if (!input.localTarget?.trashExpected) {
				if (context?.parent || context?.childrenOperationId) throw Error('Native folder transition support is required.');
				return m.expected;
			}
			const { check } = cloudRequests(runtime, scope, input.signal);
			check();
			const result = await input.localTarget.trashExpected(structuredClone(operation), { ...scope }, structuredClone(context));
			check();
			return result;
		},
		apply: async (operation, scope) => {
			const { write, trashContext } = await get(operation.id, scope);
			if (JSON.stringify({ ...operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false }))
				throw Error('Cloud sync operation changed.');

			if (isLocalTrash(write)) {
				const { check } = cloudRequests(runtime, scope, input.signal);
				check();
				await runtime.authorizeMutation?.(input.signal);
				check();
				if ((await readLocalSource(write)) !== null) throw Error('The cloud path reappeared; preserve the local item.');
				check();
				const receipt = await input.localTarget!.trash!(structuredClone(operation), { ...scope }, structuredClone(trashContext));
				check();
				return receipt;
			}
			if (isDownload(write)) {
				const m = operation.mutation;
				if (m.kind !== 'copy') throw Error('Expected a download.');
				const { check } = cloudRequests(runtime, scope, input.signal);
				const source = m.source.kind === 'file' ? createCloudDownloadSource(runtime, scope, write.before!, input.signal) : undefined;
				check();
				const staged = await input.localTarget!.stage(structuredClone(operation), { ...scope }, source);
				check();
				validateLocalStage(staged, operation, scope);
				if (source) await source.verify!();
				if (!sameSyncStamp(m.source, await readLocalSource(write))) throw Error('Cloud path changed before local publication.');
				check();
				const result = await input.localTarget!.publish(structuredClone(operation), { ...scope }, structuredClone(staged));
				check();
				return result;
			}
			if (isCloudFolderWrite(write)) return createCloudFolderTransport(runtime, write, input.signal).apply();
			const source = operation.mutation.kind === 'copy' ? await input.openSource(operation.mutation.source) : undefined;
			return fileTransport(runtime, write, input.signal).apply(source, (bytes, total) => input.progress?.(operation.mutation.path, bytes, total));
		}
	};
}

/** Legacy whole-run compatibility. Both paths share every mutation guard. */
export function createCloudSyncPort(saved: SyncRun, input: CloudSyncPortInput & { persist(run: SyncRun): Promise<void> },
	runtime: CloudTransportRuntime = defaultRuntime(input)): SyncExecutionPort {
	const run = parseCloudSyncRun(saved), contexts = localTrashContexts(run);
	if (run.cloudWrites.some(w => w.operation.mutation.kind === 'copy' && w.operation.mutation.from === 'remote') && !input.localTarget)
		throw Error('Native staged publication is required for downloads.');
	if (run.operations.some(op => op.mutation.kind === 'trash' && op.mutation.side === 'local') && !input.localTarget?.trash)
		throw Error('Recoverable native Trash is required for local deletion.');
	const writes = new Map(run.cloudWrites.map(write => [write.operation.id, { write, trashContext: contexts.get(write.operation.id) }]));
	const paths = new Map(run.cloudWrites.map(write => [write.operation.mutation.path, write.operation.id]));
	const port = createBoundCloudSyncPort(run.scope, run.version, {
		byId: async id => writes.get(id) ?? null,
		byPath: async path => writes.get(paths.get(path) ?? '') ?? null
	}, input, runtime);
	return { ...port, persist: value => {
		if (value.id !== run.id) throw Error('Cloud sync run changed.');
		return input.persist(parseCloudSyncRun({ ...value, cloudWrites: run.cloudWrites } as SyncRun));
	} };
}

/** Indexed bindings use the same transport and native publication checks as
 * existing foreground sync. No operation becomes executable during preparation. */
export async function createPagedCloudSyncPort(spec: PagedRunSpec,
	configuration: FileSyncConfiguration, journal: PagedRunJournal,
	input: CloudSyncPortInput, runtime: CloudTransportRuntime = defaultRuntime(input)): Promise<Omit<SyncExecutionPort, 'persist'>> {
	const saved = structuredClone(configuration), run = structuredClone(spec);
	if (input.cloudRootId && input.cloudRootId !== saved.remoteFolderId) throw Error('Saved cloud roots disagree.');
	if ((await journal.beginCloud(run, saved)).phase !== 'ready') throw Error('Complete cloud bindings before executing.');
	return createBoundCloudSyncPort(journal.scope, run.review?.kind === 'retain' ? 2 : 1, {
		byId: id => journal.cloudBinding(run, saved, { id }),
		byPath: path => journal.cloudBinding(run, saved, { path })
	}, { ...input, cloudRootId: saved.remoteFolderId }, runtime);
}
