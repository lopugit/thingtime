import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeDeviceSyncGovernor, DEFAULT_DEVICE_SYNC_RESOURCES, deviceResourceKey, parseDeviceSyncResourcePolicy, readDeviceSyncResourcePolicy, saveDeviceSyncResourcePolicy } from './deviceResourcePolicy';
test('requested device defaults are decimal5Mbps and15percent; unset connection fields do not remove them', () => {
 assert.deepEqual(DEFAULT_DEVICE_SYNC_RESOURCES, { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 });
 const key = deviceResourceKey('https://one.example', 'owner-a', 'device-a');
 assert.deepEqual(readDeviceSyncResourcePolicy(key), DEFAULT_DEVICE_SYNC_RESOURCES);
 saveDeviceSyncResourcePolicy(key, { transferBytesPerSecond: 125000, scanBytesPerSecond: 250000, cpuPercent: 5 });
 assert.equal(readDeviceSyncResourcePolicy(key).cpuPercent, 5);
 for (const other of [deviceResourceKey('https://two.example', 'owner-a', 'device-a'), deviceResourceKey('https://one.example', 'owner-b', 'device-a'), deviceResourceKey('https://one.example', 'owner-a', 'device-b')]) assert.equal(readDeviceSyncResourcePolicy(other).cpuPercent, 15);
});
test('zero and malformed budgets are rejected rather than interpreted as unlimited', () => {
 for (const changed of [{ transferBytesPerSecond: 0 }, { scanBytesPerSecond: Infinity }, { cpuPercent: 0 }, { cpuPercent: 1.5 }, { cpuPercent: 101 }]) assert.throws(() => parseDeviceSyncResourcePolicy({ ...DEFAULT_DEVICE_SYNC_RESOURCES, ...changed }));
});

test('iOS without native resource capability starts legacy backups but refuses explicit saved limits', () => {
 const key = deviceResourceKey('https://ios.example', 'owner', 'device');
 assert.equal(nativeDeviceSyncGovernor(key, false), undefined);
 const limits = { cpuPercent: 15, uploadBytesPerSecond: 5000000 };
 assert.throws(() => nativeDeviceSyncGovernor(key, false, limits), /Update Thingtime/);
 assert.deepEqual(limits, { cpuPercent: 15, uploadBytesPerSecond: 5000000 });
 assert.ok(nativeDeviceSyncGovernor(key, true, limits));
 assert.ok(nativeDeviceSyncGovernor(key, true));
});

test('unsupported iOS refuses explicitly saved device limits in memory and on reload', () => {
 const current = deviceResourceKey('https://ios.example', 'owner', 'current');
 const reloaded = deviceResourceKey('https://ios.example', 'owner', 'reloaded');
 const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
 const store = new Map<string, string>();
 Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value)
 } });
 try {
  readDeviceSyncResourcePolicy(current);
  assert.equal(nativeDeviceSyncGovernor(current, false), undefined);
  const limits = { transferBytesPerSecond: 5000000, scanBytesPerSecond: 5000000, cpuPercent: 15 };
  saveDeviceSyncResourcePolicy(current, limits);
  assert.throws(() => nativeDeviceSyncGovernor(current, false), /Update Thingtime/);
  const raw = store.get('tt-device-sync-resources-v1:' + current)!;
  store.set('tt-device-sync-resources-v1:' + reloaded, raw);
  assert.throws(() => nativeDeviceSyncGovernor(reloaded, false), /Update Thingtime/);
  assert.equal(store.get('tt-device-sync-resources-v1:' + reloaded), raw);
  assert.deepEqual(readDeviceSyncResourcePolicy(reloaded), limits);
  assert.ok(nativeDeviceSyncGovernor(reloaded, true));
  store.clear();
  assert.throws(() => nativeDeviceSyncGovernor(current, false), /Update Thingtime/);
 } finally {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
  else Reflect.deleteProperty(globalThis, 'localStorage');
 }
});
