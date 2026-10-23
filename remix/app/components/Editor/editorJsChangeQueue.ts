export type OrderedEditorJsChangeQueueOptions<Value, Signature> = {
	getSignature: (value: Value) => Signature;
	onEmit: (value: Value) => void;
	onError?: (error: unknown) => void;
	/** Suppress a first no-op snapshot that is identical to the mounted editor. */
	initialSignature?: Signature;
};

export type OrderedEditorJsChangeQueue<Value> = {
	enqueue: (save: () => Value | PromiseLike<Value>) => void;
	/** Stop accepting work and resolve after every already-started save is emitted. */
	close: () => Promise<void>;
	/** Immediately drop settled and future results. */
	dispose: () => void;
};

type SaveResult<Value> = { status: 'fulfilled'; value: Value } | { status: 'rejected'; reason: unknown };

/**
 * Starts every Editor.js save as soon as it is requested, then emits the
 * results in request order. Editor.js and the raw-input fallback can report
 * the same mutation independently, so only adjacent equal snapshots are
 * suppressed; returning to an older value remains a real change.
 */
export const createOrderedEditorJsChangeQueue = <Value, Signature>(
	options: OrderedEditorJsChangeQueueOptions<Value, Signature>
): OrderedEditorJsChangeQueue<Value> => {
	let accepting = true;
	let disposed = false;
	let nextRequest = 0;
	let nextToEmit = 0;
	let lastEmitted: { signature: Signature } | null = options.initialSignature === undefined ? null : { signature: options.initialSignature };
	const settled = new Map<number, SaveResult<Value>>();
	const closeWaiters = new Set<() => void>();

	const resolveCloseWaiters = () => {
		if (accepting || nextToEmit < nextRequest) return;
		for (const resolve of closeWaiters) resolve();
		closeWaiters.clear();
	};

	const reportError = (error: unknown) => {
		try {
			options.onError?.(error);
		} catch {
			// An error reporter must not stall later Editor.js changes.
		}
	};

	const flush = () => {
		while (!disposed && settled.has(nextToEmit)) {
			const result = settled.get(nextToEmit);
			settled.delete(nextToEmit);
			nextToEmit += 1;

			if (!result) continue;
			if (result.status === 'rejected') {
				reportError(result.reason);
				continue;
			}

			let signature: Signature;
			try {
				signature = options.getSignature(result.value);
			} catch (error) {
				reportError(error);
				continue;
			}

			if (lastEmitted && Object.is(signature, lastEmitted.signature)) continue;

			try {
				options.onEmit(result.value);
				lastEmitted = { signature };
			} catch (error) {
				reportError(error);
			}
		}
		resolveCloseWaiters();
	};

	const settle = (request: number, result: SaveResult<Value>) => {
		if (disposed) return;
		settled.set(request, result);
		flush();
	};

	const enqueue = (save: () => Value | PromiseLike<Value>) => {
		if (disposed || !accepting) return;

		const request = nextRequest;
		nextRequest += 1;

		let pending: Value | PromiseLike<Value>;
		try {
			// Do not chain saves: each call must capture the Editor.js document at
			// the time its change was observed.
			pending = save();
		} catch (error) {
			settle(request, { status: 'rejected', reason: error });
			return;
		}

		Promise.resolve(pending).then(
			(value) => settle(request, { status: 'fulfilled', value }),
			(error) => settle(request, { status: 'rejected', reason: error })
		);
	};

	const close = (): Promise<void> => {
		accepting = false;
		if (disposed || nextToEmit >= nextRequest) return Promise.resolve();
		return new Promise<void>((resolve) => closeWaiters.add(resolve));
	};

	return {
		enqueue,
		close,
		dispose: () => {
			accepting = false;
			disposed = true;
			settled.clear();
			for (const resolve of closeWaiters) resolve();
			closeWaiters.clear();
		}
	};
};
