import type { ForegroundSyncInput } from './foregroundSync';
import type { FolderHost } from './desktopFolders.client';
import { supportsNativePathObservation } from './mobileFolders.client';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';

export class NativePathObservationUnavailable extends Error {
 constructor() { super('Native point observation unavailable; defer to strict reconciliation.'); }
}

/** One typed boundary shared by the installed adapter and canonical fixture. */
export function nativePathObserver(host: Pick<FolderHost, 'capabilities' | 'request'>, ownerId: string, signal: AbortSignal): ForegroundSyncInput['observeLocal'] {
 if (!supportsNativePathObservation(host.capabilities)) return undefined;
 return async (path, parent, saved) => {
  signal.throwIfAborted();
  if (parent !== path.split('/').slice(0, -1).join('/')) throw Error('Invalid observation parent.');
  const value = await host.request(ownerId, { action: 'observe-path', rootId: saved.configuration.localRootId, path,
   observation: { version: 1, network: saved.configuration.network, chargingOnly: saved.configuration.chargingOnly, configurationId: saved.id, configurationRevision: saved.updatedAt }, remainingMs: 30_000 }, signal);
  signal.throwIfAborted(); assertPhotoSourcePolicy(saved.configuration, value.roots);
  if (value.observationUnavailable) throw new NativePathObservationUnavailable();
  return { conditions: value.conditions!, entries: value.observedEntries! };
 };
}
