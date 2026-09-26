import type { Feature, PlatformNode, PlatformExpression, Recipe } from './types';
import { SVG_RECEIVER_POLICY } from './svgPolicy';
import {
	base,
	recipe,
	parameter,
	input,
	variable as v,
	declare,
	perform,
	domSurface,
	domConstant,
	get,
	domGet,
	domSet,
	domCall,
	object,
	returns
} from './programBuilders';
const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const root = v('svg'),
	target = v('target'),
	result = v('result');
const call = (key: string, args: unknown[] = [], receiver: unknown = target) => domCall(receiver, key, args);
const exec = (key: string, args: unknown[] = [], receiver: unknown = target) => perform(call(key, args, receiver));
const set = (key: string, value: unknown, receiver: unknown = target) => perform(domSet(receiver, key, value));
const read = (key: string, receiver: unknown = target) => domGet(receiver, key);
const p = (name: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') =>
	parameter(
		name,
		(
			{
				color: 'Shape colour',
				text: 'Drawing text',
				width: 'Shape width',
				value: 'Selected value',
				unit: 'Unit type',
				x: 'Point X',
				y: 'Point Y',
				distance: 'Distance along path',
				angle: 'Angle',
				scale: 'Scale',
				index: 'Item index',
				path: 'Path data',
				options: 'Bounding box options'
			} as Record<string, string>
		)[name] || name,
		value,
		type
	);
const projection = (value: unknown, names: string) => object(Object.fromEntries(names.split(' ').map((k) => [k, domGet(value, k)])));
const listItemTypes: Record<string, string> = {
	SVGLengthList: 'SVGLength',
	SVGNumberList: 'SVGNumber',
	SVGPointList: 'SVGPoint',
	SVGTransformList: 'SVGTransform',
	SVGStringList: 'DOMString'
};
function describe(value: unknown, type: string): unknown {
	if (type.startsWith('SVGAnimated') && type !== 'SVGAnimatedPoints') {
		const suffix = type.slice('SVGAnimated'.length);
		const inner =
			(
				{ Boolean: 'boolean', Enumeration: 'number', Integer: 'number', Number: 'number', String: 'DOMString', Rect: 'SVGRect' } as Record<
					string,
					string
				>
			)[suffix] || 'SVG' + suffix;
		return object({ base: describe(domGet(value, 'baseVal'), inner), animated: describe(domGet(value, 'animVal'), inner) });
	}
	const fields: Record<string, string> = {
		SVGNumber: 'value',
		SVGLength: 'unitType value valueInSpecifiedUnits valueAsString',
		SVGAngle: 'unitType value valueInSpecifiedUnits valueAsString',
		SVGPreserveAspectRatio: 'align meetOrSlice',
		DOMPoint: 'x y z w',
		SVGPoint: 'x y',
		DOMRect: 'x y width height',
		SVGRect: 'x y width height',
		DOMMatrix: 'a b c d e f',
		SVGMatrix: 'a b c d e f'
	};
	if (fields[type]) return projection(value, fields[type]);
	if (type === 'SVGTransform')
		return object({ type: domGet(value, 'type'), angle: domGet(value, 'angle'), matrix: describe(domGet(value, 'matrix'), 'SVGMatrix') });
	if (listItemTypes[type])
		return object({
			length: domGet(value, 'numberOfItems'),
			first: {
				op: 'conditional',
				test: domGet(value, 'numberOfItems'),
				then: describe(domCall(value, 'getItem', [0]), listItemTypes[type]),
				else: null
			}
		});
	if (type === 'NodeList') return object({ length: domGet(value, 'length') });
	if (type.endsWith('Element') || type === 'Element') return object({ tag: domGet(value, 'localName'), markup: domGet(value, 'outerHTML') });
	return value;
}
const n = (tag: string, attributes: Record<string, string | number | boolean> = {}, children: PlatformNode[] = []): PlatformNode => ({
	tag,
	attributes,
	children
});
const rect = () =>
	n('rect', { id: 'sample', x: 16, y: 16, width: '[[width]]', height: 72, rx: 8, fill: '[[color]]', transform: 'translate(0 0)', class: 'original' });
const path = () => n('path', { id: 'sample', d: '[[path]]', fill: '[[color]]', stroke: '#0f172a', 'stroke-width': 3, pathLength: 100 });
const text = () =>
	n(
		'text',
		{
			id: 'sample',
			x: '16 30',
			y: 85,
			dx: '0 1',
			dy: '0 0',
			rotate: '0 8',
			fill: '[[color]]',
			'font-size': 24,
			textLength: 180,
			lengthAdjust: 'spacing'
		},
		['[[text]]']
	);
const stop = () => n('stop', { offset: 0, 'stop-color': '[[color]]' });
const stop2 = () => n('stop', { offset: 1, 'stop-color': '#f97316' });
const marker = () =>
	n('marker', { id: 'sample', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 8, markerHeight: 8, orient: '30deg' }, [
		n('path', { d: 'M0 0L10 5L0 10Z', fill: '[[color]]' })
	]);
const elementTags: Record<string, string> = {
	SVGSVGElement: 'svg',
	SVGRectElement: 'rect',
	SVGCircleElement: 'circle',
	SVGEllipseElement: 'ellipse',
	SVGLineElement: 'line',
	SVGPolylineElement: 'polyline',
	SVGPolygonElement: 'polygon',
	SVGPathElement: 'path',
	SVGGraphicsElement: 'rect',
	SVGGeometryElement: 'path',
	SVGElement: 'rect',
	SVGTextElement: 'text',
	SVGTSpanElement: 'tspan',
	SVGTextPositioningElement: 'text',
	SVGTextContentElement: 'text',
	SVGLinearGradientElement: 'linearGradient',
	SVGRadialGradientElement: 'radialGradient',
	SVGGradientElement: 'linearGradient',
	SVGStopElement: 'stop',
	SVGPatternElement: 'pattern',
	SVGClipPathElement: 'clipPath',
	SVGMaskElement: 'mask',
	SVGMarkerElement: 'marker',
	SVGDefsElement: 'defs',
	SVGGElement: 'g',
	SVGDescElement: 'desc',
	SVGTitleElement: 'title',
	SVGMetadataElement: 'metadata',
	SVGSwitchElement: 'switch'
};
function drawing(tag: string, useReference = false): PlatformNode[] {
	if (tag === 'rect' || tag === 'svg') return [rect()];
	if (tag === 'path') return [path()];
	if (tag === 'text') return [text()];
	if (tag === 'tspan') return [n('text', { x: 16, y: 85, 'font-size': 24, fill: '[[color]]' }, [n('tspan', { id: 'sample', dx: 4 }, ['[[text]]'])])];
	const shapeAttrs: Record<string, Record<string, string | number | boolean>> = {
		circle: { cx: 92, cy: 66, r: 42 },
		ellipse: { cx: 100, cy: 66, rx: 70, ry: 40 },
		line: { x1: 16, y1: 16, x2: 200, y2: 100, stroke: '[[color]]', 'stroke-width': 8 },
		polyline: { points: '16,100 60,16 108,100 160,16' },
		polygon: { points: '16,100 80,16 160,100' }
	};
	if (shapeAttrs[tag]) return [n(tag, { id: 'sample', fill: '[[color]]', stroke: '#0f172a', 'stroke-width': 3, ...shapeAttrs[tag] })];
	if (['g', 'switch'].includes(tag))
		return [
			n(tag, { id: 'sample', transform: 'translate(8 4)', systemLanguage: 'en' }, [
				n('rect', { x: 16, y: 16, width: '[[width]]', height: 72, fill: '[[color]]' })
			])
		];
	if (['title', 'desc', 'metadata'].includes(tag)) return [n(tag, { id: 'sample' }, ['[[text]]']), rect()];
	if (tag === 'marker')
		return [
			n('defs', {}, [marker()]),
			n('path', { d: 'M20 80L180 80', fill: 'none', stroke: '[[color]]', 'stroke-width': 4, 'marker-end': 'url(#sample)' })
		];
	if (tag === 'clipPath' || tag === 'mask')
		return [
			n('defs', {}, [n(tag, { id: 'sample' }, [n('circle', { cx: 80, cy: 66, r: 45, fill: 'white' })])]),
			n('rect', { x: 16, y: 16, width: '[[width]]', height: 90, fill: '[[color]]', [tag === 'clipPath' ? 'clip-path' : 'mask']: 'url(#sample)' })
		];
	if (tag === 'pattern')
		return [
			n('defs', {}, [
				n(
					'pattern',
					{ id: useReference ? 'base-paint' : 'sample', x: 0, y: 0, width: 16, height: 16, patternUnits: 'userSpaceOnUse', viewBox: '0 0 16 16' },
					[n('circle', { cx: 8, cy: 8, r: 6, fill: '[[color]]' })]
				),
				...(useReference ? [n('pattern', { id: 'sample', href: '#base-paint' })] : [])
			]),
			n('rect', { x: 16, y: 16, width: '[[width]]', height: 96, fill: 'url(#sample)' })
		];
	const gradient = tag === 'radialGradient' ? 'radialGradient' : 'linearGradient';
	const gradientAttrs =
		gradient === 'radialGradient' ? { cx: '50%', cy: '50%', r: '50%', fx: '35%', fy: '35%', fr: '0%' } : { x1: '0%', y1: '0%', x2: '100%', y2: '0%' };
	const first = stop() as Exclude<PlatformNode, string>;
	if (tag === 'stop') first.attributes!.id = 'sample';
	return [
		n('defs', tag === 'defs' ? { id: 'sample' } : {}, [
			n(gradient, { id: useReference ? 'base-paint' : tag === 'stop' || tag === 'defs' ? 'paint' : 'sample', ...gradientAttrs }, [first, stop2()]),
			...(useReference ? [n(gradient, { id: 'sample', href: '#base-paint' })] : [])
		]),
		n('rect', { x: 16, y: 16, width: '[[width]]', height: 96, fill: tag === 'stop' || tag === 'defs' ? 'url(#paint)' : 'url(#sample)' })
	];
}
const nested: Record<string, { tag: string; key: string; inner?: boolean }> = {
	SVGNumber: { tag: 'path', key: 'pathLength', inner: true },
	SVGLength: { tag: 'rect', key: 'width', inner: true },
	SVGAngle: { tag: 'marker', key: 'orientAngle', inner: true },
	SVGTransformList: { tag: 'rect', key: 'transform', inner: true },
	SVGTransform: { tag: 'rect', key: 'transform', inner: true },
	SVGLengthList: { tag: 'text', key: 'x', inner: true },
	SVGNumberList: { tag: 'text', key: 'rotate', inner: true },
	SVGPointList: { tag: 'polygon', key: 'points' },
	SVGStringList: { tag: 'switch', key: 'systemLanguage' },
	SVGPreserveAspectRatio: { tag: 'svg', key: 'preserveAspectRatio', inner: true },
	SVGAnimatedNumber: { tag: 'path', key: 'pathLength' },
	SVGAnimatedLength: { tag: 'rect', key: 'width' },
	SVGAnimatedAngle: { tag: 'marker', key: 'orientAngle' },
	SVGAnimatedEnumeration: { tag: 'text', key: 'lengthAdjust' },
	SVGAnimatedString: { tag: 'rect', key: 'className' },
	SVGAnimatedRect: { tag: 'svg', key: 'viewBox' },
	SVGAnimatedNumberList: { tag: 'text', key: 'rotate' },
	SVGAnimatedLengthList: { tag: 'text', key: 'x' },
	SVGAnimatedTransformList: { tag: 'rect', key: 'transform' },
	SVGAnimatedPreserveAspectRatio: { tag: 'svg', key: 'preserveAspectRatio' }
};
const mixins: Record<string, { type: string; member?: string }> = {
	SVGAnimatedPoints: { type: 'SVGPolygonElement', member: 'points' },
	SVGFitToViewBox: { type: 'SVGSVGElement', member: 'viewBox' },
	SVGTests: { type: 'SVGGraphicsElement', member: 'systemLanguage' },
	SVGURIReference: { type: 'SVGGradientElement', member: 'href' },
	SVGUnitTypes: { type: 'SVGClipPathElement', member: 'clipPathUnits' }
};
export function svgRecipe(f: Feature): Recipe | null {
	if (f.language !== 'webapi') return null;
	const dictionary = f.interface === 'SVGBoundingBoxOptions' || f.name === 'SVGBoundingBoxOptions';
	let type = f.interface || f.name,
		key = f.member || '';
	const mixin = mixins[type];
	if (mixin) {
		type = mixin.type;
		key = key || mixin.member!;
	}
	if (dictionary) {
		type = 'SVGGraphicsElement';
		key = 'getBBox';
	}
	const spec = nested[type],
		tag = spec?.tag || elementTags[type];
	const policy = SVG_RECEIVER_POLICY[type];
	if (!tag || !policy || f.kind === 'constructor') return null;
	const isUnitConstant = (f.interface || f.name) === 'SVGUnitTypes' && f.kind === 'const';
	const readonly = policy.reads.split(' ').includes(key),
		writable = (policy.writes || '').split(' ').includes(key);
	if (key && !dictionary && !readonly && !policy.calls?.[key]) return null;
	const params = [p('color', '#6366f1'), p('width', 180, 'number'), p('text', 'Thingtime SVG'), p('path', 'M16 100Q92 0 184 100Z')];
	const steps: PlatformExpression[] = [
		declare('surface', domSurface()),
		declare('svg', domCall(v('surface'), 'querySelector', ['#svg'])),
		declare('shape', domCall(v('surface'), 'querySelector', [tag === 'svg' ? '#svg' : '#sample']))
	];
	let receiver: unknown = v('shape');
	if (spec) {
		receiver = domGet(receiver, spec.key);
		if (spec.inner) receiver = domGet(receiver, 'baseVal');
		if (type === 'SVGTransform') receiver = domCall(receiver, 'getItem', [0]);
		if (type === 'SVGNumber') receiver = call('createSVGNumber', [], root);
	}
	steps.push(declare('target', receiver));
	if (type === 'SVGNumber') steps.push(set('value', input('width')));
	let value: unknown,
		returnType =
			f.returns ||
			(mixin
				? (
						{
							SVGAnimatedPoints: 'SVGPointList',
							SVGFitToViewBox: 'SVGAnimatedRect',
							SVGTests: 'SVGStringList',
							SVGURIReference: 'SVGAnimatedString',
							SVGUnitTypes: 'SVGAnimatedEnumeration'
						} as Record<string, string>
				  )[f.interface || f.name]
				: type);
	if (!key) {
		value = target;
		returnType = type;
	} else if (isUnitConstant) {
		value = domConstant('SVGUnitTypes', key);
		returnType = 'number';
	} else if (readonly) {
		if (writable) {
			let def: unknown =
				key === 'valueAsString'
					? type === 'SVGAngle'
						? '45deg'
						: '48px'
					: key === 'baseVal'
					? type === 'SVGAnimatedString'
						? 'edited'
						: type === 'SVGAnimatedEnumeration'
						? 2
						: 75
					: key === 'currentScale'
					? 1.2
					: key === 'align'
					? 6
					: key === 'meetOrSlice'
					? 2
					: 36;
			params.push(p('value', def, typeof def === 'number' ? 'number' : 'text'));
			steps.push(set(key, input('value')));
		}
		value = read(key);
	} else {
		let args: unknown[] = [],
			after = false;
		const numeric = (name: string, def: number) => {
			params.push(p(name, def, 'number'));
			return input(name);
		};
		if (key === 'getBBox') {
			if (dictionary && f.member) {
				params.push(p(f.member, f.member !== 'fill', 'boolean'));
				args = [object({ fill: true, stroke: false, markers: false, clipped: false, [f.member]: input(f.member) })];
			} else {
				params.push(p('options', { fill: true, stroke: false, markers: false, clipped: false }, 'json'));
				args = [input('options')];
			}
			returnType = 'SVGRect';
		} else if (['getCTM', 'getScreenCTM', 'createSVGMatrix'].includes(key)) returnType = 'SVGMatrix';
		else if (key === 'getTotalLength') returnType = 'number';
		else if (key === 'getPointAtLength') {
			args = [numeric('distance', 42)];
			returnType = 'SVGPoint';
		} else if (['isPointInFill', 'isPointInStroke', 'getCharNumAtPosition'].includes(key)) {
			args = [object({ x: numeric('x', 50), y: numeric('y', 65) })];
		} else if (['getStartPositionOfChar', 'getEndPositionOfChar', 'getExtentOfChar', 'getRotationOfChar', 'getSubStringLength'].includes(key)) {
			args = [numeric('index', 1), ...(key === 'getSubStringLength' ? [numeric('count', 3)] : [])];
		} else if (key === 'getElementById') {
			params.push(p('id', 'sample'));
			args = [input('id')];
			returnType = 'Element';
		} else if (['getIntersectionList', 'getEnclosureList', 'checkIntersection', 'checkEnclosure'].includes(key)) {
			steps.push(
				declare('box', call('createSVGRect', [], root)),
				set('x', 8, v('box')),
				set('y', 8, v('box')),
				set('width', 220, v('box')),
				set('height', 130, v('box'))
			);
			args = key.startsWith('check') ? [domCall(v('surface'), 'querySelector', ['#sample']), v('box')] : [v('box'), null];
		} else if (key === 'newValueSpecifiedUnits') {
			args = [numeric('unit', type === 'SVGAngle' ? 2 : 5), numeric('value', 48)];
			after = true;
		} else if (key === 'convertToSpecifiedUnits') {
			args = [numeric('unit', type === 'SVGAngle' ? 3 : 6)];
			after = true;
		} else if (key === 'setOrientToAuto') after = true;
		else if (key === 'setOrientToAngle') {
			steps.push(declare('angle', call('createSVGAngle', [], root)), set('value', numeric('angle', 45), v('angle')));
			args = [v('angle')];
			after = true;
		} else if (['setMatrix', 'createSVGTransformFromMatrix'].includes(key)) {
			params.push(p('matrix', { a: 1, b: 0, c: 0, d: 1, e: 16, f: 8 }, 'json'));
			steps.push(
				declare('matrix', call('createSVGMatrix', [], root)),
				...['a', 'b', 'c', 'd', 'e', 'f'].map((k) => set(k, get(input('matrix'), k), v('matrix')))
			);
			args = [v('matrix')];
			after = key === 'setMatrix';
		} else if (key === 'setTranslate') {
			args = [numeric('x', 20), numeric('y', 8)];
			after = true;
		} else if (key === 'setScale') {
			args = [numeric('scale', 1.2), numeric('scaleY', 0.8)];
			after = true;
		} else if (key === 'setRotate') {
			args = [numeric('angle', 20), numeric('x', 96), numeric('y', 64)];
			after = true;
		} else if (key === 'setSkewX' || key === 'setSkewY') {
			args = [numeric('angle', 20)];
			after = true;
		} else if (listItemTypes[type]) {
			if (['appendItem', 'initialize', 'insertItemBefore', 'replaceItem'].includes(key)) {
				const itemType = listItemTypes[type];
				if (itemType === 'DOMString') {
					params.push(p('value', 'fr'));
					args = [input('value')];
				} else {
					const factory = {
						SVGLength: 'createSVGLength',
						SVGNumber: 'createSVGNumber',
						SVGPoint: 'createSVGPoint',
						SVGTransform: 'createSVGTransform'
					}[itemType]!;
					steps.push(declare('item', call(factory, [], root)));
					if (itemType === 'SVGTransform') steps.push(exec('setTranslate', [numeric('x', 16), numeric('y', 8)], v('item')));
					else if (itemType === 'SVGPoint') steps.push(set('x', numeric('x', 120), v('item')), set('y', numeric('y', 60), v('item')));
					else steps.push(set('value', numeric('value', 36), v('item')));
					args = [v('item')];
				}
				if (['insertItemBefore', 'replaceItem'].includes(key)) args.push(numeric('index', 0));
			} else if (['getItem', 'removeItem'].includes(key)) args = [numeric('index', 0)];
			after = key === 'clear';
		} else if (
			![
				'getNumberOfChars',
				'getComputedTextLength',
				'createSVGNumber',
				'createSVGLength',
				'createSVGAngle',
				'createSVGPoint',
				'createSVGRect',
				'createSVGTransform'
			].includes(key)
		)
			return null;
		if (after) {
			steps.push(exec(key, args));
			value = target;
			returnType = type;
		} else value = call(key, args);
	}
	steps.push(declare('result', value));
	const content = dictionary
		? [
				n('defs', {}, [
					n('marker', { id: 'bbox-marker', markerUnits: 'userSpaceOnUse', markerWidth: 24, markerHeight: 24, refX: 12, refY: 12 }, [
						n('rect', { width: 24, height: 24, fill: '#f97316' })
					]),
					n('clipPath', { id: 'bbox-clip' }, [n('rect', { x: 40, y: 30, width: 80, height: 40 })])
				]),
				n('polygon', {
					id: 'sample',
					points: '16,16 [[width]],16 [[width]],88 16,88',
					fill: '[[color]]',
					stroke: '#0f172a',
					'stroke-width': 12,
					'marker-end': 'url(#bbox-marker)',
					'clip-path': 'url(#bbox-clip)'
				})
		  ]
		: drawing(tag, key === 'href');
	if (dictionary)
		content.push(
			n('polygon', {
				id: 'bbox-probe',
				points: '16,16 180,16 180,88 16,88',
				visibility: 'hidden',
				fill: '#6366f1',
				stroke: '#0f172a',
				'stroke-width': 12,
				'marker-end': 'url(#bbox-marker)',
				'clip-path': 'url(#bbox-clip)'
			})
		);
	let dictionaryOutput: Record<string, unknown> = {};
	if (dictionary) {
		// Passing a dictionary does not prove the browser implements it. Measure
		// each option against native geometry with fill, stroke, marker and clip.
		const defaults = { fill: true, stroke: false, markers: false, clipped: false };
		steps.push(
			declare('probeShape', domCall(v('surface'), 'querySelector', ['#bbox-probe'])),
			declare('baseline', call('getBBox', [object(defaults)], v('probeShape')))
		);
		for (const field of Object.keys(defaults))
			steps.push(declare(field + 'Probe', call('getBBox', [object({ ...defaults, [field]: field !== 'fill' })], v('probeShape'))));
		const dimension = (name: string, key: string) => domGet(v(name), key);
		steps.push(
			declare(
				'support',
				object({
					fill: binary('===', dimension('fillProbe', 'width'), 0),
					stroke: binary('>', dimension('strokeProbe', 'width'), dimension('baseline', 'width')),
					markers: binary('>', dimension('markersProbe', 'height'), dimension('baseline', 'height')),
					clipped: binary('<', dimension('clippedProbe', 'width'), dimension('baseline', 'width'))
				})
			)
		);
		const supported = f.member
			? get(v('support'), f.member)
			: Object.keys(defaults)
					.map((k) => get(v('support'), k))
					.reduce<unknown>((a, b) => binary('&&', a, b), true);
		dictionaryOutput = {
			status: { op: 'conditional', test: supported, then: 'supported', else: 'unsupported' },
			message: {
				op: 'conditional',
				test: supported,
				then: 'Native measurements respond to the selected bounding-box options.',
				else: 'This browser ignores one or more selected bounding-box options; the native measurements are shown unchanged.'
			},
			optionSupport: v('support'),
			baseline: describe(v('baseline'), 'SVGRect'),
			probes: object(Object.fromEntries(Object.keys(defaults).map((k) => [k, describe(v(k + 'Probe'), 'SVGRect')])))
		};
	}
	// Text never overlaps the shapes; it also gives non-rendered definitions an
	// editable, accessible description without depending on runtime demo IDs.
	if (!['text', 'tspan'].includes(tag)) content.push(n('text', { x: 16, y: 156, fill: '[[color]]', 'font-size': 16 }, ['[[text]]']));
	return recipe(
		{
			...base(f),
			parameters: params,
			document: [
				n(
					'svg',
					{
						id: 'svg',
						width: 256,
						height: 176,
						viewBox: type === 'SVGTransform' || type === 'SVGTransformList' ? '-48 -48 352 240' : '0 0 256 176',
						preserveAspectRatio: 'xMidYMid meet',
						role: 'img',
						'aria-label': 'Editable SVG drawing'
					},
					content
				)
			],
			styles: [
				{
					selector: 'svg',
					declarations: { display: 'block', 'max-width': '100%', overflow: 'hidden', background: '#f8fafc', border: '1px solid #cbd5e1' }
				}
			],
			steps: [
				...steps,
				...returns(
					object({
						feature: f.name,
						...dictionaryOutput,
						value: { op: 'conditional', test: result, then: describe(result, returnType), else: result },
						bounds: describe(call('getBBox', [], root), 'SVGRect')
					})
				)
			]
		},
		'interactive',
		'Native SVG geometry and value objects backed by a reusable namespace-aware document. Edit the inputs and compare the drawing with its native measurements.'
	);
}
