import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedSyncActivityPage, syncActivityBytesLabel, syncActivitySummary } from './SyncConfigActivity';
import type { SyncActivityRecord } from '~/fileSync/syncActivityJournal';

const record = (id: string, endedAt: number, sentBytes: number | null, receivedBytes: number | null): SyncActivityRecord => ({
 id, startedAt: endedAt - 10, endedAt, lastActivityAt: endedAt, status: 'complete', sentBytes, receivedBytes
});

test('an unmeasured live attempt keeps the latest measured saved attempt separate', () => {
 const latest = record('latest', 30, null, null);
 const measured = record('measured', 20, 70_480_000, null);
 const older = record('older', 10, 1, 2);
 const live = { lastActivityAt: 40, sentBytes: null, receivedBytes: null };
 const summary = syncActivitySummary(live, [latest, measured, older]);
 assert.equal(summary.latest, live);
 assert.equal(summary.latestRecorded, undefined);
 assert.equal(summary.previousMeasured, measured, 'choose the newest measurement in loaded, descending history');
 assert.equal(syncActivityBytesLabel(summary.latest?.sentBytes ?? null), 'Unavailable');
 assert.equal(syncActivityBytesLabel(summary.previousMeasured?.sentBytes ?? null), '70.48 MB');
 assert.equal(syncActivityBytesLabel(summary.previousMeasured?.receivedBytes ?? null), 'Unavailable');
});

test('unknown stays unavailable, zero remains measured, and the latest saved row is not repeated', () => {
 const unknown = record('unknown', 30, null, null);
 assert.equal(syncActivitySummary({ lastActivityAt: 40, sentBytes: null, receivedBytes: null }, [unknown]).previousMeasured, undefined);
 assert.equal(syncActivitySummary(undefined, [unknown]).previousMeasured, undefined);
 const zero = record('zero', 20, 0, null);
 const summary = syncActivitySummary(undefined, [zero, unknown]);
 assert.equal(summary.latest, zero);
 assert.equal(summary.previousMeasured, undefined);
 assert.equal(syncActivityBytesLabel(summary.latest?.sentBytes ?? null), '0 B');
 assert.equal(syncActivitySummary(undefined, [unknown, zero]).previousMeasured, zero,
  'a later loaded page can provide an older measured attempt without making it current');
});

test('a changed account, origin, device or config identity synchronously hides retained history', () => {
 const saved = record('private', 20, 70_480_000, null);
 const page = { key: 'origin:owner:device:config:generation-1', records: [saved], next: null, ready: true, error: '' };
 assert.equal(scopedSyncActivityPage(page.key, page), page);
 for (const key of ['other-origin:owner:device:config:generation-1', 'origin:other-owner:device:config:generation-1',
  'origin:owner:other-device:config:generation-1', 'origin:owner:device:other-config:generation-1',
  'origin:owner:device:config:generation-2']) {
  const visible = scopedSyncActivityPage(key, page);
  assert.deepEqual({ records: visible.records, next: visible.next, ready: visible.ready, error: visible.error },
   { records: [], next: null, ready: false, error: '' });
  assert.equal(syncActivitySummary(undefined, visible.records).previousMeasured, undefined);
 }
});
