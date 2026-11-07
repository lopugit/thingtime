import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { readBoundedJson } from './accountTransport.client';
import { WorkspaceError, type WorkspaceScope, type WorkspaceLease } from './storage';
import type { PasswordVaultTransport } from './passwordVault';

/** Direct, same-origin vault requests: no diagnostics/history, origin fallback,
 * stored credential or inferred authority from the encrypted device copy. */
export function accountPasswordRequest(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease, minimumVersion = '1.0.0') {
 const request = async (body: Record<string, unknown>, signal: AbortSignal) => {
  lease.assertCurrent(); const remote = accountRemoteWorkspaceLease(scope); remote.assertCurrent();
  const controller = new AbortController(), off = remote.onInvalidate(() => controller.abort());
  const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(20_000)]);
  try {
   if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed.', 409);
   await requireThingtimeCapability('api.passwords', minimumVersion);
   await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
   lease.assertCurrent(); remote.assertCurrent(); combined.throwIfAborted();
   const response = await fetch('/api/v1/passwords', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: combined,
    headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane },
    body: JSON.stringify({ ...body, expectedOwnerId: scope.ownerId }) });
   let result: any = null;
   try { result = await readBoundedJson(response); } catch (error) { if (response.ok) throw error; }
   lease.assertCurrent(); remote.assertCurrent(); combined.throwIfAborted();
   if (response.status === 401 || (response.status === 409 && ['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(result?.code)) || (response.ok && result?.ownerId !== scope.ownerId)) {
    rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh'));
    throw new WorkspaceError('WORKSPACE_CHANGED', 'Account confirmation changed. Device passwords remain in their original vault.', 409);
   }
   if (!response.ok || result?.ok !== true) throw Object.assign(new WorkspaceError('PASSWORD_SYNC_REFUSED', 'The account password request could not be completed.', response.ok ? 502 : response.status), {
    retryAfterMs: Math.min(86_400_000, Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000)
   });
   return result;
  } finally { off(); }
 };
 return request;
}

export function accountPasswordTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): PasswordVaultTransport {
 const request = accountPasswordRequest(scope, lease);
 return {
  write: (command, signal) => request(command, signal),
  page: (cursor, signal) => request({ operation: 'export', ...(cursor ? { cursor } : {}) }, signal),
  read: async (id, signal) => { try { return await request({ operation: 'read', id }, signal); } catch (error) { if ((error as any)?.status === 404) return null; throw error; } }
 };
}
