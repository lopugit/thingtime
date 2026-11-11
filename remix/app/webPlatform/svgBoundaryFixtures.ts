import {
	declare,
	perform,
	domSurface,
	domCall,
	domGet,
	domSet,
	domConstant,
	method,
	global,
	variable as v,
	returns,
	object
} from './programBuilders';
import type { PlatformProgram, PlatformNode } from './types';
const svg: Exclude<PlatformNode, string> = {
	tag: 'svg',
	attributes: { id: 'svg', width: 256, height: 176, viewBox: '0 0 256 176' },
	children: [{ tag: 'rect', attributes: { id: 'sample', x: 10, y: 20, width: 80, height: 40, fill: '#ff0000', transform: 'translate(0 0)' } }]
};
const init = [
	declare('surface', domSurface()),
	declare('svg', domCall(v('surface'), 'querySelector', ['#svg'])),
	declare('shape', domCall(v('surface'), 'querySelector', ['#sample']))
];
const get = (key: string, target: unknown = v('shape')) => domGet(target, key);
const call = (key: string, args: unknown[] = [], target: unknown = v('shape')) => domCall(target, key, args);
const set = (key: string, value: unknown, target: unknown) => perform(domSet(target, key, value));
const fields = (target: unknown, names: string) => object(Object.fromEntries(names.split(' ').map((key) => [key, domGet(target, key)])));
export const SVG_BOUNDARY_FIXTURES: { name: string; program: PlatformProgram; test: string; expected?: unknown; error?: string }[] = [];
function probe(name: string, steps: any[], expected?: unknown, error?: string) {
	SVG_BOUNDARY_FIXTURES.push({
		name,
		program: { version: 1, title: name, document: [structuredClone(svg)], steps: [...init, ...steps] },
		test: expected === undefined ? 'error' : 'exact',
		expected,
		error
	});
}
probe('SVG namespace is native', [...returns(get('namespaceURI'))], 'http://www.w3.org/2000/svg');
probe('SVG exact native bounding box', [declare('box', call('getBBox')), ...returns(fields(v('box'), 'x y width height'))], {
	x: 10,
	y: 20,
	width: 80,
	height: 40
});
probe(
	'SVG live animated length changes geometry',
	[
		declare('width', get('baseVal', get('width'))),
		set('value', 72, v('width')),
		declare('box', call('getBBox')),
		...returns(domGet(v('box'), 'width'))
	],
	72
);
probe(
	'SVG native inch conversion',
	[declare('width', get('baseVal', get('width'))), set('valueAsString', '1in', v('width')), ...returns(get('value', v('width')))],
	96
);
probe(
	'SVG native unit conversion preserves physical length',
	[
		declare('width', get('baseVal', get('width'))),
		perform(domCall(v('width'), 'convertToSpecifiedUnits', [6])),
		...returns({
			op: 'binary',
			operator: '<',
			left: method(global('Math'), 'abs', [{ op: 'binary', operator: '-', left: get('value', v('width')), right: 80 }]),
			right: 0.001
		})
	],
	true
);
probe(
	'SVG native readonly animVal exception',
	[
		declare('width', get('animVal', get('width'))),
		{ op: 'try', body: [set('value', 42, v('width'))], error: 'error', catch: returns({ op: 'get', target: v('error'), key: 'name' }) }
	],
	'NoModificationAllowedError'
);
probe(
	'SVG native transform changes CTM',
	[
		declare('list', get('baseVal', get('transform'))),
		declare('transform', domCall(v('list'), 'getItem', [0])),
		perform(domCall(v('transform'), 'setTranslate', [12, 24])),
		declare('matrix', call('getCTM')),
		...returns(fields(v('matrix'), 'a b c d e f'))
	],
	{ a: 1, b: 0, c: 0, d: 1, e: 12, f: 24 }
);
probe(
	'SVG native constructor factory owns real point',
	[declare('point', domCall(v('svg'), 'createSVGPoint')), set('x', 18, v('point')), set('y', 29, v('point')), ...returns(fields(v('point'), 'x y'))],
	{ x: 18, y: 29 }
);
probe('SVG native IDL constant', [...returns(domConstant('SVGUnitTypes', 'SVG_UNIT_TYPE_USERSPACEONUSE'))], 1);
probe(
	'SVG accessor cannot be read as a constant',
	[...returns(domConstant('SVGElement', 'ownerSVGElement'))],
	undefined,
	'Unregistered DOM constant'
);
probe('SVG runtime document escape', [...returns(get('ownerDocument'))], undefined, 'outside this program surface');
probe('SVG surface tree removal', [perform(call('remove')), ...returns(true)], undefined, 'Surface tree mutation');
probe(
	'SVG oversized viewport native write',
	[declare('width', get('baseVal', get('width', v('svg')))), set('value', 513, v('width')), ...returns(true)],
	undefined,
	'viewport exceeds'
);
probe(
	'SVG relative viewport write',
	[declare('width', get('baseVal', get('width', v('svg')))), set('valueAsString', '500%', v('width')), ...returns(true)],
	undefined,
	'Use pixel values'
);
probe(
	'SVG oversized viewport new units',
	[declare('width', get('baseVal', get('width', v('svg')))), perform(domCall(v('width'), 'newValueSpecifiedUnits', [5, 513])), ...returns(true)],
	undefined,
	'viewport exceeds'
);
probe(
	'SVG viewport unit conversion stays native',
	[
		declare('width', get('baseVal', get('width', v('svg')))),
		perform(domCall(v('width'), 'convertToSpecifiedUnits', [6])),
		...returns(get('value', v('width')))
	],
	256
);
probe(
	'SVG list allocation is bounded',
	[
		declare('list', get('baseVal', get('transform'))),
		...Array.from({ length: 33 }, (_, i) => declare('t' + i, domCall(v('svg'), 'createSVGTransform'))),
		...Array.from({ length: 33 }, (_, i) => perform(domCall(v('list'), 'appendItem', [v('t' + i)]))),
		...returns(true)
	],
	undefined,
	'SVG list item budget'
);
for (const [name, key, value, error] of [
	['SVG external paint', 'fill', 'url(https://example.com/p)', 'local fragments'],
	['SVG unregistered event', 'onload', 'alert(1)', 'declarative events'],
	['SVG initial viewport allocation', 'width', '513', 'at most 512']
] as const) {
	const p = structuredClone(svg);
	p.attributes![key] = value;
	SVG_BOUNDARY_FIXTURES.push({ name, program: { version: 1, title: name, document: [p] }, test: 'error', error });
}
SVG_BOUNDARY_FIXTURES.push({
	name: 'SVG live attribute cannot bypass viewport bounds',
	program: {
		version: 1,
		title: 'SVG live attribute bound',
		document: [structuredClone(svg)],
		dom: [{ target: '#svg', method: 'setAttribute', args: ['width', 513] }]
	},
	test: 'error',
	error: 'at most 512'
});
SVG_BOUNDARY_FIXTURES.push({
	name: 'SVG namespace cannot introduce foreign content',
	program: {
		version: 1,
		title: 'SVG closed namespace',
		document: [{ tag: 'svg', children: [{ tag: 'foreignObject', children: [{ tag: 'iframe' }] }] }]
	},
	test: 'error',
	error: 'Unregistered SVG element'
});

for (const [name, child, error] of [
	['SVG compact point list is bounded', { tag: 'polygon', attributes: { points: '1,1' + '-2,-2'.repeat(32) } }, 'list budget'],
	['SVG newline language list is bounded', { tag: 'switch', attributes: { systemLanguage: Array(33).fill('en').join('\n') } }, 'list budget'],
	['SVG node allocation is bounded', { tag: 'g', children: Array.from({ length: 128 }, () => ({ tag: 'rect' })) }, 'SVG budget']
] as const)
	SVG_BOUNDARY_FIXTURES.push({
		name,
		program: { version: 1, title: name, document: [{ tag: 'svg', attributes: { width: 256, height: 176 }, children: [child as PlatformNode] }] },
		test: 'error',
		error
	});
