/** Shared native Canvas resource/argument boundary. No demo or catalogue IDs. */
export const CANVAS_LIMITS = { edge: 512, canvases: 4, pixelEdge: 32, pixelValues: 4096 } as const;
const finite = (value: unknown, limit = 32768): number => {
	if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) throw new Error('Use a bounded numeric Canvas argument');
	return value;
};
const dictionary = (value: unknown, rules: Record<string, (value: unknown) => unknown>) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a Canvas settings object');
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (!Object.prototype.hasOwnProperty.call(rules, key)) throw new Error('Unregistered Canvas setting');
		out[key] = rules[key](item);
	}
	return out;
};
const text = (value: unknown) => {
	if (typeof value !== 'string' || value.length > 256) throw new Error('Expected bounded Canvas text');
	return value;
};
const boolean = (value: unknown) => {
	if (typeof value !== 'boolean') throw new Error('Expected a boolean Canvas setting');
	return value;
};
export function canvasArgument(value: unknown, rule: string, handle: (value: unknown, type: string) => object): unknown {
	if (rule === 'canvas-context') {
		if (value !== '2d') throw new Error('This bridge exposes the 2D context');
		return value;
	}
	if (rule === 'canvas-size' || rule === 'pixel-size') {
		const n = finite(value, rule === 'canvas-size' ? CANVAS_LIMITS.edge : CANVAS_LIMITS.pixelEdge);
		if (!Number.isInteger(n) || (rule === 'canvas-size' && n < 0)) throw new Error('Expected a bounded integer Canvas dimension');
		return n;
	}
	if (rule === 'canvas-blur') return finite(value, 32);
	if (rule === 'canvas-fill') {
		if (!['nonzero', 'evenodd'].includes(value as string)) throw new Error('Expected a Canvas fill rule');
		return value;
	}
	if (rule === 'canvas-style') return typeof value === 'string' ? text(value) : handle(value, 'CanvasGradient|CanvasPattern');
	if (rule === 'canvas-source') return handle(value, 'HTMLCanvasElement');
	if (rule === 'canvas-path') return handle(value, 'Path2D');
	if (rule === 'canvas-image-data') return handle(value, 'ImageData');
	if (rule === 'canvas-font') {
		const s = text(value);
		const match = /^(?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|[1-9]00)\s+)*([0-9]+(?:\.[0-9]+)?)px\s+[-\w ,'"]{1,100}$/.exec(s);
		if (!match || Number(match[1]) > 128) throw new Error('Use an absolute font size no larger than 128px');
		return s;
	}
	if (rule === 'canvas-filter') {
		const s = text(value);
		if (
			s !== 'none' &&
			!/^(?:(?:blur\((?:[0-9]|[12][0-9]|3[0-2])(?:\.\d+)?px\)|(?:brightness|contrast|grayscale|invert|opacity|saturate|sepia)\(\d{1,3}(?:\.\d+)?%?\)|hue-rotate\(-?\d{1,3}(?:\.\d+)?deg\))\s*){1,4}$/.test(
				s
			)
		)
			throw new Error('Use bounded local Canvas filters');
		return s;
	}
	if (rule === 'canvas-matrix')
		return dictionary(
			value,
			Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'm11', 'm12', 'm21', 'm22', 'm41', 'm42'].map((k) => [k, (v: unknown) => finite(v, 4096)]))
		);
	if (rule === 'canvas-settings')
		return dictionary(value, { alpha: boolean, desynchronized: boolean, willReadFrequently: boolean, colorSpace: text, colorType: text });
	if (rule === 'pixel-settings') return dictionary(value, { colorSpace: text, pixelFormat: text });
	if (rule === 'canvas-dash') {
		if (!Array.isArray(value) || value.length > 32) throw new Error('Use at most 32 dash values');
		return value.map((v) => finite(v, 512));
	}
	if (rule === 'canvas-radii') {
		const radius = (v: unknown) => (typeof v === 'number' ? finite(v, 512) : dictionary(v, { x: (v) => finite(v, 512), y: (v) => finite(v, 512) }));
		if (!Array.isArray(value)) return radius(value);
		if (value.length > 4) throw new Error('Use at most four corner radii');
		return value.map(radius);
	}
	throw new Error('Unregistered Canvas argument');
}

/** Browser output may add implementation-specific keys. Project the published
 * dictionary separately from the stricter author-input validator. */
export function canvasContextAttributes(value: unknown): Record<string, unknown> | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object') throw new Error('Invalid native Canvas attributes');
	const allowed = ['alpha', 'desynchronized', 'willReadFrequently', 'colorSpace', 'colorType'];
	const projected = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
	return canvasArgument(projected, 'canvas-settings', () => {
		throw new Error('No handle');
	}) as Record<string, unknown>;
}
