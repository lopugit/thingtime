import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceSyncHistoryAggregation } from '../../fileSync/deviceSyncHistory';
import type { SyncResourceStatus } from '../../fileSync/resourceGovernor';
import { deviceResourceHistoryDisplay, liveDeviceResourceDisplay } from './deviceSyncResourceDisplay';

const measuredAt = 100_000;
const resources: SyncResourceStatus = {
 version: 1, measuredAt, currentUploadBytesPerSecond: 125_000, currentDownloadBytesPerSecond: 62_500,
 scanBytesPerSecond: 62_500, cpuPercent: 3, cpuStatus: 'measured', effectiveTransferConcurrency: 1, effectiveIndexingConcurrency: 1
};
test('remote live sample remains current across the status cadence, but a late or disconnected sample is marked stale', () => {
 const input = { resources, active: true, online: true, observedAt: measuredAt + 100, receivedAt: measuredAt + 100, remote: true, now: measuredAt + 9_000 };
 assert.equal(liveDeviceResourceDisplay(input).sampleCurrent, true);
 assert.equal(liveDeviceResourceDisplay(input).transfer, 1.5);
 for (const stale of [{ ...input, observedAt: measuredAt + 5_000 }, { ...input, online: false }, { ...input, now: measuredAt + 15_101 }]) {
  assert.equal(liveDeviceResourceDisplay(stale).stale, true);
  assert.equal(liveDeviceResourceDisplay(stale).transfer, 1.5);
 }
});
test('remote liveness uses viewer receipt age across positive and negative source clock skew', () => {
 for (const offset of [-3_600_000, 3_600_000]) {
  const receivedAt = 7_200_000;
  const observedAt = receivedAt + offset;
  const input = { resources: { ...resources, measuredAt: observedAt - 500 }, active: true, online: true, observedAt, receivedAt, remote: true, now: receivedAt + 10_000 };
  const live = liveDeviceResourceDisplay(input);
  assert.equal(live.sampleCurrent, true);
  assert.equal(live.measurementAt, observedAt - 500);
  assert.equal(live.sampleExpiry, receivedAt + 14_500);
  assert.equal(liveDeviceResourceDisplay({ ...input, now: receivedAt + 14_501 }).stale, true);
  assert.equal(liveDeviceResourceDisplay({ ...input, active: false }).idle, true);
  assert.equal(liveDeviceResourceDisplay({ ...input, active: false, now: receivedAt + 15_001 }).idle, false);
  assert.equal(liveDeviceResourceDisplay({ ...input, resources: { ...resources, measuredAt: observedAt - 3_000 } }).stale, true);
 }
});
test('confirmed idle resets completed throughput without converting missing CPU into measured zero', () => {
 const input = { resources, active: false, online: true, observedAt: measuredAt + 5_000, remote: false, now: measuredAt + 5_100 };
 const idle = liveDeviceResourceDisplay(input);
 assert.equal(idle.idle, true);
 assert.equal(idle.transfer, 0);
 assert.equal(idle.scan, 0);
 assert.equal(idle.cpu, 3);
 assert.equal(idle.lastNative, true, 'idle retains the explicitly historical CPU reading');
 assert.equal(liveDeviceResourceDisplay({ ...input, resources: undefined, online: false }).transfer, null);
});
test('historical measured zero and absent intervals have distinct coverage and chart marks', () => {
 const aggregate = createDeviceSyncHistoryAggregation({ from: 1000, to: 5000, bucketCount: 4 });
 aggregate.add({ at: 1000, status: 'running', uploadMbps: 0, downloadMbps: 2, scanMbps: null, cpuPercent: null, memoryBytes: null });
 aggregate.add({ at: 3000, status: 'running', uploadMbps: 1, downloadMbps: 0, scanMbps: null, cpuPercent: null, memoryBytes: 2 ** 20 });
 const display = deviceResourceHistoryDisplay(aggregate.result());
 assert.equal(display.sampleCount, 2);
 assert.deepEqual(display.series.uploadMbps.bars.map(b => [b.missing, b.height]), [[false, '0%'], [true, '0%'], [false, '100%'], [true, '0%']]);
 assert.equal(display.series.uploadMbps.coverage, '2 of 4 intervals · 2 readings');
 assert.equal(display.series.scanMbps.peak, 'Unavailable');
 assert.equal(display.series.memoryBytes.peak, '1 MiB');
});
