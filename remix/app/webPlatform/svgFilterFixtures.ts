import type { Feature, PlatformNode, PlatformExpression, Recipe } from './types';
import { SVG_FILTER_RECEIVER_POLICY } from './svgFilterPolicy';
import { describeSVGValue as describe } from './svgFixtures';
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
	object,
	returns
} from './programBuilders';

const n = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({
	tag,
	attributes,
	children
});
// Original 16 x 16 two-colour PNG, embedded as editable program data.
const image =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVR4nGNITvv4Hx/+WSyGFzOMGjBqwKgBw8UAAHbAnR/WTXWDAAAAAElFTkSuQmCC';
const defaults: Record<string, Record<string, string | number | boolean>> = {
	feBlend: { in: 'SourceGraphic', in2: 'paint', mode: 'multiply' },
	feColorMatrix: { in: 'SourceGraphic', type: 'matrix', values: '0 1 0 0 0 0 0 1 0 0 1 0 0 0 0 0 0 0 1 0' },
	feComponentTransfer: { in: 'SourceGraphic' },
	feComposite: { in: 'SourceGraphic', in2: 'paint', operator: 'arithmetic', k1: 0, k2: 1, k3: 0.3, k4: 0 },
	feConvolveMatrix: {
		in: 'SourceGraphic',
		order: '3 3',
		kernelMatrix: '0 -1 0 -1 5 -1 0 -1 0',
		divisor: 1,
		bias: 0,
		targetX: 1,
		targetY: 1,
		edgeMode: 'duplicate',
		preserveAlpha: true,
		kernelUnitLength: '1 1'
	},
	feDiffuseLighting: { in: 'SourceAlpha', surfaceScale: 4, diffuseConstant: 1, kernelUnitLength: '1 1', 'lighting-color': '#fde68a' },
	feSpecularLighting: {
		in: 'SourceAlpha',
		surfaceScale: 4,
		specularConstant: 1,
		specularExponent: 12,
		kernelUnitLength: '1 1',
		'lighting-color': '#fde68a'
	},
	feDisplacementMap: { in: 'SourceGraphic', in2: 'noise', scale: 20, xChannelSelector: 'R', yChannelSelector: 'G' },
	feDistantLight: { azimuth: 45, elevation: 45 },
	fePointLight: { x: 80, y: 60, z: 40 },
	feSpotLight: { x: 80, y: 60, z: 100, pointsAtX: 100, pointsAtY: 80, pointsAtZ: 0, specularExponent: 4, limitingConeAngle: 45 },
	feDropShadow: { in: 'SourceGraphic', dx: 8, dy: 8, stdDeviation: '3 3', 'flood-color': '#334155', 'flood-opacity': 0.8 },
	feFlood: { 'flood-color': '#f97316', 'flood-opacity': 0.7 },
	feGaussianBlur: { in: 'SourceGraphic', stdDeviation: '3 3', edgeMode: 'duplicate' },
	feImage: { href: image, preserveAspectRatio: 'xMidYMid meet', crossorigin: 'anonymous' },
	feMerge: {},
	feMergeNode: { in: 'SourceGraphic' },
	feMorphology: { in: 'SourceGraphic', operator: 'dilate', radius: '3 3' },
	feOffset: { in: 'SourceGraphic', dx: 14, dy: 8 },
	feTile: { in: 'tile' },
	feTurbulence: { baseFrequency: '0.04 0.04', numOctaves: 2, seed: 3, stitchTiles: 'noStitch', type: 'fractalNoise' }
};
for (const channel of ['R', 'G', 'B', 'A'])
	defaults['feFunc' + channel] = { type: 'gamma', tableValues: '0 0.25 1', slope: 0.5, intercept: 0.1, amplitude: 1, exponent: 0.4, offset: 0 };
const light = (tag: string) => ['feDistantLight', 'fePointLight', 'feSpotLight'].includes(tag);
const region = { x: 0, y: 0, width: 256, height: 176 };
const filterAttrs = { ...region, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse' };
function graph(tag: string, sample: PlatformNode): PlatformNode[] {
	if (tag.startsWith('feFunc')) return [n('feComponentTransfer', { in: 'SourceGraphic' }, [sample])];
	if (light(tag)) return [n('feDiffuseLighting', defaults.feDiffuseLighting, [sample])];
	if (tag === 'feComponentTransfer') {
		(sample as Exclude<PlatformNode, string>).children = [
			n('feFuncR', defaults.feFuncR),
			n('feFuncG', defaults.feFuncG),
			n('feFuncB', defaults.feFuncB)
		];
	}
	if (['feDiffuseLighting', 'feSpecularLighting'].includes(tag))
		(sample as Exclude<PlatformNode, string>).children = [n('feDistantLight', defaults.feDistantLight)];
	if (['feBlend', 'feComposite'].includes(tag)) return [n('feFlood', { 'flood-color': '#f97316', result: 'paint' }), sample];
	if (tag === 'feDisplacementMap') return [n('feTurbulence', { baseFrequency: '0.04 0.04', numOctaves: 2, result: 'noise' }), sample];
	if (tag === 'feTurbulence') return [sample, n('feComposite', { in: 'selected', in2: 'SourceGraphic', operator: 'in' })];
	if (tag === 'feTile') return [n('feImage', { href: image, x: 16, y: 16, width: 24, height: 24, result: 'tile' }), sample];
	if (tag === 'feMerge' || tag === 'feMergeNode') {
		const children = [n('feMergeNode', { in: 'shadow' }), tag === 'feMergeNode' ? sample : n('feMergeNode', { in: 'SourceGraphic' })];
		if (tag === 'feMerge') (sample as Exclude<PlatformNode, string>).children = children;
		return [
			n('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '4 4', result: 'blur' }),
			n('feOffset', { in: 'blur', dx: 10, dy: 10, result: 'shadow' }),
			tag === 'feMerge' ? sample : n('feMerge', {}, children)
		];
	}
	return [sample];
}
function shapes(): PlatformNode[] {
	return [
		n('rect', { x: 16, y: 28, width: 160, height: 88, rx: 16, fill: '[[color]]' }),
		n('circle', { cx: 160, cy: 100, r: 28, fill: '#f97316' }),
		n('text', { x: 16, y: 150, 'font-size': 18, fill: '#334155' }, ['[[text]]'])
	];
}
/** Every filter example is ordinary document, input, and DOM-operation data. */
export function svgFilterRecipe(f: Feature): Recipe | null {
	if (f.language !== 'webapi') return null;
	const type = f.interface || f.name,
		key = f.member || '';
	const animated = type === 'SVGAnimatedBoolean' || type === 'SVGAnimatedInteger';
	let tag =
		type === 'SVGComponentTransferFunctionElement'
			? 'feFuncR'
			: type === 'SVGFilterPrimitiveStandardAttributes'
			? 'feDropShadow'
			: animated
			? type === 'SVGAnimatedBoolean'
				? 'feConvolveMatrix'
				: 'feTurbulence'
			: type === 'SVGFilterElement'
			? 'filter'
			: type.replace(/^SVGFE/, 'fe').replace(/Element$/, '');
	if (tag !== 'filter' && !defaults[tag]) return null;
	if (!animated && type !== 'SVGFilterPrimitiveStandardAttributes' && !SVG_FILTER_RECEIVER_POLICY[type]) return null;
	if (f.kind === 'constructor') return null;
	const attrs =
		tag === 'filter'
			? { ...filterAttrs }
			: { ...(!tag.startsWith('feFunc') && !light(tag) && tag !== 'feMergeNode' ? { ...region, result: 'selected' } : {}), ...defaults[tag] };
	if (type === 'SVGComponentTransferFunctionElement' && ['slope', 'intercept', 'tableValues'].includes(key))
		attrs.type = key === 'tableValues' ? 'table' : 'linear';
	if (tag === 'feFuncA') attrs.amplitude = 0.5;
	const parameters = [parameter('color', 'Shape colour', '#6366f1'), parameter('text', 'Drawing text', 'Thingtime filters')];
	const authored: Record<string, string | number | boolean> = { id: 'sample' };
	for (const [name, value] of Object.entries(attrs)) {
		if (Object.keys(attrs).length > 14 && ['x', 'y', 'width', 'height', 'result'].includes(name)) {
			authored[name] = value;
			continue;
		}
		const param = name.replace(/-/g, '_');
		parameters.push(parameter(param, name, value, typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text'));
		authored[name] = '[[' + param + ']]';
	}
	const sample = n(tag, authored);
	const filter =
		tag === 'filter'
			? n('filter', authored, [n('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '3 3' })])
			: n('filter', { id: 'fx', ...filterAttrs }, graph(tag, sample));
	const target = v('target');
	const steps: PlatformExpression[] = [
		declare('surface', domSurface()),
		declare('svg', domCall(v('surface'), 'querySelector', ['#svg'])),
		declare('element', domCall(v('surface'), 'querySelector', ['#sample']))
	];
	const nested = type === 'SVGAnimatedBoolean' ? 'preserveAlpha' : 'numOctaves';
	steps.push(declare('target', animated ? domGet(v('element'), nested) : v('element')));
	let value: unknown;
	if (animated) {
		if (key === 'baseVal') steps.push(perform(domSet(target, 'baseVal', input(nested))));
		value = describe(key ? domGet(target, key) : target, key ? (type === 'SVGAnimatedBoolean' ? 'boolean' : 'number') : type);
	} else if (key === 'setStdDeviation') {
		parameters.push(parameter('blurX', 'Blur X', 4, 'number'), parameter('blurY', 'Blur Y', 2, 'number'));
		steps.push(perform(domCall(target, key, [input('blurX'), input('blurY')])));
		value = object({
			x: describe(domGet(target, 'stdDeviationX'), 'SVGAnimatedNumber'),
			y: describe(domGet(target, 'stdDeviationY'), 'SVGAnimatedNumber')
		});
	} else if (key) value = describe(domGet(target, key), f.returns || 'number');
	else value = describe(target, 'Element');
	return recipe(
		{
			...base(f),
			parameters,
			document: [
				n('svg', { id: 'svg', width: 512, height: 224, viewBox: '0 0 512 224', role: 'img', 'aria-label': 'Original and filtered SVG drawing' }, [
					n('defs', {}, [filter]),
					n('text', { x: 16, y: 22, 'font-size': 16, fill: '#334155' }, ['Original']),
					n('text', { x: 272, y: 22, 'font-size': 16, fill: '#334155' }, ['Filtered']),
					n('g', { transform: 'translate(0 36)' }, shapes()),
					n('g', { transform: 'translate(256 36)', filter: 'url(#' + (tag === 'filter' ? 'sample' : 'fx') + ')' }, shapes())
				])
			],
			styles: [
				{
					selector: 'svg',
					declarations: {
						display: 'block',
						'max-width': '100%',
						height: 'auto',
						overflow: 'hidden',
						background: '#f8fafc',
						border: '1px solid #cbd5e1'
					}
				}
			],
			steps: [...steps, ...returns(object({ feature: f.name, value, bounds: describe(domCall(v('svg'), 'getBBox', []), 'SVGRect') }))]
		},
		'interactive',
		'Edit the filter graph and typed inputs, compare the original and filtered drawing, and inspect real SVG values. This bounded surface uses explicit user-space regions; absent browser members report unsupported.'
	);
}
