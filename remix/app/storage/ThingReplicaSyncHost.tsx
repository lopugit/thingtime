import React from 'react';
import { useApi } from '../hooks/useApi';
import { rootIdentity } from '../utils/rootIdentity';
import { createThingStorageClient } from '../components/Things/thingStorageClient';
import { isNativeFileStorage, requestNativeThingReplica } from '../components/Things/thingStorageNative.client';
import { createBrowserThingReplicas } from './thingReplicas.client';
import { ThingReplicaStore, replicaScopeKey } from './thingReplicaStore';

/** Foreground reconciliation visits only this installation's enrolled copies,
 * one at a time. It never downloads a catalog or assumes another device's pin. */
export function ThingReplicaSyncHost({ ownerId, generation, dataPlane }: {
  ownerId?: string; generation: number; dataPlane?: string | null;
}) {
  const api = useApi(), apiRef = React.useRef(api); apiRef.current = api;
  React.useEffect(() => {
    if (!ownerId || dataPlane !== 'home' || !window.indexedDB) return;
    const origin = window.location.origin, store = new ThingReplicaStore(window.indexedDB);
    const base = { apiOrigin: origin, ownerId, dataPlane };
    const lifetime = new AbortController(); let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (signal: AbortSignal) => {
      signal.throwIfAborted(); lifetime.signal.throwIfAborted();
      if (window.location.origin !== origin || rootIdentity.read().pending || rootIdentity.read().generation !== generation)
        throw new DOMException('Storage account changed', 'AbortError');
    };
    const reconcile = async () => {
      if (active || lifetime.signal.aborted || document.visibilityState !== 'visible' || navigator.onLine === false) return;
      const operation = new AbortController(); active = operation;
      const signal = AbortSignal.any([operation.signal, lifetime.signal]);
      const assertCurrent = () => check(signal);
      try {
        const deviceId = await store.binding(base); assertCurrent(); if (!deviceId) return;
        const scope = { ...base, deviceId }, key = replicaScopeKey(scope);
        const work = async () => {
          const client = createThingStorageClient({ origin, ownerId, dataPlane: 'home' }, {
            signal, assertCurrent, onIdentityChange: () => { rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh')); },
          });
          let after: string | undefined;
          for (;;) {
            assertCurrent(); const row = await store.next(key, after); assertCurrent(); if (!row) break;
            after = row.id;
            try {
              const paired = row.policy.device?.kind === 'paired' ? deviceId : undefined;
              const readPolicy = (id: string) => client.read(id, paired);
              let current = await readPolicy(row.id); assertCurrent();
              if (!current.canEdit || current.device?.id !== deviceId || !current.policy.cloudSync) continue;
              const local = current.device.localAvailability;
              const keep = local === 'keep' || (local === 'inherit' && current.policy.defaultLocalAvailability === 'keep');
              if (local !== 'cloud-only' && (!keep || (current.policy.automaticDownloadDeviceId && current.policy.automaticDownloadDeviceId !== deviceId))) continue;
              if (row.nativeFileBytes && !isNativeFileStorage('file')) continue;
              const options = { signal, expectedActor: ownerId, expectedDataPlane: 'home', expectedApiOrigin: origin, storageMode: 'cloud' as const };
              const adapter = createBrowserThingReplicas({ scope, store, signal, assertCurrent, readPolicy,
                manageFileBytes: !row.nativeFileBytes,
                readThing: id => apiRef.current.v1.things.get({ id }, options),
                writeThing: payload => apiRef.current.v1.things.update(payload, options),
              });
              if (row.pendingMutation) { await adapter.sync(row.id); current = await readPolicy(row.id); assertCurrent(); }
              if (local === 'cloud-only') {
                if (row.nativeFileBytes) {
                  const result = await requestNativeThingReplica('evict', { origin, ownerId, dataPlane: 'home' }, current, signal);
                  assertCurrent(); if (result.state !== 'evicted') continue;
                }
                await adapter.evict(row.id);
              } else if (row.pendingMutation || row.sourceHash !== current.source.sourceHash || row.policy.policy.revision !== current.policy.revision || row.policy.device?.revision !== current.device.revision) {
                if (row.nativeFileBytes) {
                  const result = await requestNativeThingReplica('keep', { origin, ownerId, dataPlane: 'home' }, current, signal);
                  assertCurrent(); if (result.state !== 'saved' && result.state !== 'present') continue;
                }
                await adapter.keep(row.id);
              }
              assertCurrent(); window.dispatchEvent(new CustomEvent('thingtime:replica-changed', {
                detail: { id: row.id, ownerId, dataPlane, apiOrigin: origin },
              }));
            } catch {
              assertCurrent();
              // Failures retain the saved copy/pending change. The Thing's
              // Storage panel exposes its current state and an explicit retry.
            }
          }
        };
        // Web Locks forbids combining ifAvailable with signal. This request
        // never queues; work itself checks cancellation before every action.
        if (navigator.locks) await navigator.locks.request(`thingtime-replicas:${key}`, { ifAvailable: true }, lock => lock ? work() : undefined);
        else await work();
      } catch { /* No background retry loop; next foreground/online event retries. */ }
      finally { if (active === operation) active = null; }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void reconcile(); }, 1000);
    };
    const visibility = () => { if (document.visibilityState === 'visible') schedule(); else active?.abort(); };
    window.addEventListener('online', schedule); window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', visibility); schedule();
    return () => {
      lifetime.abort(); active?.abort(); if (timer) clearTimeout(timer); store.close();
      window.removeEventListener('online', schedule); window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [ownerId, generation, dataPlane]);
  return null;
}
