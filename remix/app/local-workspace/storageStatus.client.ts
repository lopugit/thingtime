import { rootIdentity } from '../utils/rootIdentity';
import { accountWorkspaceLease, anonymousWorkspaceLease, currentAccountWorkspace, isAnonymousWorkspace, subscribeWorkspaceBinding, workspaceDatabase } from './runtime.client';
import { workspaceScopeKey, type WorkspaceScope } from './storage';

export function workspaceStorageBinding() {
 const scope: WorkspaceScope | null = isAnonymousWorkspace() ? { kind: 'anonymous' } : currentAccountWorkspace();
 if (!scope) return null;
 const lease = scope.kind === 'anonymous' ? anonymousWorkspaceLease() : accountWorkspaceLease(scope);
 return { scope, lease, identity: JSON.stringify([workspaceScopeKey(scope), rootIdentity.read().generation]),
  read: async () => workspaceDatabase().transaction(scope, 'readonly', lease, tx => tx.usage()) };
}
export const workspaceStorageIdentity = () => workspaceStorageBinding()?.identity || '';
export function subscribeWorkspaceStorage(listener: () => void) {
 const unbind = subscribeWorkspaceBinding(listener), unroot = rootIdentity.subscribe(listener);
 return () => { unbind(); unroot(); };
}
