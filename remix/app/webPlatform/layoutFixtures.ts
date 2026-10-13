import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	base,
	recipe,
	parameter,
	input,
	variable as v,
	declare,
	perform,
	domSurface,
	domGet,
	domSet,
	domCall,
	domConstruct,
	domStatic,
	domGlobal,
	object,
	array,
	get,
	method,
	returns,
	awaited,
	call
} from './programBuilders';
const eq = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const plus = (left: unknown, right: unknown) => ({ op: 'binary', operator: '+', left, right });
const show = (value: unknown) => awaited(call(v('describeLayout'), [value]));
const projection = (target: unknown, keys: string) => object(Object.fromEntries(keys.split(' ').map((k) => [k, domGet(target, k)])));
const describe: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeLayout',
	params: ['item'],
	async: true,
	body: [
		{ op: 'if', test: { op: 'binary', operator: '==', left: v('item'), right: null }, then: returns(v('item')) },
		{
			op: 'if',
			test: method({ op: 'global', name: 'Array' }, 'isArray', [v('item')]),
			then: [
				declare('parts', array()),
				{ op: 'for-of', name: 'part', value: v('item'), body: [perform(method(v('parts'), 'push', [show(v('part'))]))] },
				...returns(v('parts'))
			]
		},
		{
			op: 'if',
			test: get(v('item'), '$dom'),
			then: [
				declare('type', get(v('item'), 'type')),
				...Object.entries({
					DOMRect: 'x y width height top right bottom left',
					DOMRectReadOnly: 'x y width height top right bottom left',
					DOMPoint: 'x y z w',
					DOMPointReadOnly: 'x y z w',
					DOMMatrix: 'a b c d e f',
					DOMMatrixReadOnly: 'a b c d e f',
					MediaQueryList: 'matches media',
					MediaQueryListEvent: 'matches media type isTrusted',
					MouseEvent: 'offsetX offsetY pageX pageY x y type isTrusted',
					Screen: 'availHeight availWidth colorDepth height pixelDepth width',
					VisualViewport: 'height offsetLeft offsetTop pageLeft pageTop scale width'
				}).map(([type, keys]) => ({ op: 'if', test: eq(v('type'), type), then: returns(projection(v('item'), keys)) })),
				{
					op: 'if',
					test: eq(v('type'), 'DOMQuad'),
					then: returns(object({ points: domCall(v('item'), 'toJSON'), bounds: show(domCall(v('item'), 'getBounds')) }))
				},
				{
					op: 'if',
					test: eq(v('type'), 'DOMRectList'),
					then: [
						declare('parts', array()),
						declare('count', domGet(v('item'), 'length')),
						{
							op: 'for-of',
							name: 'index',
							value: method({ op: 'global', name: 'Array' }, 'from', [
								object({ length: v('count') }),
								{ op: 'function', params: ['unused', 'i'], value: v('i') }
							]),
							body: [perform(method(v('parts'), 'push', [show(domCall(v('item'), 'item', [v('index')]))]))]
						},
						...returns(object({ length: v('count'), items: v('parts') }))
					]
				},
				{
					op: 'if',
					test: eq(v('type'), 'CaretPosition'),
					then: returns(
						object({
							offset: domGet(v('item'), 'offset'),
							node: show(domGet(v('item'), 'offsetNode')),
							rectangle: show(domCall(v('item'), 'getClientRect'))
						})
					)
				},
				{
					op: 'if',
					test: eq(v('type'), 'Range'),
					then: returns(object({ bounds: show(domCall(v('item'), 'getBoundingClientRect')), rectangles: show(domCall(v('item'), 'getClientRects')) }))
				},
				...returns(object({ type: v('type'), name: domGet(v('item'), 'nodeName'), text: domGet(v('item'), 'textContent') }))
			]
		},
		...returns(v('item'))
	]
};
export function layoutRecipe(f: Feature): Recipe | null {
	const geometry =
		f.spec.includes('geometry-1') && (/^DOMQuad(?:Init)?(?:\.|$)|^DOMRectList(?:\.|$)/.test(f.name) || f.name === 'DOMMatrix.setMatrixValue');
	if (f.language !== 'webapi' || !(f.spec.includes('cssom-view') || geometry)) return null;
	const iface = f.interface || f.name,
		member = f.member || '';
	const parameters: NonNullable<PlatformProgram['parameters']> = [parameter('width', 'Sample width (px)', 180, 'number')];
	const add = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [
		describe,
		declare('surface', domSurface()),
		declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])),
		declare('text', domCall(v('surface'), 'querySelector', ['#text']))
	];
	const dom: NonNullable<PlatformProgram['dom']> = [];
	let selected: unknown = null;
	let note =
		'Edit the saved program and inspect real layout measurements in this isolated preview. Read-only screen values depend on your browser; unsupported APIs are reported explicitly.';
	const native = (namespace: string, key: string, args: unknown[] = []) => {
		steps.push(declare('operation', domStatic(namespace, key, args)));
		selected = v('operation');
	};
	const invoke = (target: unknown, key: string, args: unknown[] = []) => {
		steps.push(declare('operation', domCall(target, key, args)));
		selected = v('operation');
	};
	const read = (target: unknown, key: string) => {
		selected = domGet(target, key);
	};
	const rect = () => steps.push(declare('rect', domCall(v('text'), 'getBoundingClientRect')));
	if (geometry) {
		if (iface === 'DOMMatrix') {
			steps.push(declare('matrix', domConstruct('DOMMatrix')));
			invoke(v('matrix'), 'setMatrixValue', [add('transform', 'Transform list', 'translate(24px, 16px) rotate(15deg)')]);
		} else if (iface === 'DOMRectList') {
			steps.push(declare('rects', domCall(v('text'), 'getClientRects')));
			selected =
				member === 'item'
					? domCall(v('rects'), 'item', [add('index', 'Rectangle index', 0, 'number')])
					: member === 'length'
					? domGet(v('rects'), 'length')
					: v('rects');
		} else {
			if (member === 'fromRect') native('DOMQuad', 'fromRect', [add('rectangle', 'Rectangle', { x: 10, y: 20, width: 120, height: 60 }, 'json')]);
			else {
				const quad = add('quad', 'Four points', { p1: { x: 0, y: 0 }, p2: { x: 120, y: 10 }, p3: { x: 110, y: 70 }, p4: { x: 10, y: 60 } }, 'json');
				steps.push(
					declare(
						'quad',
						member === 'constructor'
							? domConstruct(
									'DOMQuad',
									['p1', 'p2', 'p3', 'p4'].map((k) => get(quad, k))
							  )
							: domStatic('DOMQuad', 'fromQuad', [quad])
					)
				);
				selected = ['getBounds', 'toJSON'].includes(member)
					? domCall(v('quad'), member)
					: /^p[1-4]$/.test(member)
					? domGet(v('quad'), member)
					: v('quad');
			}
		}
	} else if (iface === 'Screen' || iface === 'VisualViewport') {
		steps.push(declare('receiver', domGlobal('Window', iface === 'Screen' ? 'screen' : 'visualViewport')));
		selected = member && !member.startsWith('on') ? domGet(v('receiver'), member) : v('receiver');
		if (member.startsWith('on')) {
			const event = member.slice(2);
			dom.push(
				{ target: '$visualViewport', event: '$visualViewport|' + event, binding: 'handler' },
				{ target: '#tail', event: '#scroll|click', method: 'scrollIntoView', args: [{ behavior: 'instant', block: 'end' }] }
			);
			note += ' Resize or zoom the preview, or scroll to its lower marker, to observe the native viewport handler.';
		}
	} else if (iface === 'Window') {
		if (member === 'matchMedia') native('Window', member, [add('query', 'Media query', '(min-width: 400px)')]);
		else if (/^(?:scroll|move|resize)(?:By|To)?$/.test(member)) {
			if (member.startsWith('scroll'))
				native('Window', member, [add('options', 'Scroll options', { left: 0, top: 40, behavior: 'instant' }, 'json')]);
			else native('Window', member, [add('x', 'X / width', 20, 'number'), add('y', 'Y / height', 20, 'number')]);
			selected = object(
				Object.fromEntries(
					'innerWidth innerHeight outerWidth outerHeight scrollX scrollY screenX screenY'.split(' ').map((k) => [k, domGlobal('Window', k)])
				)
			);
			note += ' Browsers usually refuse window moving and resizing inside an iframe; the result reports the actual values after the call.';
		} else selected = domGlobal('Window', member);
	} else if (iface === 'MediaQueryList' || iface === 'MediaQueryListEvent' || iface === 'MediaQueryListEventInit') {
		const query = add('query', 'Media query', '(min-width: 400px)');
		if (iface === 'MediaQueryList') {
			steps.push(declare('query', domStatic('Window', 'matchMedia', [query])));
			selected = ['matches', 'media'].includes(member) ? domGet(v('query'), member) : v('query');
			if (['onchange', 'addListener', 'removeListener'].includes(member)) {
				dom.push(
					{
						target: '$media:[[query]]',
						event: '$media:[[query]]|change',
						binding: member === 'onchange' ? 'handler' : 'legacy',
						...(member === 'removeListener' ? { removeOn: '#remove|click' } : {})
					},
					{
						target: '$media:[[query]]',
						event: '#dispatch|click',
						method: 'dispatchEvent',
						args: [{ op: 'event', interface: 'MediaQueryListEvent', type: 'change', init: { matches: true, media: '(min-width: 400px)' } }]
					}
				);
				note +=
					' Resize the preview to change matching. Dispatch sends an explicitly synthetic native event (isTrusted=false); Remove unregisters the exact callback.';
			}
		} else {
			steps.push(
				declare(
					'event',
					domConstruct('MediaQueryListEvent', ['change', object({ media: query, matches: add('matches', 'Matches', true, 'boolean') })])
				)
			);
			selected = ['matches', 'media'].includes(member) ? domGet(v('event'), member) : v('event');
		}
	} else if (iface === 'MouseEvent') {
		steps.push(
			declare(
				'event',
				domConstruct('MouseEvent', [
					'mousemove',
					object({ clientX: add('x', 'Client X', 30, 'number'), clientY: add('y', 'Client Y', 20, 'number') })
				])
			)
		);
		selected = member ? domGet(v('event'), member) : v('event');
		dom.push({ target: '#sample', event: '#sample|mousemove', label: 'Real pointer coordinates' });
		note += ' The initial receipt comes from a constructed MouseEvent. Move over the sample to observe real pointer coordinates.';
	} else if (iface === 'Range') {
		steps.push(declare('range', domStatic('Document', 'createRange')), perform(domCall(v('range'), 'selectNodeContents', [v('text')])));
		selected = member ? domCall(v('range'), member) : v('range');
	} else if (iface === 'CaretPosition' || iface === 'CaretPositionFromPointOptions' || (iface === 'Document' && member !== 'scrollingElement')) {
		const shadowCaret = iface === 'CaretPositionFromPointOptions';
		if (shadowCaret)
			steps.push(
				declare('shadow', domCall(v('sample'), 'attachShadow', [object({ mode: 'open' })])),
				perform(domCall(v('shadow'), 'replaceChildren', [v('text')]))
			);
		rect();
		const x = plus(domGet(v('rect'), 'x'), add('x', 'X within text', 5, 'number')),
			y = plus(domGet(v('rect'), 'y'), 8);
		const caret = iface !== 'Document' || member === 'caretPositionFromPoint';
		const roots = shadowCaret
			? { op: 'conditional', test: add('includeShadow', 'Include the owned shadow root', true, 'boolean'), then: array(v('shadow')), else: array() }
			: array();
		native('Document', caret ? 'caretPositionFromPoint' : member, caret ? [x, y, object({ shadowRoots: roots })] : [x, y]);
		if (iface === 'CaretPosition' && member)
			selected = {
				op: 'conditional',
				test: v('operation'),
				then: member === 'getClientRect' ? domCall(v('operation'), member) : domGet(v('operation'), member),
				else: null
			};
	} else if (iface === 'Document') selected = domGlobal('Document', 'scrollingElement');
	else if (iface === 'HTMLElement' || iface === 'HTMLImageElement') {
		steps.push(declare('element', domCall(v('surface'), 'querySelector', [iface === 'HTMLImageElement' ? '#image' : '#text'])));
		selected = member ? domGet(v('element'), member) : projection(v('element'), 'x y');
	} else if (['GeometryUtils', 'GeometryNode', 'CSSBoxType', 'BoxQuadOptions', 'ConvertCoordinateOptions'].includes(iface)) {
		const options = add(
			'options',
			'Coordinate options',
			iface === 'ConvertCoordinateOptions' || member.startsWith('convert') ? { fromBox: 'border', toBox: 'padding' } : { box: 'border' },
			'json'
		);
		if (member.startsWith('convert') || iface === 'ConvertCoordinateOptions') {
			const key = member.startsWith('convert') ? member : 'convertPointFromNode';
			const shape = key.includes('Quad')
				? { p1: { x: 0, y: 0 }, p2: { x: 80, y: 0 }, p3: { x: 80, y: 40 }, p4: { x: 0, y: 40 } }
				: key.includes('Rect')
				? { x: 0, y: 0, width: 80, height: 40 }
				: { x: 10, y: 15 };
			invoke(v('sample'), key, [add('shape', 'Source geometry', shape, 'json'), v('text'), options]);
		} else invoke(v('sample'), 'getBoxQuads', [member === 'relativeTo' ? object({ box: 'border', relativeTo: v('text') }) : options]);
	} else if (iface === 'CheckVisibilityOptions' || (iface === 'Element' && member === 'checkVisibility')) {
		const options = add(
			'options',
			'Visibility options',
			{ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true },
			'json'
		);
		add('opacity', 'Sample opacity', 0, 'number');
		invoke(v('sample'), 'checkVisibility', [options]);
	} else if (/^Scroll/.test(iface) || (iface === 'Element' && /^scroll(?:To|By|IntoView)?$/.test(member))) {
		const into = iface.startsWith('ScrollIntoView') || iface === 'ScrollLogicalPosition' || member === 'scrollIntoView';
		const options = add(
			'options',
			'Scroll options',
			into ? { behavior: 'instant', block: 'end', inline: 'nearest', container: 'nearest' } : { behavior: 'instant', left: 35, top: 45 },
			'json'
		);
		invoke(
			into ? domCall(v('surface'), 'querySelector', ['#marker']) : v('sample'),
			into ? 'scrollIntoView' : ['scroll', 'scrollTo', 'scrollBy'].includes(member) ? member : 'scrollTo',
			[options]
		);
		selected = projection(v('sample'), 'scrollLeft scrollTop scrollWidth scrollHeight clientWidth clientHeight');
	} else if (iface === 'Element') {
		if (member === 'scrollTop' || member === 'scrollLeft')
			steps.push(perform(domSet(v('sample'), member, add('offset', 'Scroll offset', 30, 'number'))));
		selected = member.startsWith('get') ? domCall(v('sample'), member) : domGet(v('sample'), member);
	} else throw new Error('Missing layout recipe: ' + f.name);
	steps.push(...returns(object({ feature: f.name, selected: show(selected), sample: show(domCall(v('sample'), 'getBoundingClientRect')) })));
	return recipe(
		{
			...base(f),
			parameters,
			document: [
				{ tag: 'p', children: ['Edit the inputs and inspect native layout. Move over the sample for pointer events.'] },
				...(dom.some((d) => d.event === '#dispatch|click')
					? [{ tag: 'button', attributes: { id: 'dispatch', type: 'button' }, children: ['Dispatch synthetic change'] }]
					: []),
				...(dom.some((d) => d.removeOn) ? [{ tag: 'button', attributes: { id: 'remove', type: 'button' }, children: ['Remove listener'] }] : []),
				...(dom.some((d) => d.event === '#scroll|click')
					? [{ tag: 'button', attributes: { id: 'scroll', type: 'button' }, children: ['Scroll viewport'] }]
					: []),
				{
					tag: 'div',
					attributes: { id: 'sample' },
					children: [
						{
							tag: 'div',
							attributes: { id: 'content' },
							children: [
								{
									tag: 'span',
									attributes: { id: 'text' },
									children: ['Measure this editable Thingtime layout sample. More words wrap across lines.']
								},
								{
									tag: 'img',
									attributes: {
										id: 'image',
										alt: 'Geometry sample',
										width: 32,
										height: 24,
										src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
									}
								},
								{ tag: 'div', attributes: { id: 'marker' }, children: ['Scroll destination'] }
							]
						}
					]
				},
				{ tag: 'p', attributes: { id: 'tail' }, children: ['Viewport scroll destination'] }
			],
			styles: [
				{
					selector: '#sample',
					declarations: {
						width: '[[width]]px',
						height: '110px',
						overflow: 'auto',
						border: '3px solid #60a5fa',
						padding: '8px',
						position: 'relative',
						opacity: '[[opacity]]',
						background: '#eff6ff'
					}
				},
				{ selector: '#content', declarations: { width: 'calc([[width]]px + 140px)', height: '320px', position: 'relative' } },
				{ selector: '#image', declarations: { display: 'block', 'margin-left': '12px', background: '#bae6fd' } },
				{ selector: '#marker', declarations: { position: 'absolute', top: '240px', left: '180px' } },
				{ selector: '#tail', declarations: { 'margin-top': '240px' } }
			],
			steps,
			...(dom.length ? { dom } : {})
		},
		'interactive',
		note
	);
}
