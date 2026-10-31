import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	base,
	recipe,
	parameter,
	input,
	variable,
	declare,
	perform,
	domSurface,
	domGet,
	domSet,
	domCall,
	domConstruct,
	object,
	get,
	method,
	returns
} from './programBuilders';
const doc = variable('doc'),
	canvas = variable('canvas'),
	ctx = variable('ctx'),
	result = variable('result');
const v = variable;
const call = (key: string, args: unknown[] = [], target: unknown = ctx) => domCall(target, key, args);
const exec = (key: string, args: unknown[] = [], target: unknown = ctx) => perform(call(key, args, target));
const set = (key: string, value: unknown, target: unknown = ctx) => perform(domSet(target, key, value));
const labels: Record<string, string> = {
	color: 'Drawing colour',
	text: 'Drawing text',
	stop: 'Colour stop (0–1)',
	endColor: 'End colour',
	value: 'Selected property',
	setting: 'Selected setting',
	settings: 'Context settings',
	pixels: 'RGBA pixel values',
	path: 'SVG path',
	repeat: 'Pattern repeat',
	scale: 'Pattern scale',
	size: 'Bitmap size',
	format: 'Image format',
	fillRule: 'Fill rule',
	x: 'Point X',
	y: 'Point Y'
};
const p = (name: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => parameter(name, labels[name] || name, value, type);
const properties: Record<string, unknown> = {
	globalAlpha: 0.5,
	globalCompositeOperation: 'xor',
	fillStyle: '#f97316',
	strokeStyle: '#0ea5e9',
	filter: 'blur(2px)',
	imageSmoothingEnabled: false,
	imageSmoothingQuality: 'high',
	lineCap: 'round',
	lineDashOffset: 8,
	lineJoin: 'round',
	lineWidth: 8,
	miterLimit: 4,
	shadowBlur: 8,
	shadowColor: '#ef4444',
	shadowOffsetX: 8,
	shadowOffsetY: 8,
	direction: 'rtl',
	font: '24px serif',
	fontKerning: 'none',
	fontStretch: 'expanded',
	fontVariantCaps: 'small-caps',
	lang: 'en',
	letterSpacing: '3px',
	textAlign: 'center',
	textBaseline: 'middle',
	textRendering: 'geometricPrecision',
	wordSpacing: '8px'
};
const operations: Record<string, unknown[]> = {
	clearRect: [24, 24, 32, 32],
	fillRect: [64, 32, 100, 64],
	strokeRect: [64, 32, 100, 64],
	closePath: [],
	moveTo: [100, 80],
	lineTo: [180, 90],
	quadraticCurveTo: [128, 0, 200, 90],
	bezierCurveTo: [40, 0, 190, 0, 200, 90],
	arc: [100, 64, 40, 0, Math.PI * 1.5, false],
	arcTo: [180, 16, 180, 100, 24],
	ellipse: [128, 72, 80, 36, 0.3, 0, Math.PI * 2],
	rect: [72, 32, 120, 80],
	roundRect: [72, 32, 120, 80, 20],
	rotate: [0.35],
	scale: [1.2, 0.8],
	translate: [48, 20],
	transform: [1, 0.2, 0.1, 1, 16, 0],
	setTransform: [1, 0.2, 0.1, 1, 16, 0],
	resetTransform: [],
	getTransform: [],
	setLineDash: [[12, 6]],
	getLineDash: [],
	fillText: [input('text'), 80, 70],
	strokeText: [input('text'), 80, 70],
	measureText: [input('text')],
	beginPath: [],
	fill: ['evenodd'],
	stroke: [],
	clip: ['evenodd'],
	isPointInPath: [input('x'), input('y')],
	isPointInStroke: [input('x'), input('y')],
	save: [],
	restore: [],
	reset: [],
	isContextLost: [],
	getContextAttributes: [],
	createLinearGradient: [0, 0, 220, 0],
	createRadialGradient: [100, 60, 4, 100, 60, 100],
	createConicGradient: [0, 110, 70],
	createImageData: [4, 4],
	getImageData: [16, 16, 2, 2]
};
const pathMethods = new Set(
	'closePath moveTo lineTo quadraticCurveTo bezierCurveTo arc arcTo ellipse rect roundRect beginPath fill stroke clip isPointInPath isPointInStroke'.split(
		' '
	)
);
const mixins: Record<string, string> = {
	CanvasCompositing: 'globalAlpha',
	CanvasFillStrokeStyles: 'createLinearGradient',
	CanvasFilters: 'filter',
	CanvasImageSmoothing: 'imageSmoothingEnabled',
	CanvasPathDrawingStyles: 'setLineDash',
	CanvasShadowStyles: 'shadowBlur',
	CanvasTextDrawingStyles: 'font',
	CanvasDrawImage: 'drawImage',
	CanvasDrawPath: 'fill',
	CanvasPath: 'roundRect',
	CanvasRect: 'fillRect',
	CanvasSettings: 'getContextAttributes',
	CanvasState: 'save',
	CanvasText: 'measureText',
	CanvasTransform: 'translate',
	CanvasImageData: 'getImageData'
};
const enums: Record<string, string> = {
	CanvasDirection: 'direction',
	CanvasFontKerning: 'fontKerning',
	CanvasFontStretch: 'fontStretch',
	CanvasFontVariantCaps: 'fontVariantCaps',
	CanvasLineCap: 'lineCap',
	CanvasLineJoin: 'lineJoin',
	CanvasTextAlign: 'textAlign',
	CanvasTextBaseline: 'textBaseline',
	CanvasTextRendering: 'textRendering'
};
const describe = (value: unknown): unknown => ({
	op: 'conditional',
	test: value,
	then: {
		op: 'conditional',
		test: get(value, '$dom'),
		then: {
			op: 'conditional',
			test: { op: 'binary', operator: '===', left: get(value, 'type'), right: 'ImageData' },
			then: object({
				type: 'ImageData',
				width: domGet(value, 'width'),
				height: domGet(value, 'height'),
				pixels: method(domGet(value, 'data'), 'slice', [0, 32])
			}),
			else: get(value, 'type')
		},
		else: value
	},
	else: value
});
const matrix = (value: unknown) => object(Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, domGet(value, k)])));
const tile: PlatformExpression[] = [
	declare('tile', domCall(doc, 'querySelector', ['#tile'])),
	set('width', 8, v('tile')),
	set('height', 8, v('tile')),
	declare('tileContext', domCall(v('tile'), 'getContext', ['2d'])),
	set('fillStyle', input('color'), v('tileContext')),
	exec('fillRect', [0, 0, 4, 4], v('tileContext'))
];

/** Every program is editable data. Native Canvas policy has no feature names. */
export function canvasRecipe(f: Feature): Recipe | null {
	let member = f.member || '',
		iface = f.interface || '',
		kind = f.kind;
	if (f.language === 'html') {
		if (kind !== 'element' || f.name !== 'canvas') return null;
		iface = 'HTMLCanvasElement';
		member = 'getContext';
		kind = 'operation';
	} else if (f.language !== 'webapi') return null;
	if (f.name in mixins) {
		member = mixins[f.name];
		iface = 'CanvasRenderingContext2D';
		kind = member in properties ? 'attribute' : 'operation';
	}
	if (f.name in enums) {
		member = enums[f.name];
		iface = 'CanvasRenderingContext2D';
		kind = 'attribute';
	}
	const contextSettings = iface === 'CanvasRenderingContext2DSettings' || f.name === 'CanvasColorType';
	const pixelSettings = iface === 'ImageDataSettings' || ['ImageDataPixelFormat', 'ImageDataArray'].includes(f.name);
	const fillRule = f.name === 'CanvasFillRule';
	const imageSource = f.name === 'CanvasImageSource';
	const canvasFamily = iface === 'HTMLCanvasElement';
	const path = iface === 'Path2D';
	const pixels = iface === 'ImageData' || pixelSettings;
	const gradient = iface === 'CanvasGradient';
	const pattern = iface === 'CanvasPattern';
	const metrics = iface === 'TextMetrics';
	const context = iface === 'CanvasRenderingContext2D' || Object.keys(mixins).includes(iface);
	if (!(canvasFamily || path || pixels || gradient || pattern || metrics || context || contextSettings || fillRule || imageSource)) return null;
	if (canvasFamily && !['', 'width', 'height', 'getContext', 'toDataURL'].includes(member)) return null;
	if (kind === 'constructor' && !path && !pixels) return null;
	if (
		context &&
		member &&
		!(member in properties) &&
		!(member in operations) &&
		!['canvas', 'drawImage', 'createPattern', 'putImageData'].includes(member)
	)
		return null;

	const parameters: NonNullable<PlatformProgram['parameters']> = [p('color', '#6366f1'), p('text', 'Thingtime')];
	const settings: Record<string, unknown> = { alpha: true, willReadFrequently: true };
	if (contextSettings) {
		if (kind === 'field' || f.name === 'CanvasColorType') {
			const key = member || 'colorType',
				value = key === 'colorSpace' ? 'display-p3' : key === 'colorType' ? 'unorm8' : true;
			parameters.push(p('setting', value, typeof value === 'boolean' ? 'boolean' : 'text'));
			settings[key] = input('setting');
		} else parameters.push(p('settings', { alpha: false, willReadFrequently: true, colorSpace: 'srgb', desynchronized: false }, 'json'));
	}
	const steps: PlatformExpression[] = [
		declare('doc', domSurface()),
		declare('canvas', domCall(doc, 'querySelector', ['#sample'])),
		declare(
			'ctx',
			domCall(canvas, 'getContext', [
				'2d',
				contextSettings && kind !== 'field' && f.name !== 'CanvasColorType' ? input('settings') : object(settings)
			])
		),
		set('fillStyle', input('color')),
		exec('fillRect', [12, 12, 96, 72]),
		set('font', '20px sans-serif'),
		exec('fillText', [input('text'), 16, 150]),
		set('strokeStyle', input('color')),
		set('lineWidth', 6)
	];
	let value: unknown;
	let resultView: unknown = describe(result);
	if (contextSettings) value = call('getContextAttributes');
	else if (pixels) {
		let options: unknown = object({ colorSpace: 'srgb' });
		if (pixelSettings) {
			if (kind === 'field' || f.name === 'ImageDataPixelFormat') {
				parameters.push(p('setting', member === 'colorSpace' ? 'display-p3' : 'rgba-unorm8'));
				options = object({ [member || 'pixelFormat']: input('setting') });
			} else {
				parameters.push(p('settings', { colorSpace: 'srgb', pixelFormat: 'rgba-unorm8' }, 'json'));
				options = input('settings');
			}
		}
		parameters.push(p('pixels', [255, 64, 0, 255, 0, 128, 255, 255, 0, 128, 255, 255, 255, 64, 0, 255], 'json'));
		steps.push(declare('pixels', domConstruct('ImageData', [input('pixels'), 2, 2, options])), exec('putImageData', [v('pixels'), 20, 20]));
		value = member && kind === 'attribute' ? domGet(v('pixels'), member) : v('pixels');
	} else if (path) {
		parameters.push(p('path', 'M 16 16 h 80 v 48 h -80 Z'));
		steps.push(declare('path', domConstruct('Path2D', [input('path')])));
		if (member === 'addPath')
			steps.push(
				declare('copy', domConstruct('Path2D')),
				exec('addPath', [v('path'), object({ e: 100, f: 32 })], v('copy')),
				exec('fill', [v('copy')])
			);
		steps.push(exec('stroke', [v('path')]));
		value = call('isPointInPath', [v('path'), 32, 32]);
	} else if (gradient || member.includes('Gradient')) {
		const name = member.includes('Gradient') ? member : 'createLinearGradient';
		steps.push(declare('gradient', call(name, operations[name])), exec('addColorStop', [0, input('color')], v('gradient')));
		parameters.push(p('stop', 0.7, 'number'), p('endColor', '#f97316'));
		steps.push(
			exec('addColorStop', [input('stop'), input('endColor')], v('gradient')),
			set('fillStyle', v('gradient')),
			exec('fillRect', [16, 16, 220, 100])
		);
		value = v('gradient');
	} else if (pattern || member === 'createPattern' || imageSource || member === 'drawImage') {
		steps.push(...tile);
		if (member === 'drawImage' || imageSource) value = call('drawImage', [v('tile'), 0, 0, 8, 8, 120, 16, 96, 96]);
		else {
			parameters.push(p('repeat', 'repeat'));
			steps.push(declare('pattern', call('createPattern', [v('tile'), input('repeat')])));
			if (member === 'setTransform') {
				parameters.push(p('scale', 3, 'number'));
				steps.push(exec('setTransform', [object({ a: input('scale'), d: input('scale') })], v('pattern')));
			}
			steps.push(set('fillStyle', v('pattern')), exec('fillRect', [0, 0, 240, 120]));
			value = v('pattern');
		}
	} else if (metrics) {
		steps.push(declare('metrics', call('measureText', [input('text')])));
		value = member ? domGet(v('metrics'), member) : domGet(v('metrics'), 'width');
	} else if (canvasFamily) {
		if (member === 'width' || member === 'height') {
			parameters.push(p('size', member === 'width' ? 220 : 140, 'number'));
			steps.push(set(member, input('size'), canvas), set('fillStyle', input('color')), exec('fillRect', [12, 12, 96, 72]));
			value = domGet(canvas, member);
		} else if (member === 'toDataURL') {
			parameters.push(p('format', 'image/png'));
			value = domCall(canvas, 'toDataURL', [input('format')]);
		} else value = object({ width: domGet(canvas, 'width'), height: domGet(canvas, 'height'), context: get(ctx, 'type') });
	} else if (member === 'canvas')
		value = object({ sameReceiver: { op: 'binary', operator: '===', left: domGet(ctx, 'canvas'), right: canvas }, width: domGet(canvas, 'width') });
	else if (member in properties) {
		const initial = properties[member];
		parameters.push(p('value', initial, typeof initial as 'text' | 'number' | 'boolean'));
		if (typeof initial === 'string') parameters[parameters.length - 1].type = 'text';
		if (member === 'lineDashOffset') steps.push(exec('setLineDash', [[12, 6]]));
		steps.push(
			set('shadowColor', '#64748b'),
			set('shadowOffsetX', 4),
			set('shadowOffsetY', 4),
			set(member, input('value')),
			exec('fillRect', [64, 32, 120, 48]),
			exec('beginPath'),
			exec('moveTo', [16, 90]),
			exec('lineTo', [80, 64]),
			exec('lineTo', [200, 90]),
			exec('stroke'),
			exec('fillText', [input('text'), 96, 132])
		);
		if (member.startsWith('imageSmoothing')) steps.push(...tile, exec('drawImage', [v('tile'), 120, 16, 100, 70]));
		value = domGet(ctx, member);
	} else {
		if (!member) member = 'getContextAttributes';
		if (fillRule) {
			member = 'fill';
			parameters.push(p('fillRule', 'evenodd'));
		}
		if (pathMethods.has(member) || fillRule) {
			steps.push(exec('beginPath'), exec('rect', [16, 16, 100, 72]), exec('rect', [40, 32, 44, 36]), exec('moveTo', [16, 16]));
			if (member.startsWith('isPoint')) parameters.push(p('x', 24, 'number'), p('y', 24, 'number'));
		}
		if (member === 'closePath') steps.push(exec('beginPath'), exec('moveTo', [16, 16]), exec('lineTo', [200, 16]), exec('lineTo', [200, 80]));
		if (['getLineDash', 'lineDashOffset'].includes(member)) steps.push(exec('setLineDash', [[8, 4]]));
		if (['restore', 'save'].includes(member)) steps.push(exec('save'), set('globalAlpha', 0.4));
		if (['resetTransform', 'getTransform'].includes(member)) steps.push(exec('translate', [20, 12]));
		if (member === 'putImageData') steps.push(declare('pixels', call('getImageData', [12, 12, 16, 16])));
		value = call(member, member === 'putImageData' ? [v('pixels'), 130, 32] : fillRule ? [input('fillRule')] : operations[member]);
		steps.push(declare('result', value));
		if (member === 'moveTo') steps.push(exec('lineTo', [220, 140]));
		if (member === 'save') steps.push(set('globalAlpha', 0.8), exec('restore'));
		if (pathMethods.has(member)) steps.push(exec('stroke'));
		if (member === 'clip') steps.push(set('fillStyle', '#f97316'), exec('fillRect', [0, 0, 240, 140]));
		if (['rotate', 'scale', 'translate', 'transform', 'setTransform', 'resetTransform', 'setLineDash', 'restore', 'save'].includes(member))
			steps.push(exec('strokeRect', [72, 24, 128, 72]));
		if (member === 'getTransform') resultView = matrix(result);
		if (member === 'measureText') resultView = object({ width: domGet(result, 'width'), ascent: domGet(result, 'actualBoundingBoxAscent') });
		value = undefined;
	}
	if (value !== undefined) steps.push(declare('result', value));
	steps.push(
		...returns(
			object({
				feature: f.name,
				result: resultView,
				pixel: domGet(call('getImageData', [20, 20, 1, 1]), 'data'),
				state: object({
					alpha: domGet(ctx, 'globalAlpha'),
					lineWidth: domGet(ctx, 'lineWidth'),
					font: domGet(ctx, 'font'),
					pathContainsPoint: call('isPointInPath', [24, 24])
				})
			})
		)
	);
	return recipe(
		{
			...base(f),
			description:
				'Edit the drawing inputs and run. The preview is the real Canvas bitmap; results expose native values and a sampled RGBA pixel. Drawing runs on the isolated frame surface. Other document trees and account data are not exposed.',
			parameters,
			document: [
				{ tag: 'canvas', attributes: { id: 'tile', width: 8, height: 8, hidden: true } },
				{
					tag: 'canvas',
					attributes: { id: 'sample', width: 256, height: 160, role: 'img', 'aria-label': 'Editable Canvas drawing' },
					children: ['The drawing is described by the editable program and pixel results.']
				}
			],
			styles: [{ selector: 'canvas', declarations: { 'max-width': '100%', border: '1px solid #cbd5e1', 'background-color': '#f8fafc' } }],
			steps
		},
		'interactive',
		'Actual native 2D drawing with bounded local resources. Canvas dimensions reset drawing state; unsupported members and native errors remain visible.'
	);
}
