import { nativeDescriptor, nativeValue, UnsupportedDOMFeature } from './liveDOM';
import { MEDIA_PROPERTIES, MEDIA_WRITES } from './mediaPolicy';

function media(target: unknown): target is HTMLMediaElement {
	return typeof HTMLMediaElement !== 'undefined' && target instanceof HTMLMediaElement;
}
function scalar(value: unknown): unknown {
	if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
	if (typeof value === 'string') return value.slice(0, 256);
	return typeof value === 'boolean' || value === null ? value : undefined;
}
export function readMediaProperty(target: Element, name: string): unknown {
	if (!media(target) || !MEDIA_PROPERTIES.has(name)) throw new Error('Expected a registered media receiver and property');
	if (!nativeDescriptor(target, name)) throw new UnsupportedDOMFeature('This browser does not implement the media property ' + name);
	const value = nativeValue(target, name);
	if (['buffered', 'played', 'seekable'].includes(name) && value) {
		const ranges = value as TimeRanges;
		const length = Number(nativeValue(ranges, 'length'));
		const start = nativeDescriptor(ranges, 'start')!.value,
			end = nativeDescriptor(ranges, 'end')!.value;
		return {
			length,
			ranges: Array.from({ length: Math.min(length, 20) }, (_, index) => ({ start: start.call(ranges, index), end: end.call(ranges, index) }))
		};
	}
	if (name === 'error' && value)
		return { code: scalar(nativeValue(value as object, 'code')), message: scalar(nativeValue(value as object, 'message')) };
	return scalar(value);
}
export function writeMediaProperty(target: Element, name: string, value: unknown) {
	if (!media(target) || !Object.prototype.hasOwnProperty.call(MEDIA_WRITES, name)) throw new Error('Media property is not writable');
	if (typeof value !== MEDIA_WRITES[name] || (typeof value === 'number' && !Number.isFinite(value)))
		throw new Error('Media input has the wrong scalar type');
	const setter = nativeDescriptor(target, name)?.set;
	if (!setter) throw new UnsupportedDOMFeature('This browser does not implement the media setter ' + name);
	setter.call(target, value);
	return readMediaProperty(target, name);
}
export function mediaReceipt(target: unknown) {
	if (!media(target)) return undefined;
	return Object.fromEntries(
		['currentTime', 'duration', 'paused', 'ended', 'seeking', 'readyState', 'networkState', 'muted', 'volume', 'playbackRate', 'error'].map(
			(name) => [name, readMediaProperty(target, name)]
		)
	);
}
export function mediaMethodResult(result: unknown) {
	if (typeof VideoPlaybackQuality !== 'undefined' && result instanceof VideoPlaybackQuality)
		return Object.fromEntries(
			['creationTime', 'totalVideoFrames', 'droppedVideoFrames', 'corruptedVideoFrames'].map((name) => [name, scalar(nativeValue(result, name))])
		);
	return typeof result === 'object' ? String(result) : result ?? null;
}
