import { resolveMediaSettings, type MediaPipeline } from './mediaPipeline';

type MediaWorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
/** Trusted host adapter: only a selected Blob crosses out of the opaque frame.
 * Settings come from the host's validated program snapshot, never its messages.
 * The static worker has a network-denying response CSP and no authored source. */
export function createHostMediaPipeline(
	pipeline: MediaPipeline,
	inputs: Record<string, unknown>,
	createWorker: () => MediaWorkerPort,
	send: (requestId: number, result: unknown) => void
) {
	let worker: MediaWorkerPort | undefined;
	let sequence = 0;
	let disposed = false;
	const stop = () => {
		worker?.terminate();
		worker = undefined;
	};
	return {
		receive(data: unknown) {
			if (disposed || !data || typeof data !== 'object') return;
			const message = data as { type?: string; requestId?: number; file?: unknown };
			if (
				!['tt-platform-media-start', 'tt-platform-media-cancel'].includes(message.type || '') ||
				!Number.isSafeInteger(message.requestId) ||
				message.requestId! <= sequence
			)
				return;
			const current = (sequence = message.requestId!);
			stop();
			if (message.type === 'tt-platform-media-cancel') return;
			const emit = (result: unknown) => {
				if (!disposed && sequence === current) send(current, result);
			};
			try {
				if (!(message.file instanceof Blob) || !message.file.size) throw new Error('Choose a nonempty local video');
				const settings = resolveMediaSettings(pipeline, inputs);
				worker = createWorker();
				worker.onmessage = (event) => {
					if (disposed || sequence !== current) return;
					const result = event.data;
					if (!result || !['progress', 'complete', 'error'].includes(result.type)) return;
					if (result.type !== 'progress') stop();
					emit(result);
				};
				worker.onerror = () => {
					if (!disposed && sequence === current) {
						stop();
						emit({ type: 'error', message: 'The local media worker could not start or stopped unexpectedly.' });
					}
				};
				worker.postMessage({ file: message.file, settings });
			} catch (error) {
				stop();
				emit({ type: 'error', message: error instanceof Error ? error.message : 'Could not start local media processing.' });
			}
		},
		dispose() {
			disposed = true;
			stop();
		}
	};
}
