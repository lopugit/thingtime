import { SVG_FILTER_TAGS, svgFilterAttribute, svgFilterImage } from './svgFilterSupport';
import { canvasArgument } from './canvasSupport';
/** SVG authoring and argument boundaries, shared by every program. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const SVG_TAGS = new Set(
	'svg g defs symbol title desc metadata rect circle ellipse line polyline polygon path text tspan linearGradient radialGradient stop pattern clipPath mask marker switch view'.split(
		' '
	)
);
export const SVG_LIMITS = { nodes: 128, list: 32, text: 4096, edge: 512 } as const;
const svgAttributes = new Set(
	'filter id class role tabindex aria-label aria-labelledby aria-describedby width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points pathLength transform viewBox preserveAspectRatio fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity color display visibility font-family font-size font-weight text-anchor dominant-baseline textLength lengthAdjust rotate gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr patternUnits patternContentUnits patternTransform clipPathUnits clip-path maskUnits maskContentUnits mask markerUnits markerWidth markerHeight refX refY orient marker-start marker-mid marker-end requiredExtensions systemLanguage href'.split(
		' '
	)
);
export function svgTag(value: unknown): string {
	if (typeof value !== 'string' || (!SVG_TAGS.has(value) && !SVG_FILTER_TAGS.has(value))) throw new Error('Unregistered SVG element');
	return value;
}
export function svgAttribute(tag: string, key: string, value: string, reflected = false): string {
	if (svgFilterAttribute(tag, key, value)) return value;
	if (!svgAttributes.has(key) || value.length > SVG_LIMITS.text) throw new Error('Unregistered or oversized SVG attribute');
	if (key === 'filter' && !/^(?:none|url\(#[A-Za-z][\w-]{0,80}\))$/.test(value)) throw new Error('SVG filters require a local fragment');
	if (key === 'href' && !/^#[A-Za-z][\w-]{0,80}$/.test(value)) throw new Error('SVG references must be local fragments');
	if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z][\w-]{0,80}\)$/.test(value)) throw new Error('SVG paint references must be local fragments');
	if (!reflected && tag === 'svg' && ['width', 'height'].includes(key)) {
		if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > SVG_LIMITS.edge) throw new Error('SVG viewport dimensions must be at most 512 pixels');
	}
	const listTokens = value
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean);
	const numericTokens = value.match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g) || [];
	if (key === 'points' && numericTokens.length > SVG_LIMITS.list * 2) throw new Error('SVG points exceed the list budget');
	if (
		((['text', 'tspan'].includes(tag) && ['x', 'y', 'dx', 'dy', 'rotate'].includes(key)) || ['requiredExtensions', 'systemLanguage'].includes(key)) &&
		(['requiredExtensions', 'systemLanguage'].includes(key) ? listTokens.length : numericTokens.length) > SVG_LIMITS.list
	)
		throw new Error('SVG attribute exceeds the list budget');
	if (['transform', 'gradientTransform', 'patternTransform'].includes(key) && (value.match(/\(/g) || []).length > SVG_LIMITS.list)
		throw new Error('SVG transforms exceed the list budget');

	return value;
}
const scalar = (value: unknown): number => {
	if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 4096) throw new Error('Expected a bounded SVG number');
	return value;
};
export function svgArgument(value: unknown, rule: string, handle: (value: unknown, type: string) => object): unknown {
	if (rule === 'svg-matrix')
		return value && typeof value === 'object' && '$dom' in value
			? handle(value, 'SVGMatrix|DOMMatrix')
			: canvasArgument(value, 'canvas-matrix', handle);
	if (rule === 'svg-number') return scalar(value);
	if (rule === 'svg-filter-image') {
		if (typeof value !== 'string') throw new Error('Expected local image bytes');
		return svgFilterImage(value);
	}
	if (rule === 'svg-text') {
		if (typeof value !== 'string' || value.length > 256) throw new Error('Expected bounded SVG text');
		return value;
	}
	if (rule === 'svg-fragment') {
		if (typeof value !== 'string' || !/^#[A-Za-z][\w-]{0,80}$/.test(value)) throw new Error('SVG references must be local fragments');
		return value;
	}
	if (rule === 'svg-unit') {
		if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?(?:%|px|em|ex|cm|mm|in|pt|pc|deg|rad|grad)?$/.test(value) || Math.abs(parseFloat(value)) > 512)
			throw new Error('Expected a bounded SVG unit value');
		return value;
	}
	if (rule === 'svg-point' || rule === 'svg-box-options') {
		const keys = rule === 'svg-point' ? ['x', 'y', 'z', 'w'] : ['fill', 'stroke', 'markers', 'clipped'];
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an SVG dictionary');
		return Object.fromEntries(
			Object.entries(value).map(([key, v]) => {
				if (!keys.includes(key)) throw new Error('Unregistered SVG dictionary field');
				if (rule === 'svg-box-options' && typeof v !== 'boolean') throw new Error('Expected an SVG boolean option');
				return [key, rule === 'svg-point' ? scalar(v) : v];
			})
		);
	}
	const type = {
		'svg-length': 'SVGLength',
		'svg-angle': 'SVGAngle',
		'svg-number-value': 'SVGNumber',
		'svg-point-value': 'DOMPoint|SVGPoint',
		'svg-transform': 'SVGTransform',
		'svg-rect': 'DOMRect|SVGRect',
		'svg-element': 'SVGElement',
		'svg-nullable-element': 'SVGElement'
	}[rule];
	if (type) return rule === 'svg-nullable-element' && value === null ? null : handle(value, type);
	throw new Error('Unregistered SVG argument');
}
