import test from 'node:test';
import assert from 'node:assert/strict';
import { syncConnectionGlance } from './connectionGlance';
import { emptySyncDirections, addSyncDirection, formatSyncBytes, parseSyncDirections } from './directionalProgress';
import type { SyncOperation } from './execute';
const operation = (from: 'local' | 'remote', size: number, confirmed = false, kind: 'file' | 'folder' = 'file'): SyncOperation => ({ id: from + size, confirmed, mutation: { kind: 'copy', from, path: 'entry', source: { id: 'entry', path: 'entry', version: 'one', kind, size, sha256: null }, expectedTarget: null } });
test('directions separate payload plans and metadata operations; exact aggregate bytes exceed safe Number totals', () => {
 const d = emptySyncDirections(); addSyncDirection(d, operation('local', Number.MAX_SAFE_INTEGER, true)); addSyncDirection(d, operation('local', Number.MAX_SAFE_INTEGER)); addSyncDirection(d, operation('remote', 1));
 assert.equal(d.upload.bytesTotal, '18014398509481982'); assert.equal(d.upload.bytesConfirmed, String(Number.MAX_SAFE_INTEGER)); assert.equal(d.download.bytesTotal, '1');
 assert.ok(formatSyncBytes(d.upload.bytesTotal).endsWith('PiB'));
 const parsed = parseSyncDirections({ ...d, privateExtra: 'never-project' }); assert.equal('privateExtra' in parsed, false);
});
test('growing totals and pending folder operations never show false completion', () => {
 const d = emptySyncDirections(); addSyncDirection(d, operation('local', 100, true)); addSyncDirection(d, operation('local', 0, false, 'folder'));
 const state = { progress: { stage: 'transferring' as const, total: 2, confirmed: 1, directions: d, totalFinal: false }, online: true, active: true, paused: false };
 let view = syncConnectionGlance(state); assert.equal(view.upload.percent, 99.9); assert.match(view.upload.progress, /still growing/); assert.match(view.upload.operations, /1 \/ 2/);
 view = syncConnectionGlance({ ...state, progress: { ...state.progress, totalFinal: true } }); assert.equal(view.upload.percent, 99.9);
});
test('paused totals remain while speed becomes zero, offline never repeats a cached nonzero rate', () => {
 const d = emptySyncDirections(); addSyncDirection(d, operation('remote', 1000));
 const rates = { upload: { status: 'known' as const, value: 4, unit: 'Mbps' as const, requestedWindowMs: 1000, observedDurationMs: 1000 }, download: { status: 'known' as const, value: 2, unit: 'Mbps' as const, requestedWindowMs: 1000, observedDurationMs: 1000 } };
 const state = { progress: { stage: 'transferring' as const, total: 1, confirmed: 0, directions: d, totalFinal: true }, online: true, active: true, paused: false, rates };
 assert.match(syncConnectionGlance(state).download.rate, /2 Mbps live/);
 assert.match(syncConnectionGlance({ ...state, active: false, paused: true }).download.rate, /^0 Mbps/);
 const offline = syncConnectionGlance({ ...state, online: false }); assert.match(offline.download.rate, /Unavailable/); assert.match(offline.download.remaining, /1,?000 B/);
});
test('unfenced file callbacks cannot inflate durable percentages or double-count a receipt', () => {
 const d = emptySyncDirections(); addSyncDirection(d, operation('local', 1000)); addSyncDirection(d, operation('remote', 1000));
 const view = syncConnectionGlance({ progress: { stage: 'transferring', total: 2, confirmed: 0, directions: d, totalFinal: true, direction: 'upload', bytes: 500, size: 1000 }, online: true, active: true, paused: false });
 assert.equal(view.upload.percent, 0); assert.equal(view.download.percent, 0); assert.equal(view.upload.inflight, ''); assert.match(view.upload.bytes, /0 B confirmed/);
});

test('folder-only and empty directional lanes distinguish pending work from no work', () => {
 const d = emptySyncDirections(); addSyncDirection(d, operation('local', 0, false, 'folder'));
 const input = { progress: { stage: 'transferring' as const, confirmed: 0, total: 1, directions: d, totalFinal: true }, online: true, active: true, paused: false };
 const value = syncConnectionGlance(input); assert.equal(value.upload.percent, 0); assert.match(value.upload.operations, /0 \/ 1/); assert.match(value.download.progress, /No work/);
 d.upload.confirmed = 1; const late = syncConnectionGlance({ ...input, progress: { ...input.progress, directions: d, direction: 'upload', bytes: 999, size: 999 } }); assert.equal(late.upload.percent, 100); assert.equal(late.upload.inflight, '');
});

test('a Photos backup has no download meter and starts measuring upload only when bytes are expected', () => {
 const state = { mode: 'backup' as const, active: true, paused: false, online: true };
 const scanning = syncConnectionGlance({ ...state, progress: { stage: 'scanning', total: 0, confirmed: 0 } });
 assert.equal(scanning.download.rate, 'Off for this sync config');
 assert.equal(scanning.download.unknown, true);
 assert.equal(scanning.upload.rate, '—');
 const directions = emptySyncDirections(); addSyncDirection(directions, operation('local', 1000));
 const transferring = syncConnectionGlance({ ...state, progress: { stage: 'transferring', total: 1, confirmed: 0, directions } });
 assert.equal(transferring.upload.rate, 'Measuring live speed…');
 assert.equal(transferring.download.rate, 'Off for this sync config');
});

test('fetching an iCloud original does not measure upload throughput or mark its plan complete', () => {
 const directions = emptySyncDirections(); addSyncDirection(directions, operation('local', 1000, true));
 const view = syncConnectionGlance({ mode: 'backup', preparing: true, online: true, active: true, paused: false,
  progress: { stage: 'transferring', direction: 'upload', total: 1, confirmed: 1, directions, totalFinal: true } });
 assert.equal(view.upload.rate, '—');
 assert.notEqual(view.upload.percent, 100);
 assert.equal(view.download.rate, 'Off for this sync config');
});
