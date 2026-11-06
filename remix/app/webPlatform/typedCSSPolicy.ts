import type { Arg, Policy } from './domBridge';
export type TypedCSSArg =
	| 'css-number'
	| 'css-numeric'
	| 'css-numeric-list'
	| 'css-unit'
	| 'css-text'
	| 'css-property'
	| 'css-style-value'
	| 'css-transform-list'
	| 'css-unparsed-list'
	| 'css-unparsed'
	| 'css-matrix'
	| 'css-matrix-options'
	| 'css-perspective'
	| 'css-color-channel'
	| 'css-color-channels'
	| 'css-keyword'
	| 'css-rule';
type Signature = { args: Arg[]; min?: number; rest?: boolean; iterable?: boolean; mutates?: boolean };
const call = (args: Arg[] = [], extra: Omit<Signature, 'args'> = {}): Signature => ({ args, ...extra });
const variadic = (arg: Arg, min = 1) => call([arg], { rest: true, min });
const iteration = { keys: call([], { iterable: true }), values: call([], { iterable: true }), entries: call([], { iterable: true }) };
const numeric = 'css-numeric' as const;
const writable = (keys: string, rule: Arg): Policy => ({
	reads: keys,
	writes: keys,
	writeArgs: Object.fromEntries(keys.split(' ').map((k) => [k, rule]))
});
export const CSS_UNIT_FACTORIES =
	'number percent cap ch em ex ic lh rcap rch rem rex ric rlh cm mm Q in pt pc px vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax deg grad rad turn s ms Hz kHz dpi dpcm dppx fr'.split(
		' '
	);
export const TYPED_CSS_STATIC: Record<string, Record<string, Signature>> = {
	CSS: Object.fromEntries(CSS_UNIT_FACTORIES.map((k) => [k, call(['css-number'])])),
	CSSStyleValue: { parse: call(['css-property', 'css-text']), parseAll: call(['css-property', 'css-text']) },
	CSSNumericValue: { parse: call(['css-text']) },
	CSSColorValue: { parse: call(['css-text']) }
};
export const TYPED_CSS_CONSTRUCTORS: Record<string, Signature> = {
	CSSUnitValue: call(['css-number', 'css-unit']),
	CSSKeywordValue: call(['css-text']),
	CSSMathSum: variadic(numeric),
	CSSMathProduct: variadic(numeric),
	CSSMathMin: variadic(numeric),
	CSSMathMax: variadic(numeric),
	CSSMathNegate: call([numeric]),
	CSSMathInvert: call([numeric]),
	CSSMathClamp: call([numeric, numeric, numeric]),
	CSSTranslate: call([numeric, numeric, numeric], { min: 2 }),
	CSSScale: call([numeric, numeric, numeric], { min: 2 }),
	CSSRotate: call([numeric, numeric, numeric, numeric], { min: 1 }),
	CSSSkew: call([numeric, numeric]),
	CSSSkewX: call([numeric]),
	CSSSkewY: call([numeric]),
	CSSPerspective: call(['css-perspective']),
	CSSMatrixComponent: call(['css-matrix', 'css-matrix-options'], { min: 1 }),
	CSSTransformValue: call(['css-transform-list']),
	CSSUnparsedValue: call(['css-unparsed-list']),
	CSSVariableReferenceValue: call(['css-text', 'css-unparsed'], { min: 1 }),
	DOMMatrix: call(['css-matrix'], { min: 0 }),
	CSSStyleSheet: call(),
	CSSRGB: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSHSL: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSHWB: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSLab: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSLCH: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSOKLab: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSOKLCH: call(['css-color-channel', 'css-color-channel', 'css-color-channel', 'css-color-channel'], { min: 3 }),
	CSSColor: call(['css-keyword', 'css-color-channels', 'css-color-channel'], { min: 2 })
};
export const TYPED_CSS_RECEIVER_POLICY: Record<string, Policy> = {
	CSSUnitValue: { ...writable('value', 'css-number'), reads: 'value unit' },
	CSSKeywordValue: writable('value', 'css-text'),
	CSSMathClamp: { reads: 'lower value upper' },
	CSSMathNegate: { reads: 'value' },
	CSSMathInvert: { reads: 'value' },
	CSSMathSum: { reads: 'values' },
	CSSMathProduct: { reads: 'values' },
	CSSMathMin: { reads: 'values' },
	CSSMathMax: { reads: 'values' },
	CSSMathValue: { reads: 'operator' },
	CSSNumericValue: {
		reads: '',
		calls: {
			...Object.fromEntries('add sub mul div min max equals'.split(' ').map((k) => [k, variadic(numeric, 0)])),
			to: call(['css-unit']),
			toSum: variadic('css-unit', 0),
			type: call()
		}
	},
	CSSNumericArray: { reads: 'length', calls: iteration },
	CSSTranslate: writable('x y z', numeric),
	CSSScale: writable('x y z', numeric),
	CSSRotate: writable('x y z angle', numeric),
	CSSSkew: writable('ax ay', numeric),
	CSSSkewX: writable('ax', numeric),
	CSSSkewY: writable('ay', numeric),
	CSSPerspective: writable('length', 'css-perspective'),
	CSSMatrixComponent: writable('matrix', 'css-matrix'),
	CSSTransformComponent: { ...writable('is2D', 'boolean'), calls: { toMatrix: call(), toString: call() } },
	CSSTransformValue: { reads: 'length is2D', calls: { ...iteration, toMatrix: call() } },
	CSSUnparsedValue: { reads: 'length', calls: iteration },
	CSSVariableReferenceValue: { ...writable('variable', 'css-text'), reads: 'variable fallback' },
	CSSRGB: writable('r g b alpha', 'css-color-channel'),
	CSSHSL: writable('h s l alpha', 'css-color-channel'),
	CSSHWB: writable('h w b alpha', 'css-color-channel'),
	CSSLab: writable('l a b alpha', 'css-color-channel'),
	CSSLCH: writable('l c h alpha', 'css-color-channel'),
	CSSOKLab: writable('l a b alpha', 'css-color-channel'),
	CSSOKLCH: writable('l c h alpha', 'css-color-channel'),
	CSSColor: {
		...writable('colorSpace channels alpha', 'css-color-channel'),
		writeArgs: { colorSpace: 'css-keyword', channels: 'css-color-channels', alpha: 'css-color-channel' }
	},
	CSSColorValue: { reads: '' },
	CSSImageValue: { reads: '' },
	CSSStyleValue: { reads: '', calls: { toString: call() } },
	StylePropertyMap: {
		reads: '',
		calls: {
			set: call(['css-property', 'css-style-value'], { min: 2, rest: true, mutates: true }),
			append: call(['css-property', 'css-style-value'], { min: 2, rest: true, mutates: true }),
			delete: call(['css-property'], { mutates: true }),
			clear: call([], { mutates: true })
		}
	},
	StylePropertyMapReadOnly: {
		reads: 'size',
		calls: { get: call(['css-property']), getAll: call(['css-property']), has: call(['css-property']), ...iteration }
	},
	CSSStyleSheet: { reads: 'cssRules', calls: { insertRule: call(['css-rule', 'number'], { min: 1, mutates: true }) } },
	CSSRuleList: { reads: 'length', calls: { item: call(['number']) } },
	CSSStyleRule: { reads: 'styleMap selectorText cssText' }
};
