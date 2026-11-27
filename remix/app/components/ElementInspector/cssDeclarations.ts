import { isCssPropertyName, normalizeCssPropertyName } from '~/schemas/cssDeclarationNames';

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
		const key = normalizeCssPropertyName(declaration.slice(0, split));
		const value = declaration.slice(split + 1).trim();
		// the write gate's own key screen, shared rather than re-spelled here
		if (key && value && isCssPropertyName(key)) out[key] = value;
	}
	return out;
};

/** The priority is a CSSOM argument, not part of the CSS value passed to it. */
export function splitCssPriority(source: string): { value: string; priority: '' | 'important' } {
 const text = source.trim();
 // A quoted "!important" isn't a declaration priority; an actual priority
 // marker occurs after the value, at the end of the declaration.
 const suffix = /\s*!\s*important$/i.exec(text);
 return suffix ? { value: text.slice(0, suffix.index).trimEnd(), priority: 'important' } : { value: text, priority: '' };
}

/** CSSOM parses a declaration name; never assign untrusted names to DOM members. */
export function applyInlineCssDeclarations(element: HTMLElement, declarations: Record<string, string>, mapValue?: (value: string) => string): () => void {
 const style = element.style;
 const previous = new Map<string, [string, string]>();
 for (const [name, source] of Object.entries(declarations)) {
  if (!isCssPropertyName(name) || typeof source !== 'string') continue;
  const { value, priority } = splitCssPriority(source);
  if (!value) continue;
  previous.set(name, [style.getPropertyValue(name), style.getPropertyPriority(name)]);
  style.setProperty(name, mapValue?.(value) ?? value, priority);
 }
 const applied = new Map([...previous.keys()].map(name => [name, [style.getPropertyValue(name), style.getPropertyPriority(name)]] as const));
 return () => {
  // Restore in reverse to keep ordered shorthand/longhand overrides coherent.
  const retained = [...previous.keys()].filter(name =>
   style.getPropertyValue(name) === applied.get(name)?.[0] && style.getPropertyPriority(name) === applied.get(name)?.[1]);
  for (const name of retained.reverse()) {
   const [value, priority] = previous.get(name)!;
   if (value) style.setProperty(name, value, priority);
   else style.removeProperty(name);
  }
 };
}
