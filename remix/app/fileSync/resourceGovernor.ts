import type { FileSyncResourceLimits } from './configuration';

export type SyncResourceStatus = {
	version: 1; cpuPercent: number | null; cpuStatus: 'measured' | 'unavailable';
	effectiveTransferConcurrency: number; effectiveIndexingConcurrency: number;
	uploadBytesPerSecond?: number; downloadBytesPerSecond?: number;
};
export function parseSyncResourceStatus(value: unknown): SyncResourceStatus {
	const s = value as SyncResourceStatus;
	if (!s || s.version !== 1 || !['measured', 'unavailable'].includes(s.cpuStatus) ||
		(s.cpuStatus === 'measured' ? typeof s.cpuPercent !== 'number' || !Number.isFinite(s.cpuPercent) || s.cpuPercent < 0 || s.cpuPercent > 100 : s.cpuPercent !== null) ||
		![s.effectiveTransferConcurrency, s.effectiveIndexingConcurrency].every(n => Number.isSafeInteger(n) && n > 0) ||
		[s.uploadBytesPerSecond, s.downloadBytesPerSecond].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)))
		throw Error('Invalid sync resource measurement.');
	return { version: 1, cpuPercent: s.cpuPercent, cpuStatus: s.cpuStatus, effectiveTransferConcurrency: s.effectiveTransferConcurrency,
		effectiveIndexingConcurrency: s.effectiveIndexingConcurrency, ...(s.uploadBytesPerSecond === undefined ? {} : { uploadBytesPerSecond: s.uploadBytesPerSecond }),
		...(s.downloadBytesPerSecond === undefined ? {} : { downloadBytesPerSecond: s.downloadBytesPerSecond }) };
}
function wait(ms: number, signal?: AbortSignal) {
	signal?.throwIfAborted();
	return new Promise<void>((resolve, reject) => {
		const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
		const timer = setTimeout(done, ms);
		const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
		signal?.addEventListener('abort', abort, { once: true });
	});
}
/** One governor belongs to one admitted connection. Native byte streams use
 * their host governor; this instance controls browser scalar fallback only. */
export class SyncResourceGovernor {
	private factor = 1;
	private cpu: number | null = null;
	private active = 0;
	private wake = new Set<() => void>();
	private lanes: Record<'upload' | 'download', Promise<void>> = { upload: Promise.resolve(), download: Promise.resolve() };
	constructor(readonly limits: FileSyncResourceLimits, private now = () => performance.now(), private sleep = wait) {}
	observe(value: SyncResourceStatus) {
		const s = parseSyncResourceStatus(value);
		this.cpu = s.cpuStatus === 'measured' ? s.cpuPercent : null;
		if (this.limits.cpuPercent && this.cpu !== null) {
			if (this.cpu > this.limits.cpuPercent) this.factor = Math.max(1 / 64, this.factor * .75);
			else if (this.cpu < this.limits.cpuPercent * .85) this.factor = Math.min(1, this.factor + .05);
		}
		for (const wake of this.wake) wake();
	}
	status(): SyncResourceStatus {
		return { version: 1, cpuPercent: this.cpu, cpuStatus: this.cpu === null ? 'unavailable' : 'measured',
			effectiveTransferConcurrency: Math.max(1, Math.floor((this.limits.transferConcurrency ?? 1) * this.factor)),
			effectiveIndexingConcurrency: Math.max(1, Math.floor((this.limits.indexingConcurrency ?? 1) * this.factor)),
			...(this.limits.uploadBytesPerSecond ? { uploadBytesPerSecond: this.limits.uploadBytesPerSecond * this.factor } : {}),
			...(this.limits.downloadBytesPerSecond ? { downloadBytesPerSecond: this.limits.downloadBytesPerSecond * this.factor } : {}) };
	}
	async acquire(signal?: AbortSignal): Promise<() => void> {
		while (this.active >= this.status().effectiveTransferConcurrency) {
			signal?.throwIfAborted();
			await new Promise<void>((resolve, reject) => {
				const done = () => { this.wake.delete(done); signal?.removeEventListener('abort', abort); resolve(); };
				const abort = () => { this.wake.delete(done); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
				this.wake.add(done); signal?.addEventListener('abort', abort, { once: true });
			});
		}
		signal?.throwIfAborted(); this.active++;
		let released = false;
		return () => { if (released) return; released = true; this.active--; for (const wake of this.wake) wake(); };
	}
	async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const release = await this.acquire(signal);
		try { return await operation(); } finally { release(); }
	}
	async pace(direction: 'upload' | 'download', bytes: number, signal?: AbortSignal) {
		if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error('Invalid transfer byte count.');
		const key = direction === 'upload' ? 'uploadBytesPerSecond' : 'downloadBytesPerSecond';
		if (!this.limits[key]) { signal?.throwIfAborted(); if (this.factor < 1) await this.sleep(Math.min(250, (1 / this.factor - 1) * 10), signal); return; }
		const prior = this.lanes[direction]; let release!: () => void;
		this.lanes[direction] = new Promise<void>(resolve => { release = resolve; });
		let abort: (() => void) | undefined;
		try {
			// Abort waiting in the lane as well as in an active timer.
			await Promise.race([prior, new Promise<never>((_, reject) => {
				if (signal?.aborted) reject(signal.reason);
				else { abort = () => reject(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); }
			})]);
			let remaining = bytes;
			while (remaining > 0) {
				signal?.throwIfAborted();
				const rate = this.status()[key]!, amount = Math.min(remaining, Math.max(1, rate / 10));
				const deadline = this.now() + amount / rate * 1000;
				while (this.now() < deadline) await this.sleep(Math.min(100, Math.ceil(deadline - this.now())), signal);
				remaining -= amount;
			}
		} finally { if (abort) signal?.removeEventListener('abort', abort); void prior.then(release); }
	}
	/** Backpressure keeps only the existing source chunk and one output slice. */
	stream(direction: 'upload' | 'download', source: ReadableStream<Uint8Array>, signal?: AbortSignal): ReadableStream<Uint8Array> {
		const cancellation = new AbortController(), active = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
		const reader = source.getReader(); let bytes: Uint8Array | undefined, offset = 0;
		return new ReadableStream<Uint8Array>({
			pull: async controller => {
				try {
					active.throwIfAborted();
					if (!bytes || offset === bytes.length) { const next = await reader.read(); if (next.done) { reader.releaseLock(); controller.close(); return; } bytes = next.value; offset = 0; }
					const part = bytes.subarray(offset, Math.min(bytes.length, offset + 64 * 1024));
					await this.pace(direction, part.length, active); offset += part.length; controller.enqueue(part);
				} catch (error) { await reader.cancel(error).catch(() => {}); controller.error(error); }
			}, cancel: reason => { cancellation.abort(reason); return reader.cancel(reason); }
		}, { highWaterMark: 0 });
	}
}
