import type { FileSyncResourceLimits } from './configuration';
import { SyncResourceGovernor } from './resourceGovernor';

export type DeviceSyncResourcePolicy = { transferBytesPerSecond: number; scanBytesPerSecond: number; cpuPercent: number };
export const DEFAULT_DEVICE_SYNC_RESOURCES: Readonly<DeviceSyncResourcePolicy> = Object.freeze({ transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 });
export const deviceResourceKey = (origin: string, ownerId: string, deviceId: string) => JSON.stringify([origin, ownerId, deviceId]);
export function parseDeviceSyncResourcePolicy(value: unknown): DeviceSyncResourcePolicy {
 const p = value as DeviceSyncResourcePolicy;
 if (!p || ![p.transferBytesPerSecond, p.scanBytesPerSecond].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(p.cpuPercent) || p.cpuPercent < 1 || p.cpuPercent > 100) throw Error('Enter positive transfer and scan speeds and a CPU target from 1 to 100.');
 return { transferBytesPerSecond: p.transferBytesPerSecond, scanBytesPerSecond: p.scanBytesPerSecond, cpuPercent: p.cpuPercent };
}
const policies = new Map<string, DeviceSyncResourcePolicy>(), budgets = new Map<string, SyncResourceGovernor>(), listeners = new Set<() => void>();
const storageKey = (key: string) => 'tt-device-sync-resources-v1:' + key;
export function readDeviceSyncResourcePolicy(key: string): DeviceSyncResourcePolicy {
 let policy = policies.get(key); if (policy) return policy;
 try { const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey(key)); if (saved) policy = parseDeviceSyncResourcePolicy(JSON.parse(saved)); } catch { /* Invalid private preferences use the conservative defaults. */ }
 policy ??= { ...DEFAULT_DEVICE_SYNC_RESOURCES }; policies.set(key, policy); return policy;
}
export function saveDeviceSyncResourcePolicy(key: string, value: DeviceSyncResourcePolicy) {
 const policy = parseDeviceSyncResourcePolicy(value);
 if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(key), JSON.stringify(policy));
 policies.set(key, policy); for (const listener of listeners) listener();
}
export function subscribeDeviceSyncResourcePolicy(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** One app-owned budget survives connection switches; total upload + download is shared. */
export function deviceSyncGovernor(key: string, connection?: FileSyncResourceLimits) {
 let shared = budgets.get(key);
 if (!shared) { shared = new SyncResourceGovernor({}, undefined, undefined, undefined, () => readDeviceSyncResourcePolicy(key).transferBytesPerSecond); budgets.set(key, shared); }
 const policy = readDeviceSyncResourcePolicy(key);
 return new SyncResourceGovernor({ ...connection, cpuPercent: Math.min(connection?.cpuPercent ?? 100, policy.cpuPercent) }, undefined, undefined, shared);
}
