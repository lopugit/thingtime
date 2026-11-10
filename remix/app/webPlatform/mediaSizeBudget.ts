import { validateMaxOutputBytes } from './mediaPipeline';

/** Budget the complete duration, retaining audio and reserving mux overhead.
 * Actual muxed bytes remain authoritative; bitrate is only an initial estimate. */
export function initialVideoBudget(duration: number, videoBitrate: number, audioBitrate: number, maximum?: number) {
	validateMaxOutputBytes(maximum);
	if (![duration, videoBitrate, audioBitrate].every((value) => Number.isFinite(value) && value >= 0) || duration <= 0 || videoBitrate <= 0)
		throw new Error('Invalid video size budget');
	if (maximum === undefined) return { videoBitrate, audioBitrate };
	const available = (maximum * 0.88 * 8) / duration;
	const audio = Math.min(audioBitrate, available * 0.25);
	const video = Math.min(videoBitrate, available - audio);
	if (video < 1 || (audioBitrate > 0 && audio < 1)) throw new Error('Maximum output size is too small for the complete duration and selected audio');
	return { videoBitrate: Math.floor(video), audioBitrate: audioBitrate ? Math.max(1, Math.floor(audio)) : 0 };
}
export function nextVideoBudget(
	current: { videoBitrate: number; audioBitrate: number; width: number; height: number },
	actualBytes: number,
	maximum: number
) {
	if (validateMaxOutputBytes(maximum) === undefined) throw new Error('A retry requires maximum output bytes');
	if (
		!Number.isSafeInteger(actualBytes) ||
		actualBytes < 1 ||
		!Object.values(current).every((value) => Number.isFinite(value) && value >= 0) ||
		current.videoBitrate < 1 ||
		current.width < 2 ||
		current.height < 2
	)
		throw new Error('Invalid video retry budget');
	const ratio = Math.min(0.75, (maximum / actualBytes) * 0.8);
	return {
		videoBitrate: Math.max(1, Math.floor(current.videoBitrate * ratio)),
		audioBitrate: current.audioBitrate ? Math.max(1, Math.floor(current.audioBitrate * ratio)) : 0,
		width: Math.max(2, Math.floor((current.width * Math.sqrt(ratio)) / 2) * 2),
		height: Math.max(2, Math.floor((current.height * Math.sqrt(ratio)) / 2) * 2)
	};
}
