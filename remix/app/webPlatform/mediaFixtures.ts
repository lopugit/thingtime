import { base, input, parameter, recipe } from './programBuilders';
import { MEDIA_EVENTS, MEDIA_PROPERTIES, MEDIA_WRITES } from './mediaPolicy';
import { AUDIO_SAMPLE, VIDEO_SAMPLE } from './mediaSamples';
import type { Feature, PlatformDOMBinding, PlatformNode, PlatformProgram, Recipe } from './types';

const node = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({
	tag,
	attributes,
	children
});
const button = (id: string, label: string) => node('button', { id, type: 'button' }, [label]);
const methods = new Set(['play', 'pause', 'load', 'canPlayType', 'fastSeek', 'getVideoPlaybackQuality']);
const attributes: Record<string, string> = {
	autoplay: 'autoplay',
	controls: 'controls',
	loop: 'loop',
	muted: 'defaultMuted',
	preload: 'preload',
	playsinline: 'playsInline',
	poster: 'poster',
	src: 'src'
};
const defaults: Record<string, unknown> = {
	autoplay: false,
	controls: true,
	loop: true,
	muted: false,
	defaultMuted: false,
	preservesPitch: false,
	playsInline: false,
	disableRemotePlayback: true,
	disablePictureInPicture: true,
	currentTime: 1.5,
	volume: 0.2,
	playbackRate: 1.5,
	defaultPlaybackRate: 1.5,
	width: 240,
	height: 160,
	preload: 'none',
	loading: 'lazy'
};

/** Complete Component programs: resources, controls, events and settings are data. */
export function mediaRecipe(f: Feature): Recipe | undefined {
	const handler =
		(f.language === 'html' && f.kind === 'attribute' && f.name.startsWith('on')) ||
		(f.language === 'webapi' && f.interface === 'GlobalEventHandlers' && f.member?.startsWith('on'));
	const eventName = handler ? (f.member || f.name).slice(2) : undefined;
	const html = f.language === 'html';
	const mediaInterface = ['HTMLMediaElement', 'HTMLAudioElement', 'HTMLVideoElement'].includes(f.interface || f.name);
	let property =
		html && f.kind === 'attribute' ? attributes[f.name] : mediaInterface && ['attribute', 'const'].includes(f.kind) ? f.member : undefined;
	const selectedMethod = mediaInterface && f.kind === 'operation' && methods.has(f.member || '') ? f.member : undefined;
	if (
		!(eventName && MEDIA_EVENTS.has(eventName)) &&
		!(html && f.kind === 'element' && ['audio', 'video', 'source'].includes(f.name)) &&
		!(property && MEDIA_PROPERTIES.has(property)) &&
		!selectedMethod &&
		!(mediaInterface && f.kind === 'interface')
	)
		return;
	const audio = f.name === 'audio' || (f.interface || f.name) === 'HTMLAudioElement';
	property ||= 'readyState';
	const p: PlatformProgram = {
		...base(f),
		parameters: [
			parameter('time', 'Seek to seconds', audio ? 0.4 : 1.5, 'number'),
			parameter('rate', 'Playback speed', 1.5, 'number'),
			parameter('volume', 'Volume (0–1)', 0.2, 'number'),
			parameter('muted', 'Mute sound', true, 'boolean')
		],
		dom: [],
		styles: [
			{
				selector: '#media-example',
				declarations: { display: 'grid', gap: '12px', padding: '16px', border: '1px solid #a78bfa', 'border-radius': '12px' }
			},
			{
				selector: 'audio, video',
				declarations: { width: '100%', 'max-width': '360px', 'max-height': '240px', background: '#312e81', 'border-radius': '8px' }
			},
			{ selector: '.buttons', declarations: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
			{ selector: 'button', declarations: { font: 'inherit', padding: '8px' } }
		]
	};
	const clip = audio ? AUDIO_SAMPLE : VIDEO_SAMPLE;
	const tag = audio ? 'audio' : 'video';
	const mediaAttributes: Record<string, string | number | boolean> = {
		id: 'sample',
		controls: true,
		preload: 'auto',
		muted: true,
		playsinline: true
	};
	if (f.name !== 'source') mediaAttributes.src = property === 'error' ? 'data:video/mp4;base64,AAAA' : clip;
	if (property === 'poster') mediaAttributes.poster = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
	const source = f.name === 'source' ? [node('source', { src: clip, type: 'video/mp4' })] : [];
	const explanation =
		(property === 'error'
			? 'This example intentionally uses invalid local media bytes to produce a native MediaError. Read error after the error event. '
			: '') +
		'Play the local clip, pause, seek, reload or change its speed and volume. The video changes from purple to teal; the audio is a quiet 440 Hz tone. Sound is muted by default. Results show native media state and recent events. Browser playback policy and codec support still apply.';
	p.description = `${f.name}: ${explanation}`;
	const controls = [
		button('play', 'Play'),
		button('pause', 'Pause'),
		button('seek', 'Seek'),
		button('rate', 'Apply speed'),
		button('volume', 'Apply volume'),
		button('mute', 'Apply mute'),
		button('reload', 'Reload clip'),
		button('inspect', 'Read ' + property)
	];
	if (Object.prototype.hasOwnProperty.call(MEDIA_WRITES, property)) {
		const kind = MEDIA_WRITES[property];
		p.parameters!.push(parameter('value', property + ' value', defaults[property], kind === 'string' ? 'text' : kind));
		controls.push(button('write', 'Apply ' + property));
		p.dom!.push({ target: '#sample', event: '#write|click', property, value: input('value') });
	}
	if (selectedMethod && !['play', 'pause', 'load'].includes(selectedMethod)) {
		controls.push(button('method', 'Call ' + selectedMethod));
		const args = selectedMethod === 'canPlayType' ? ['[[mime]]'] : selectedMethod === 'fastSeek' ? ['[[time]]'] : [];
		if (selectedMethod === 'canPlayType') p.parameters!.push(parameter('mime', 'Media MIME type', audio ? 'audio/wav' : 'video/mp4'));
		p.dom!.push({ target: '#sample', event: '#method|click', method: selectedMethod, args });
	}
	p.document = [
		node('section', { id: 'media-example' }, [
			node('p', {}, [explanation]),
			node(tag, mediaAttributes, source),
			node('div', { class: 'buttons' }, controls)
		])
	];
	const operation = (trigger: string, method: string): PlatformDOMBinding => ({ target: '#sample', event: `#${trigger}|click`, method });
	p.dom!.push(
		{ target: '#sample', property: 'muted', value: input('muted') },
		{ target: '#sample', property: 'volume', value: input('volume') },
		operation('play', 'play'),
		operation('pause', 'pause'),
		operation('reload', 'load'),
		{ target: '#sample', event: '#seek|click', property: 'currentTime', value: input('time') },
		{ target: '#sample', event: '#rate|click', property: 'playbackRate', value: input('rate') },
		{ target: '#sample', event: '#volume|click', property: 'volume', value: input('volume') },
		{ target: '#sample', event: '#mute|click', property: 'muted', value: input('muted') },
		{ target: '#sample', event: '#inspect|click', property },
		{ target: '#sample', property }
	);
	const observed = new Set(
		[eventName, 'loadedmetadata', 'playing', 'pause', 'ended', 'seeked', 'ratechange', 'volumechange', 'emptied', 'error'].filter(
			(e): e is string => !!e
		)
	);
	for (const name of observed)
		p.dom!.push({
			target: '#sample',
			event: `#sample|${name}`,
			label: name === eventName ? 'Selected handler' : name,
			...(name === eventName ? { binding: 'handler' as const } : {})
		});
	return recipe(p, 'interactive', explanation);
}
