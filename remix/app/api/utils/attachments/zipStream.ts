import { Zip, ZipPassThrough } from 'fflate';

// A backpressure-aware ZIP body: entries are appended one after another as
// stored (uncompressed) members, so memory stays at one upstream chunk plus
// the queued output regardless of archive size. Media is already compressed;
// deflating it again would only burn CPU inside the request budget.

export type ZipStreamEntry = {
	path: string;
	// The exact byte length the source promised. Upstream is verified against it
	// so a changed object can never silently truncate or overrun the archive.
	size: number;
	open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
	mtime?: Date;
};

export type ZipStreamText = { path: string; bytes: Uint8Array };

export type ZipStreamOptions = {
	// Output queued ahead of the consumer before the pump waits (bytes).
	highWaterMarkBytes?: number;
	// Absolute deadline (ms epoch). Checked between chunks AND enforced by a
	// timer, so a stalled upstream read or a consumer that stops pulling still
	// ends the archive with an error at the deadline instead of holding the
	// function, its buffers and the upstream connection until the platform
	// kills it.
	deadlineAt?: number;
	now?: () => number;
};

export class ZipStreamError extends Error {
	constructor(message: string, readonly path?: string) {
		super(message);
		this.name = 'ZipStreamError';
	}
}

const DEFAULT_HIGH_WATER_MARK = 4 * 1024 * 1024;

// ZIP (MS-DOS) timestamps only span 1980–2099; clamp so an odd clock can never
// make fflate reject a member header mid-stream.
const ZIP_TIME_MIN = Date.UTC(1980, 0, 1);
const ZIP_TIME_MAX = Date.UTC(2099, 11, 31, 23, 59, 58);
export const zipTimestamp = (value: Date | number | undefined): Date => {
	const millis = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.now();
	return new Date(Math.min(ZIP_TIME_MAX, Math.max(ZIP_TIME_MIN, Number.isFinite(millis) ? millis : Date.now())));
};

export const createZipStream = (
	entries: readonly ZipStreamEntry[],
	texts: readonly ZipStreamText[] = [],
	options: ZipStreamOptions = {}
): ReadableStream<Uint8Array> => {
	const now = options.now || Date.now;
	const abort = new AbortController();
	let waitingForPull: (() => void) | undefined;
	let finished = false;
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

	const timedOut = () => new ZipStreamError('Archive download timed out');
	const checkDeadline = () => {
		if (options.deadlineAt !== undefined && now() > options.deadlineAt) throw timedOut();
	};
	const stopTimer = () => {
		if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
		deadlineTimer = undefined;
	};
	const wake = () => {
		const resume = waitingForPull;
		waitingForPull = undefined;
		resume?.();
	};

	return new ReadableStream<Uint8Array>(
		{
			start(controller) {
				const nextPull = () =>
					new Promise<void>((resolve) => {
						waitingForPull = resolve;
					});
				const drain = async () => {
					// desiredSize is null once the stream errored/closed; treat that as "stop".
					while (!abort.signal.aborted && (controller.desiredSize ?? -1) <= 0 && !finished) await nextPull();
					if (abort.signal.aborted) throw new ZipStreamError('Archive download cancelled');
					checkDeadline();
				};

				const zip = new Zip((error, chunk, final) => {
					if (finished) return;
					if (error) {
						finished = true;
						stopTimer();
						controller.error(error);
						return;
					}
					if (chunk.byteLength) controller.enqueue(chunk);
					if (final) {
						finished = true;
						stopTimer();
						controller.close();
					}
				});

				// A pump parked in reader.read() or in drain() cannot observe the clock,
				// so the deadline itself aborts the upstream read and fails the stream.
				const failNow = (error: unknown) => {
					if (finished) return;
					finished = true;
					stopTimer();
					abort.abort();
					try {
						zip.terminate();
					} catch {
						/* already ended */
					}
					controller.error(error);
					wake();
				};
				if (options.deadlineAt !== undefined) {
					deadlineTimer = setTimeout(() => failNow(timedOut()), Math.max(0, options.deadlineAt - now()));
					deadlineTimer.unref?.();
				}

				const pump = async () => {
					for (const entry of entries) {
						checkDeadline();
						const member = new ZipPassThrough(entry.path);
						member.mtime = zipTimestamp(entry.mtime || now());
						zip.add(member);
						const body = await entry.open(abort.signal);
						const reader = body.getReader();
						let received = 0;
						try {
							while (true) {
								checkDeadline();
								const { done, value } = await reader.read();
								if (done) break;
								if (!value?.byteLength) continue;
								received += value.byteLength;
								if (received > entry.size) throw new ZipStreamError('A file grew beyond its declared size', entry.path);
								member.push(value);
								await drain();
							}
						} finally {
							await reader.cancel().catch(() => {});
							reader.releaseLock();
						}
						if (received !== entry.size) throw new ZipStreamError('A file changed size while it was being archived', entry.path);
						member.push(new Uint8Array(0), true);
						await drain();
					}
					for (const text of texts) {
						const member = new ZipPassThrough(text.path);
						member.mtime = zipTimestamp(now());
						zip.add(member);
						member.push(text.bytes, true);
						await drain();
					}
					zip.end();
				};

				pump().catch(failNow);
			},
			pull() {
				wake();
			},
			cancel() {
				finished = true;
				stopTimer();
				abort.abort();
				wake();
			}
		},
		new ByteLengthQueuingStrategy({ highWaterMark: options.highWaterMarkBytes ?? DEFAULT_HIGH_WATER_MARK })
	);
};
