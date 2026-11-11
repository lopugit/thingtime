import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	variable,
	object,
	array,
	fn,
	call,
	declare,
	perform,
	project,
	awaited,
	base,
	get,
	global,
	input,
	make,
	method,
	parameter,
	recipe,
	returns
} from './programBuilders';
const equal = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const conditional = (test: unknown, yes: unknown, no: unknown) => ({ op: 'conditional', test, then: yes, else: no });

/** Event lifecycles are complete authored programs, including callbacks and
 * native listener removal. Saved Components execute without a catalogue lookup. */
export function eventApiRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name;
	if (!['Event', 'CustomEvent', 'EventTarget', 'AbortController', 'AbortSignal'].includes(name)) return undefined;
	const member = f.member || '';
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [[name]] };
	const param = (key: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		p.parameters!.push(parameter(key, label, value, type));
		return input(key);
	};
	const require = (...path: string[]) => p.requires!.push(path);
	const done = (
		value: unknown,
		note = 'Change the inputs to observe real event delivery or cancellation in an isolated worker. This program uses only its own in-memory objects.'
	) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note);
	const add = (...steps: PlatformExpression[]) => p.steps!.push(...steps);
	const event = variable('event'),
		target = variable('target'),
		delivered = variable('delivered'),
		log = variable('log');
	const listener = variable('listener'),
		controller = variable('controller'),
		signal = variable('signal');
	const isSummary = ['interface', 'constructor'].includes(f.kind);
	if (f.kind === 'const') {
		require(name, member);
		return done(get(global(name), member));
	}
	if (name === 'Event' || name === 'CustomEvent') {
		const type = param('type', 'Event type', 'thingtime-demo');
		const bubbles = param('bubbles', 'Bubbles', true, 'boolean');
		const cancelable = param('cancelable', 'Cancelable', true, 'boolean');
		const composed = param('composed', 'Composed', true, 'boolean');
		const options: Record<string, unknown> = { bubbles, cancelable, composed };
		if (name === 'CustomEvent') options.detail = param('detail', 'Detail (JSON)', { message: 'Hello Thingtime' }, 'json');
		add(declare('event', make(name, [type, object(options)])));
		const fields = ['type', 'bubbles', 'cancelable', 'composed', 'defaultPrevented', 'isTrusted', ...(name === 'CustomEvent' ? ['detail'] : [])];
		if (member === 'initEvent' || member === 'initCustomEvent') {
			require(name, 'prototype', member);
			add(declare('before', project(event, fields)));
			const args = [param('nextType', 'Replacement type', 'renamed-event'), bubbles, cancelable];
			if (name === 'CustomEvent') args.push(param('nextDetail', 'Replacement detail (JSON)', { message: 'Updated' }, 'json'));
			add(perform(method(event, member, args)));
			return done(object({ before: variable('before'), after: project(event, fields) }));
		}
		if (f.kind === 'attribute' && ['cancelBubble', 'returnValue'].includes(member)) {
			require(name, 'prototype', member);
			add(declare('before', get(event, member)));
			add(perform(method(global('Reflect'), 'set', [event, member, param('value', 'New property value', member === 'cancelBubble', 'boolean')])));
			return done(object({ before: variable('before'), after: get(event, member), defaultPrevented: get(event, 'defaultPrevented') }));
		}
		if (f.kind === 'attribute' && !['target', 'currentTarget', 'srcElement', 'eventPhase'].includes(member)) {
			// isTrusted is an unforgeable own property, not a prototype member.
			if (member !== 'isTrusted') require(name, 'prototype', member);
			return done(get(event, member));
		}
		if (
			!isSummary &&
			![
				'target',
				'currentTarget',
				'srcElement',
				'eventPhase',
				'composedPath',
				'preventDefault',
				'stopPropagation',
				'stopImmediatePropagation'
			].includes(member)
		)
			return undefined;
		require('EventTarget');
		if (f.kind === 'operation') require(name, 'prototype', member);
		add(declare('target', make('EventTarget')), declare('log', array()));
		const label = (value: unknown) => conditional(equal(value, null), null, conditional(equal(value, target), 'demo target', 'another target'));
		const snapshot = (value: unknown) =>
			object({
				type: get(value, 'type'),
				target: label(get(value, 'target')),
				currentTarget: label(get(value, 'currentTarget')),
				srcElement: label(get(value, 'srcElement')),
				eventPhase: get(value, 'eventPhase'),
				defaultPrevented: get(value, 'defaultPrevented'),
				cancelBubble: get(value, 'cancelBubble'),
				composedPath: method(method(value, 'composedPath'), 'map', [fn(['node'], label(variable('node')))])
			});
		add(declare('before', snapshot(event)));
		const actions: unknown[] = [];
		if (['preventDefault', 'stopPropagation', 'stopImmediatePropagation'].includes(member)) actions.push(method(delivered, member));
		actions.push(method(log, 'push', [object({ listener: 'first', event: snapshot(delivered) })]));
		add(perform(method(target, 'addEventListener', [type, fn(['delivered'], array(...actions))])));
		add(
			perform(
				method(target, 'addEventListener', [
					type,
					fn(['delivered'], method(log, 'push', [object({ listener: 'second', event: snapshot(delivered) })]))
				])
			)
		);
		add(declare('dispatchAccepted', method(target, 'dispatchEvent', [event])));
		return done(
			object({
				configuration: project(event, fields),
				before: variable('before'),
				delivery: log,
				after: snapshot(event),
				dispatchAccepted: variable('dispatchAccepted')
			}),
			'Observe delivery on a standalone EventTarget. stopPropagation keeps other listeners on this same target; stopImmediatePropagation stops them. A DOM tree is needed to demonstrate ancestor bubbling.'
		);
	}
	if (name === 'EventTarget') {
		if (!isSummary && !['addEventListener', 'removeEventListener', 'dispatchEvent', 'when'].includes(member)) return undefined;
		require('Event');
		if (!isSummary) require(name, 'prototype', member);
		const type = param('type', 'Event type', 'thingtime-demo');
		add(declare('target', make('EventTarget')), declare('log', array()));
		const actions: unknown[] = [];
		const options: Record<string, unknown> = {};
		if (member === 'dispatchEvent') {
			actions.push(conditional(param('preventDefault', 'Prevent default', true, 'boolean'), method(delivered, 'preventDefault'), null));
			options.cancelable = param('cancelable', 'Cancelable', true, 'boolean');
		}
		actions.push(method(log, 'push', [project(delivered, ['type', 'eventPhase', 'defaultPrevented'])]));
		add(declare('listener', fn(['delivered'], array(...actions))));
		const dispatch = () => method(target, 'dispatchEvent', [make('Event', [type, object(options)])]);
		if (member === 'when') {
			require('AbortController');
			add(declare('controller', make('AbortController')));
			add(perform(method(method(target, 'when', [type]), 'subscribe', [listener, object({ signal: get(controller, 'signal') })])));
			add(declare('firstDispatch', dispatch()), perform(method(controller, 'abort')), declare('secondDispatch', dispatch()));
		} else {
			const listenerOptions =
				member === 'removeEventListener' ? object({ capture: false }) : object({ once: param('once', 'Run listener once', false, 'boolean') });
			add(perform(method(target, 'addEventListener', [type, listener, listenerOptions])), declare('firstDispatch', dispatch()));
			if (member === 'removeEventListener') add(perform(method(target, 'removeEventListener', [type, listener, object({ capture: false })])));
			add(declare('secondDispatch', dispatch()));
		}
		return done(object({ received: log, dispatchAccepted: array(variable('firstDispatch'), variable('secondDispatch')) }));
	}
	require('AbortController');
	const state = () => project(signal, ['aborted', 'reason']);
	if (name === 'AbortSignal' && member === 'timeout') {
		require('AbortSignal', 'timeout');
		const milliseconds = param('milliseconds', 'Timeout (milliseconds; runtime is limited to 2 seconds)', 25, 'number');
		add(declare('signal', method(global('AbortSignal'), 'timeout', [milliseconds])));
		const result = object({ aborted: get(signal, 'aborted'), reasonName: get(get(signal, 'reason'), 'name') });
		return done(
			awaited(
				make('Promise', [
					fn(['resolve'], method(signal, 'addEventListener', ['abort', fn([], call(variable('resolve'), [result])), object({ once: true })]))
				])
			)
		);
	}
	if (name === 'AbortSignal' && member === 'abort') {
		require('AbortSignal', 'abort');
		add(declare('signal', method(global('AbortSignal'), 'abort', [param('reason', 'Abort reason', 'Stopped by Thingtime')])));
		return done(state());
	}
	if (name === 'AbortSignal' && member === 'any') {
		require('AbortSignal', 'any');
		add(declare('first', make('AbortController')), declare('second', make('AbortController')));
		add(declare('signal', method(global('AbortSignal'), 'any', [array(get(variable('first'), 'signal'), get(variable('second'), 'signal'))])));
		add(declare('before', state()));
		const chosen = conditional(param('useSecond', 'Abort the second controller', true, 'boolean'), variable('second'), variable('first'));
		add(perform(method(chosen, 'abort', [param('reason', 'Abort reason', 'First abort wins')])));
		return done(
			object({
				before: variable('before'),
				after: state(),
				firstAborted: get(get(variable('first'), 'signal'), 'aborted'),
				secondAborted: get(get(variable('second'), 'signal'), 'aborted')
			})
		);
	}
	if (!isSummary && !['signal', 'abort', 'aborted', 'reason', 'onabort', 'throwIfAborted'].includes(member)) return undefined;
	if (!isSummary) require(name, 'prototype', member);
	const reason = param('reason', 'Abort reason', 'Stopped by Thingtime');
	add(
		declare('controller', make('AbortController')),
		declare('signal', get(controller, 'signal')),
		declare('before', state()),
		declare('log', array())
	);
	const observer = fn([], method(log, 'push', [state()]));
	if (member === 'onabort') add(perform(method(global('Reflect'), 'set', [signal, 'onabort', observer])));
	else add(perform(method(signal, 'addEventListener', ['abort', observer])));
	if (member === 'throwIfAborted') {
		add({ op: 'if', test: param('abort', 'Abort before checking', true, 'boolean'), then: [perform(method(controller, 'abort', [reason]))] });
		add(declare('outcome', 'No exception'));
		add({
			op: 'try',
			body: [perform(method(signal, 'throwIfAborted'))],
			error: 'error',
			catch: [{ op: 'assign', name: 'outcome', value: variable('error') }]
		});
		return done(object({ aborted: get(signal, 'aborted'), outcome: variable('outcome') }));
	}
	add(perform(method(controller, 'abort', [reason])));
	return done(object({ before: variable('before'), events: log, after: state() }));
}
