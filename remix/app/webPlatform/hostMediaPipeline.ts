import { isImageFile } from './imageFiles';
import type { ImageWasmAssets } from './imagePipeline';
import { assertMediaOutputSize, resolveMediaSettings, type MediaPipeline } from './mediaPipeline';

type MediaWorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
/** Trusted host adapter: only a selected Blob crosses out of the opaque frame.
 * Settings come from the host's validated program snapshot, never its messages.
 * The static worker has a network-denying response CSP and no authored source. */
export function createHostMediaPipeline(
	pipeline: MediaPipeline,
	inputs: Record<string, unknown> | (() => Record<string, unknown>),
	createWorker: () => MediaWorkerPort,
	send: (requestId: number, result: unknown) => void,
	loadImageAssets?: (signal: AbortSignal) => Promise<ImageWasmAssets>
) {
	let worker: MediaWorkerPort | undefined;
	let sequence = 0;
	let disposed = false;
	let pending: AbortController | undefined;
	const stop = () => {
		pending?.abort();
		pending = undefined;
		worker?.terminate();
		worker = undefined;
	};
	return {
		receive(data: unknown) {
			if (disposed || !data || typeof data !== 'object') return;
			const message = data as { type?: string; requestId?: number; file?: unknown; name?: unknown };
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
				if (!(message.file instanceof Blob) || !message.file.size) throw new Error('Choose a nonempty local image or video');
				const settings = resolveMediaSettings(pipeline, typeof inputs === 'function' ? inputs() : inputs);
				worker = createWorker();
				worker.onmessage = (event) => {
					if (disposed || sequence !== current) return;
					const result = event.data;
					if (!result || !['progress', 'complete', 'error'].includes(result.type)) return;
					if (result.type === 'complete') {
						try {
							assertMediaOutputSize(result.blob, settings.maxOutputBytes);
						} catch (error) {
							stop();
							emit({ type: 'error', message: error instanceof Error ? error.message : 'Invalid media output' });
							return;
						}
					}
					if (result.type !== 'progress') stop();
					emit(result);
				};
				worker.onerror = () => {
					if (!disposed && sequence === current) {
						stop();
						emit({ type: 'error', message: 'The local media worker could not start or stopped unexpectedly.' });
					}
				};
				const file = message.file;
				const name = typeof message.name === 'string' ? message.name : file instanceof File ? file.name : '';
				if (isImageFile({ type: file.type, name })) {
					if (!loadImageAssets) throw new Error('Local image codecs are unavailable. Reload the updated app.');
					const controller = (pending = new AbortController());
					emit({ type: 'progress', percent: 0 });
					void loadImageAssets(controller.signal)
						.then((assets) => {
							if (!disposed && sequence === current && !controller.signal.aborted) worker?.postMessage({ file, name, settings, assets });
						})
						.catch((error) => {
							if (!disposed && sequence === current && !controller.signal.aborted) {
								stop();
								emit({ type: 'error', message: error instanceof Error ? error.message.slice(0, 700) : 'Local image codecs could not load.' });
							}
						});
				} else worker.postMessage({ file, name, settings });
			} catch (error) {
				stop();
				emit({ type: 'error', message: error instanceof Error ? error.message.slice(0, 700) : 'Could not start local media processing.' });
			}
		},
		dispose() {
			disposed = true;
			stop();
		}
	};
}
