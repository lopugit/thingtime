/** Closed native receiver surface; no source, account, device or navigation access. */
export const MEDIA_WRITES: Record<string, 'boolean' | 'number' | 'string'> = {
	autoplay: 'boolean',
	controls: 'boolean',
	loop: 'boolean',
	muted: 'boolean',
	defaultMuted: 'boolean',
	preservesPitch: 'boolean',
	playsInline: 'boolean',
	disableRemotePlayback: 'boolean',
	disablePictureInPicture: 'boolean',
	currentTime: 'number',
	volume: 'number',
	playbackRate: 'number',
	defaultPlaybackRate: 'number',
	width: 'number',
	height: 'number',
	preload: 'string',
	loading: 'string'
};
export const MEDIA_PROPERTIES = new Set([
	...Object.keys(MEDIA_WRITES),
	'duration',
	'paused',
	'ended',
	'seeking',
	'readyState',
	'networkState',
	'currentSrc',
	'src',
	'poster',
	'buffered',
	'played',
	'seekable',
	'error',
	'videoWidth',
	'videoHeight',
	'HAVE_NOTHING',
	'HAVE_METADATA',
	'HAVE_CURRENT_DATA',
	'HAVE_FUTURE_DATA',
	'HAVE_ENOUGH_DATA',
	'NETWORK_EMPTY',
	'NETWORK_IDLE',
	'NETWORK_LOADING',
	'NETWORK_NO_SOURCE'
]);
export const MEDIA_EVENTS = new Set(
	'loadstart loadedmetadata loadeddata canplay canplaythrough play playing pause ended emptied durationchange timeupdate ratechange volumechange seeking seeked resize'.split(
		' '
	)
);
/** Stored clips are bounded bytes in the ordinary program, never an external fetch. */
export function localPlatformResource(value: string, tag: string, attribute: string) {
	if (/^#|^data:image\/(png|jpeg|gif|webp);base64,/.test(value)) return true;
	return (
		attribute === 'src' &&
		['audio', 'video', 'source'].includes(tag) &&
		/^data:(audio\/(wav|mpeg|ogg)|video\/(mp4|webm));base64,[A-Za-z0-9+/]*={0,2}$/.test(value) &&
		value.length <= 20000
	);
}
