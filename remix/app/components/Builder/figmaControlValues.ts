// Pure value parsing/serialising for the Figma-style inspector controls —
// kept DOM-free so node unit tests cover the shorthand math directly.

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
