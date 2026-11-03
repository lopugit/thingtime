import { compressImage } from './imagePipeline';
import { isImageFile } from './imageFiles';
import {
	Input,
	Output,
	BlobSource,
	StreamTarget,
	Conversion,
	Quality,
	MP4,
	QTFF,
	WEBM,
	MATROSKA,
	Mp4OutputFormat,
	WebMOutputFormat
} from 'mediabunny';
import { MediaOutput } from './mediaOutput';
import { mediaDimensions, validateMediaSettings } from './mediaPipeline';

// One selected file and one conversion per terminable worker. No URL source,
// network, account data, authored functions, or filesystem enumeration.
let started = false;
self.onmessage = async (event: MessageEvent) => {
	if (started) return;
	started = true;
	let input: Input | undefined;
	let conversion: Conversion | undefined;
	try {
		const file = event.data?.file;
		if (!(file instanceof Blob) || !file.size) throw new Error('Choose a nonempty local image or video');
		const settings = validateMediaSettings(event.data.settings);
		if (isImageFile({ type: file.type, name: event.data.name })) {
			const result = await compressImage(file, settings, event.data.assets, typeof event.data.name === 'string' ? event.data.name : undefined);
			self.postMessage({ type: 'complete', ...result });
			return;
		}
		if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined')
			throw new Error('This browser does not expose WebCodecs video encoding and decoding');
		input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] });
		const video = await input.getPrimaryVideoTrack();
		if (!video) throw new Error('The selected file has no video track');
		const duration = await input.computeDuration();
		if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video must have a positive finite duration');
		const dimensions = mediaDimensions(await video.getDisplayWidth(), await video.getDisplayHeight(), settings);
		const audio = await input.getPrimaryAudioTrack();
		const buffer = new MediaOutput();
		const target = new StreamTarget(new WritableStream({ write: ({ data, position }) => buffer.write(data, position) }), {
			chunked: true,
			chunkSize: 1024 * 1024
		});
		const output = new Output({
			format: settings.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'fragmented' }) : new WebMOutputFormat(),
			target
		});
		conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			tags: {},
			showWarnings: false,
			video: {
				...dimensions,
				fit: 'contain',
				frameRate: settings.frameRate,
				codec: settings.format === 'mp4' ? 'avc' : 'vp9',
				quality: new Quality({ bitrate: settings.videoBitrate }),
				forceTranscode: true
			},
			audio:
				settings.audio === 'remove'
					? { discard: true }
					: {
							codec: settings.format === 'mp4' ? 'aac' : 'opus',
							quality: new Quality({ bitrate: settings.audioBitrate }),
							forceTranscode: true
					  }
		});
		const missing = conversion.discardedTracks.filter((item) => item.reason !== 'discarded_by_user');
		if (!conversion.isValid || missing.length)
			throw new Error(
				'This browser cannot decode the source or encode the selected format' +
					(missing.length ? ': ' + missing.map((x) => x.reason).join(', ') : '') +
					'. Try another format; audio is never silently removed.'
			);
		let reported = -1;
		conversion.onProgress = (progress) => {
			const percent = Math.min(99, Math.floor(progress * 100));
			if (percent !== reported) {
				reported = percent;
				self.postMessage({ type: 'progress', percent });
			}
		};
		await conversion.execute();
		const blob = buffer.blob(settings.format === 'mp4' ? 'video/mp4' : 'video/webm');
		if (!blob.size) throw new Error('The encoder returned no output');
		self.postMessage({
			type: 'complete',
			blob,
			receipt: {
				...dimensions,
				duration,
				inputBytes: file.size,
				outputBytes: blob.size,
				savedPercent: Math.round((1 - blob.size / file.size) * 1000) / 10,
				format: settings.format,
				audio: settings.audio === 'remove' ? 'removed' : audio ? 'retained' : 'none',
				frameRate: settings.frameRate,
				videoBitrate: settings.videoBitrate,
				note:
					blob.size < file.size
						? 'Output is smaller than the selected source.'
						: 'Output is not smaller; reduce bitrate or dimensions. The original file is unchanged.'
			}
		});
	} catch (error) {
		await conversion?.cancel().catch(() => {});
		self.postMessage({ type: 'error', message: error instanceof Error ? (/@ (?:error|warning)\//.test(error.message) ? 'This image is damaged or its format is not supported by the local decoder. Try another image or output format.' : error.message.slice(0, 700)) : 'Media conversion failed' });
	} finally {
		input?.dispose();
	}
};
