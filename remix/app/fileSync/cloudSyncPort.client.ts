import { localTrashContexts } from './localTrash';
import { createCloudDownloadSource } from './cloudDownloadSource';
import { validateLocalStage, type LocalSyncTarget } from './localSyncTarget';
import { cloudRequests } from './cloudTransport';
import { readCloudPathEntry } from './cloudPath.client';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { createCloudFileTransport, createCloudRetentionTransport, createCloudFolderTransport, type CloudTransportRuntime } from './cloudTransport';
import { parseCloudSyncRun, isCloudFolderWrite } from './cloudWrite';
import type { FingerprintSource } from './contentFingerprint';
import { sameSyncScope, sameSyncStamp, type SyncEntry, type SyncScope } from './reconcile';
import type { SyncExecutionPort, SyncRun } from './execute';

/** Connect a prepared upload/download run to real cloud bytes. The complete
 * destinations travel in the existing durable run, so a restart cannot remap
 * an uncertain operation to a different folder. Root scanning and local
 * download publication are supplied by platform workers, not inferred here. */
export function createCloudSyncPort(
	saved: SyncRun,
	input: {
		currentScope(): SyncScope;
		persist(run: SyncRun): Promise<void>;
		readLocal(path: string): Promise<SyncEntry | null>;
		openSource(expected: SyncEntry): Promise<FingerprintSource>;
		signal?: AbortSignal;
		localTarget?: LocalSyncTarget;
		/** Original durable configuration root for runs predating per-write roots.
		 * The caller must validate the saved configuration before supplying it. */
		cloudRootId?: string;
		progress?: (path: string, bytes: number, total: number) => void;
	},
	runtime: CloudTransportRuntime = {
		currentScope: input.currentScope,
		origin: () => window.location.origin,
		fetch: (url, init) => fetch(url, init),
		requireCapability: requireThingtimeCapability
	}
): SyncExecutionPort {
	const run = parseCloudSyncRun(saved);
	const fileTransport = run.version === 2 ? createCloudRetentionTransport : createCloudFileTransport;
	const downloads = run.cloudWrites.some((write) => write.operation.mutation.kind === 'copy' && write.operation.mutation.from === 'remote');
	if (downloads && !input.localTarget) throw Error('Native staged publication is required for downloads.');
	const trashContexts = localTrashContexts(run);
	if (run.operations.some((op) => op.mutation.kind === 'trash' && op.mutation.side === 'local') && !input.localTarget?.trash)
		throw Error('Recoverable native Trash is required for local deletion.');
	const writes = new Map(run.cloudWrites.map((write) => [write.operation.id, write]));
	const paths = new Map(run.cloudWrites.map((write) => [write.operation.mutation.path, write]));
	const get = (id: string, scope: SyncScope) => {
		if (!sameSyncScope(scope, run.scope) || !writes.has(id)) throw Error('Unknown cloud sync operation.');
		return writes.get(id)!;
	};
	const isLocalTrash = (write: ReturnType<typeof get>) => write.operation.mutation.kind === 'trash' && write.operation.mutation.side === 'local';
	const isDownload = (write: ReturnType<typeof get>) => write.operation.mutation.kind === 'copy' && write.operation.mutation.from === 'remote';
	const readLocalSource = async (write: ReturnType<typeof get>) => {
		const m = write.operation.mutation;
		if (!isDownload(write) && !isLocalTrash(write)) throw Error('Expected a local destination.');
		const rootId = write.cloudRootId ?? input.cloudRootId;
		if (!rootId) throw Error('This saved download has no pinned cloud root; reconcile it before publishing.');
		if (write.cloudRootId && input.cloudRootId && write.cloudRootId !== input.cloudRootId) throw Error('Saved cloud roots disagree.');
		return readCloudPathEntry(runtime, run.scope, rootId, m.path, input.signal);
	};
	const transport = (write: ReturnType<typeof get>) =>
		isDownload(write) || isLocalTrash(write)
			? {
					read: () => readLocalSource(write),
					lookup: async () => {
						const { check } = cloudRequests(runtime, run.scope, input.signal);
						check();
						const result = await input.localTarget!.lookup(structuredClone(write.operation), { ...run.scope }, trashContexts.get(write.operation.id));
						check();
						return result;
					}
			  }
			: isCloudFolderWrite(write)
			? createCloudFolderTransport(runtime, write, input.signal)
			: fileTransport(runtime, write, input.signal);

	return {
		currentScope: input.currentScope,
		persist: (value) => {
			if (value.id !== run.id) throw Error('Cloud sync run changed.');
			return input.persist(parseCloudSyncRun({ ...value, cloudWrites: run.cloudWrites } as SyncRun));
		},
		read: async (side, path) => {
			if (side === 'local') return input.readLocal(path);
			const write = paths.get(path);
			if (!write) throw Error('Unknown cloud sync path.');
			return transport(write).read();
		},
		lookup: (id, scope) => transport(get(id, scope)).lookup(),
		trashExpected: async (operation, scope) => {
			const write = get(operation.id, scope),
				m = operation.mutation;
			if (m.kind !== 'trash') throw Error('Expected a Trash operation.');
			if (!isLocalTrash(write)) return m.expected;
			const context = trashContexts.get(operation.id);
			if (!input.localTarget?.trashExpected) {
				if (context?.parent || context?.childrenOperationId) throw Error('Native folder transition support is required.');
				return m.expected;
			}
			const { check } = cloudRequests(runtime, run.scope, input.signal);
			check();
			const result = await input.localTarget.trashExpected(structuredClone(operation), { ...scope }, structuredClone(context));
			check();
			return result;
		},
		apply: async (operation, scope) => {
			const write = get(operation.id, scope);
			if (JSON.stringify({ ...operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false }))
				throw Error('Cloud sync operation changed.');

			if (isLocalTrash(write)) {
				const { check } = cloudRequests(runtime, run.scope, input.signal);
				check();
				await runtime.authorizeMutation?.(input.signal);
				check();
				if ((await readLocalSource(write)) !== null) throw Error('The cloud path reappeared; preserve the local item.');
				check();
				const receipt = await input.localTarget!.trash!(structuredClone(operation), { ...scope }, structuredClone(trashContexts.get(operation.id)));
				check();
				return receipt;
			}
			if (isDownload(write)) {
				const m = operation.mutation;
				if (m.kind !== 'copy') throw Error('Expected a download.');
				const { check } = cloudRequests(runtime, run.scope, input.signal);
				const source = m.source.kind === 'file' ? createCloudDownloadSource(runtime, run.scope, write.before!, input.signal) : undefined;
				check();
				const staged = await input.localTarget!.stage(structuredClone(operation), { ...run.scope }, source);
				check();
				validateLocalStage(staged, operation, run.scope);
				if (source) await source.verify!();
				if (!sameSyncStamp(m.source, await readLocalSource(write))) throw Error('Cloud path changed before local publication.');
				check();
				const result = await input.localTarget!.publish(structuredClone(operation), { ...run.scope }, structuredClone(staged));
				check();
				return result;
			}
			if (isCloudFolderWrite(write)) return createCloudFolderTransport(runtime, write, input.signal).apply();
			const source = operation.mutation.kind === 'copy' ? await input.openSource(operation.mutation.source) : undefined;
			return fileTransport(runtime, write, input.signal).apply(source, (bytes, total) => input.progress?.(operation.mutation.path, bytes, total));
		}
	};
}
