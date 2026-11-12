import type { Arg, Policy } from './domBridge';
const call = (args: Arg[] = [], min = args.length, overloads?: Arg[][]) => ({ args, min, overloads, mutates: true });
const numbers = (n: number): Arg[] => Array(n).fill('finite');
export const CANVAS_PATH_CALLS = {
	closePath: call(),
	moveTo: call(numbers(2)),
	lineTo: call(numbers(2)),
	quadraticCurveTo: call(numbers(4)),
	bezierCurveTo: call(numbers(6)),
	arcTo: call(numbers(5)),
	rect: call(numbers(4)),
	arc: call([...numbers(5), 'boolean'], 5),
	ellipse: call([...numbers(7), 'boolean'], 7),
	roundRect: call([...numbers(4), 'canvas-radii'], 4)
};
const writeArgs: Record<string, Arg> = Object.fromEntries(
	[
		['finite', 'globalAlpha lineDashOffset lineWidth miterLimit shadowOffsetX shadowOffsetY'],
		['canvas-blur', 'shadowBlur'],
		['canvas-style', 'fillStyle strokeStyle'],
		['canvas-filter', 'filter'],
		['canvas-font', 'font'],
		['boolean', 'imageSmoothingEnabled'],
		[
			'text',
			'globalCompositeOperation imageSmoothingQuality lineCap lineJoin shadowColor direction fontKerning fontStretch fontVariantCaps lang letterSpacing textAlign textBaseline textRendering wordSpacing'
		]
	].flatMap(([rule, keys]) => keys.split(' ').map((key) => [key, rule as Arg]))
);
export const CANVAS_RECEIVER_POLICY: Record<string, Policy> = {
	HTMLCanvasElement: {
		reads: 'width height',
		writes: 'width height',
		writeArgs: { width: 'canvas-size', height: 'canvas-size' },
		calls: {
			getContext: call(['canvas-context', 'canvas-settings'], 1),
			toDataURL: call(['text', 'finite'], 0)
		}
	},
	CanvasRenderingContext2D: {
		reads: `canvas ${Object.keys(writeArgs).join(' ')}`,
		writes: Object.keys(writeArgs).join(' '),
		writeArgs,
		calls: {
			...CANVAS_PATH_CALLS,
			save: call(),
			restore: call(),
			reset: call(),
			isContextLost: call(),
			getContextAttributes: call(),
			getTransform: call(),
			resetTransform: call(),
			rotate: call(numbers(1)),
			scale: call(numbers(2)),
			translate: call(numbers(2)),
			transform: call(numbers(6)),
			setTransform: call([], 0, [[], ['canvas-matrix'], numbers(6)]),
			beginPath: call(),
			fill: call([], 0, [[], ['canvas-fill'], ['canvas-path'], ['canvas-path', 'canvas-fill']]),
			stroke: call(['canvas-path'], 0),
			clip: call([], 0, [[], ['canvas-fill'], ['canvas-path'], ['canvas-path', 'canvas-fill']]),
			isPointInPath: call([], 0, [
				numbers(2),
				[...numbers(2), 'canvas-fill'],
				['canvas-path', ...numbers(2)],
				['canvas-path', ...numbers(2), 'canvas-fill']
			]),
			isPointInStroke: call([], 0, [numbers(2), ['canvas-path', ...numbers(2)]]),
			fillRect: call(numbers(4)),
			strokeRect: call(numbers(4)),
			clearRect: call(numbers(4)),
			fillText: call(['text', ...numbers(3)], 3),
			strokeText: call(['text', ...numbers(3)], 3),
			measureText: call(['text']),
			createLinearGradient: call(numbers(4)),
			createRadialGradient: call(numbers(6)),
			createConicGradient: call(numbers(3)),
			createPattern: call(['canvas-source', 'text']),
			drawImage: call([], 0, [
				['canvas-source', ...numbers(2)],
				['canvas-source', ...numbers(4)],
				['canvas-source', ...numbers(8)]
			]),
			getLineDash: call(),
			setLineDash: call(['canvas-dash']),
			createImageData: call([], 0, [['canvas-image-data'], ['pixel-size', 'pixel-size'], ['pixel-size', 'pixel-size', 'pixel-settings']]),
			getImageData: call(['finite', 'finite', 'pixel-size', 'pixel-size', 'pixel-settings'], 4),
			putImageData: call([], 0, [
				['canvas-image-data', ...numbers(2)],
				['canvas-image-data', ...numbers(6)]
			])
		}
	},
	CanvasGradient: { reads: '', calls: { addColorStop: call(['finite', 'text']) } },
	CanvasPattern: { reads: '', calls: { setTransform: call(['canvas-matrix'], 0) } },
	Path2D: { reads: '', calls: { ...CANVAS_PATH_CALLS, addPath: call(['canvas-path', 'canvas-matrix'], 1) } },
	ImageData: { reads: 'width height data colorSpace pixelFormat' },
	TextMetrics: {
		reads:
			'width actualBoundingBoxLeft actualBoundingBoxRight fontBoundingBoxAscent fontBoundingBoxDescent actualBoundingBoxAscent actualBoundingBoxDescent emHeightAscent emHeightDescent hangingBaseline alphabeticBaseline ideographicBaseline'
	},
	DOMMatrixReadOnly: { reads: 'a b c d e f m11 m12 m13 m14 m21 m22 m23 m24 m31 m32 m33 m34 m41 m42 m43 m44 is2D isIdentity' }
};
