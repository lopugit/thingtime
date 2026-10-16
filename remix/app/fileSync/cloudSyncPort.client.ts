import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { createCloudFileTransport, type CloudTransportRuntime } from './cloudTransport';
import { parseCloudSyncRun } from './cloudWrite';
import type { FingerprintSource } from './contentFingerprint';
import { sameSyncScope, type SyncEntry, type SyncScope } from './reconcile';
import type { SyncExecutionPort, SyncRun } from './execute';

/** Connect a prepared upload/backup run to real cloud bytes. The complete
 * destinations travel in the existing durable run, so a restart cannot remap
 * an uncertain operation to a different folder. Root scanning and local
 * download publication are supplied by platform workers, not inferred here. */
export function createCloudSyncPort(saved: SyncRun, input: {
 currentScope(): SyncScope;
 persist(run: SyncRun): Promise<void>;
 readLocal(path: string): Promise<SyncEntry | null>;
 openSource(expected: SyncEntry): Promise<FingerprintSource>;
 signal?: AbortSignal;
 progress?: (path: string, bytes: number, total: number) => void;
}, runtime: CloudTransportRuntime = { currentScope: input.currentScope, origin: () => window.location.origin, fetch: (url, init) => fetch(url, init), requireCapability: requireThingtimeCapability }): SyncExecutionPort {
 const run = parseCloudSyncRun(saved);
 const writes = new Map(run.cloudWrites.map(write => [write.operation.id, write]));
 const paths = new Map(run.cloudWrites.map(write => [write.operation.mutation.path, write]));
 const get = (id: string, scope: SyncScope) => {
  if (!sameSyncScope(scope, run.scope) || !writes.has(id)) throw Error('Unknown cloud sync operation.');
  return writes.get(id)!;
 };
 return {
  currentScope: input.currentScope,
  persist: value => {
   if (value.id !== run.id) throw Error('Cloud sync run changed.');
   return input.persist(parseCloudSyncRun({ ...value, cloudWrites: run.cloudWrites } as SyncRun));
  },
  read: async (side, path) => {
   if (side === 'local') return input.readLocal(path);
   const write = paths.get(path); if (!write) throw Error('Unknown cloud sync path.');
   return createCloudFileTransport(runtime, write, input.signal).read();
  },
  lookup: (id, scope) => createCloudFileTransport(runtime, get(id, scope), input.signal).lookup(),
  apply: async (operation, scope) => {
   const write = get(operation.id, scope);
   if (JSON.stringify({ ...operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false })) throw Error('Cloud sync operation changed.');
   const source = operation.mutation.kind === 'copy' ? await input.openSource(operation.mutation.source) : undefined;
   return createCloudFileTransport(runtime, write, input.signal).apply(source, (bytes, total) => input.progress?.(operation.mutation.path, bytes, total));
  }
 };
}
