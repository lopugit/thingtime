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
