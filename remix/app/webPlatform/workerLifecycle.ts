type WorkerPort = Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;

/** Browser process startup has its own bound; it is not program execution. */
export function runPlatformWorker(
	worker: WorkerPort,
	input: unknown,
	send: (ok: boolean, result: unknown) => void,
	release: () => void,
	dom?: (request: unknown) => unknown
) {
	let done = false;
	let running = false;
	let timer: ReturnType<typeof setTimeout>;
	const stop = () => {
		if (done) return;
		done = true;
		clearTimeout(timer);
		worker.terminate();
		release();
	};
	const finish = (ok: boolean, result: unknown) => {
		if (done) return;
		stop();
		send(ok, result);
	};
	timer = setTimeout(() => finish(false, 'The isolated worker did not start. Try running the example again.'), 10000);
	worker.onmessage = (event) => {
		if (done) return;
		if (event.data?.type === 'tt-platform-worker-ready') {
			if (running) return;
			running = true;
			clearTimeout(timer);
			timer = setTimeout(() => finish(false, 'The program exceeded its 2-second execution limit.'), 2000);
			worker.postMessage(input);
		} else if (running && event.data?.type === 'tt-platform-dom') {
			try {
				if (!dom) throw new Error('This execution context has no document');
				const result = dom(event.data);
				worker.postMessage({ type: 'tt-platform-dom-result', id: event.data.id, ok: true, result });
			} catch (error) {
				// Protocol and budget errors terminate the run; malformed requests must
				// not keep an unbounded error/retry loop alive on the frame thread.
				finish(false, error instanceof Error ? error.message : 'Invalid DOM operation');
			}
		} else if (running) finish(event.data?.ok === true, event.data?.result);
	};
	worker.onerror = () => finish(false, 'The browser could not execute this program. Check feature support and the program definition.');
	return stop;
}
