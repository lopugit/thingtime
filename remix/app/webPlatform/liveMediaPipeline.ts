import { mediaExtensions } from './mediaExport';
import { resolveMediaSettings, type MediaPipeline } from './mediaPipeline';

type Publish = (file: { blob: Blob; name: string } | null) => void;
/** Generic bindings connect a saved document to a cancellable media job. Every label,
 * layout, selector and output setting belongs to the editable Component program. */
export function bindMediaPipeline(
	root: HTMLElement,
	pipeline: MediaPipeline,
	inputs: Record<string, unknown>,
	report: (ok: boolean, value: unknown) => void,
	publish: Publish,
	transport: { send: (message: unknown) => void; subscribe: (receive: (requestId: number, result: any) => void) => () => void }
) {
	resolveMediaSettings(pipeline, inputs);
	const unique = (selector: string) => {
		const matches = root.querySelectorAll(selector);
		if (matches.length !== 1) throw new Error('A media control must resolve to exactly one surface element');
		return matches[0];
	};
	const file = unique(pipeline.file),
		start = unique(pipeline.start),
		cancel = unique(pipeline.cancel);
	const status = unique(pipeline.status),
		progress = unique(pipeline.progress);
	const preview = pipeline.preview ? unique(pipeline.preview) : null;
	const imagePreview = pipeline.imagePreview ? unique(pipeline.imagePreview) : null;
	if (
		!(file instanceof HTMLInputElement) ||
		file.type !== 'file' ||
		file.multiple ||
		!(start instanceof HTMLButtonElement) ||
		!(cancel instanceof HTMLButtonElement) ||
		!(status instanceof HTMLOutputElement) ||
		!(progress instanceof HTMLProgressElement) ||
		(preview && !(preview instanceof HTMLVideoElement)) ||
		(imagePreview && !(imagePreview instanceof HTMLImageElement))
	)
		throw new Error('Media requires a single-file input, start/cancel buttons, output status, progress and optional video');
	let running = false,
		url: string | undefined;
	let active = true,
		generation = 0;
	const stop = () => {
		generation++;
		transport.send({ type: 'tt-platform-media-cancel', requestId: generation });
		running = false;
		start.disabled = false;
		cancel.disabled = true;
	};
	const clearOutput = () => {
		publish(null);
		if (preview instanceof HTMLVideoElement) {
			preview.pause();
			preview.removeAttribute('src');
			preview.load();
		}
		if (imagePreview instanceof HTMLImageElement) { imagePreview.removeAttribute('src'); imagePreview.hidden = true; }
		if (preview instanceof HTMLVideoElement) preview.hidden = true;
		if (url) URL.revokeObjectURL(url);
		url = undefined;
	};
	const state = (label: string, percent = 0, ok = true, extra: object = {}) => {
		if (!active) return;
		status.value = label;
		progress.max = 100;
		progress.value = percent;
		report(ok, { media: { status: label, percent, ...extra } });
	};
	const select = () => {
		stop();
		clearOutput();
		state(file.files?.length ? 'Ready — selected file stays on this device.' : 'Choose a local image or video.');
	};
	const abort = () => {
		stop();
		clearOutput();
		state('Canceled. Select Start to try again.');
	};
	let unsubscribe = () => {};
	const run = () => {
		if (!active || running) return;
		clearOutput();
		const selected = file.files?.[0];
		if (!selected?.size) {
			state('Choose a nonempty local image or video.', 0, false);
			return;
		}
		const current = ++generation;
		start.disabled = true;
		cancel.disabled = false;
		state('Preparing local conversion…');
		try {
			running = true;
			const fail = (message: string) => {
				if (active && current === generation) {
					stop();
					clearOutput();
					state(message, 0, false);
				}
			};
			unsubscribe();
			unsubscribe = transport.subscribe((requestId, result) => {
				if (!active || current !== generation || requestId !== current) return;
				if (result?.type === 'progress') state('Encoding on this device…', result.percent);
				else if (result?.type === 'error') fail(result.message);
				else if (result?.type === 'complete') {
					const blob = result.blob;
					if (!(blob instanceof Blob) || !blob.size || !Object.prototype.hasOwnProperty.call(mediaExtensions, blob.type)) {
						fail('The media worker returned an invalid output.');
						return;
					}
					stop();
					url = URL.createObjectURL(blob);
					if (preview instanceof HTMLVideoElement && blob.type.startsWith('video/')) { preview.src = url; preview.hidden = false; }
					if (imagePreview instanceof HTMLImageElement && blob.type.startsWith('image/')) { imagePreview.src = url; imagePreview.hidden = false; }
					const stem =
						selected.name
							.replace(/\.[^.]*$/, '')
							.replace(/[^a-zA-Z0-9 _-]/g, '_')
							.slice(0, 80) || 'media';
					publish({ blob, name: `${stem}-converted.${mediaExtensions[blob.type]}` });
					state(`Complete — ${selected.size.toLocaleString()} → ${blob.size.toLocaleString()} bytes. ${result.receipt.note}`, 100, true, result.receipt);
				}
			});
			transport.send({ type: 'tt-platform-media-start', requestId: current, file: selected, name: selected.name });
		} catch {
			stop();
			state('This browser could not start local media processing.', 0, false);
		}
	};
	file.addEventListener('change', select);
	start.addEventListener('click', run);
	cancel.addEventListener('click', abort);
	select();
	return () => {
		active = false;
		unsubscribe();
		stop();
		clearOutput();
		file.removeEventListener('change', select);
		start.removeEventListener('click', run);
		cancel.removeEventListener('click', abort);
	};
}
