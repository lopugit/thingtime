import React from 'react';
import { anonymousThings, anonymousWorkspaceLease, LOCAL_WORKSPACE_CHANGED } from './runtime.client';
import { LocalMediaRegistry, localMediaId } from './media';

const registry = new LocalMediaRegistry({
 lease: anonymousWorkspaceLease,
 read: async id => { const { row, bytes } = await anonymousThings().readFile(id); return { bytes, contentType: String(row.crystal.contentType) }; },
 create: (bytes, type) => URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type })),
 revoke: url => URL.revokeObjectURL(url)
});
if (typeof window !== 'undefined') window.addEventListener(LOCAL_WORKSPACE_CHANGED, event => {
 const ids = (event as Event & { removedIds?: string[] }).removedIds;
 if (ids) registry.removed(ids);
});
/** Collect references during native rendering, then acquire bytes in an effect.
 * No network or persistence work runs during React render. */
export function useLocalMediaUrl(remote: (url: string) => string) {
 React.useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
 const held = React.useRef(new Map<string, () => void>());
 const requested = new Set<string>();
 React.useEffect(() => {
  for (const [id, release] of held.current) if (!requested.has(id)) { release(); held.current.delete(id); }
  for (const id of requested) if (!held.current.has(id)) {
   try { held.current.set(id, registry.retain(id)); } catch { /* Capacity errors are surfaced by LocalMediaDiagnostics. */ }
  }
 });
 React.useEffect(() => () => { held.current.forEach(release => release()); held.current.clear(); }, []);
 return (url: string) => {
  const id = localMediaId(url);
  if (!id) return remote(url);
  requested.add(id);
  return registry.url(id);
 };
}
export function LocalMediaDiagnostics() {
 React.useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
 const errors = [...new Set(registry.errors())].slice(0, 3);
 return errors.length ? <div role="alert" style={{ margin: '12px', padding: '12px', border: '1px solid var(--tt-border)', borderRadius: 8 }}>{errors.map(error => <p key={error}>{error}</p>)}</div> : null;
}
