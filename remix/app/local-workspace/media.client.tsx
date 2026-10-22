import React from 'react';
import { anonymousWorkspaceLease, accountWorkspaceLease, currentAccountWorkspace, isAnonymousWorkspace, subscribeWorkspaceIdentity, workspaceIdentityKey, workspaceDatabase, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import type { WorkspaceScope } from './storage';
import { LocalThings } from './things';
import { AccountFileSync } from './accountFiles';
import { LocalMediaRegistry, localMediaId } from './media';

const listeners = new Set<() => void>();
const scopeNow = (): WorkspaceScope | null => isAnonymousWorkspace() ? { kind: 'anonymous' } : currentAccountWorkspace();
const contextKey = workspaceIdentityKey;
let context: { key: string; registry: LocalMediaRegistry } | undefined;
const retireContext = () => {
 if (context?.key === contextKey()) return;
 const retired = context; context = undefined; retired?.registry.dispose();
 listeners.forEach(listener => listener());
};
subscribeWorkspaceIdentity(retireContext);
const subscribeContext = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const subscribeEmpty = () => () => {};
const emptySnapshot = () => 0;
function currentRegistry() {
 const scope = scopeNow(), key = contextKey();
 if (!scope || !key) return null;
 if (context?.key === key) return context.registry;
 const lease = scope.kind === 'anonymous' ? anonymousWorkspaceLease() : accountWorkspaceLease(scope);
 const registry = new LocalMediaRegistry({
  lease: () => lease,
  read: async id => { const db = workspaceDatabase(); const reader = scope.kind === 'account' ? new AccountFileSync(db, scope, lease) : new LocalThings(db, scope, lease); const { row, bytes } = await reader.readFile(id); return { bytes, contentType: String(row.crystal.contentType) }; },
  create: (bytes, type) => URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type })),
  revoke: url => URL.revokeObjectURL(url)
 });
 context = { key, registry }; return registry;
}
if (typeof window !== 'undefined') window.addEventListener(LOCAL_WORKSPACE_CHANGED, event => {
 const ids = (event as Event & { removedIds?: string[] }).removedIds;
 if (ids) context?.registry.removed(ids);
 context?.registry.refresh();
});
function useRegistry() {
 React.useSyncExternalStore(subscribeContext, contextKey, contextKey);
 const registry = currentRegistry();
 React.useSyncExternalStore(registry?.subscribe || subscribeEmpty, registry?.snapshot || emptySnapshot, emptySnapshot);
 return registry;
}
/** Capture the active local identity; a remote URL, shared link, or imported
 * owner ID cannot select a device partition or reuse a retired object URL. */
export function useLocalMediaUrl(remote: (url: string) => string, allowLocal = true) {
 const registry = useRegistry();
 const held = React.useRef(new Map<string, () => void>());
 const requested = new Set<string>();
 React.useEffect(() => () => { held.current.forEach(release => release()); held.current.clear(); }, [registry]);
 React.useEffect(() => {
  for (const [id, release] of held.current) if (!requested.has(id)) { release(); held.current.delete(id); }
  if (registry) for (const id of requested) if (!held.current.has(id)) {
   try { held.current.set(id, registry.retain(id)); } catch { /* Capacity errors are surfaced by LocalMediaDiagnostics. */ }
  }
 });
 return (url: string) => {
  const id = localMediaId(url);
  if (!id || !allowLocal) return remote(url);
  requested.add(id);
  return registry?.url(id) || '';
 };
}
export function LocalMediaDiagnostics() {
 const registry = useRegistry();
 const errors = [...new Set(registry?.errors() || [])].slice(0, 3);
 return errors.length ? <div role="alert" style={{ margin: '12px', padding: '12px', border: '1px solid var(--tt-border)', borderRadius: 8 }}>{errors.map(error => <p key={error}>{error}</p>)}</div> : null;
}
