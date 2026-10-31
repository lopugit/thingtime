export type ComponentStyleRule = { selector: string; declarations: Record<string, string>; maxWidth?: number };

// A CSS string ends at a newline whether or not its closing quote ever arrives,
// so `[title="a` and `[title="a<newline>b"]` are both broken the same way even
// though only the first looks unterminated. Either one leaves the enclosing
// block open, which swallows this rule's body and every later rule in the same
// instance stylesheet the way `/*` would, so both are rejected rather than
// emitted. No escape handling is needed because `\` is rejected for selectors by
// the character class below and for declaration values by their own check.
function closesEveryString(text: string): boolean {
	let quote = '';
	for (const char of text) {
		if (!quote) {
			if (char === '"' || char === "'") quote = char;
		} else if (char === '\n' || char === '\r' || char === '\f') return false;
		else if (char === quote) quote = '';
	}
	return !quote;
}

// The CSS parser consumes `(` and `[` as blocks that end at their matching
// closer or the end of the stylesheet, never at `}`, so an unbalanced delimiter
// swallows the rest of the rule and every later rule in the same instance
// stylesheet the way `/*` would — `.a(` as a selector and `rgb(0,0,0` as a
// declaration value both do it. A delimiter inside a terminated string is only
// data, so the scan tracks quotes to keep `[title="]"]` and `content:"("` legal;
// that is only sound once every string is known to close, so callers check
// `closesEveryString` first.
function balancesEveryBlock(text: string): boolean {
	const closers: string[] = [];
	let quote = '';
	for (const char of text) {
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'") quote = char;
		else if (char === '(' || char === '[') closers.push(char === '(' ? ')' : ']');
		else if ((char === ')' || char === ']') && closers.pop() !== char) return false;
	}
	return !closers.length;
}

// Only a comma outside `()`, `[]` and a quoted string separates the selector
// list, so the comma in `:is(.a, .b)` or `[title="a,b"]` stays with its own
// compound instead of being prefixed twice. Balance and string termination are
// verified up front, so the split only has to track nesting depth.
function topLevelSelectors(selector: string): string[] | null {
	if (!closesEveryString(selector) || !balancesEveryBlock(selector)) return null;
	const parts: string[] = [];
	let depth = 0;
	let quote = '';
	let start = 0;
	for (let index = 0; index < selector.length; index++) {
		const char = selector[index];
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'") quote = char;
		else if (char === '(' || char === '[') depth++;
		else if (char === ')' || char === ']') depth--;
		else if (char === ',' && !depth) {
			parts.push(selector.slice(start, index).trim());
			start = index + 1;
		}
	}
	return [...parts, selector.slice(start).trim()];
}

// Each selector is prefixed independently. Authored styles cannot select the
// surrounding app, insert an at-rule, load resources, or escape a declaration.
export function componentStyleRules(value: unknown, scope: string): string {
	if (!Array.isArray(value) || value.length > 220 || !/^[a-zA-Z0-9_-]+$/.test(scope)) return '';
	return value
		.map((rule) => {
			if (!rule || typeof rule !== 'object' || typeof rule.selector !== 'string' || rule.selector.length > 800) return '';
			const selectors = topLevelSelectors(rule.selector);
			// A leading sibling combinator would bind to the instance wrapper itself
			// rather than its subtree, so `+ .chrome` would style the app element
			// next to this instance. `>` stays legal because it still selects a
			// child of the wrapper. `~` is already outside the character class. A
			// surviving `,` can only sit inside `()` or `[]`, where it cannot begin
			// an unprefixed selector.
			if (
				!selectors ||
				selectors.some(
					(selector: string) =>
						!selector || /^\+/.test(selector) || /[^a-zA-Z0-9_.#\s>*:+,\-[\]="'()]/.test(selector) || /:has\s*\(/i.test(selector)
				)
			)
				return '';
			const declarations = rule.declarations;
			if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations) || Object.keys(declarations).length > 40) return '';
			const body = Object.entries(declarations)
				.flatMap(([key, value]) => {
					if (!/^(--)?[a-z][a-z0-9-]{0,60}$/.test(key) || typeof value !== 'string' || value.length > 300) return [];
					if (/[{};@\\<>]/.test(value) || /url\s*\(|expression\s*\(|javascript:|image-set\s*\(/i.test(value)) return [];
					// `/` stays legal for `font`, `grid-area` and `aspect-ratio`, but a
					// comment delimiter would run past this declaration and silently
					// swallow every later rule in the same instance stylesheet.
					if (/\/\*|\*\//.test(value)) return [];
					// A quoted value stays legal for `content` and `font-family`, but a
					// string left open by a missing quote or an embedded newline runs past
					// this declaration and consumes the closing `}`, which swallows every
					// later rule in the same instance stylesheet exactly like `/*`. An
					// unbalanced `(` or `[` consumes that `}` the same way, so `rgb(0,0,0`
					// is rejected while the balanced `rgb(0,0,0)` a value needs stays legal.
					if (!closesEveryString(value) || !balancesEveryBlock(value)) return [];
					// Match the renderer's containment boundary. Untrusted CSS cannot
					// place a viewport overlay over the surrounding Thingtime controls.
					if (key === 'position' && !/^(static|relative)(\s*!important)?$/i.test(value.trim())) return [];
					if (['z-index', 'behavior', '-moz-binding'].includes(key)) return [];
					return [`${key}:${value}`];
				})
				.join(';');
			if (!body) return '';
			// A namespace establishes containment, not extra specificity. Nested
			// authored rules follow ordinary CSS specificity and source order.
			const css = `${selectors.map((selector: string) => `:where([data-tt-style="${scope}"]) ${selector}`).join(',')}{${body}}`;
			return rule.maxWidth === undefined
				? css
				: Number.isInteger(rule.maxWidth) && rule.maxWidth >= 200 && rule.maxWidth <= 4000
				? `@media(max-width:${rule.maxWidth}px){${css}}`
				: '';
		})
		.join('\n');
}
