import { WEB_FEATURES } from './catalogue';
import { svgFilterRecipe } from './svgFilterFixtures';
import type { PlatformProgram, PlatformNode, PlatformExpression } from './types';
import { declare, perform, domSurface, domCall, domGet, domSet, variable as v, returns, object } from './programBuilders';
export const SVG_FILTER_BOUNDARY_FIXTURES: { name: string; program: PlatformProgram; test: string; expected?: unknown; error?: string }[] = [];
const read = (key: string, target: unknown = v('sample')) => domGet(target, key);
const nested = (key: string) => read('baseVal', read(key));
const write = (key: string, value: unknown) => perform(domSet(read(key), 'baseVal', value));
function check(name: string, type: string, steps: PlatformExpression[], expected?: unknown, error?: string, edit?: (p: PlatformProgram) => void) {
	const program = structuredClone(svgFilterRecipe(WEB_FEATURES.find((f) => f.name === type)!)!.program);
	program.title = name;
	program.steps = [declare('surface', domSurface()), declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])), ...steps];
	edit?.(program);
	SVG_FILTER_BOUNDARY_FIXTURES.push({ name, program, test: expected === undefined ? 'error' : 'exact', expected, error });
}
function nodes(p: PlatformProgram): Exclude<PlatformNode, string>[] {
	const all: Exclude<PlatformNode, string>[] = [];
	const walk = (n: PlatformNode) => {
		if (typeof n === 'string') return;
		all.push(n);
		for (const c of n.children || []) walk(c);
	};
	for (const n of p.document || []) walk(n);
	return all;
}
check(
	'Filter native paired blur mutation',
	'SVGFEGaussianBlurElement',
	[perform(domCall(v('sample'), 'setStdDeviation', [6, 3])), ...returns(object({ x: nested('stdDeviationX'), y: nested('stdDeviationY') }))],
	{ x: 6, y: 3 }
);
check('Filter native integer mutation', 'SVGFETurbulenceElement', [write('numOctaves', 3), ...returns(nested('numOctaves'))], 3);
check('Filter native boolean mutation', 'SVGFEConvolveMatrixElement', [write('preserveAlpha', false), ...returns(nested('preserveAlpha'))], false);
check('Filter native input mutation', 'SVGFEOffsetElement', [write('in1', 'SourceAlpha'), ...returns(nested('in1'))], 'SourceAlpha');
check(
	'Filter native number list mutation',
	'SVGFEConvolveMatrixElement',
	[declare('item', domCall(nested('kernelMatrix'), 'getItem', [4])), perform(domSet(v('item'), 'value', 4)), ...returns(read('value', v('item')))],
	4
);
check(
	'Filter native pixel region mutation',
	'SVGFilterElement',
	[perform(domSet(nested('width'), 'valueAsString', '200px')), ...returns(read('value', nested('width')))],
	200
);
check(
	'Filter refuses oversized paired blur',
	'SVGFEGaussianBlurElement',
	[perform(domCall(v('sample'), 'setStdDeviation', [17, 3]))],
	undefined,
	'work budget'
);
check('Filter refuses oversized nested blur', 'SVGFEGaussianBlurElement', [write('stdDeviationX', 17)], undefined, 'work budget');
check('Filter refuses signed octave conversion', 'SVGFETurbulenceElement', [write('numOctaves', -1)], undefined, 'integer');
check('Filter refuses octave allocation', 'SVGFETurbulenceElement', [write('numOctaves', 5)], undefined, 'work budget');
check('Filter refuses convolution allocation', 'SVGFEConvolveMatrixElement', [write('orderX', 6)], undefined, 'work budget');
check(
	'Filter refuses oversized kernel item',
	'SVGFEConvolveMatrixElement',
	[declare('item', domCall(nested('kernelMatrix'), 'getItem', [4])), perform(domSet(v('item'), 'value', 9))],
	undefined,
	'work budget'
);
check(
	'Filter refuses injected kernel item',
	'SVGFEConvolveMatrixElement',
	[
		declare('svg', domCall(v('surface'), 'querySelector', ['#svg'])),
		declare('item', domCall(v('svg'), 'createSVGNumber')),
		perform(domSet(v('item'), 'value', 9)),
		perform(domCall(nested('kernelMatrix'), 'appendItem', [v('item')]))
	],
	undefined,
	'work budget'
);
check('Filter refuses external input reference', 'SVGFEOffsetElement', [write('in1', 'url(https://example.com)')], undefined, 'input/result');
check('Filter refuses external image mutation', 'SVGFEImageElement', [write('href', 'https://example.com/p.png')], undefined, 'local PNG');
check('Filter refuses oversized region mutation', 'SVGFilterElement', [perform(domSet(nested('width'), 'value', 513))], undefined, 'work budget');
check(
	'Filter refuses percentage region mutation',
	'SVGFilterElement',
	[perform(domSet(nested('width'), 'valueAsString', '100%'))],
	undefined,
	'filter numbers'
);
check('Filter refuses object-box unit mutation', 'SVGFilterElement', [write('filterUnits', 2)], undefined, 'userSpaceOnUse');
check('Filter refuses relative primitive units', 'SVGFilterElement', [write('primitiveUnits', 2)], undefined, 'userSpaceOnUse');
check('Filter refuses implicit region units', 'SVGFilterElement', [], undefined, 'explicit bounded', (p) => {
	const x = nodes(p).find((n) => n.tag === 'filter')!;
	delete x.attributes!.filterUnits;
});
check('Filter refuses excess filter definitions', 'SVGFilterElement', [], undefined, 'count budget', (p) => {
	const defs = nodes(p).find((n) => n.tag === 'defs')!;
	defs.children = Array.from({ length: 5 }, () => structuredClone(defs.children![0]));
});
check('Filter refuses excess filter primitives', 'SVGFilterElement', [], undefined, 'node budget', (p) => {
	const filter = nodes(p).find((n) => n.tag === 'filter')!;
	filter.children = Array.from({ length: 32 }, () => structuredClone(filter.children![0]));
});

check(
	'Filter literal SVG Boolean attributes preserve true',
	'SVGFEConvolveMatrixElement',
	[...returns(nested('preserveAlpha'))],
	true,
	undefined,
	(p) => {
		nodes(p).find((n) => n.tag === 'feConvolveMatrix')!.attributes!.preserveAlpha = true;
	}
);

check('Filter refuses malformed repeated number input', 'SVGFEGaussianBlurElement', [], undefined, 'work budget', (p) => {
	nodes(p).find((n) => n.tag === 'feGaussianBlur')!.attributes!.stdDeviation = '.0\t' + '00\t'.repeat(250) + '.';
});
