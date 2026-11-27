import { openSyncJournal } from './journal.client';
import { sameSyncScope, type SyncScope } from './reconcile';
import { type SyncActivityCursor } from './syncActivityJournal';

export { SYNC_ACTIVITY_CHANGED_EVENT, type SyncActivityRecord, type SyncActivityCursor } from './syncActivityJournal';

export async function readNativeSyncActivity(scope: SyncScope, options: {
 currentScope(): SyncScope; signal?: AbortSignal; limit?: number; before?: SyncActivityCursor;
}) {
 const check = () => {
  options.signal?.throwIfAborted();
  if (!sameSyncScope(scope, options.currentScope())) throw Error('Sync activity account or connection changed.');
  return scope;
 };
 check();
 const journal = await openSyncJournal();
 try { return await journal.syncActivity({ scope, currentScope: check, signal: options.signal }).read(options); }
 finally { journal.close(); }
}
