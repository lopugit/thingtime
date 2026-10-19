export type TransferDirection = 'upload' | 'download';
export type TransferUnit = 'Kbps' | 'Mbps' | 'Gbps' | 'Folders/ps' | 'Files/ps' | 'INodes/ps';
export type TransferCounterValue = number | bigint;
export type TransferDirectionCounters = {
	/** Null means the transport does not expose byte progress for this direction. */
	bytes: TransferCounterValue | null;
	files: TransferCounterValue;
	folders: TransferCounterValue;
};
export type TransferCounters = Record<TransferDirection, TransferDirectionCounters>;
export type TransferWindowUnit = 'seconds' | 'minutes' | 'hours';
export type SpeedReading =
	| { status: 'known'; value: number; unit: TransferUnit; requestedWindowMs: number; observedDurationMs: number }
	| { status: 'unknown'; reason: 'no-baseline' | 'insufficient-duration' | 'unavailable'; requestedWindowMs: number; observedDurationMs: number }
	| { status: 'paused'; requestedWindowMs: number; observedDurationMs: number };

export const MIN_TRANSFER_WINDOW_MS = 1_000;
export const MAX_TRANSFER_WINDOW_MS = 86_400_000;
const MAX_SAMPLES = 86_402;
const SAMPLE_INTERVAL_MS = 1_000;
const UNITS: readonly TransferUnit[] = ['Kbps', 'Mbps', 'Gbps', 'Folders/ps', 'Files/ps', 'INodes/ps'];
const COUNTER_FIELDS = ['bytes', 'files', 'folders'] as const;
type CounterField = typeof COUNTER_FIELDS[number];
type Sample = { at: number; counters: TransferCounters };

export class TransferSpeedCounterError extends RangeError {
	constructor(readonly direction: TransferDirection, readonly field: CounterField) {
		super(`Cumulative ${direction} ${field} decreased; reset the transfer series before observing a new run.`);
		this.name = 'TransferSpeedCounterError';
	}
}

function readCounter(value: TransferCounterValue | null, label: string): bigint | null {
	if (value === null) return null;
	if (typeof value === 'bigint') {
		if (value < BigInt(0)) throw new RangeError(`${label} must not be negative.`);
		return value;
	}
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer or bigint.`);
	return BigInt(value);
}

function copyCounters(value: TransferCounters): TransferCounters {
	if (!value || typeof value !== 'object') throw new TypeError('Transfer counters are required.');
	const copyDirection = (direction: TransferDirection): TransferDirectionCounters => {
		const counters = value[direction];
		if (!counters || typeof counters !== 'object') throw new TypeError(`Missing ${direction} counters.`);
		for (const field of COUNTER_FIELDS) readCounter(counters[field], `${direction}.${field}`);
		return { bytes: counters.bytes, files: counters.files, folders: counters.folders };
	};
	return { upload: copyDirection('upload'), download: copyDirection('download') };
}

function compare(a: TransferCounterValue | null, b: TransferCounterValue | null): number | null {
	const left = readCounter(a, 'counter'), right = readCounter(b, 'counter');
	if (left === null || right === null) return null;
	if (right < left) return -1;
	if (right > left) return 1;
	return 0;
}

function difference(current: TransferCounterValue | null, baseline: TransferCounterValue | null): bigint | null {
	const now = readCounter(current, 'counter'), before = readCounter(baseline, 'counter');
	return now === null || before === null ? null : now - before;
}

function numericDifference(current: TransferCounterValue | null, baseline: TransferCounterValue | null): number | null {
	const delta = difference(current, baseline);
	return delta === null ? null : Number(delta);
}

function counterFor(counters: TransferDirectionCounters, unit: TransferUnit): TransferCounterValue | null {
	switch (unit) {
		case 'Kbps': case 'Mbps': case 'Gbps': return counters.bytes;
		case 'Files/ps': return counters.files;
		case 'Folders/ps': return counters.folders;
		case 'INodes/ps': return readCounter(counters.files, 'files')! + readCounter(counters.folders, 'folders')!;
	}
}

/** Convert a user-entered duration into the bounded millisecond window. */
export function toWindowMs(value: number, unit: TransferWindowUnit): number {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError('Transfer window must be a positive finite number.');
	const multiplier = unit === 'seconds' ? 1_000 : unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : null;
	if (multiplier === null) throw new TypeError('Unsupported transfer window unit.');
	const windowMs = Math.round(value * multiplier);
	validateWindowMs(windowMs);
	return windowMs;
}

export function validateWindowMs(windowMs: number): void {
	if (!Number.isSafeInteger(windowMs) || windowMs < MIN_TRANSFER_WINDOW_MS || windowMs > MAX_TRANSFER_WINDOW_MS) {
		throw new RangeError(`Transfer window must be between ${MIN_TRANSFER_WINDOW_MS}ms and ${MAX_TRANSFER_WINDOW_MS}ms.`);
	}
}

function defaultNow(): number {
	return globalThis.performance.now();
}

/** One bounded cumulative history for a sync run, queried by any number of windows. */
export class TransferSpeedSeries {
	private samples: Sample[] = [];
	private previous: TransferCounters | null = null;
	private paused = false;
	private lastClockAt: number | null = null;
	private readonly now: () => number;

	constructor(options: { now?: () => number } = {}) { this.now = options.now ?? defaultNow; }

	private clock(): number {
		const value = this.now();
		if (!Number.isFinite(value) || value < 0) throw new RangeError('Transfer clock must return a nonnegative finite monotonic time.');
		if (this.lastClockAt !== null && value < this.lastClockAt) throw new RangeError('Transfer clock moved backwards.');
		this.lastClockAt = value;
		return value;
	}

	/** Observe absolute successful-transfer totals. Calls closer than 1s are coalesced. */
	observe(counters: TransferCounters): void {
		const next = copyCounters(counters), at = this.clock();
		if (this.previous) {
			for (const direction of ['upload', 'download'] as const) for (const field of COUNTER_FIELDS) {
				const before = this.previous[direction][field], after = next[direction][field];
				if (before !== null && after !== null && compare(before, after)! < 0) throw new TransferSpeedCounterError(direction, field);
			}
			// Close any active idle interval using the previous totals before the
			// event's increment enters the series.
			this.materializeActiveTime(at);
		}
		this.previous = next;
		if (this.paused) return;
		const lastSample = this.samples.at(-1);
		if (lastSample?.at === at) {
			lastSample.counters = next;
			return;
		}
		if (lastSample && at - lastSample.at < SAMPLE_INTERVAL_MS) return;
		this.pushSample({ at, counters: next });
	}

	private pushSample(sample: Sample): void {
		this.samples.push(sample);
		if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
		const cutoff = sample.at - MAX_TRANSFER_WINDOW_MS;
		let remove = 0;
		while (remove + 1 < this.samples.length && this.samples[remove + 1].at < cutoff) remove++;
		if (remove) this.samples.splice(0, remove);
	}

	/** Active reads fill missing 1Hz buckets with the latest absolute totals. This
	 * ages idle windows even when no transfer callback or view was present. */
	private materializeActiveTime(now: number): void {
		if (this.paused || !this.previous) return;
		let discard = 0;
		const retentionCutoff = now - MAX_TRANSFER_WINDOW_MS - SAMPLE_INTERVAL_MS;
		while (discard + 1 < this.samples.length && this.samples[discard + 1].at < retentionCutoff) discard++;
		if (discard) this.samples.splice(0, discard);
		const latest = this.samples.at(-1);
		if (!latest) { this.pushSample({ at: now, counters: this.previous }); return; }
		const firstAt = Math.max(latest.at + SAMPLE_INTERVAL_MS, now - MAX_TRANSFER_WINDOW_MS - SAMPLE_INTERVAL_MS);
		for (let at = firstAt, added = 0; at <= now && added < MAX_SAMPLES; at += SAMPLE_INTERVAL_MS, added++) {
			this.pushSample({ at, counters: this.previous });
		}
	}

	read(input: { direction: TransferDirection; unit: TransferUnit; windowMs: number }): SpeedReading {
		const { direction, unit, windowMs } = input;
		if (direction !== 'upload' && direction !== 'download') throw new TypeError('Unsupported transfer direction.');
		if (!UNITS.includes(unit)) throw new TypeError('Unsupported transfer speed unit.');
		validateWindowMs(windowMs);
		const now = this.clock();
		if (this.paused) return { status: 'paused', requestedWindowMs: windowMs, observedDurationMs: 0 };
		this.materializeActiveTime(now);
		const lastSample = this.samples.at(-1);
		if (!lastSample) return { status: 'unknown', reason: 'no-baseline', requestedWindowMs: windowMs, observedDurationMs: 0 };
		// Use current absolute totals as a transient endpoint. It can be newer
		// than the last retained 1Hz point without adding another history sample.
		const latest: Sample = { at: now, counters: this.previous ?? lastSample.counters };
		const windowStart = now - windowMs;
		const first = this.samples[0];
		let low = 0, high = this.samples.length;
		while (low < high) {
			const middle = low + ((high - low) >> 1);
			if (this.samples[middle].at < windowStart) low = middle + 1;
			else high = middle;
		}
		const before = low > 0 ? this.samples[low - 1] : null;
		const after = this.samples[low] ?? latest;
		let observedDurationMs: number;
		let elapsedDelta: number | null;
		if (windowStart <= first.at) {
			observedDurationMs = Math.max(0, now - first.at);
			elapsedDelta = numericDifference(counterFor(latest.counters[direction], unit), counterFor(first.counters[direction], unit));
		} else if (after.at === windowStart) {
			observedDurationMs = windowMs;
			elapsedDelta = numericDifference(counterFor(latest.counters[direction], unit), counterFor(after.counters[direction], unit));
		} else if (before && after.at > before.at) {
			observedDurationMs = windowMs;
			const beforeValue = counterFor(before.counters[direction], unit), afterValue = counterFor(after.counters[direction], unit);
			const endValue = counterFor(latest.counters[direction], unit);
			const segment = difference(afterValue, beforeValue), toEnd = difference(endValue, beforeValue);
			const portion = (windowStart - before.at) / (after.at - before.at);
			elapsedDelta = segment === null || toEnd === null ? null : Number(toEnd) - Number(segment) * portion;
		} else {
			observedDurationMs = Math.max(0, now - latest.at);
			elapsedDelta = 0;
		}
		if (observedDurationMs <= 0) return { status: 'unknown', reason: 'insufficient-duration', requestedWindowMs: windowMs, observedDurationMs };
		if (elapsedDelta === null) return { status: 'unknown', reason: 'unavailable', requestedWindowMs: windowMs, observedDurationMs };
		const scale = unit === 'Kbps' ? 8 / observedDurationMs
			: unit === 'Mbps' ? 0.008 / observedDurationMs
			: unit === 'Gbps' ? 0.000008 / observedDurationMs
			: 1_000 / observedDurationMs;
		const value = Math.max(0, elapsedDelta) * scale;
		if (!Number.isFinite(value)) return { status: 'unknown', reason: 'unavailable', requestedWindowMs: windowMs, observedDurationMs };
		return { status: 'known', value, unit, requestedWindowMs: windowMs, observedDurationMs };
	}

	/** Pauses invalidate the old rate baseline so downtime is never averaged in. */
	pause(): void {
		this.clock();
		this.paused = true;
		this.samples = [];
	}

	resume(): void {
		const at = this.clock();
		if (!this.paused) return;
		this.paused = false;
		this.samples = [];
		if (this.previous) this.pushSample({ at, counters: this.previous });
	}

	/** Start a fresh run. The next observation establishes its baseline. */
	reset(): void {
		this.clock();
		this.samples = [];
		this.previous = null;
		this.paused = false;
	}
}
