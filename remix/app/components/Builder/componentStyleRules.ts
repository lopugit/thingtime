export type ComponentStyleRule = { selector: string; declarations: Record<string, string>; maxWidth?: number };

// Each selector is prefixed independently. Authored styles cannot select the
// surrounding app, insert an at-rule, load resources, or escape a declaration.
export function componentStyleRules(value: unknown, scope: string): string {
	if (!Array.isArray(value) || value.length > 220 || !/^[a-zA-Z0-9_-]+$/.test(scope)) return '';
	return value
		.map((rule) => {
			if (!rule || typeof rule !== 'object' || typeof rule.selector !== 'string' || rule.selector.length > 800) return '';
			const selectors = rule.selector.split(',').map((part: string) => part.trim());
			if (selectors.some((selector: string) => !selector || /[^a-zA-Z0-9_.#\s>*:+\-[\]="'()]/.test(selector) || /:has\s*\(/i.test(selector)))
				return '';
			const declarations = rule.declarations;
			if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations) || Object.keys(declarations).length > 40) return '';
			const body = Object.entries(declarations)
				.flatMap(([key, value]) => {
					if (!/^(--)?[a-z][a-z0-9-]{0,60}$/.test(key) || typeof value !== 'string' || value.length > 300) return [];
					if (/[{};@\\<>]/.test(value) || /url\s*\(|expression\s*\(|javascript:|image-set\s*\(/i.test(value)) return [];
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
