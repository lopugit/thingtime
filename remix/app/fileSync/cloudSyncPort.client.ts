import { createCloudDownloadSource } from './cloudDownloadSource';
import { validateLocalStage, type LocalSyncTarget } from './localSyncTarget';
import { cloudRequests } from './cloudTransport';
import { cloudFolderSyncEntry, parseCloudFolder } from './cloudFolder';
import { cloudFileSyncEntry, parseCloudFile } from './cloudFile';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { createCloudFileTransport, createCloudFolderTransport, type CloudTransportRuntime } from './cloudTransport';
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
	const downloads = run.cloudWrites.some((write) => write.operation.mutation.kind === 'copy' && write.operation.mutation.from === 'remote');
	if (downloads && !input.localTarget) throw Error('Native staged publication is required for downloads.');
	const writes = new Map(run.cloudWrites.map((write) => [write.operation.id, write]));
	const paths = new Map(run.cloudWrites.map((write) => [write.operation.mutation.path, write]));
	const get = (id: string, scope: SyncScope) => {
		if (!sameSyncScope(scope, run.scope) || !writes.has(id)) throw Error('Unknown cloud sync operation.');
		return writes.get(id)!;
	};
	const isDownload = (write: ReturnType<typeof get>) => write.operation.mutation.kind === 'copy' && write.operation.mutation.from === 'remote';
	const readDownload = async (write: ReturnType<typeof get>) => {
		const m = write.operation.mutation;
		if (m.kind !== 'copy' || m.from !== 'remote') throw Error('Expected a download.');
		const { json, negotiate } = cloudRequests(runtime, run.scope, input.signal);
		await negotiate({ 'api.files': m.source.kind === 'folder' ? '1.2.0' : '1.0.0' });
		const result = await json(
			'/api/v1/files?' + new URLSearchParams({ [m.source.kind === 'folder' ? 'folderId' : 'id']: m.source.id }),
			undefined,
			true
		);
		if (!result) return null;
		if (m.source.kind === 'folder') {
			const folder = parseCloudFolder(result.folder);
			if (folder.folderId !== write.folderId || folder.name !== m.path.split('/').at(-1)) throw Error('Cloud folder moved or renamed.');
			return cloudFolderSyncEntry(folder, m.path);
		}
		const file = parseCloudFile(result.file);
		if (file.folderId !== write.folderId || file.name !== m.path.split('/').at(-1)) throw Error('Cloud file moved or renamed.');
		return file.trashed ? null : cloudFileSyncEntry(file, m.path);
	};
	const transport = (write: ReturnType<typeof get>) =>
		isDownload(write)
			? {
					read: () => readDownload(write),
					lookup: async () => {
						const { check } = cloudRequests(runtime, run.scope, input.signal);
						check();
						const result = await input.localTarget!.lookup(structuredClone(write.operation), { ...run.scope });
						check();
						return result;
					}
			  }
			: isCloudFolderWrite(write)
			? createCloudFolderTransport(runtime, write, input.signal)
			: createCloudFileTransport(runtime, write, input.signal);

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
		apply: async (operation, scope) => {
			const write = get(operation.id, scope);
			if (JSON.stringify({ ...operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false }))
				throw Error('Cloud sync operation changed.');
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
				else if (!sameSyncStamp(m.source, await readDownload(write))) throw Error('Cloud folder changed before local publication.');
				check();
				const result = await input.localTarget!.publish(structuredClone(operation), { ...run.scope }, structuredClone(staged));
				check();
				return result;
			}
			if (isCloudFolderWrite(write)) return createCloudFolderTransport(runtime, write, input.signal).apply();
			const source = operation.mutation.kind === 'copy' ? await input.openSource(operation.mutation.source) : undefined;
			return createCloudFileTransport(runtime, write, input.signal).apply(source, (bytes, total) =>
				input.progress?.(operation.mutation.path, bytes, total)
			);
		}
	};
}
