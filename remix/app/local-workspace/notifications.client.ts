import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { rootIdentity } from '../utils/rootIdentity';
import { accountRemoteWorkspaceLease, accountWorkspaceLease, anonymousWorkspaceLease, canSyncAccountWorkspace, subscribeWorkspaceBinding, workspaceDatabase } from './runtime.client';
import { readBoundedJson } from './accountTransport.client';
import { LocalNotificationHistory, type MessageTransport } from './notifications';
import { WorkspaceError, workspaceScopeKey, type WorkspaceScope } from './storage';

export function deviceNotificationHistory(scope: WorkspaceScope) {
 return new LocalNotificationHistory(workspaceDatabase(), scope, scope.kind === 'account' ? accountWorkspaceLease(scope) : anonymousWorkspaceLease());
}
const HISTORY_CHANNEL = 'thingtime:notification-history';
const dispatchHistoryChanged = (detail: { userId: string; scope: string }) => window.dispatchEvent(new CustomEvent('thingtime:notification-recorded', { detail }));
let historyChannel: BroadcastChannel | undefined;
function channel() {
 if (!historyChannel && typeof window.BroadcastChannel === 'function') {
  try { historyChannel = new window.BroadcastChannel(HISTORY_CHANNEL); } catch { return undefined; }
  historyChannel.onmessage = event => {
   const detail = event.data;
   // Only an invalidation hint crosses tabs, never message content or credentials.
   if (detail && typeof detail.userId === 'string' && typeof detail.scope === 'string') dispatchHistoryChanged(detail);
  };
 }
 return historyChannel;
}
export function subscribeNotificationHistory(scope: WorkspaceScope, listener: () => void) {
 channel();
 const expected = workspaceScopeKey(scope);
 const changed = (event: Event) => { if ((event as CustomEvent).detail?.scope === expected) listener(); };
 window.addEventListener('thingtime:notification-recorded', changed);
 return () => window.removeEventListener('thingtime:notification-recorded', changed);
}
export function notifyHistoryChanged(scope: WorkspaceScope) {
 const detail = { userId: scope.kind === 'account' ? scope.ownerId : 'local-workspace', scope: workspaceScopeKey(scope) };
 dispatchHistoryChanged(detail);
 try { channel()?.postMessage(detail); } catch { /* Cross-tab hints are optional; local persistence and invalidation succeeded. */ }
}
export async function retryNotificationHistory(scope: WorkspaceScope) {
 if (scope.kind !== 'account') return;
 await deviceNotificationHistory(scope).retry();
 notifyHistoryChanged(scope);
 startNotificationHistorySync(scope);
}

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export const notificationMessageTransport = (scope: AccountScope): MessageTransport => async (body, signal) => {
 const lease = accountRemoteWorkspaceLease(scope); lease.assertCurrent();
 const controller = new AbortController(), unsubscribe = lease.onInvalidate(() => controller.abort());
 try {
  if (window.location.origin !== scope.origin || body.userId !== scope.ownerId) throw new WorkspaceError('WORKSPACE_CHANGED', 'Notification workspace changed.', 409);
  await requireThingtimeCapability('api.notifications-record', '1.0.0');
  lease.assertCurrent(); signal?.throwIfAborted();
  // This existing home-pinned endpoint checks body.userId against the session
  // before writing. Never use the selected data plane to pick a recipient.
  const response = await fetch('/api/v1/notifications/record', { method: 'POST', credentials: 'same-origin', redirect: 'error',
   signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let result: any = null;
  try { result = await readBoundedJson(response); } catch (error) { if (response.ok) throw error; }
  lease.assertCurrent();
  if (response.status === 401 || response.status === 403) {
   rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh'));
   throw new WorkspaceError('WORKSPACE_CHANGED', 'Confirm your account before syncing saved messages.', 409);
  }
  if (!response.ok || result?.ok !== true || typeof result.id !== 'string') throw new WorkspaceError('NOTIFICATION_SYNC_FAILED', 'The message is saved on this device but account sync failed.', response.ok ? 502 : response.status);
  return result.id;
 } finally { unsubscribe(); }
};

const workers = new Map<string, { wake(): void }>();
export function startNotificationHistorySync(scope: AccountScope) {
 const key = JSON.stringify([workspaceScopeKey(scope), rootIdentity.read().generation]);
 const previous = workers.get(key);
 if (previous) { previous.wake(); return; }
 const lease = accountWorkspaceLease(scope), history = deviceNotificationHistory(scope), transport = notificationMessageTransport(scope);
 let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined, again = false;
 const controller = new AbortController();
 const wake = () => {
  if (stopped || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
  if (running) { again = true; return; }
  clearTimeout(timer); timer = setTimeout(() => { void drain(); }, 0);
 };
 const drain = async () => {
  if (stopped || running || navigator.onLine === false || !canSyncAccountWorkspace(scope)) return;
  running = true; again = false;
  try {
   const result = await history.sync(transport, controller.signal);
   notifyHistoryChanged(scope);
   if (result.pending && !stopped) timer = setTimeout(wake, 30_000);
  } catch {
   // A transient failure must keep a retry scheduled; identity retirement still stops it.
   if (!stopped && canSyncAccountWorkspace(scope)) timer = setTimeout(wake, 30_000);
  }
  finally { running = false; if (again && !stopped) wake(); }
 };
 const stop = () => { stopped = true; clearTimeout(timer); controller.abort(); unbind(); unsubscribe(); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); workers.delete(key); };
 const unsubscribe = lease.onInvalidate(stop), unbind = subscribeWorkspaceBinding(wake);
 window.addEventListener('online', wake); window.addEventListener('focus', wake);
 workers.set(key, { wake }); wake();
}
