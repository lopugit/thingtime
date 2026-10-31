import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_TRANSFER_WINDOW_MS, TransferSpeedCounterError, TransferSpeedSeries, toWindowMs,
	validateWindowMs, type TransferCounters,
} from './transferSpeed';

const counters = (values: Partial<Record<'upload' | 'download', Partial<TransferCounters['upload']>>> = {}): TransferCounters => ({
	upload: { bytes: 0, files: 0, folders: 0, ...values.upload },
	download: { bytes: 0, files: 0, folders: 0, ...values.download },
});
const knownValue = (reading: ReturnType<TransferSpeedSeries['read']>) => {
	assert.equal(reading.status, 'known');
	if (reading.status !== 'known') throw new Error('Expected a known rate.');
	return reading.value;
};
const unknownReason = (reading: ReturnType<TransferSpeedSeries['read']>) => {
	assert.equal(reading.status, 'unknown');
	if (reading.status !== 'unknown') throw new Error('Expected an unknown rate.');
	return reading.reason;
};

test('calculates decimal bit rates independently per direction', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now = 1_000;
	series.observe(counters({ upload: { bytes: 1_000_000, files: 0, folders: 0 }, download: { bytes: 500_000, files: 0, folders: 0 } }));
	assert.deepEqual(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 }), {
		status: 'known', value: 8_000, unit: 'Kbps', requestedWindowMs: 1_000, observedDurationMs: 1_000,
	});
	assert.equal(knownValue(series.read({ direction: 'download', unit: 'Mbps', windowMs: 1_000 })), 4);
	assert.ok(Math.abs(knownValue(series.read({ direction: 'upload', unit: 'Gbps', windowMs: 1_000 })) - 0.008) < 1e-12);
});

test('counts only supplied successful files and folders; INodes means logical entries', () => {
	let now = 100;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now += 2_000;
	series.observe(counters({ upload: { bytes: 0, files: 4, folders: 2 } }));
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Files/ps', windowMs: 2_000 })), 2);
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Folders/ps', windowMs: 2_000 })), 1);
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'INodes/ps', windowMs: 2_000 })), 3);
});

test('returns unknown until a baseline and positive elapsed time exist, then reports measured idle as zero', () => {
	let now = 10;
	const series = new TransferSpeedSeries({ now: () => now });
	assert.equal(unknownReason(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 'no-baseline');
	series.observe(counters());
	assert.equal(unknownReason(series.read({ direction: 'upload', unit: 'Files/ps', windowMs: 1_000 })), 'insufficient-duration');
	now += 1_000;
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 0);
});

test('materializes active idle time on read, including after a long unmounted interval', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now = 1_000;
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 0);
	now = 30 * 60 * 60 * 1_000;
	const reading = series.read({ direction: 'upload', unit: 'Files/ps', windowMs: MAX_TRANSFER_WINDOW_MS });
	assert.deepEqual({ status: reading.status, value: reading.status === 'known' ? reading.value : undefined }, { status: 'known', value: 0 });
	assert.ok((series as unknown as { samples: unknown[] }).samples.length <= 86_402);
});

test('coalesces observations faster than 1Hz without losing the next cumulative delta', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now = 500;
	series.observe(counters({ upload: { bytes: 500, files: 0, folders: 0 } }));
	now = 1_000;
	series.observe(counters({ upload: { bytes: 1_000, files: 0, folders: 0 } }));
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 8);
});

test('uses irregular observed duration and large bigint counters without unsafe integer subtraction', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	const start = BigInt('9007199254740993');
	series.observe(counters({ upload: { bytes: start, files: 0, folders: 0 } }));
	now = 1_500;
	series.observe(counters({ upload: { bytes: start + BigInt(3_000_000), files: 0, folders: 0 } }));
	const reading = series.read({ direction: 'upload', unit: 'Mbps', windowMs: 2_000 });
	assert.equal(reading.status, 'known');
	if (reading.status === 'known') {
		assert.equal(reading.observedDurationMs, 1_500);
		assert.equal(reading.value, 16);
	}
});

test('interpolates cumulative baselines at rolling-window boundaries', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now = 1_000;
	series.observe(counters({ upload: { bytes: 1_000, files: 0, folders: 0 } }));
	now = 1_500;
	const oneSecond = series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 });
	assert.equal(oneSecond.status, 'known');
	if (oneSecond.status === 'known') {
		assert.equal(oneSecond.observedDurationMs, 1_000);
		assert.equal(oneSecond.value, 4);
	}
	const oneAndHalfSeconds = series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_500 });
	assert.equal(oneAndHalfSeconds.status, 'known');
	if (oneAndHalfSeconds.status === 'known') {
		assert.equal(oneAndHalfSeconds.observedDurationMs, 1_500);
		assert.ok(Math.abs(oneAndHalfSeconds.value - (8_000 / 1_500)) < 1e-12);
	}
});

test('keeps file and folder rates available when byte progress is unavailable', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters({ upload: { bytes: null, files: 0, folders: 0 } }));
	now = 1_000;
	series.observe(counters({ upload: { bytes: null, files: 2, folders: 0 } }));
	assert.equal(unknownReason(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 'unavailable');
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Files/ps', windowMs: 1_000 })), 2);
});

test('rejects decreases without corrupting history; reset starts a separate run', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters({ upload: { bytes: 100, files: 1, folders: 0 } }));
	now = 1_000;
	assert.throws(() => series.observe(counters({ upload: { bytes: 99, files: 1, folders: 0 } })), TransferSpeedCounterError);
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 0);
	series.reset();
	series.observe(counters());
	assert.equal(unknownReason(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 'insufficient-duration');
});

test('pause/resume reports paused and rebases so downtime is excluded', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	series.observe(counters());
	now = 1_000;
	series.observe(counters({ upload: { bytes: 1_000, files: 0, folders: 0 } }));
	series.pause();
	now = 20_000;
	assert.equal(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 }).status, 'paused');
	series.observe(counters({ upload: { bytes: 5_000, files: 0, folders: 0 } }));
	series.resume();
	now = 21_000;
	series.observe(counters({ upload: { bytes: 5_000, files: 0, folders: 0 } }));
	assert.equal(knownValue(series.read({ direction: 'upload', unit: 'Kbps', windowMs: 1_000 })), 0);
});

test('validates user windows and rounds converted custom durations', () => {
	assert.equal(toWindowMs(1.25, 'seconds'), 1_250);
	assert.equal(toWindowMs(1.5, 'minutes'), 90_000);
	assert.equal(toWindowMs(24, 'hours'), MAX_TRANSFER_WINDOW_MS);
	assert.throws(() => toWindowMs(0.5, 'seconds'), RangeError);
	assert.throws(() => validateWindowMs(MAX_TRANSFER_WINDOW_MS + 1), RangeError);
	assert.throws(() => validateWindowMs(1_000.5), RangeError);
});

test('retains no more than one sample per second across the 24-hour bound', () => {
	let now = 0;
	const series = new TransferSpeedSeries({ now: () => now });
	for (let i = 0; i <= 86_403; i++) {
		series.observe(counters({ upload: { bytes: i, files: 0, folders: 0 } }));
		now += 1_000;
	}
	const retained = (series as unknown as { samples: unknown[] }).samples;
	assert.ok(retained.length <= 86_402);
	assert.ok(retained.length >= 86_400);
	const rate = series.read({ direction: 'upload', unit: 'Files/ps', windowMs: MAX_TRANSFER_WINDOW_MS });
	assert.equal(rate.status, 'known');
});

test('subsecond known coverage starts at its own baseline and excludes earlier unknown samples', () => {
 let now = 0; const series = new TransferSpeedSeries({ now: () => now });
 const read = (windowMs = 10000) => series.read({ direction: 'upload', unit: 'Mbps', windowMs });
 series.observe(counters({ upload: { bytes: null } }));
 now = 100; series.observe(counters({ upload: { bytes: 32 * 1024 * 1024 } }));
 assert.equal(unknownReason(read()), 'insufficient-duration');
 now = 150; series.observe(counters({ upload: { bytes: 32 * 1024 * 1024 + 6250 } }));
 assert.equal(knownValue(read()), 1);
 assert.equal(read().observedDurationMs, 50);
 now = 1200;
 // The requested window crosses the unknown period, so only known coverage counts.
 assert.equal(read().observedDurationMs, 1100);
 now = 2500;
 assert.equal(read(1000).observedDurationMs, 1000);
 assert.equal(knownValue(read(1000)), 0, 'Old acknowledgment ages out rather than becoming an ongoing wire rate');
});

test('repeated unknown episodes and pause resume preserve other-direction and inode histories', () => {
 let now = 0; const series = new TransferSpeedSeries({ now: () => now });
 const observe = (bytes: number | null, files: number, downloaded: number) => series.observe(counters({ upload: { bytes, files }, download: { bytes: downloaded } }));
 const read = (direction: 'upload' | 'download', unit: 'Mbps' | 'INodes/ps' = 'Mbps') => series.read({ direction, unit, windowMs: 10000 });
 observe(0, 0, 0); now = 1000; observe(null, 1, 125000);
 now = 1500; observe(0, 1, 125000); now = 2000; observe(62500, 2, 250000);
 assert.equal(knownValue(read('upload')), 1); assert.equal(read('upload').observedDurationMs, 500);
 assert.equal(knownValue(read('download')), 1); assert.equal(knownValue(read('upload', 'INodes/ps')), 1);
 now = 2500; observe(null, 2, 250000); assert.equal(unknownReason(read('upload')), 'unavailable');
 now = 3000; observe(0, 2, 375000); now = 4000; observe(125000, 3, 500000);
 assert.equal(knownValue(read('upload')), 1); assert.equal(read('upload').observedDurationMs, 1000);
 assert.equal(read('download').observedDurationMs, 4000);
 series.pause(); now = 100000; series.resume();
 assert.equal(unknownReason(read('upload')), 'insufficient-duration');
 now += 1000; assert.equal(knownValue(read('upload')), 0); assert.equal(read('upload').observedDurationMs, 1000);
});
