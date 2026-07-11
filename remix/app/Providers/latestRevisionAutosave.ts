export type LatestRevisionAutosavePhase = 'serialize' | 'write';

export type LatestRevisionAutosaveErrorContext = {
	phase: LatestRevisionAutosavePhase;
	revision: number;
};

export type LatestRevisionAutosaveState = {
	dirty: boolean;
	saving: boolean;
	disposed: boolean;
	latestRevision: number | null;
	savedRevision: number | null;
	lastError: unknown | null;
};

export type LatestRevisionAutosaveTimers = {
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (handle: unknown) => void;
};

export type LatestRevisionAutosaveOptions<Value, Serialized> = {
	debounceMs: number;
	maxWaitMs: number;
	serialize: (value: Value, revision: number) => Serialized | Promise<Serialized>;
	write: (serialized: Serialized, revision: number) => void | Promise<void>;
	onError?: (error: unknown, context: LatestRevisionAutosaveErrorContext) => void;
	timers?: LatestRevisionAutosaveTimers;
};

export type LatestRevisionAutosaveCoordinator<Value> = {
	/**
	 * Queue an immutable value snapshot. Revisions must increase; stale or
	 * duplicate revisions are ignored so an older async producer cannot replace
	 * newer pending work.
	 */
	schedule: (value: Value, revision: number) => boolean;
	/** Save all currently pending work, including a newer revision that arrives while writing. */
	flush: () => Promise<void>;
	/** Cancel timers and reject future schedules. An already-started write is allowed to finish. */
	dispose: () => void;
	getState: () => LatestRevisionAutosaveState;
};

const defaultTimers: LatestRevisionAutosaveTimers = {
	setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

const validateDelay = (name: string, value: number): void => {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a finite, non-negative number`);
	}
};

/**
 * Coordinates expensive snapshot persistence without doing serialization in
 * the edit handler. Values stay pending until debounce/max-wait/flush chooses
 * one, then only the newest revision is serialized. Writes are strictly
 * serialized and a revision received during a write drains immediately after
 * the current write completes.
 */
export const createLatestRevisionAutosave = <Value, Serialized>(
	options: LatestRevisionAutosaveOptions<Value, Serialized>
): LatestRevisionAutosaveCoordinator<Value> => {
	validateDelay('debounceMs', options.debounceMs);
	validateDelay('maxWaitMs', options.maxWaitMs);

	const timers = options.timers || defaultTimers;
	let latest: { value: Value; revision: number } | null = null;
	let savedRevision: number | null = null;
	let lastError: unknown | null = null;
	let saving = false;
	let disposed = false;
	let debounceTimer: unknown | null = null;
	let maxWaitTimer: unknown | null = null;
	let inFlight: Promise<void> | null = null;

	const isDirty = (): boolean => latest !== null && (savedRevision === null || latest.revision > savedRevision);

	const clearDebounceTimer = (): void => {
		if (debounceTimer === null) return;
		timers.clearTimeout(debounceTimer);
		debounceTimer = null;
	};

	const clearMaxWaitTimer = (): void => {
		if (maxWaitTimer === null) return;
		timers.clearTimeout(maxWaitTimer);
		maxWaitTimer = null;
	};

	const clearTimers = (): void => {
		clearDebounceTimer();
		clearMaxWaitTimer();
	};

	const reportError = (error: unknown, context: LatestRevisionAutosaveErrorContext): void => {
		lastError = error;
		try {
			options.onError?.(error, context);
		} catch {
			// An observer must not replace the persistence failure or corrupt state.
		}
	};

	const drain = async (onFailure: (revision: number) => void): Promise<void> => {
		saving = true;
		lastError = null;

		try {
			while (!disposed && isDirty()) {
				clearTimers();
				const candidate = latest as { value: Value; revision: number };

				let serialized: Serialized;
				try {
					serialized = await options.serialize(candidate.value, candidate.revision);
				} catch (error) {
					onFailure(candidate.revision);
					reportError(error, { phase: 'serialize', revision: candidate.revision });
					throw error;
				}

				try {
					await options.write(serialized, candidate.revision);
				} catch (error) {
					onFailure(candidate.revision);
					reportError(error, { phase: 'write', revision: candidate.revision });
					throw error;
				}

				savedRevision = candidate.revision;
				lastError = null;
				// The loop deliberately re-reads `latest`: intermediate revisions are
				// skipped and the newest one drains immediately after this write.
			}
		} finally {
			saving = false;
		}
	};

	const flush = (): Promise<void> => {
		clearTimers();
		if (inFlight) return inFlight;
		if (disposed || !isDirty()) return Promise.resolve();

		let failedRevision: number | null = null;
		const operation = drain((revision) => {
			failedRevision = revision;
		});
		let trackedOperation: Promise<void>;
		trackedOperation = operation.finally(() => {
			if (inFlight === trackedOperation) inFlight = null;
			// A timer for a newer revision may have fired while this write was in
			// flight. If the older candidate failed, that timer returned the old
			// promise and was cleared; immediately give the newer snapshot its own
			// drain instead of leaving it dirty forever. Do not auto-loop on the same
			// failed revision.
			if (!disposed && failedRevision !== null && latest && latest.revision > failedRevision) {
				triggerScheduledFlush();
			}
		});
		inFlight = trackedOperation;
		return trackedOperation;
	};

	const triggerScheduledFlush = (): void => {
		void flush().catch(() => {
			// `reportError` already retained the failure. Scheduled work has no
			// caller to reject to; an explicit later flush can retry it.
		});
	};

	const armTimers = (): void => {
		clearDebounceTimer();
		debounceTimer = timers.setTimeout(() => {
			debounceTimer = null;
			clearMaxWaitTimer();
			triggerScheduledFlush();
		}, options.debounceMs);

		if (maxWaitTimer !== null) return;
		maxWaitTimer = timers.setTimeout(() => {
			maxWaitTimer = null;
			clearDebounceTimer();
			triggerScheduledFlush();
		}, options.maxWaitMs);
	};

	const schedule = (value: Value, revision: number): boolean => {
		if (disposed) return false;
		if (!Number.isFinite(revision)) throw new TypeError('revision must be a finite number');
		if (latest && revision <= latest.revision) return false;

		latest = { value, revision };
		armTimers();
		return true;
	};

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		clearTimers();
	};

	const getState = (): LatestRevisionAutosaveState => ({
		dirty: isDirty(),
		saving,
		disposed,
		latestRevision: latest?.revision ?? null,
		savedRevision,
		lastError
	});

	return { schedule, flush, dispose, getState };
};
