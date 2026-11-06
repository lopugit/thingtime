import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEVICE_SYNC_RESOURCES, deviceResourceKey, parseDeviceSyncResourcePolicy, readDeviceSyncResourcePolicy, saveDeviceSyncResourcePolicy } from './deviceResourcePolicy';
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
