import { WEB_FEATURES } from './catalogue';
import { observerRecipe } from './observerFixtures';
import type { PlatformExpression, PlatformProgram } from './types';
import {
	array,
	declare,
	domBatch,
	domCallback,
	domCall,
	domConstruct,
	domDocument,
	domGet,
	domSurface,
	fn,
	get,
	make,
	object,
	perform,
	returns,
	variable as v
} from './programBuilders';
export const OBSERVER_BOUNDARIES: { name: string; program: PlatformProgram; expected?: unknown; error?: string }[] = [];
function observation(name: string, feature: string, selected: unknown, expected: unknown) {
	const program = structuredClone(observerRecipe(WEB_FEATURES.find((f) => f.name === feature)!)!.program);
	program.title = name;
	program.steps!.splice(-1, 1, ...returns(selected));
	OBSERVER_BOUNDARIES.push({ name, program, expected });
}
observation('Mutation takeRecords drains native queued changes before callback delivery', 'MutationObserver.takeRecords', v('selected'), {
	recordCount: 5,
	callbackCount: 0,
	drained: true
});
observation('Mutation disconnect prevents new records after the initial queue is drained', 'MutationObserver.disconnect', v('selected'), {
	before: 5,
	after: 0
});
observation(
	'Mutation callbacks preserve their native observer receiver identity',
	'MutationObserver',
	{ op: 'binary', operator: '===', left: v('callbackObserver'), right: v('observer') },
	true
);
observation('Mutation oldValue reflects actual prior attribute and character data', 'MutationRecord.oldValue', v('selected'), [
	'Original title',
	'Original data',
	'Original text',
	null,
	null
]);
observation('Resize content box uses the native logical block size', 'ResizeObserverSize.blockSize', v('selected'), 80);
observation('Resize unobserve prevents a later geometry change callback', 'ResizeObserver.unobserve', v('selected'), { before: 1, after: 1 });
observation('Resize disconnect prevents a later geometry change callback', 'ResizeObserver.disconnect', v('selected'), { before: 1, after: 1 });
observation('Intersection unobserve prevents a later geometry change callback', 'IntersectionObserver.unobserve', v('selected'), {
	before: 1,
	after: 1
});
observation('Intersection disconnect prevents a later geometry change callback', 'IntersectionObserver.disconnect', v('selected'), {
	before: 1,
	after: 1
});
function boundary(name: string, steps: PlatformExpression[], error: string) {
	OBSERVER_BOUNDARIES.push({
		name,
		program: { version: 1, title: name, document: [{ tag: 'div', attributes: { id: 'sample' }, children: ['Owned node'] }], steps },
		error
	});
}
const callback = () => domCallback(fn(['entries', 'observer'], null));
boundary(
	'Observer construction requires a selected owned context',
	returns(domConstruct('MutationObserver', [callback()])),
	'owned document context'
);
boundary(
	'Observers reject forged callback descriptors',
	[declare('doc', domDocument()), ...returns(domConstruct('MutationObserver', [object({ $callback: 0 })]))],
	'registered worker callback'
);
boundary(
	'Observers refuse foreign intersection roots',
	[
		declare('root', domSurface()),
		...returns(domConstruct('IntersectionObserver', [callback(), object({ root: object({ $dom: 'foreign', type: 'Element' }) })]))
	],
	'stale or belongs'
);
boundary(
	'Observers bound the number of native subscriptions',
	[
		declare('doc', domDocument()),
		{
			op: 'for-of',
			name: 'index',
			value: array(...Array.from({ length: 17 }, (_, i) => i)),
			body: [perform(domConstruct('MutationObserver', [callback()]))]
		}
	],
	'Observer allocation budget'
);
boundary(
	'Observer callback registration is bounded in the authored worker',
	[{ op: 'for-of', name: 'index', value: array(...Array.from({ length: 33 }, (_, i) => i)), body: [perform(callback())] }],
	'DOM callback budget'
);
boundary(
	'DOM batches refuse nested work packets',
	[
		declare('doc', domDocument()),
		...returns({
			op: 'await',
			value: { op: 'dom', action: 'batch', args: [array(object({ action: 'batch', target: null, key: '', args: array() }))] }
		})
	],
	'Only synchronous member operations'
);
boundary(
	'DOM batches refuse async operations before invoking them',
	[
		declare('root', domSurface()),
		declare('sheet', domConstruct('CSSStyleSheet')),
		...returns(domBatch([{ action: 'call', target: v('sheet'), key: 'replace', args: ['div { color: red }'] }]))
	],
	'Asynchronous DOM operations'
);
boundary(
	'Observer options cannot grant a foreign target receiver',
	[
		declare('root', domSurface()),
		declare('observer', domConstruct('ResizeObserver', [callback()])),
		...returns(domCall(v('observer'), 'observe', [object({ $dom: 'foreign', type: 'Element' })]))
	],
	'stale or belongs'
);
boundary(
	'Observer thresholds refuse unbounded and out-of-range values',
	[declare('root', domSurface()), ...returns(domConstruct('IntersectionObserver', [callback(), object({ threshold: array(0, 1.1) })]))],
	'bounded observer number'
);
const failing = structuredClone(observerRecipe(WEB_FEATURES.find((f) => f.name === 'MutationCallback')!)!.program);
const change = (value: any) => {
	if (!value || typeof value !== 'object') return;
	if (value.op === 'dom-callback') value.value.body = [{ op: 'throw', value: make('Error', ['Saved callback failure']) }];
	else for (const child of Object.values(value)) change(child);
};
change(failing.steps);
OBSERVER_BOUNDARIES.push({ name: 'Native callback exceptions end the bounded authored run', program: failing, error: 'Saved callback failure' });
