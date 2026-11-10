import type { PlatformExpression, PlatformProgram } from './types';
import { WEB_FEATURES } from './catalogue';
import { animationRecipe } from './animationFixtures';
import {
	array,
	declare,
	domBatch,
	domCall,
	domConstruct,
	domDocument,
	domGet,
	domSet,
	domSurface,
	object,
	perform,
	returns,
	variable as v,
	get
} from './programBuilders';
export const ANIMATION_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
const observe = (name: string, feature: string, value: unknown, expected: unknown) => {
	const program = structuredClone(animationRecipe(WEB_FEATURES.find((f) => f.name === feature)!)!.program);
	program.title = name;
	program.steps!.splice(-1, 1, ...returns(value));
	ANIMATION_BOUNDARIES.push({ name, program, expected });
};
observe('Animation samples native interpolation at its saved currentTime', 'Animation.currentTime', get(v('result'), 'rendered'), {
	opacity: '0.625',
	transform: 'matrix(1, 0, 0, 1, 60, 0)'
});
observe('Animation finished promise resolves to its actual native receiver', 'Animation.finished', get(v('selected'), 'playState'), 'finished');
observe(
	'Animation cancel clears its currentTime and native effect',
	'Animation.cancel',
	object({
		time: get(get(v('result'), 'animation'), 'currentTime'),
		state: get(get(v('result'), 'animation'), 'playState'),
		opacity: get(get(v('result'), 'rendered'), 'opacity')
	}),
	{ time: null, state: 'idle', opacity: '1' }
);
observe('Animation computed timing reports the native half-way progress', 'ComputedEffectTiming.progress', v('selected'), 0.5);
observe(
	'Native KeyframeEffect copying preserves independent timing objects',
	'KeyframeEffect.constructor',
	object({ original: get(get(v('selected'), 'original'), 'duration'), clone: get(get(v('selected'), 'clone'), 'duration') }),
	{ original: 1000, clone: 2000 }
);
observe(
	'Animation finish emits a trusted native playback event',
	'Animation.onfinish',
	object({ type: get(v('selected'), 'type'), trusted: get(v('selected'), 'trusted'), receiverMatches: get(v('selected'), 'receiverMatches') }),
	{ type: 'finish', trusted: true, receiverMatches: true }
);
observe(
	'Animation cancel emits a trusted native playback event',
	'Animation.oncancel',
	object({ type: get(v('selected'), 'type'), trusted: get(v('selected'), 'trusted'), receiverMatches: get(v('selected'), 'receiverMatches') }),
	{ type: 'cancel', trusted: true, receiverMatches: true }
);
observe(
	'Animation replacement emits native remove and changes replaceState',
	'Animation.onremove',
	object({ type: get(v('selected'), 'type'), state: get(get(v('result'), 'animation'), 'replaceState') }),
	{ type: 'remove', state: 'removed' }
);
const boundary = (name: string, steps: PlatformExpression[], error: string) =>
	ANIMATION_BOUNDARIES.push({
		name,
		program: { version: 1, title: name, document: [{ tag: 'div', attributes: { id: 'sample' }, children: ['Owned animation'] }], steps },
		error
	});
const setup = [declare('root', domSurface()), declare('sample', domCall(v('root'), 'querySelector', ['#sample']))];
const frames = array(object({ opacity: 0 }), object({ opacity: 1 }));
const animate = () => domCall(v('sample'), 'animate', [frames, object({ duration: 1000 })]);
boundary(
	'Animation requires a run-owned active surface',
	[declare('document', domDocument()), ...returns(domConstruct('Animation'))],
	'owned surface context'
);
boundary(
	'Animation rejects a foreign effect target before construction',
	[...setup, ...returns(domConstruct('KeyframeEffect', [object({ $dom: 'foreign', type: 'Element' }), frames]))],
	'stale or belongs'
);
boundary(
	'Animation refuses a foreign timeline before native playback',
	[...setup, ...returns(domCall(v('sample'), 'animate', [frames, object({ timeline: object({ $dom: 'foreign', type: 'DocumentTimeline' }) })]))],
	'stale or belongs'
);
boundary(
	'Animation bounds native objects even without receiver reads',
	[
		declare('root', domSurface()),
		{ op: 'for-of', name: 'index', value: array(...Array.from({ length: 33 }, (_, i) => i)), body: [perform(domConstruct('DocumentTimeline'))] }
	],
	'Animation allocation budget'
);
boundary(
	'Animation bounds keyframe arrays before native parsing',
	[...setup, ...returns(domCall(v('sample'), 'animate', [array(...Array(65).fill(object({ opacity: 1 })))]))],
	'keyframe count'
);
boundary(
	'Animation rejects unknown options before native parsing',
	[...setup, ...returns(domCall(v('sample'), 'animate', [frames, object({ trigger: 'foreign authority' })]))],
	'Unknown animation dictionary'
);
boundary(
	'Animation rejects unsafe timing allocation values',
	[...setup, ...returns(domCall(v('sample'), 'animate', [frames, object({ iterations: 1001 })]))],
	'bounded animation number'
);
boundary(
	'Animation ready reads cannot hide asynchronous work in a DOM batch',
	[...setup, declare('animation', animate()), ...returns(domBatch([{ action: 'get', target: v('animation'), key: 'ready' }]))],
	'Asynchronous DOM operations'
);
boundary(
	'Animation handlers reject unregistered worker callbacks',
	[...setup, declare('animation', animate()), ...returns(domSet(v('animation'), 'onfinish', object({ $callback: 0 })))],
	'registered worker callback'
);
boundary(
	'Animation preserves native errors for out-of-order keyframe offsets',
	[...setup, ...returns(domCall(v('sample'), 'animate', [array(object({ offset: 1, opacity: 0 }), object({ offset: 0, opacity: 1 }))]))],
	''
);

ANIMATION_BOUNDARIES.push({
	name: 'Shadow-root animation queries retain only their owned native effects',
	program: {
		version: 1,
		title: 'Owned shadow animation',
		document: [
			{ tag: 'div', attributes: { id: 'host' } },
			{ tag: 'span', attributes: { id: 'sample' }, children: ['Shadow sample'] }
		],
		steps: [
			...setup,
			declare('host', domCall(v('root'), 'querySelector', ['#host'])),
			declare('shadow', domCall(v('host'), 'attachShadow', [object({ mode: 'open' })])),
			perform(domCall(v('shadow'), 'replaceChildren', [v('sample')])),
			declare('animation', animate()),
			perform(domCall(v('animation'), 'pause')),
			perform(domGet(v('animation'), 'ready')),
			...returns(get(domCall(v('shadow'), 'getAnimations'), 'length'))
		]
	},
	expected: 1
});
