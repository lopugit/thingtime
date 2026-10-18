import { TIMELINE_CHANGED_EVENT } from '../timeline/clientEvents';
import { rootIdentity } from '../utils/rootIdentity';
import { WorkspaceDatabase, WorkspaceError, workspaceScopeKey, type WorkspaceScope, type WorkspaceLease } from './storage';
import { LocalThings } from './things';

export const LOCAL_WORKSPACE_OWNER = 'local-workspace';
export const LOCAL_WORKSPACE_CHANGED = 'thingtime:local-workspace-changed';
let binding: { anonymous: boolean; generation: number; remoteConfirmed: boolean; account?: Extract<WorkspaceScope, { kind: 'account' }> } | null = null;
let bindingVersion = 0;
let database: WorkspaceDatabase | null = null;
const invalidations = new Set<() => void>();
let changeChannel: BroadcastChannel | null = null;
const currentChangeScope = () => {
 if (!binding || binding.generation !== rootIdentity.read().generation || rootIdentity.read().pending) return null;
 return binding.anonymous ? workspaceScopeKey({ kind: 'anonymous' }) : binding.account ? workspaceScopeKey(binding.account) : null;
};
const currentHomeChangeScope = () => {
 const selected = currentChangeScope();
 return selected && binding?.account && !binding.anonymous ? workspaceScopeKey({...binding.account,dataPlane:'home'}) : null;
};
const dispatchChange = (removedIds?: string[]) => {
 window.dispatchEvent(Object.assign(new Event(LOCAL_WORKSPACE_CHANGED), { removedIds }));
 window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
};
const ensureChangeChannel = () => {
 if (changeChannel || typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return;
 try {
  changeChannel = new window.BroadcastChannel('thingtime:workspace-changes:v1');
  changeChannel.onmessage = event => {
   // Invalidation only: no Thing content, credentials or authority crosses tabs.
   if (event.data?.scope && (event.data.scope === currentChangeScope() ||
    (event.data.type === 'home-themes' && event.data.scope === currentHomeChangeScope()))) dispatchChange();
  };
 } catch { /* Local writes remain available where tab messaging is disabled. */ }
};
/** Called only after the root loader's current-generation check. A caller's
 * Thing JSON cannot select this identity or open an account partition. */
export function bindLocalWorkspace(anonymous: boolean, generation: number, account?: Extract<WorkspaceScope, { kind: 'account' }>, remoteConfirmed = true) {
	if (account?.delegatedBy !== undefined) throw new WorkspaceError('INVALID_WORKSPACE', 'Root identity cannot be selected by a delegated editor.', 409);
	const changed = binding?.remoteConfirmed !== remoteConfirmed || binding?.anonymous !== anonymous || binding.generation !== generation || JSON.stringify(binding?.account) !== JSON.stringify(account);
	binding = { anonymous, generation, remoteConfirmed, ...(!anonymous && account ? { account } : {}) };
 ensureChangeChannel();
	if (changed) { bindingVersion++; invalidations.forEach(listener => listener()); }
}
export function isAnonymousWorkspace() {
	return binding?.anonymous === true && binding.generation === rootIdentity.read().generation && !rootIdentity.read().pending;
}
export function anonymousWorkspaceLease(): WorkspaceLease {
	const generation = rootIdentity.read().generation;
	const assertCurrent = () => {
		if (!isAnonymousWorkspace() || rootIdentity.read().generation !== generation) throw new WorkspaceError('WORKSPACE_CHANGED', 'Workspace changed. Reopen this editor before continuing.', 409);
	};
	return { assertCurrent, onInvalidate: callback => {
		const changed = () => { try { assertCurrent(); } catch { callback(); } };
		invalidations.add(changed); const unsubscribe = rootIdentity.subscribe(changed);
		return () => { invalidations.delete(changed); unsubscribe(); };
	} };
}
export function anonymousWorkspaceDatabase() {
	if (typeof indexedDB === 'undefined') throw new WorkspaceError('LOCAL_STORAGE_UNAVAILABLE', 'Browser storage is unavailable. Allow site storage to save local Things.', 503);
	return database ??= new WorkspaceDatabase(indexedDB);
}
export function anonymousThings() { return new LocalThings(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease()); }
export function announceLocalWorkspaceChange(removedIds?: string[]) {
 dispatchChange(removedIds);
 const scope = currentChangeScope();
 try { if (scope) changeChannel?.postMessage({ scope }); } catch { /* Device storage already committed. */ }
}

/** Only invalidation crosses tabs. Home theme changes are visible under any
 * selected plane for this exact account/origin, without granting remote sync. */
export function announceAccountHomeThemeChange() {
 const scope = currentHomeChangeScope();
 if (!scope) return;
 dispatchChange();
 try { changeChannel?.postMessage({ type:'home-themes',scope }); } catch { /* The local transaction already committed. */ }
}

export function accountWorkspaceLease(scope: Extract<WorkspaceScope, { kind: 'account' }>): WorkspaceLease {
	const authority = scope.delegatedBy === undefined ? scope : { kind: 'account' as const, origin: scope.origin, ownerId: scope.delegatedBy, dataPlane: scope.dataPlane };
	workspaceScopeKey(scope);
	const generation = rootIdentity.read().generation;
	const assertCurrent = () => {
		if (!binding?.account || binding.anonymous || binding.generation !== generation || rootIdentity.read().generation !== generation || rootIdentity.read().pending || workspaceScopeKey(binding.account) !== workspaceScopeKey(authority))
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Account workspace changed. Reopen this editor before continuing.', 409);
	};
	return { assertCurrent, onInvalidate: callback => {
		const changed = () => { try { assertCurrent(); } catch { callback(); } };
		invalidations.add(changed); const unsubscribe = rootIdentity.subscribe(changed);
		return () => { invalidations.delete(changed); unsubscribe(); };
	} };
}
export const workspaceDatabase = anonymousWorkspaceDatabase;

export function currentAccountWorkspace() {
	const scope = binding?.account;
	if (!scope) return null;
	try { accountWorkspaceLease(scope).assertCurrent(); return { ...scope }; } catch { return null; }
}

/** Reading local account content never implies permission to use its cookies. */
export function canSyncAccountWorkspace(scope: Extract<WorkspaceScope, { kind: 'account' }>) {
 try { accountWorkspaceLease(scope).assertCurrent(); return binding?.remoteConfirmed === true; } catch { return false; }
}
export function assertAccountSyncAllowed(scope: Extract<WorkspaceScope, { kind: 'account' }>) {
 accountWorkspaceLease(scope).assertCurrent();
 if (!binding?.remoteConfirmed) throw new WorkspaceError('ACCOUNT_UNCONFIRMED', 'This workspace is offline. Reconnect and confirm your account before syncing.', 503);
 if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new WorkspaceError('ACCOUNT_OFFLINE', 'Account sync is paused while this device is offline.', 503);
}
export function subscribeWorkspaceBinding(listener: () => void) { invalidations.add(listener); return () => { invalidations.delete(listener); }; }
/** A remote operation also retires when confirmation is lost, even if local
 * editing remains in the same account partition. */
export function accountRemoteWorkspaceLease(scope: Extract<WorkspaceScope, { kind: 'account' }>): WorkspaceLease {
 const local = accountWorkspaceLease(scope), version = bindingVersion;
 const assertCurrent = () => { local.assertCurrent(); if (version !== bindingVersion) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account confirmation changed during the request.', 409); assertAccountSyncAllowed(scope); };
 return { assertCurrent, onInvalidate: callback => {
  const changed = () => { try { assertCurrent(); } catch { callback(); } };
  invalidations.add(changed); const unsubscribe = rootIdentity.subscribe(changed);
  return () => { invalidations.delete(changed); unsubscribe(); };
 } };
}

/** Ephemeral UI identity; confirmation changes alone keep local state usable. */
export const workspaceIdentityKey = () => {
 const scope = currentChangeScope();
 return scope ? `${rootIdentity.read().generation}:${scope}` : '';
};
export const subscribeWorkspaceIdentity = (listener: () => void) => {
 const unbind = subscribeWorkspaceBinding(listener), unroot = rootIdentity.subscribe(listener);
 return () => { unbind(); unroot(); };
};
