import { syncScopeKey, type SyncScope } from './reconcile';
import type { NativePhotoRunStatus } from './nativePhotoRunProgress';

export type SyncStartupOutcome = 'checking' | 'running' | 'waiting' | 'complete' | 'paused' | 'error' | 'unavailable';
type Identity = { ownerId: string; origin: string; generation: number };
export const SYNC_STARTUP_STARTED_EVENT = 'tt:sync-startup-started';
export type SyncStartupSnapshot = Identity & { discovering: boolean; pendingLocalIntents: number | null; devices: readonly Omit<SyncScope, 'rootId'>[]; entries: readonly { scope: SyncScope; outcome: SyncStartupOutcome }[] };

/** Presentation receipts from the existing runner, never execution authority or
 * another scheduler. A discarded identity/pass cannot publish or announce. */
export function createSyncStartup() {
 let snapshot: SyncStartupSnapshot | null = null;
 let pass = 0, announced: string | undefined;
 const listeners = new Set<() => void>();
 const publish = () => { for (const listener of listeners) listener(); };
 const identityKey = (identity: Identity) => JSON.stringify([identity.ownerId, identity.origin, identity.generation]);
 return {
  read: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  begin(identity: Identity) {
   const current = ++pass;
   snapshot = { ...identity, discovering: true, pendingLocalIntents: 0, devices: [], entries: [] }; publish();
   return {
    pendingIntents(count: number | null) {
     if (current === pass && snapshot) { snapshot = { ...snapshot, pendingLocalIntents: count }; publish(); }
    },
    checking(scope: Omit<SyncScope, 'rootId'>) {
     if (current !== pass || !snapshot || scope.ownerId !== identity.ownerId || scope.dataPlane !== 'home') return;
     if (!snapshot.devices.some(device => device.origin === scope.origin && device.deviceId === scope.deviceId)) {
      snapshot = { ...snapshot, devices: [...snapshot.devices, scope] }; publish();
     }
    },
    finishDiscovery() {
     if (current === pass && snapshot) { snapshot = { ...snapshot, discovering: false }; publish(); }
    },
    failDiscovery() {
     if (current !== pass || !snapshot) return;
     snapshot = { ...snapshot, discovering: false, entries: snapshot.devices.map(device => ({ scope: { ...device, rootId: 'sync-startup-discovery' }, outcome: 'error' as const })) }; publish();
    },
    observe(scope: SyncScope, outcome: SyncStartupOutcome) {
     if (current !== pass || !snapshot || scope.ownerId !== identity.ownerId || scope.dataPlane !== 'home') return;
     const key = syncScopeKey(scope);
     snapshot = { ...snapshot, entries: [...snapshot.entries.filter(entry => syncScopeKey(entry.scope) !== key), { scope: { ...scope }, outcome }] };
     publish();
    },
    ignore(scope: SyncScope) {
     if (current !== pass || !snapshot) return;
     snapshot = { ...snapshot, entries: snapshot.entries.filter(entry => syncScopeKey(entry.scope) !== syncScopeKey(scope)) }; publish();
    },
    announce() {
     if (current !== pass || snapshot?.discovering || snapshot?.pendingLocalIntents !== 0 || !snapshot?.entries.length || snapshot.entries.some(entry => !['running', 'waiting', 'complete'].includes(entry.outcome)) ||
      !snapshot.entries.some(entry => ['running', 'waiting'].includes(entry.outcome)) || announced === identityKey(identity)) return false;
     announced = identityKey(identity); return true;
    }
   };
  },
  clear(identity: Identity) {
   if (snapshot && identityKey(snapshot) === identityKey(identity)) { ++pass; snapshot = null; publish(); }
  },
  activate(identity: Identity) {
   if (announced === identityKey(identity)) announced = undefined;
  }
 };
}
export const syncStartup = createSyncStartup();
export function photoStartupOutcome(status: NativePhotoRunStatus | undefined, foregroundStart = false): SyncStartupOutcome {
 if (foregroundStart) {
  if (!status?.wake) return 'unavailable';
  if (status.wake.status === 'refused') return 'error';
  return status.wake.status === 'waiting' ? 'waiting' : 'running';
 }
 const progress = status?.photoRunProgress;
 if (!progress || progress.stage === 'needs-review') return 'error';
 if (progress.continuation === 'held' || progress.stage === 'paused') return 'paused';
 if (progress.stage === 'waiting') return 'waiting';
 return progress.stage === 'complete' ? 'complete' : 'running';
}
export function syncStartupMessage(snapshot: SyncStartupSnapshot | null, scope: Omit<SyncScope, 'rootId'>, generation: number, rendererOrigin = scope.origin): string {
 if (!snapshot || snapshot.ownerId !== scope.ownerId || snapshot.origin !== rendererOrigin || snapshot.generation !== generation || scope.dataPlane !== 'home') return '';
 const entries = snapshot.entries.filter(entry => entry.scope.origin === scope.origin && entry.scope.deviceId === scope.deviceId);
 const running = entries.some(entry => entry.outcome === 'running');
 if (entries.some(entry => entry.outcome === 'error')) return running ? 'Sync is in progress. Some configs need attention below.' : 'Some sync configs need attention. Check their details below.';
 if (entries.some(entry => entry.outcome === 'unavailable')) return running ? 'Sync is in progress. Automatic startup is unavailable for some configs.' : 'Update Thingtime on this device to start all sync configs automatically.';
 if (running) return 'Sync is in progress';
 if (entries.some(entry => entry.outcome === 'checking')) return 'Checking automatic sync…';
 if (entries.some(entry => entry.outcome === 'waiting')) return 'Sync is waiting for saved conditions.';
 if (snapshot.discovering && snapshot.devices.some(device => device.origin === scope.origin && device.deviceId === scope.deviceId)) return 'Sync is in progress — checking saved configs';
 return '';
}
