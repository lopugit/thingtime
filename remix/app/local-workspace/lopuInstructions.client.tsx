import React from 'react';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { LocalLopuInstructions, instructionSettings, promptSnapshot, type InstructionTransport } from './lopuInstructions';
import { accountRemoteWorkspaceLease, accountWorkspaceLease, anonymousWorkspaceLease, canSyncAccountWorkspace, currentAccountWorkspace, isAnonymousWorkspace, subscribeWorkspaceBinding, subscribeWorkspaceIdentity, workspaceDatabase, workspaceIdentityKey } from './runtime.client';
import { workspaceScopeKey, WorkspaceError, type WorkspaceScope } from './storage';
import { createSyncPump } from './syncPump';
import { syncLopuInstructionPass } from './lopuInstructionSync';

export const LOPU_INSTRUCTIONS_CHANGED = 'thingtime:lopu-instructions-changed';
const WAKE = 'thingtime:lopu-instructions-sync';
let channel: BroadcastChannel | null = null;
export function lopuInstructionWorkspace() {
 const account = currentAccountWorkspace();
 if (account) return new LocalLopuInstructions(workspaceDatabase(), account, accountWorkspaceLease(account));
 if (isAnonymousWorkspace()) return new LocalLopuInstructions(workspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease());
 throw new WorkspaceError('WORKSPACE_CHANGED', 'Wait for this workspace to finish opening, then retry.', 409);
}
const homeKey = (scope: WorkspaceScope) => workspaceScopeKey(scope.kind === 'account' ? { ...scope, dataPlane: 'home' } : scope);
export function announceLopuInstructions(scope: WorkspaceScope, sync = false) {
 window.dispatchEvent(new Event(LOPU_INSTRUCTIONS_CHANGED));
 if (sync) window.dispatchEvent(new Event(WAKE));
 try { channel?.postMessage({ scope: homeKey(scope), sync }); } catch { /* Saved content is already durable. */ }
}
export function instructionTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>): InstructionTransport {
 const request = async (body: unknown, signal: AbortSignal) => {
  const lease = accountRemoteWorkspaceLease(scope), retired = new AbortController(), off = lease.onInvalidate(() => retired.abort());
  try {
   lease.assertCurrent();
   if (navigator.onLine === false || window.location.origin !== scope.origin) throw new WorkspaceError('ACCOUNT_UNCONFIRMED', 'Account sync is unavailable.', 503);
   await requireThingtimeCapability('api.settings-lopu-prompt', '1.1.0');
   lease.assertCurrent();
   const requestSignal = AbortSignal.any([signal, retired.signal, AbortSignal.timeout(20_000)]);
   requestSignal.throwIfAborted();
   const response = await fetch('/api/v1/settings/lopu-prompt', { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: requestSignal,
    headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
   const result = await response.json().catch(() => null);
   lease.assertCurrent(); requestSignal.throwIfAborted();
   if (response.status === 401 || ['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(result?.code)) {
    rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh'));
    throw new WorkspaceError('WORKSPACE_CHANGED', 'The active account changed. Device instructions remain in their original workspace.', 409);
   }
   if (!response.ok || result?.ok !== true) throw new WorkspaceError('INSTRUCTIONS_SYNC_REFUSED', 'Account instructions could not be synchronized.', response.status);
   return result;
  } finally { off(); }
 };
 return { read: async signal => promptSnapshot(await request(undefined, signal)), write: async (value, signal) => instructionSettings((await request({ scope: 'personal', ...value }, signal)).personal) };
}

/** Independent from post, draft and Thing sync. Network never holds the local
 * save transaction; current-root confirmation is required for every request. */
export function LopuInstructionsSync() {
 const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, workspaceIdentityKey);
 React.useEffect(() => {
  if (!identity) return;
  const service = lopuInstructionWorkspace(), controller = new AbortController();
  let stopped = false;
  const online = () => !stopped && service.scope.kind === 'account' && navigator.onLine !== false && canSyncAccountWorkspace(service.scope);
  const pump = createSyncPump(online, () => service.scope.kind === 'account'
   ? syncLopuInstructionPass(service, instructionTransport(service.scope), controller.signal, () => announceLopuInstructions(service.scope))
   : Promise.resolve(null));
  const wake = () => pump.wake();
  const off = subscribeWorkspaceBinding(wake), retire = service.lease.onInvalidate(() => controller.abort());
  try {
   channel = new BroadcastChannel('thingtime:lopu-instructions:v1');
   channel.onmessage = event => { if (event.data?.scope === homeKey(service.scope)) { window.dispatchEvent(new Event(LOPU_INSTRUCTIONS_CHANGED)); if (event.data.sync) wake(); } };
  } catch { /* Same-tab editing still works. */ }
  window.addEventListener(WAKE, wake); window.addEventListener('online', wake); window.addEventListener('focus', wake);
  wake();
  return () => { stopped = true; pump.stop(); controller.abort(); retire(); off(); channel?.close(); channel = null; window.removeEventListener(WAKE, wake); window.removeEventListener('online', wake); window.removeEventListener('focus', wake); };
 }, [identity]);
 return null;
}
