import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	array,
	awaited,
	base,
	call,
	declare,
	domBatch,
	domCall,
	domCallback,
	domConstruct,
	domDocument,
	domGet,
	domSet,
	domSurface,
	fn,
	get,
	global,
	input,
	make,
	method,
	object,
	parameter,
	perform,
	recipe,
	returns,
	variable as v
} from './programBuilders';
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const add = (left: unknown, right: unknown) => ({ op: 'binary', operator: '+', left, right });
const show = (value: unknown) => awaited(call(v('describe'), [value]));
const map = (value: unknown, callback: unknown) => method(value, 'map', [callback]);
const promiseAll = (value: unknown) => awaited(method(global('Promise'), 'all', [value]));
const nativeFields = (names: string[]) => object(Object.fromEntries(names.map((n) => [n, show(domGet(v('item'), n))])));
const fields: Record<string, string[]> = {
	MutationRecord: [
		'type',
		'target',
		'addedNodes',
		'removedNodes',
		'previousSibling',
		'nextSibling',
		'attributeName',
		'attributeNamespace',
		'oldValue'
	],
	ResizeObserverEntry: ['target', 'contentRect', 'contentBoxSize', 'borderBoxSize'],
	ResizeObserverSize: ['inlineSize', 'blockSize'],
	IntersectionObserverEntry: ['time', 'rootBounds', 'boundingClientRect', 'intersectionRect', 'isIntersecting', 'intersectionRatio', 'target'],
	DOMRectReadOnly: ['x', 'y', 'width', 'height'],
	DOMRect: ['x', 'y', 'width', 'height']
};
/** Result projection is itself editable program data, including recursive native reads. */
const describe: PlatformExpression = {
	op: 'function-declaration',
	name: 'describe',
	async: true,
	params: ['item'],
	body: [
		{ op: 'if', test: method(global('Array'), 'isArray', [v('item')]), then: returns(promiseAll(map(v('item'), v('describe')))) },
		{
			op: 'if',
			test: { op: 'binary', operator: '&&', left: v('item'), right: get(v('item'), '$dom') },
			then: [
				declare('type', get(v('item'), 'type')),
				...Object.entries(fields).map(([type, names]) => ({ op: 'if', test: eq(v('type'), type), then: returns(nativeFields(names)) })),
				{
					op: 'if',
					test: eq(v('type'), 'NodeList'),
					then: [
						declare('length', domGet(v('item'), 'length')),
						...returns(
							promiseAll(
								map(method(global('Array'), 'from', [object({ length: v('length') }), fn(['unused', 'index'], v('index'))]), {
									op: 'function-expression',
									async: true,
									params: ['index'],
									body: returns(show(domCall(v('item'), 'item', [v('index')])))
								})
							)
						)
					]
				},
				...returns(object({ nodeName: domGet(v('item'), 'nodeName'), text: domGet(v('item'), 'textContent') }))
			]
		},
		...returns(v('item'))
	]
};
const delay = (milliseconds: number) => awaited(make('Promise', [fn(['resolve'], call(global('setTimeout'), [v('resolve'), milliseconds]))]));
const callback = domCallback({
	op: 'function-expression',
	params: ['entries', 'observer'],
	body: [
		perform({ op: 'assign-expression', target: v('callbackObserver'), value: v('observer') }),
		perform(method(v('deliveries'), 'push', [v('entries')])),
		perform(call(get(v('pending'), 'resolve'), [v('entries')]))
	]
});
const isMutation = (f: Feature) => f.group === 'DOM Standard' && /^Mutation(?:Observer|Record|Callback)/.test(f.name);
export function observerRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'webapi' || !(['Intersection Observer', 'Resize Observer Module Level 1'].includes(f.group) || isMutation(f))) return;
	const mutation = isMutation(f),
		resize = f.group === 'Resize Observer Module Level 1';
	const family = mutation ? 'MutationObserver' : resize ? 'ResizeObserver' : 'IntersectionObserver';
	const iface = f.interface || f.name,
		member = f.member || '';
	const parameters: NonNullable<PlatformProgram['parameters']> = [parameter('size', 'Sample size (px)', 80, 'number')];
	const p = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [
		describe,
		declare('surface', mutation ? domDocument() : domSurface()),
		declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])),
		declare('pending', method(global('Promise'), 'withResolvers')),
		declare('callbackObserver', null),
		declare('deliveries', array())
	];
	let selected: unknown, observations: unknown;
	if (mutation) {
		const options: Record<string, unknown> = {
			childList: true,
			attributes: true,
			attributeOldValue: true,
			characterData: true,
			characterDataOldValue: true,
			subtree: true
		};
		if (member === 'attributeFilter') options.attributeFilter = ['title'];
		const config = p('options', 'Mutation observation options', options, 'json');
		const value = p('value', 'New text and attribute value', 'Customisable Things');
		steps.push(
			declare('observer', domConstruct(family, [callback])),
			declare('text', domGet(v('sample'), 'firstChild')),
			declare('tail', domCall(v('surface'), 'querySelector', ['#tail'])),
			declare('child', domCall(v('surface'), 'createElement', ['span'])),
			perform(domSet(v('child'), 'textContent', value)),
			perform(domCall(v('observer'), 'observe', [v('sample'), config]))
		);
		const commands = [
			{ action: 'call' as const, target: v('sample'), key: 'setAttribute', args: ['title', value] },
			{ action: 'call' as const, target: v('sample'), key: 'setAttribute', args: ['data-x', value] },
			{ action: 'set' as const, target: v('text'), key: 'data', args: [value] },
			{ action: 'call' as const, target: v('sample'), key: 'insertBefore', args: [v('child'), v('tail')] },
			{ action: 'call' as const, target: v('sample'), key: 'removeChild', args: [v('child')] }
		];
		const draining = ['takeRecords', 'disconnect'].includes(member);
		steps.push(
			declare('batch', domBatch([...commands, ...(draining ? [{ action: 'call' as const, target: v('observer'), key: 'takeRecords' }] : [])]))
		);
		steps.push(declare('records', draining ? get(v('batch'), commands.length) : awaited(get(v('pending'), 'promise'))));
		steps.push(declare('mutationRecords', show(v('records'))));
		observations = v('mutationRecords');
		if (member === 'disconnect') {
			steps.push(
				perform(domCall(v('observer'), 'disconnect')),
				declare('after', domBatch([...commands, { action: 'call', target: v('observer'), key: 'takeRecords' }]))
			);
			selected = object({ before: get(v('records'), 'length'), after: get(get(v('after'), commands.length), 'length') });
		} else if (iface === 'MutationRecord' && member) selected = map(v('mutationRecords'), fn(['record'], get(v('record'), member)));
		else selected = object({ recordCount: get(v('records'), 'length'), callbackCount: get(v('deliveries'), 'length'), drained: draining });
	} else if (iface === 'IntersectionObserverEntryInit' || (iface === 'IntersectionObserverEntry' && f.kind === 'constructor')) {
		const init = p(
			'entry',
			'Native entry constructor fields',
			{
				time: 42,
				rootBounds: { x: 0, y: 0, width: 200, height: 100 },
				boundingClientRect: { x: 4, y: 8, width: 80, height: 60 },
				intersectionRect: { x: 4, y: 8, width: 40, height: 60 },
				isIntersecting: true,
				isVisible: true,
				intersectionRatio: 0.5
			},
			'json'
		);
		steps.push(
			declare('entry', domConstruct('IntersectionObserverEntry', [method(global('Object'), 'assign', [object({ target: v('sample') }), init])]))
		);
		observations = show(v('entry'));
		selected = f.kind === 'field' ? show(domGet(v('entry'), member)) : observations;
	} else {
		const config = resize
			? p('options', 'Resize observation options', { box: 'content-box' }, 'json')
			: p(
					'options',
					'Intersection observation options',
					{
						rootMargin: '0px',
						threshold: [0, 0.5, 1],
						...(member === 'scrollMargin' ? { scrollMargin: '10px' } : {}),
						...(['delay', 'trackVisibility', 'isVisible'].includes(member) ? { delay: 100, trackVisibility: true } : {})
					},
					'json'
			  );
		steps.push(declare('root', domCall(v('surface'), 'querySelector', ['#viewport'])));
		let constructorOptions: unknown = config;
		if (!resize) {
			const ownedRoot = p('ownedRoot', 'Use the example scroll container as root', true, 'boolean');
			constructorOptions = method(global('Object'), 'assign', [
				object({ root: { op: 'conditional', test: ownedRoot, then: v('root'), else: null } }),
				config
			]);
		}
		steps.push(
			declare('observer', domConstruct(family, resize ? [callback] : [callback, constructorOptions])),
			perform(domCall(v('observer'), 'observe', resize ? [v('sample'), config] : [v('sample')])),
			declare('records', awaited(get(v('pending'), 'promise'))),
			declare('entry', get(v('records'), 0))
		);
		if (resize && ['ResizeObserverOptions', 'ResizeObserverBoxOptions'].includes(iface)) {
			steps.push(perform(domCall(domGet(v('sample'), 'style'), 'setProperty', ['border-width', '12px', ''])), perform(delay(120)));
		}
		observations = show(v('entry'));
		if (['disconnect', 'unobserve'].includes(member)) {
			steps.push(
				perform(domCall(v('observer'), member, member === 'unobserve' ? [v('sample')] : [])),
				declare('before', get(v('deliveries'), 'length')),
				perform(domCall(domGet(v('sample'), 'style'), 'setProperty', ['height', add(add(input('size'), 40), 'px'), ''])),
				perform(delay(180))
			);
			selected = object({ before: v('before'), after: get(v('deliveries'), 'length') });
		} else if (member === 'takeRecords') selected = show(domCall(v('observer'), 'takeRecords'));
		else if (iface === 'ResizeObserverSize')
			selected = member ? domGet(get(domGet(v('entry'), 'contentBoxSize'), 0), member) : show(get(domGet(v('entry'), 'contentBoxSize'), 0));
		else if (iface === family && f.kind === 'attribute') selected = show(domGet(v('observer'), member));
		else if (iface === 'IntersectionObserverInit' && member) selected = show(domGet(v('observer'), member === 'threshold' ? 'thresholds' : member));
		else if (iface.endsWith('Entry') && member) selected = show(domGet(v('entry'), member));
		else selected = object({ delivered: get(v('records'), 'length'), callbacks: get(v('deliveries'), 'length') });
	}
	steps.push(declare('selected', selected), declare('observations', observations));
	if (!(iface === 'IntersectionObserverEntryInit' || (iface === 'IntersectionObserverEntry' && f.kind === 'constructor')))
		steps.push(perform(domCall(v('observer'), 'disconnect')));
	steps.push(
		...returns(
			object({
				feature: f.name,
				selected: v('selected'),
				observations: v('observations'),
				...(iface === 'IntersectionObserverEntryInit' || (iface === 'IntersectionObserverEntry' && f.kind === 'constructor')
					? {}
					: { callbackReceiverMatches: eq(v('callbackObserver'), v('observer')) })
			})
		)
	);
	return recipe(
		{
			...base(f),
			parameters,
			requires: [['Promise', 'withResolvers']],
			document: [
				{
					tag: 'p',
					children: ['Edit the inputs, then run to receive native observer records. Each run disconnects its observers when it finishes.']
				},
				{
					tag: 'div',
					attributes: { id: 'viewport', style: 'position:relative;width:220px;height:140px;overflow:auto;border:2px solid #aaa' },
					children: [
						{
							tag: 'div',
							attributes: {
								id: 'sample',
								title: 'Original title',
								'data-x': 'Original data',
								style: 'margin-top:40px;width:[[size]]px;height:[[size]]px;padding:6px;border:3px solid #77a;box-sizing:content-box'
							},
							children: ['Original text', { tag: 'span', attributes: { id: 'tail' }, children: ['Tail'] }]
						}
					]
				}
			],
			steps
		},
		'interactive',
		'Customise this saved observer program, its options and callback function. It uses native records from its own document or rendered surface; the shared two-second deadline and Stop release every observer.'
	);
}
