import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNativePhotoRunStatus } from './nativePhotoRunProgress';

const revision = '2026-11-11T00:00:00.000Z';
const progress = { stage: 'waiting', unavailableOriginals: 3,
 confirmed: { photos: 2, videos: 1, other: 0, wifiBytes: 200, mobileBytes: 0, unknownBytes: 0 } };

test('Photos reason telemetry is optional and keeps committed counters from older native versions', () => {
 const parsed = parseNativePhotoRunStatus(revision, progress).photoRunProgress!;
 assert.deepEqual(parsed.confirmed, progress.confirmed);
 assert.equal(parsed.unavailableReasons, undefined);
 const reasons = { 'cloud-download': 2, 'photo-read': 1 };
 assert.deepEqual(parseNativePhotoRunStatus(revision, { ...progress, unavailableReasons: reasons }).photoRunProgress?.unavailableReasons, reasons);
});

test('invalid additive Photos reason telemetry cannot discard a valid scoped run or invent counts', () => {
 for (const reasons of [null, [], {}, { 'cloud-download': 2 },
  { 'cloud-download': -1, 'photo-read': 4 }, { 'cloud-download': 2.5, 'photo-read': 0.5 },
  { 'cloud-download': 1, 'photo-read': 1 }, { 'cloud-download': 2, 'photo-read': 1, unknown: 4 }]) {
  const parsed = parseNativePhotoRunStatus(revision, { ...progress, unavailableReasons: reasons }).photoRunProgress!;
  assert.equal(parsed.unavailableReasons, undefined);
  assert.deepEqual(parsed.confirmed, progress.confirmed);
 }
 assert.equal(parseNativePhotoRunStatus(revision, { ...progress, unavailableOriginals: undefined,
  unavailableReasons: { 'cloud-download': 2, 'photo-read': 1 } }).photoRunProgress?.unavailableReasons, undefined);
 assert.throws(() => parseNativePhotoRunStatus(revision, { ...progress, configurationRevision: '2026-11-10T00:00:00Z' }));
});
