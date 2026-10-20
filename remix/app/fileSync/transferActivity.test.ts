import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferActivitySession } from './transferActivity';

test('live counters isolate directions, exclude paused time and retain explicit unavailable bytes', () => {
	let now = 0; const session = createTransferActivitySession({ now: () => now });
	const read = (direction: 'upload' | 'download', unit: 'Mbps' | 'INodes/ps' = 'Mbps') => session.series.read({ direction, unit, windowMs: 1000 });
	assert.equal(read('upload').status, 'paused');
	session.stage('transferring'); now = 1000;
	session.add({ direction: 'upload', bytes: 125000 });
	session.add({ direction: 'download', kind: 'file' }); session.add({ direction: 'download', kind: 'folder' });
	assert.deepEqual(read('upload'), { status: 'known', value: 1, unit: 'Mbps', requestedWindowMs: 1000, observedDurationMs: 1000 });
	assert.equal(read('download', 'INodes/ps').status, 'known');
	session.add({ direction: 'download', bytes: null });
	assert.equal(read('download').status, 'unknown');
	session.stage('verifying'); now = 100000; assert.equal(read('upload').status, 'paused');
	session.stage('transferring'); now += 1000;
	const idle = read('upload'); assert.equal(idle.status, 'known'); if (idle.status === 'known') assert.equal(idle.value, 0);
	assert.equal(read('download').status, 'unknown');
	session.clear(); assert.equal(read('upload').status, 'paused');
});

test('unsafe byte deltas cannot change a valid cumulative rate', () => {
	let now = 0; const session = createTransferActivitySession({ now: () => now }); session.stage('transferring');
	for (const bytes of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => session.add({ direction: 'upload', bytes }));
	now = 1000;
	const read = session.series.read({ direction: 'upload', unit: 'Mbps', windowMs: 1000 });
	assert.equal(read.status, 'known'); if (read.status === 'known') assert.equal(read.value, 0);
});

test('unknown byte periods recover per direction without counting their first unmeasured sample', () => {
 let now = 0; const session = createTransferActivitySession({ now: () => now }); session.stage('transferring');
 const read = (direction: 'upload' | 'download', unit: 'Mbps' | 'INodes/ps' = 'Mbps') => session.series.read({ direction, unit, windowMs: 10000 });
 session.add({ direction: 'upload', bytes: null });
 now = 1000; session.add({ direction: 'download', bytes: 125000 }); session.add({ direction: 'upload', kind: 'file' });
 now = 2000; session.add({ direction: 'upload', bytes: 32 * 1024 * 1024 });
 assert.equal(read('upload').status, 'unknown', 'Completion cannot assign the first 32 MiB to zero elapsed time');
 now = 3000; session.add({ direction: 'upload', bytes: 125000 });
 const upload = read('upload'); assert.equal(upload.status, 'known');
 if (upload.status === 'known') { assert.equal(upload.value, 1); assert.equal(upload.observedDurationMs, 1000); }
 const download = read('download'); assert.equal(download.status, 'known');
 if (download.status === 'known') assert.equal(download.observedDurationMs, 3000);
 const entries = read('upload', 'INodes/ps'); assert.equal(entries.status, 'known');
 if (entries.status === 'known') assert.equal(entries.value, 1 / 3);
 session.add({ direction: 'upload', bytes: null }); now = 5000;
 session.add({ direction: 'upload', bytes: 0 }); now = 6000; session.add({ direction: 'upload', bytes: 125000 });
 const recovered = read('upload'); assert.equal(recovered.status, 'known');
 if (recovered.status === 'known') { assert.equal(recovered.value, 1); assert.equal(recovered.observedDurationMs, 1000); }
 session.stage('verifying'); now = 100000; session.stage('transferring'); now += 1000;
 const resumed = read('upload'); assert.equal(resumed.status, 'known');
 if (resumed.status === 'known') { assert.equal(resumed.value, 0); assert.equal(resumed.observedDurationMs, 1000); }
});
