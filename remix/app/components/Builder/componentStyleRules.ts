export type ComponentStyleRule = { selector: string; declarations: Record<string, string>; maxWidth?: number };

// Only a comma outside `()` and `[]` separates the selector list, so the comma
// in `:is(.a, .b)` stays with its own compound instead of being prefixed twice.
// An unbalanced delimiter is rejected rather than emitted: the CSS parser
// consumes `(` and `[` as blocks, so `.a(` would swallow this rule's body and
// every later rule in the same instance stylesheet the way `/*` would.
function topLevelSelectors(selector: string): string[] | null {
	const closers: string[] = [];
	const parts: string[] = [];
	let start = 0;
	for (let index = 0; index < selector.length; index++) {
		const char = selector[index];
		if (char === '(' || char === '[') closers.push(char === '(' ? ')' : ']');
		else if (char === ')' || char === ']') {
			if (closers.pop() !== char) return null;
		} else if (char === ',' && !closers.length) {
			parts.push(selector.slice(start, index).trim());
			start = index + 1;
		}
	}
	return closers.length ? null : [...parts, selector.slice(start).trim()];
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
