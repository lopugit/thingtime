import { useEffect } from 'react';
import { useLopu } from '~/components/Lopu/useLopu';
import { rootIdentity } from '~/utils/rootIdentity';
import { SYNC_STARTUP_STARTED_EVENT } from './syncStartup';

/** The normal Lopu presenter consumes acknowledged startup, independently of
 * discovery ownership. Neither route mounting nor a cached status emits it. */
export function SyncStartupNotice({ ownerId, generation }: { ownerId: string; generation: number }) {
 const lopu = useLopu();
 useEffect(() => {
  const started = (event: Event) => {
   const value = (event as CustomEvent).detail, identity = rootIdentity.read();
   if (!value || value.ownerId !== ownerId || value.generation !== generation || value.origin !== window.location.origin || identity.pending || identity.generation !== generation) return;
   lopu({ description: 'Device File Syncing has been started for all configs', status: 'info' });
  };
  window.addEventListener(SYNC_STARTUP_STARTED_EVENT, started);
  return () => window.removeEventListener(SYNC_STARTUP_STARTED_EVENT, started);
 }, [ownerId, generation, lopu]);
 return null;
}
