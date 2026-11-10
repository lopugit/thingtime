// Pure value parsing/serialising for the Figma-style inspector controls —
// kept DOM-free so node unit tests cover the shorthand math directly.

import { WEBPAGE_CSS_KEY_PATTERN } from '~/schemas/registry';

// css shorthand expansion — works for sides (T R B L) and corners
// (TL TR BR BL): [a, b=a, c=a, d=b] is the spec's fallback chain for both.
// paren-aware tokenizer: calc(100% - 20px) / rgba(0, 0, 0, .5) stay whole
export const tokenizeCssValue = (value?: string): string[] =>
	(value || '').trim().match(/(?:[^\s()]+(?:\([^)]*\))?)/g) || [];

export const expandShorthand = (value?: string): [string, string, string, string] => {
	const parts = tokenizeCssValue(value);
	if (!parts.length) return ['', '', '', ''];
	const [a, b = a, c = a, d = b] = parts;
	return [a, b, c, d];
};

export const collapseShorthand = (a: string, b: string, c: string, d: string): string => {
	const A = a.trim() || '0';
	const B = b.trim() || '0';
	const C = c.trim() || '0';
	const D = d.trim() || '0';
	if (!a.trim() && !b.trim() && !c.trim() && !d.trim()) return '';
	if (A === B && B === C && C === D) return A;
	if (A === C && B === D) return `${A} ${B}`;
	if (B === D) return `${A} ${B} ${C}`;
	return `${A} ${B} ${C} ${D}`;
};

export const BORDER_STYLES = ['', 'solid', 'dashed', 'dotted', 'double'];

export const parseBorder = (value?: string): { width: string; style: string; color: string } => {
	const tokens = tokenizeCssValue(value);
	let width = '';
	let style = '';
	const rest: string[] = [];
	for (const token of tokens) {
		if (!style && BORDER_STYLES.includes(token)) style = token;
		else if (!width && /^[\d.]/.test(token) && !token.includes('(')) width = token;
		else rest.push(token);
	}
	return { width, style, color: rest.join(' ') };
};

export const parseShadow = (value?: string): { x: string; y: string; blur: string; spread: string; color: string } => {
	const tokens = (value || '').trim().match(/(?:[^\s()]+(?:\([^)]*\))?)/g) || [];
	const lengths: string[] = [];
	const rest: string[] = [];
	for (const token of tokens) {
		if (/^-?[\d.]/.test(token) && lengths.length < 4) lengths.push(token);
		else rest.push(token);
	}
	const [x = '', y = '', blur = '', spread = ''] = lengths;
	return { x, y, blur, spread, color: rest.join(' ') };
};

// ——— the Custom CSS textarea: `property: value` lines ↔ the block's record ———

// Declarations separate on newlines and on TOP-LEVEL semicolons only. The
// write gate deliberately keeps `;` legal INSIDE a value ("data: URIs need
// it"), so a naive split on every `;` truncates
// `url(data:image/png;base64,…)` to `url(data:image/png` — and the textarea
// commits on blur whether or not it was edited, so merely focusing the field
// would silently corrupt the saved page. Quotes are tracked (with escapes)
// but never span a line: an unterminated one must not swallow the rest.
const splitDeclarationsInLine = (line: string): string[] => {
	const out: string[] = [];
	let current = '';
	let depth = 0;
	let quote: string | null = null;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (quote) {
			current += char;
			if (char === '\\' && index + 1 < line.length) {
				current += line[index + 1];
				index += 1;
			} else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === '(') depth += 1;
		else if (char === ')' && depth > 0) depth -= 1;
		else if (char === ';' && depth === 0) {
			out.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	out.push(current);
	return out;
};

export const splitCssDeclarations = (text: string): string[] => text.split('\n').flatMap(splitDeclarationsInLine);

export const cssRecordToLines = (css?: Record<string, string>): string =>
	Object.entries(css || {})
		.map(([key, value]) => `${key}: ${value}`)
		.join('\n');

export const cssLinesToRecord = (text: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const declaration of splitCssDeclarations(text)) {
		const split = declaration.indexOf(':');
		if (split <= 0) continue;
		const key = declaration.slice(0, split).trim().toLowerCase();
		const value = declaration.slice(split + 1).trim();
		// the write gate's own key screen, shared rather than re-spelled here
		if (key && value && WEBPAGE_CSS_KEY_PATTERN.test(key)) out[key] = value;
	}
	return out;
};
