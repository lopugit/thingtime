export const CSSOM_LIMITS = { text: 4096, rules: 32, depth: 8, sheets: 8 } as const;
/** Input bounds are applied before invoking the browser parser. The opaque
 * runtime CSP remains the network boundary, including CSS resource fetches. */
export function cssomText(value: unknown): string {
	if (typeof value !== 'string' || value.length > CSSOM_LIMITS.text) throw new Error('CSSOM text budget exceeded');
	let depth = 0,
		count = (value.match(/@(?:namespace|import)\b/gi) || []).length;
	if (count > CSSOM_LIMITS.rules) throw new Error('CSSOM rule budget exceeded');
	// Deliberately conservative for quoted braces; native parsing still decides
	// syntax and serialization. This is an allocation bound, not a CSS parser.
	for (const c of value) {
		if (c === '{') {
			if (++depth > CSSOM_LIMITS.depth || ++count > CSSOM_LIMITS.rules) throw new Error('CSSOM rule budget exceeded');
		} else if (c === '}') depth = Math.max(0, depth - 1);
	}
	return value;
}
export function cssomArgument(value: unknown, rule: string, receiver: (value: unknown, types: string) => object): unknown {
	switch (rule) {
		case 'cssom-text':
			return cssomText(value);
		case 'cssom-rule': {
			const text = cssomText(value);
			if (/@import/i.test(text)) throw new Error('Use a bounded CSS style rule without imports on a constructed sheet');
			return text;
		}
		case 'cssom-element':
			return receiver(value, 'Element');
		case 'cssom-pseudo':
			if (value === null || value === '' || value === '::before' || value === '::after') return value;
			throw new Error('Use a supported CSS pseudo-element');
		case 'cssom-sheets':
			if (!Array.isArray(value) || value.length > CSSOM_LIMITS.sheets) throw new Error('CSSOM adopted sheet budget exceeded');
			return value.map((v) => receiver(v, 'CSSStyleSheet'));
		case 'cssom-shadow':
			if (
				!value ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				Object.keys(value).length !== 1 ||
				(value as { mode?: unknown }).mode !== 'open'
			)
				throw new Error('Use an open, program-owned shadow root');
			return { mode: 'open' };
		case 'cssom-options': {
			if (
				!value ||
				typeof value !== 'object' ||
				Array.isArray(value) ||
				Object.keys(value).some((k) => !['baseURL', 'media', 'disabled'].includes(k))
			)
				throw new Error('Invalid CSS stylesheet options');
			const v = value as Record<string, unknown>,
				out: Record<string, unknown> = {};
			if ('baseURL' in v) out.baseURL = v.baseURL === null ? null : cssomText(v.baseURL);
			if ('media' in v) out.media = typeof v.media === 'string' ? cssomText(v.media) : receiver(v.media, 'MediaList');
			if ('disabled' in v) {
				if (typeof v.disabled !== 'boolean') throw new Error('Use a boolean stylesheet disabled flag');
				out.disabled = v.disabled;
			}
			return out;
		}
	}
	throw new Error('Unregistered CSSOM argument');
}
