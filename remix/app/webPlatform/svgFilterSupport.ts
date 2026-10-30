/** Shared filter resource boundaries. Programs author ordinary SVG data. */
export const SVG_FILTER_TAGS = new Set(
	'filter feBlend feColorMatrix feComponentTransfer feFuncR feFuncG feFuncB feFuncA feComposite feConvolveMatrix feDiffuseLighting feDistantLight fePointLight feSpotLight feDisplacementMap feDropShadow feFlood feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset feSpecularLighting feTile feTurbulence'.split(
		' '
	)
);
export const SVG_FILTER_LIMITS = { filters: 4, nodes: 32, region: 512, blur: 16, radius: 8, octaves: 4, order: 5, list: 32 } as const;
const enums: Record<string, string[]> = {
	filterUnits: ['userSpaceOnUse'],
	primitiveUnits: ['userSpaceOnUse'],
	mode: 'normal multiply screen darken lighten overlay color-dodge color-burn hard-light soft-light difference exclusion hue saturation color luminosity'.split(
		' '
	),
	edgeMode: ['duplicate', 'wrap', 'none'],
	xChannelSelector: ['R', 'G', 'B', 'A'],
	yChannelSelector: ['R', 'G', 'B', 'A'],
	stitchTiles: ['stitch', 'noStitch'],
	preserveAlpha: ['true', 'false'],
	crossorigin: ['anonymous'],
	'color-interpolation-filters': ['sRGB', 'linearRGB']
};
export function svgFilterNumbers(property: string, value: unknown): number[] {
	const text = typeof value === 'number' ? String(value) : value;
	if (typeof text !== 'string' || text.length > 1024) throw new Error('Expected bounded SVG filter numbers');
	// Split first, then validate disjoint scalar tokens. A repeated-number regular
	// expression can backtrack exponentially before rejecting malformed input.
	const tokens = text.trim().split(/[\s,]+/);
	if (tokens.length > SVG_FILTER_LIMITS.list) throw new Error('SVG filter parameter exceeds its work budget');
	if (tokens.some((token) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))) throw new Error('Expected bounded SVG filter numbers');
	const values = tokens.map(Number);
	const key = property.replace(/^(stdDeviation|radius|order|baseFrequency|kernelUnitLength)[XY]$/, '$1');
	const max =
		key === 'stdDeviation'
			? 16
			: key === 'radius'
			? 8
			: key === 'numOctaves'
			? 4
			: key === 'order'
			? 5
			: key === 'baseFrequency'
			? 1
			: key === 'specularExponent'
			? 64
			: key === 'kernelUnitLength'
			? 32
			: key === 'kernelMatrix' || key === 'tableValues'
			? 8
			: 512;
	const count = ['values', 'kernelMatrix', 'tableValues'].includes(key)
		? 32
		: ['stdDeviation', 'radius', 'order', 'baseFrequency', 'kernelUnitLength'].includes(key)
		? 2
		: 1;
	if (values.length > count || values.some((n) => !Number.isFinite(n) || Math.abs(n) > max))
		throw new Error('SVG filter parameter exceeds its work budget');
	if (['numOctaves', 'order', 'targetX', 'targetY'].includes(key) && values.some((n) => !Number.isInteger(n) || n < 0))
		throw new Error('Expected an integer SVG filter parameter');
	return values;
}
export function svgFilterImage(value: string): string {
	if (!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > 24000)
		throw new Error('SVG filter images require a bounded local PNG');
	let bytes: string;
	try {
		bytes = atob(value.slice('data:image/png;base64,'.length));
	} catch {
		throw new Error('Invalid local PNG');
	}
	const uint = (at: number) =>
		bytes.charCodeAt(at) * 0x1000000 + (bytes.charCodeAt(at + 1) << 16) + (bytes.charCodeAt(at + 2) << 8) + bytes.charCodeAt(at + 3);
	if (
		bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
		bytes.slice(12, 16) !== 'IHDR' ||
		uint(8) !== 13 ||
		uint(16) < 1 ||
		uint(16) > 128 ||
		uint(20) < 1 ||
		uint(20) > 128
	)
		throw new Error('SVG filter PNG dimensions exceed 128 pixels');
	let at = 8,
		chunks = 0,
		ended = false;
	while (at < bytes.length && ++chunks <= 64) {
		const length = uint(at),
			type = bytes.slice(at + 4, at + 8);
		if (!['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type) || !Number.isSafeInteger(length) || length < 0 || at + 12 + length > bytes.length)
			throw new Error('Unregistered or malformed PNG chunk');
		at += 12 + length;
		if (type === 'IEND') {
			ended = true;
			break;
		}
	}
	if (!ended || at !== bytes.length) throw new Error('Incomplete local PNG');
	return value;
}
const numeric = new Set(
	'x y z width height dx dy stdDeviation radius baseFrequency numOctaves seed order kernelMatrix divisor bias targetX targetY kernelUnitLength surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation pointsAtX pointsAtY pointsAtZ scale k1 k2 k3 k4 values tableValues slope intercept amplitude exponent offset flood-opacity'.split(
		' '
	)
);
export function svgFilterAttribute(tag: string, key: string, value: string): boolean {
	if (!SVG_FILTER_TAGS.has(tag)) return false;
	if (key === 'href' && tag === 'feImage') {
		svgFilterImage(value);
		return true;
	}
	if (['in', 'in2', 'result'].includes(key)) {
		if (!/^[A-Za-z][\w-]{0,31}$/.test(value)) throw new Error('Expected a local SVG filter input/result name');
		return true;
	}
	if (key === 'type') {
		const values =
			tag === 'feColorMatrix'
				? ['matrix', 'saturate', 'hueRotate', 'luminanceToAlpha']
				: tag === 'feTurbulence'
				? ['fractalNoise', 'turbulence']
				: ['identity', 'table', 'discrete', 'linear', 'gamma'];
		if (!values.includes(value)) throw new Error('Unregistered SVG filter type');
		return true;
	}
	if (key === 'operator') {
		if (!(tag === 'feMorphology' ? ['erode', 'dilate'] : ['over', 'in', 'out', 'atop', 'xor', 'arithmetic']).includes(value))
			throw new Error('Unregistered SVG filter operator');
		return true;
	}
	if (enums[key]) {
		if (!enums[key].includes(value)) throw new Error('Unregistered SVG filter option');
		return true;
	}
	if (numeric.has(key)) {
		svgFilterNumbers(key, ['x', 'y', 'width', 'height'].includes(key) ? value.replace(/px$/, '') : value);
		return true;
	}
	if (['flood-color', 'lighting-color'].includes(key)) {
		if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) throw new Error('Use a local hexadecimal SVG filter colour');
		return true;
	}
	return false;
}
/** Validate a native nested value before invoking its setter. */
export function svgFilterValue(tag: string, property: string, value: unknown): void {
	if (!SVG_FILTER_TAGS.has(tag)) return;
	if (['in1', 'in2', 'result'].includes(property)) {
		svgFilterAttribute(tag, property === 'in1' ? 'in' : property, String(value));
		return;
	}
	if (property === 'href' && tag === 'feImage') {
		if (typeof value !== 'string') throw new Error('Expected local image bytes');
		svgFilterImage(value);
		return;
	}
	if (property === 'crossOrigin') {
		if (value !== 'anonymous') throw new Error('Only anonymous local PNGs are registered');
		return;
	}
	if (['filterUnits', 'primitiveUnits'].includes(property) && value !== 1) throw new Error('Filter runs require userSpaceOnUse units');
	if (property === 'preserveAlpha') {
		if (typeof value !== 'boolean') throw new Error('Expected a filter boolean');
		return;
	}
	if (typeof value === 'number') svgFilterNumbers(property, value);
}
