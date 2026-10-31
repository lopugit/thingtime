/** Saved media programs contain settings and surface selectors, never file bytes,
 * remote addresses, executable source, or account credentials. */
export type MediaInput = number | string | boolean | { op: 'input'; name: string };
export type MediaPipeline = {
	file: string;
	start: string;
	cancel: string;
	status: string;
	progress: string;
	preview?: string;
	imagePreview?: string;
	download?: string;
	output: {
		format: MediaInput;
		maxWidth: MediaInput;
		maxHeight: MediaInput;
		videoBitrate: MediaInput;
		frameRate: MediaInput;
		audio: MediaInput;
		audioBitrate: MediaInput;
		imageFormat?: MediaInput;
		imageQuality?: MediaInput;
		imageBackground?: MediaInput;
	};
};
export type MediaSettings = {
	format: 'mp4' | 'webm';
	maxWidth: number;
	maxHeight: number;
	videoBitrate: number;
	frameRate: number;
	audio: 'keep' | 'remove';
	audioBitrate: number;
	imageFormat?: 'auto' | 'webp' | 'jpeg' | 'png' | 'avif' | 'gif';
	imageQuality?: number;
	imageBackground?: string;
};
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const keys = (x: Record<string, unknown>, allowed: string[]) => {
	if (Object.keys(x).some((k) => !allowed.includes(k))) throw new Error('Unknown media pipeline field');
};
const optionKeys = ['format', 'maxWidth', 'maxHeight', 'videoBitrate', 'frameRate', 'audio', 'audioBitrate', 'imageFormat', 'imageQuality', 'imageBackground'];
export function validateMediaPipeline(value: unknown): asserts value is MediaPipeline {
	if (!record(value)) throw new Error('Expected a media pipeline');
	keys(value, ['file', 'start', 'cancel', 'status', 'progress', 'preview', 'imagePreview', 'download', 'output']);
	const used = new Set<string>();
	for (const key of ['file', 'start', 'cancel', 'status', 'progress', 'preview', 'imagePreview', 'download']) {
		const v = value[key];
		if (['preview', 'imagePreview', 'download'].includes(key) && v === undefined) continue;
		if (typeof v !== 'string' || !/^#[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(v) || used.has(v))
			throw new Error('Media controls require distinct element IDs inside their surface');
		used.add(v);
	}
	if (!record(value.output)) throw new Error('Expected media output settings');
	keys(value.output, optionKeys);
	for (const key of optionKeys) {
		const v = value.output[key];
		if (key.startsWith('image') && v === undefined) continue;
		if (record(v)) {
			keys(v, ['op', 'name']);
			if (
				v.op !== 'input' ||
				typeof v.name !== 'string' ||
				!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(v.name) ||
				['__proto__', 'constructor', 'prototype'].includes(v.name)
			)
				throw new Error('Media settings accept only named inputs or scalar values');
		} else if (!['number', 'string', 'boolean'].includes(typeof v)) throw new Error('Missing media output setting');
	}
	// Validate literal options now; referenced options are checked again at Run.
	const defaults = { format: 'mp4', maxWidth: 1280, maxHeight: 720, videoBitrate: 1_500_000, frameRate: 30, audio: 'keep', audioBitrate: 96_000, imageFormat: 'auto', imageQuality: 80, imageBackground: 'none' };
	validateMediaSettings(
		Object.fromEntries(optionKeys.map((k) => [k, record(value.output[k]) ? defaults[k as keyof typeof defaults] : value.output[k]]))
	);
}
export function validateMediaSettings(raw: unknown): MediaSettings {
	if (!record(raw)) throw new Error('Expected media settings');
	keys(raw, optionKeys);
	if (raw.imageFormat !== undefined && (typeof raw.imageFormat !== 'string' || !['auto', 'webp', 'jpeg', 'png', 'avif', 'gif'].includes(raw.imageFormat)))
		throw new Error('Choose auto, webp, jpeg, png, avif or gif for images');
	if (raw.imageQuality !== undefined && (typeof raw.imageQuality !== 'number' || !Number.isInteger(raw.imageQuality) || raw.imageQuality < 1 || raw.imageQuality > 100))
		throw new Error('Image quality must be a number from 1 to 100');
	if (raw.imageBackground !== undefined && (typeof raw.imageBackground !== 'string' || !/^(none|#[a-fA-F0-9]{6})$/.test(raw.imageBackground)))
		throw new Error('Image background must be none or a six-digit hex color');
	if (
		typeof raw.format !== 'string' ||
		!['mp4', 'webm'].includes(raw.format) ||
		typeof raw.audio !== 'string' ||
		!['keep', 'remove'].includes(raw.audio)
	)
		throw new Error('Choose mp4 or webm, and keep or remove audio');
	for (const key of ['maxWidth', 'maxHeight', 'videoBitrate', 'frameRate', 'audioBitrate']) {
		const v = raw[key];
		if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${key} must be a positive finite number`);
		if (['maxWidth', 'maxHeight'].includes(key) && (!Number.isInteger(v) || v < 2 || v > 0xffffffff))
			throw new Error(`${key} must be a WebCodecs dimension (integer from 2 to 4294967295)`);
	}
	return raw as MediaSettings;
}
export function resolveMediaSettings(pipeline: MediaPipeline, input: Record<string, unknown>): MediaSettings {
	validateMediaPipeline(pipeline);
	return validateMediaSettings(
		Object.fromEntries(
			Object.entries(pipeline.output).map(([key, value]) => [
				key,
				record(value) ? (Object.prototype.hasOwnProperty.call(input, value.name) ? input[value.name] : undefined) : value
			])
		)
	);
}
export function mediaDimensions(width: number, height: number, settings: MediaSettings) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height))
		throw new Error('The source has invalid video dimensions');
	const scale = Math.min(1, settings.maxWidth / width, settings.maxHeight / height);
	return { width: Math.max(2, Math.floor((width * scale) / 2) * 2), height: Math.max(2, Math.floor((height * scale) / 2) * 2) };
}
