// Ordinary declaration names are ASCII case-insensitive; authored keys use
// lowercase kebab-case. Custom property names are Unicode and case-sensitive.
// Accept literal identifier characters, as CSSOM/React keys do not parse CSS
// source escapes as identifier spelling.
export const CSS_PROPERTY_NAME_PATTERN = /^(?:-?[a-z][a-z0-9-]*|--[a-z0-9_\u0080-\uD7FF\uE000-\u{10FFFF}-]+)$/iu;
export const isCssPropertyName = (name: string): boolean => CSS_PROPERTY_NAME_PATTERN.test(name);
export const normalizeCssPropertyName = (name: string): string => {
 const trimmed = name.trim();
 return trimmed.startsWith('--') ? trimmed : trimmed.toLowerCase();
};

export const EXPANDED_WEBPAGE_AUTHORING_REQUIREMENTS = { 'api.things': '1.60.0', 'api.things-update': '1.25.0', 'api.webpages-resolve': '1.17.0' } as const;

/** Only block content that an older deployed writer rejected needs to gate. */
export function usesExpandedWebpageAuthoring(blocks: unknown): boolean {
 const pending = Array.isArray(blocks) ? [...blocks] : [];
 const seen = new WeakSet<object>();
 while (pending.length) {
  const block = pending.pop();
  if (!block || typeof block !== 'object' || seen.has(block)) continue;
  seen.add(block);
  if (Array.isArray(block.children)) for (const child of block.children) pending.push(child);
  if ((block.type === 'html' || block.type === 'text') && typeof block.html === 'string' && block.html.length > 20_000) return true;
  if (!block.css || typeof block.css !== 'object') continue;
  const declarations = Object.entries(block.css);
  if (declarations.length > 40 || declarations.some(([key, value]) =>
   key.length > 48 || !/^(--)?[a-z][a-z0-9-]*$/.test(key) || (typeof value === 'string' && value.length > 240)
  )) return true;
 }
 return false;
}

// One css declaration value: no nested rules/markup, no expression()/@import,
// no javascript: url — url() only with https/site-relative/data-image targets.
export const isSafeWebpageCssValue = (value: string): boolean => {
	// no markup/nested-rule characters; `;` stays legal (data: URIs need it, and
	// values are applied per-property through CSSOM, where a semicolon
	// can never open a second declaration)
	if (/[<>{}]/.test(value)) return false;
	const lower = value.toLowerCase();
	if (lower.includes('expression(') || lower.includes('@import') || lower.includes('javascript:')) return false;
	const urlMatches = lower.matchAll(/url\(\s*['"]?([^'")]*)/g);
	for (const match of urlMatches) {
		const target = (match[1] || '').trim();
		if (!/^(https:\/\/|\/(?![/\\])|data:image\/)/.test(target)) return false;
	}
	return true;
};
