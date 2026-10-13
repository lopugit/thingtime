import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import { ANIMATION_RECEIVER_POLICY } from './animationPolicy';
import {
	base,
	recipe,
	parameter,
	input,
	object,
	get,
	method,
	global,
	declare,
	perform,
	returns,
	domSurface,
	domConstruct,
	domGlobal,
	domStatic,
	domCall,
	domGet,
	domSet,
	domCallback,
	awaited,
	call,
	variable as v
} from './programBuilders';
const merge = (...values: unknown[]) => method(global('Object'), 'assign', [object({}), ...values]);
const showNode = (target: unknown) => ({
	op: 'conditional',
	test: target,
	then: object({ name: domGet(target, 'nodeName'), id: domGet(target, 'id') }),
	else: null
});
const animationState = (target: unknown) =>
	object(
		Object.fromEntries(['id', 'currentTime', 'startTime', 'playbackRate', 'playState', 'replaceState', 'pending'].map((k) => [k, domGet(target, k)]))
	);
const keyframeKinds = ['BaseKeyframe', 'BaseComputedKeyframe', 'BasePropertyIndexedKeyframe'];
const timingKinds = ['EffectTiming', 'OptionalEffectTiming', 'ComputedEffectTiming'];
const enums: Record<string, string> = {
	FillMode: 'fill',
	PlaybackDirection: 'direction',
	CompositeOperation: 'composite',
	CompositeOperationOrAuto: 'composite',
	IterationCompositeOperation: 'iterationComposite',
	AnimationPlayState: 'playState',
	AnimationReplaceState: 'replaceState'
};
/** Each example is an ordinary, complete saved program. No feature-name dispatch
 * or bespoke animation renderer participates in execution. */
export function animationRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'webapi' || !/^Web Animations/.test(f.group)) return;
	const iface = f.interface || f.name,
		member = f.member || '';
	const families = [
		...Object.keys(ANIMATION_RECEIVER_POLICY),
		...keyframeKinds,
		...timingKinds,
		...Object.keys(enums),
		'DocumentTimelineOptions',
		'AnimationPlaybackEventInit',
		'KeyframeAnimationOptions',
		'KeyframeEffectOptions',
		'GetAnimationsOptions',
		'Animatable'
	];
	if (!families.includes(iface) && !['Document.timeline', 'DocumentOrShadowRoot.getAnimations'].includes(f.name)) return;
	if (['trigger', 'rangeStart', 'rangeEnd', 'nextSibling', 'previousSibling', 'parent', 'before', 'after', 'remove', 'replace'].includes(member))
		return;
	if ((timingKinds.includes(iface) && member === 'playbackRate') || (iface === 'AnimationTimeline' && member === 'play')) return;
	const parameters: NonNullable<PlatformProgram['parameters']> = [
		parameter(
			'keyframes',
			'Keyframes',
			[
				{ offset: 0, opacity: 0.25, transform: 'translateX(0px)' },
				{ offset: 1, opacity: 1, transform: 'translateX(120px)' }
			],
			'json'
		),
		parameter(
			'timing',
			'Timing',
			{ duration: 1000, fill: 'both', easing: 'linear', direction: 'normal', iterations: 1, iterationStart: 0, delay: 0, endDelay: 0 },
			'json'
		),
		parameter('time', 'Preview time (ms)', 500, 'number'),
		parameter('id', 'Animation name', 'My reusable animation')
	];
	const p = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [
		declare('root', domSurface()),
		declare('sample', domCall(v('root'), 'querySelector', ['#sample'])),
		declare('alternate', domCall(v('root'), 'querySelector', ['#alternate'])),
		declare(
			'timeline',
			iface.startsWith('DocumentTimeline')
				? domConstruct('DocumentTimeline', [object({ originTime: p('originTime', 'Timeline origin (ms)', 0, 'number') })])
				: domGlobal('Document', 'timeline')
		)
	];
	let options: unknown = input('timing');
	if (iface === 'KeyframeEffectOptions' || ['CompositeOperation', 'IterationCompositeOperation'].includes(iface)) {
		options = merge(
			options,
			p(
				'effectOptions',
				'Effect options',
				{
					composite: 'replace',
					...(member === 'iterationComposite' || iface === 'IterationCompositeOperation' ? { iterationComposite: 'accumulate' } : {}),
					pseudoElement: member === 'pseudoElement' ? '::before' : null
				},
				'json'
			)
		);
	}
	let frames: unknown = input('keyframes');
	if (iface === 'BasePropertyIndexedKeyframe')
		frames = p(
			'indexed',
			'Property-indexed keyframes',
			{ opacity: [0.2, 1], offset: [0, 1], easing: ['linear', 'ease-in'], composite: ['replace', 'replace'] },
			'json'
		);
	if (iface === 'CompositeOperationOrAuto')
		frames = p('indexed', 'Keyframe composition', { opacity: [0.2, 1], composite: ['auto', 'replace'] }, 'json');
	const animate = iface === 'Animatable' || iface === 'KeyframeAnimationOptions';
	if (animate) {
		steps.push(
			declare('animation', domCall(v('sample'), 'animate', [frames, merge(options, object({ id: input('id'), timeline: v('timeline') }))])),
			declare('effect', domGet(v('animation'), 'effect'))
		);
	} else
		steps.push(
			declare('effect', domConstruct('KeyframeEffect', [v('sample'), frames, options])),
			declare('animation', domConstruct('Animation', [v('effect'), v('timeline')])),
			perform(domSet(v('animation'), 'id', input('id')))
		);
	steps.push(
		perform(domCall(v('animation'), 'pause')),
		perform(domGet(v('animation'), 'ready')),
		perform(domSet(v('animation'), 'currentTime', input('time')))
	);
	let selected: unknown = animationState(v('animation'));
	if (iface === 'Animation' && /^on(?:finish|cancel|remove)$/.test(member)) {
		steps.push(
			declare('pendingEvent', method(global('Promise'), 'withResolvers')),
			perform(
				domSet(
					v('animation'),
					member,
					domCallback({
						op: 'function-expression',
						params: ['event'],
						body: [
							perform(
								call(get(v('pendingEvent'), 'resolve'), [
									object({ event: v('event'), receiverMatches: { op: 'binary', operator: '===', left: { op: 'this' }, right: v('animation') } })
								])
							)
						]
					})
				)
			)
		);
		if (member === 'onremove')
			steps.push(
				perform(domCall(v('animation'), 'finish')),
				declare('replacement', domCall(v('sample'), 'animate', [frames, merge(options, object({ fill: 'both' }))])),
				perform(domCall(v('replacement'), 'finish'))
			);
		else steps.push(perform(domCall(v('animation'), member === 'onfinish' ? 'finish' : 'cancel')));
		steps.push(declare('delivery', awaited(get(v('pendingEvent'), 'promise'))), declare('event', get(v('delivery'), 'event')));
		selected = object({
			type: domGet(v('event'), 'type'),
			currentTime: domGet(v('event'), 'currentTime'),
			timelineTime: domGet(v('event'), 'timelineTime'),
			trusted: domGet(v('event'), 'isTrusted'),
			receiverMatches: get(v('delivery'), 'receiverMatches'),
			handler: domGet(v('animation'), member)
		});
	} else if (iface === 'Animation' && f.kind === 'operation') {
		steps.push(perform(domCall(v('animation'), member, member === 'updatePlaybackRate' ? [p('rate', 'Playback rate', 2, 'number')] : [])));
		if (['play', 'pause', 'reverse', 'updatePlaybackRate'].includes(member)) steps.push(perform(domGet(v('animation'), 'ready')));
		selected = animationState(v('animation'));
	} else if (iface === 'Animation' && f.kind === 'attribute') {
		if (member === 'finished') steps.push(perform(domCall(v('animation'), 'finish')));
		if (member === 'playbackRate') steps.push(perform(domSet(v('animation'), member, p('rate', 'Playback rate', 2, 'number'))));
		if (member === 'startTime') steps.push(perform(domSet(v('animation'), member, p('startTime', 'Start time (ms)', 0, 'number'))));
		if (member === 'effect')
			steps.push(
				declare('secondEffect', domConstruct('KeyframeEffect', [v('alternate'), frames, options])),
				perform(domSet(v('animation'), 'effect', v('secondEffect')))
			);
		if (member === 'timeline')
			steps.push(
				declare('secondTimeline', domConstruct('DocumentTimeline', [object({ originTime: p('originTime', 'Timeline origin (ms)', 100, 'number') })])),
				perform(domSet(v('animation'), 'timeline', v('secondTimeline')))
			);
		selected = ['ready', 'finished'].includes(member)
			? animationState(domGet(v('animation'), member))
			: member === 'effect'
			? showNode(domGet(domGet(v('animation'), member), 'target'))
			: member === 'timeline'
			? domGet(domGet(v('animation'), member), 'currentTime')
			: domGet(v('animation'), member);
	} else if (iface === 'KeyframeEffect' && f.kind === 'constructor') {
		steps.push(
			declare('clone', domConstruct('KeyframeEffect', [v('effect')])),
			perform(domCall(v('clone'), 'updateTiming', [p('cloneTiming', 'Cloned effect timing', { duration: 2000 }, 'json')]))
		);
		selected = object({
			original: domCall(v('effect'), 'getTiming'),
			clone: domCall(v('clone'), 'getTiming'),
			clonedKeyframes: domCall(v('clone'), 'getKeyframes')
		});
	} else if (iface === 'KeyframeEffect' && f.kind === 'attribute') {
		const value =
			member === 'target'
				? v('alternate')
				: member === 'pseudoElement'
				? p('pseudoElement', 'Pseudo-element', '::before')
				: p('composition', 'Composition', member === 'iterationComposite' ? 'accumulate' : 'add');
		steps.push(perform(domSet(v('effect'), member, value)));
		selected = member === 'target' ? showNode(domGet(v('effect'), member)) : domGet(v('effect'), member);
	} else if (iface === 'AnimationEffect' || (iface === 'KeyframeEffect' && f.kind === 'operation')) {
		if (member === 'updateTiming')
			steps.push(perform(domCall(v('effect'), member, [p('updatedTiming', 'Updated timing', { duration: 1500, easing: 'ease-in' }, 'json')])));
		if (member === 'setKeyframes')
			steps.push(
				perform(
					domCall(v('effect'), member, [
						p(
							'updatedKeyframes',
							'Updated keyframes',
							[
								{ opacity: 1, transform: 'translateX(0px)' },
								{ opacity: 0.3, transform: 'translateX(180px)' }
							],
							'json'
						)
					])
				)
			);
		selected = domCall(
			v('effect'),
			['getTiming', 'getComputedTiming', 'getKeyframes'].includes(member) ? member : member === 'setKeyframes' ? 'getKeyframes' : 'getComputedTiming'
		);
	} else if (timingKinds.includes(iface)) {
		steps.push(declare('timingResult', domCall(v('effect'), iface === 'ComputedEffectTiming' ? 'getComputedTiming' : 'getTiming')));
		if (member)
			steps.push({
				op: 'if',
				test: { op: 'unary', operator: '!', value: method(global('Object'), 'hasOwn', [v('timingResult'), member]) },
				then: returns(object({ status: 'unsupported', feature: f.name, message: 'This browser does not expose this native timing field.' }))
			});
		selected = member ? get(v('timingResult'), member) : v('timingResult');
	} else if (keyframeKinds.includes(iface) || iface === 'CompositeOperationOrAuto') selected = domCall(v('effect'), 'getKeyframes');
	else if (iface === 'AnimationPlaybackEvent' || iface === 'AnimationPlaybackEventInit') {
		steps.push(
			declare(
				'event',
				domConstruct('AnimationPlaybackEvent', [
					p('eventType', 'Event type', 'finish'),
					object({ currentTime: input('time'), timelineTime: p('timelineTime', 'Event timeline time (ms)', 800, 'number') })
				])
			)
		);
		selected =
			member && f.kind !== 'constructor'
				? domGet(v('event'), member)
				: object({
						type: domGet(v('event'), 'type'),
						currentTime: domGet(v('event'), 'currentTime'),
						timelineTime: domGet(v('event'), 'timelineTime'),
						trusted: domGet(v('event'), 'isTrusted')
				  });
	} else if (['AnimationTimeline', 'DocumentTimeline', 'DocumentTimelineOptions', 'Document'].includes(iface))
		selected = object({
			currentTime: domGet(v('timeline'), 'currentTime'),
			...(member === 'duration' ? { duration: domGet(v('timeline'), 'duration') } : {})
		});
	else if (iface === 'GetAnimationsOptions' || member === 'getAnimations') {
		if (member === 'pseudoElement') {
			steps.push(
				declare(
					'pseudoAnimation',
					domCall(v('sample'), 'animate', [frames, merge(options, object({ pseudoElement: '::before', id: 'Pseudo animation' }))])
				),
				perform(domCall(v('pseudoAnimation'), 'pause')),
				perform(domGet(v('pseudoAnimation'), 'ready')),
				perform(domSet(v('pseudoAnimation'), 'currentTime', input('time')))
			);
		}
		const animations =
			iface === 'DocumentOrShadowRoot'
				? domStatic('Document', 'getAnimations')
				: domCall(v(member === 'pseudoElement' ? 'sample' : 'root'), 'getAnimations', [
						p('query', 'Animation query', member === 'pseudoElement' ? { pseudoElement: '::before' } : { subtree: true }, 'json')
				  ]);
		steps.push(declare('animations', animations));
		if (member === 'pseudoElement')
			steps.push({
				op: 'if',
				test: method(v('animations'), 'some', [
					{
						op: 'function-expression',
						async: false,
						params: ['item'],
						body: returns({ op: 'binary', operator: '===', left: v('item'), right: v('animation') })
					}
				]),
				then: returns(object({ status: 'unsupported', feature: f.name, message: 'This browser ignores the pseudoElement animation query filter.' }))
			});
		selected = awaited(
			method(global('Promise'), 'all', [
				method(v('animations'), 'map', [{ op: 'function-expression', async: true, params: ['item'], body: returns(animationState(v('item'))) }])
			])
		);
	} else if (enums[iface])
		selected = ['playState', 'replaceState'].includes(enums[iface])
			? domGet(v('animation'), enums[iface])
			: ['composite', 'iterationComposite'].includes(enums[iface])
			? domGet(v('effect'), enums[iface])
			: get(domCall(v('effect'), 'getTiming'), enums[iface]);
	else if (iface === 'KeyframeEffectOptions')
		selected = member
			? domGet(v('effect'), member)
			: object({
					timing: domCall(v('effect'), 'getTiming'),
					composite: domGet(v('effect'), 'composite'),
					pseudoElement: domGet(v('effect'), 'pseudoElement')
			  });
	steps.push(
		declare('selected', selected),
		declare(
			'computed',
			domStatic('Window', 'getComputedStyle', [
				domGet(domGet(v('animation'), 'effect'), 'target'),
				domGet(domGet(v('animation'), 'effect'), 'pseudoElement')
			])
		)
	);
	steps.push(
		declare(
			'result',
			object({
				feature: f.name,
				selected: v('selected'),
				animation: animationState(v('animation')),
				timing: domCall(v('effect'), 'getComputedTiming'),
				keyframes: domCall(v('effect'), 'getKeyframes'),
				rendered: object({
					opacity: domCall(v('computed'), 'getPropertyValue', ['opacity']),
					transform: domCall(v('computed'), 'getPropertyValue', ['transform'])
				})
			})
		)
	);
	// Preserve the sampled native pixels before generic run cleanup cancels objects.
	steps.push(
		{
			op: 'if',
			test: {
				op: 'binary',
				operator: '&&',
				left: { op: 'binary', operator: '!==', left: domGet(v('animation'), 'playState'), right: 'idle' },
				right: { op: 'unary', operator: '!', value: domGet(domGet(v('animation'), 'effect'), 'pseudoElement') }
			},
			then: [perform(domCall(v('animation'), 'commitStyles'))]
		},
		...returns(v('result'))
	);
	return recipe(
		{
			...base(f),
			parameters,
			requires: [['Promise', 'withResolvers']],
			document: [
				{
					tag: 'section',
					attributes: { class: 'stage' },
					children: [
						{ tag: 'div', attributes: { id: 'sample', class: 'tile' }, children: ['Reusable animation'] },
						{ tag: 'div', attributes: { id: 'alternate', class: 'tile alternate' }, children: ['Alternate target'] }
					]
				}
			],
			styles: [
				{ selector: '.stage', declarations: { padding: '24px', overflow: 'hidden', 'min-height': '200px', background: '#f5f3ff' } },
				{ selector: '.tile', declarations: { width: '150px', padding: '16px', background: '#a78bfa', color: '#211345', 'border-radius': '12px' } },
				{ selector: '.alternate', declarations: { margin: '12px 0', background: '#67e8f9' } },
				{ selector: '.tile::before', declarations: { content: '"✦ "' } }
			],
			steps
		},
		'interactive',
		'Edit the saved keyframes, timing, native operations and result projections. Run samples a real browser animation. Element samples retain their computed appearance; pseudo-element samples report their computed styles. Native objects are canceled when the run ends.'
	);
}
