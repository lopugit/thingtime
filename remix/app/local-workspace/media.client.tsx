import React from 'react';
import { useCharacterScope } from '../components/Characters/CharacterScope';
import { anonymousWorkspaceLease, accountWorkspaceLease, currentAccountWorkspace, isAnonymousWorkspace, subscribeWorkspaceIdentity, workspaceIdentityKey, workspaceDatabase, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import { workspaceScopeKey, type WorkspaceScope } from './storage';
import { LocalThings } from './things';
import { AccountFileSync } from './accountFiles';
import { LocalMediaRegistry, localMediaId } from './media';
import { isLocalLinkedAttachment } from './attachments';

const listeners = new Set<() => void>();
const scopeNow = (actorId?:string): WorkspaceScope | null => {
 const account=currentAccountWorkspace();
 if(account)return actorId && actorId!==account.ownerId ? {...account,ownerId:actorId,delegatedBy:account.ownerId} : account;
 return !actorId && isAnonymousWorkspace() ? {kind:'anonymous'} : null;
};
const contextKey = workspaceIdentityKey;
type MediaContext = {key:string;identity:string;registry:LocalMediaRegistry;users:number};
const contexts = new Map<string,MediaContext>();
const retireContext = () => {
 const identity=contextKey();
 for(const [key,context] of contexts)if(context.identity!==identity){contexts.delete(key);context.registry.dispose();}
 listeners.forEach(listener => listener());
};
subscribeWorkspaceIdentity(retireContext);
const subscribeContext = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const subscribeEmpty = () => () => {};
const emptySnapshot = () => 0;
function currentContext(actorId?:string) {
 const scope = scopeNow(actorId), identity = contextKey();
 if (!scope || !identity) return null;
 const key=JSON.stringify([identity,workspaceScopeKey(scope)]), existing=contexts.get(key);
 if(existing)return existing;
 const lease = scope.kind === 'anonymous' ? anonymousWorkspaceLease() : accountWorkspaceLease(scope);
 const registry = new LocalMediaRegistry({
  lease: () => lease,
  read: async (id, signal) => {
   const db = workspaceDatabase(), reader = scope.kind === 'account' ? new AccountFileSync(db, scope, lease) : new LocalThings(db, scope, lease);
   if (reader instanceof AccountFileSync) {
    const url = await reader.readLinkedUrl(id, signal); if (url) return { url };
   }
   if (scope.kind === 'anonymous') {
    const row = await (reader as LocalThings).get(id); signal.throwIfAborted(); lease.assertCurrent();
    if (isLocalLinkedAttachment(row)) return { url: String(row.crystal.url) };
   }
   const { row, blob } = await reader.readFileBlob(id, signal); return { bytes: blob, contentType: String(row.crystal.contentType) };
  },
  create: (bytes, type) => URL.createObjectURL(new Blob([bytes instanceof Blob ? bytes : Uint8Array.from(bytes)], { type })),
  revoke: url => URL.revokeObjectURL(url)
 });
 const context={key,identity,registry,users:0};contexts.set(key,context);return context;
}
if (typeof window !== 'undefined') window.addEventListener(LOCAL_WORKSPACE_CHANGED, event => {
 const ids = (event as Event & { removedIds?: string[] }).removedIds;
 for(const context of contexts.values()){
  if(ids)context.registry.removed(ids);
  context.registry.refresh();
 }
});
function useRegistry() {
 const actor=useCharacterScope();
 React.useSyncExternalStore(subscribeContext, contextKey, contextKey);
 const context=currentContext(actor?.id), registry=context?.registry;
 React.useEffect(()=>{
  if(!context)return;
  context.users++;
  return ()=>{context.users--;queueMicrotask(()=>{
   if(!context.users && contexts.get(context.key)===context){contexts.delete(context.key);context.registry.dispose();}
  });};
 },[context]);
 React.useSyncExternalStore(registry?.subscribe || subscribeEmpty, registry?.snapshot || emptySnapshot, emptySnapshot);
 return registry;
}
/** The validated editor context selects the local partition; a remote URL,
 * shared link or imported owner ID cannot select it or reuse a retired URL. */
export function useLocalMediaUrl(remote: (url: string) => string, allowLocal = true) {
 const registry = useRegistry();
 const held = React.useRef(new Map<string, () => void>());
 const requested = new Set<string>();
 React.useEffect(() => () => { held.current.forEach(release => release()); held.current.clear(); }, [registry]);
 React.useEffect(() => {
  for (const [id, release] of held.current) if (!requested.has(id)) { release(); held.current.delete(id); }
  if (registry) for (const id of requested) if (!held.current.has(id)) {
   try { held.current.set(id, registry.retain(id)); } catch { /* Read errors are surfaced by LocalMediaDiagnostics. */ }
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
