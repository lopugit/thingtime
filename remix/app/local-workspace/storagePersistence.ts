import { WorkspaceError, type WorkspaceLease } from './storage';

export type PersistenceManager = Pick<StorageManager, 'persisted' | 'persist'>;
export type StorageProtection = 'persistent' | 'best-effort' | 'unsupported';

/** The browser grants origin-wide eviction protection, not account authority or
 * a backup. Only the explicit user action requests it; reads never prompt. */
export async function storageProtection(manager: Partial<PersistenceManager> | undefined, lease: WorkspaceLease, request = false, timeoutMs = 10_000): Promise<StorageProtection> {
 lease.assertCurrent();
 if (typeof manager?.persisted !== 'function' || typeof manager?.persist !== 'function') return 'unsupported';
 let timer: ReturnType<typeof setTimeout> | undefined, unsubscribe = () => {}, settled = false;
 const assertActive = () => {
  lease.assertCurrent();
  if (settled) throw new WorkspaceError('LOCAL_PERSISTENCE_TIMEOUT', 'The browser did not finish checking storage protection. Try again.', 503);
 };
 try {
  return await Promise.race([
   (async () => {
    let protectedStorage = await manager.persisted!(); assertActive();
    if (typeof protectedStorage !== 'boolean') throw new WorkspaceError('LOCAL_PERSISTENCE_UNAVAILABLE', 'The browser did not report a storage protection result.', 503);
    if (request && !protectedStorage) { protectedStorage = await manager.persist!(); assertActive(); }
    if (typeof protectedStorage !== 'boolean') throw new WorkspaceError('LOCAL_PERSISTENCE_UNAVAILABLE', 'The browser did not report a storage protection result.', 503);
    return protectedStorage ? 'persistent' as const : 'best-effort' as const;
   })(),
   new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WorkspaceError('LOCAL_PERSISTENCE_TIMEOUT', 'The browser did not finish checking storage protection. Try again.', 503)), timeoutMs);
    unsubscribe = lease.onInvalidate(() => reject(new WorkspaceError('WORKSPACE_CHANGED', 'Workspace changed. Reopen storage settings.', 409)));
   })
  ]);
 } finally { settled = true; clearTimeout(timer); unsubscribe(); }
}
