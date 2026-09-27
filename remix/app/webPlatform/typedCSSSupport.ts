import type { Arg } from './domBridge';
export const TYPED_CSS_LIMITS = { text: 2048, list: 32, complexity: 256, totalComplexity: 8192 } as const;
type Receiver = (value: unknown, types: string) => object;
export function typedCSSArgument(value: unknown, rule: string, receiver: Receiver): unknown {
	const numeric = (v: unknown): unknown => (typeof v === 'number' ? number(v) : receiver(v, 'CSSNumericValue'));
	const number = (v: unknown) => {
		if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 32768) throw new Error('Use a bounded finite CSS number');
		return v;
	};
	const text = (v: unknown) => {
		if (typeof v !== 'string' || v.length > TYPED_CSS_LIMITS.text) throw new Error('Use bounded CSS text');
		return v;
	};
	const list = (v: unknown, convert: (x: unknown) => unknown) => {
		if (!Array.isArray(v) || v.length > TYPED_CSS_LIMITS.list) throw new Error('CSS list budget exceeded');
		return v.map(convert);
	};
	switch (rule) {
		case 'css-number':
			return number(value);
		case 'css-numeric':
			return numeric(value);
		case 'css-color-channel':
			return typeof value === 'string' ? text(value) : typeof value === 'number' ? number(value) : receiver(value, 'CSSNumericValue|CSSKeywordValue');
		case 'css-keyword':
			return typeof value === 'string' ? text(value) : receiver(value, 'CSSKeywordValue');
		case 'css-color-channels':
			return list(value, (v) =>
				typeof v === 'string' ? text(v) : typeof v === 'number' ? number(v) : receiver(v, 'CSSNumericValue|CSSKeywordValue')
			);
		case 'css-text':
			return text(value);
		case 'css-unit': {
			const unit = text(value);
			if (!/^[a-zA-Z%]{1,16}$/.test(unit)) throw new Error('Invalid CSS unit');
			return unit;
		}
		case 'css-property': {
			const name = text(value);
			if (!/^(?:--[a-zA-Z0-9_-]+|[a-zA-Z][a-zA-Z0-9-]*)$/.test(name) || name.length > 100) throw new Error('Invalid CSS property');
			return name;
		}
		case 'css-style-value':
			return typeof value === 'string' ? text(value) : receiver(value, 'CSSStyleValue');
		case 'css-perspective':
			return typeof value === 'string' ? text(value) : typeof value === 'number' ? number(value) : receiver(value, 'CSSNumericValue|CSSKeywordValue');
		case 'css-numeric-list':
			return list(value, numeric);
		case 'css-transform-list':
			return list(value, (v) => receiver(v, 'CSSTransformComponent'));
		case 'css-unparsed-list':
			return list(value, (v) => (typeof v === 'string' ? text(v) : receiver(v, 'CSSVariableReferenceValue')));
		case 'css-unparsed':
			return value === null ? null : receiver(value, 'CSSUnparsedValue');
		case 'css-matrix':
			if (Array.isArray(value)) {
				if (![6, 16].includes(value.length)) throw new Error('Use six or sixteen matrix numbers');
				return value.map(number);
			}
			return receiver(value, 'DOMMatrixReadOnly');
		case 'css-matrix-options':
			if (
				!value ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				Object.keys(value).some((k) => k !== 'is2D') ||
				('is2D' in value && typeof value.is2D !== 'boolean')
			)
				throw new Error('Invalid CSS matrix options');
			return { ...value };
		// Constructed sheets never attach to a document. Only style rules are exposed.
		case 'css-rule': {
			const ruleText = text(value);
			if (/[@\\]/.test(ruleText) || !/^[^{}]+\{[^{}]*\}$/.test(ruleText.trim())) throw new Error('Use one bounded CSS style rule');
			return ruleText;
		}
	}
	throw new Error('Unregistered CSS argument');
}
export function typedCSSArguments(
	shape: { args: Arg[]; min?: number; rest?: boolean },
	values: unknown[],
	convert: (value: unknown, rule: Arg) => unknown
) {
	if (values.length < (shape.min ?? shape.args.length) || (!shape.rest && values.length > shape.args.length))
		throw new Error('Invalid CSS argument count');
	return values.map((v, i) => convert(v, shape.args[Math.min(i, shape.args.length - 1)]));
}
export function typedCSSNumericType(value: unknown) {
	if (!value || typeof value !== 'object') throw new Error('Invalid native CSS numeric type');
	const out: Record<string, unknown> = {};
	for (const key of ['length', 'angle', 'time', 'frequency', 'resolution', 'flex', 'percent', 'percentHint']) {
		const item = (value as Record<string, unknown>)[key];
		if (item !== undefined) {
			if (key === 'percentHint' ? typeof item !== 'string' : typeof item !== 'number' || !Number.isFinite(item))
				throw new Error('Invalid native CSS numeric type field');
			out[key] = item;
		}
	}
	return out;
}
