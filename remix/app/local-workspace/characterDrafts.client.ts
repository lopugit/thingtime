import { validDraftId } from '../drafts/draftCore';
import { rootIdentity } from '../utils/rootIdentity';
import { AccountDraftSync } from './accountDrafts';
import { AccountDraftCatalog } from './accountDraftCatalog';
import { AccountDraftClient } from './accountDraftClient.client';
import { AccountFileSync } from './accountFiles';
import { accountThingTransport } from './accountTransport.client';
import { createSyncPump } from './syncPump';
import { accountWorkspaceLease, canSyncAccountWorkspace, subscribeWorkspaceBinding, announceLocalWorkspaceChange, workspaceDatabase } from './runtime.client';
import { WorkspaceError, workspaceScopeKey, type WorkspaceScope } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
const workers = new Map<string, ReturnType<typeof createWorker>>();
const retryDelay = (completed: number, rows: {state:string;retryAt:number}[]) => {
 const pending = rows.filter(row => ['pending','syncing'].includes(row.state));
 if (!pending.length) return null;
 const waits = pending.map(row => row.retryAt - Date.now()).filter(wait => wait > 0);
 return completed ? 0 : waits.length ? Math.min(...waits) : 60_000;
};

/** Existing canonical draft/file queues, in a principal-and-actor partition.
 * Local editing grants no remote delegation: every request still selects and
 * reauthorizes the actor through the normal Character API contract. */
function createWorker(scope: AccountScope, dispose: () => void) {
 const db = workspaceDatabase(), lease = accountWorkspaceLease(scope);
 lease.assertCurrent();
 const files = new AccountFileSync(db,scope,lease), drafts = new AccountDraftSync(db,scope,lease,files.draftHooks);
 const catalog = new AccountDraftCatalog(db,scope,lease), transport = accountThingTransport(scope,lease);
 const controller = new AbortController(); let stopped = false;
 const enabled = () => !stopped && navigator.onLine !== false && canSyncAccountWorkspace(scope);
 const draftPump = createSyncPump(enabled, async () => {
  const before = JSON.stringify(await drafts.status()), result = await drafts.sync(transport.drafts,controller.signal), rows = await drafts.status();
  if (JSON.stringify(rows) !== before) announceLocalWorkspaceChange();
  return retryDelay(result.completed,rows);
 });
 const filePump = createSyncPump(enabled, async () => {
  const before = JSON.stringify(await files.status()), result = await files.sync(transport.files,controller.signal,3,async () => false), rows = await files.status();
  if (JSON.stringify(rows) !== before) announceLocalWorkspaceChange();
  if (result.completed) draftPump.wake();
  return retryDelay(result.completed,rows);
 });
 const wake = () => { filePump.wake(); draftPump.wake(); };
 const stop = () => {
  if (stopped) return;
  stopped = true; controller.abort(); filePump.stop(); draftPump.stop();
  window.removeEventListener('online',wake); window.removeEventListener('focus',wake);
  unbind(); unlease(); dispose();
 };
 const unbind = subscribeWorkspaceBinding(wake), unlease = lease.onInvalidate(stop);
 window.addEventListener('online',wake); window.addEventListener('focus',wake);
 const client = new AccountDraftClient({db,lease,files,drafts,catalog,transport,wake},scope,enabled,announceLocalWorkspaceChange);
 return { scope,lease,client,draftClient:client,drafts,files,transport,wake,stop };
}

export function characterDraftWorkspace(principal: AccountScope, actor: string) {
 accountWorkspaceLease(principal).assertCurrent();
 if (principal.delegatedBy !== undefined || !validDraftId(actor) || actor === principal.ownerId || actor === 'local-workspace')
  throw new WorkspaceError('INVALID_CHARACTER', 'Choose a Character belonging to this account.',409);
 const scope: AccountScope = {...principal,ownerId:actor,delegatedBy:principal.ownerId};
 const key = `${workspaceScopeKey(scope)}:${rootIdentity.read().generation}`;
 let worker = workers.get(key);
 if (!worker) { worker = createWorker(scope,() => workers.delete(key)); workers.set(key,worker); }
 return worker;
}
