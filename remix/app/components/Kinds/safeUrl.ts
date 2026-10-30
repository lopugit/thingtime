const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_BASE = 'https://thingtime.invalid/';

export const isSafeUrl = (value: string): boolean => {
	const source = String(value).trim();
	if (!source) return false;

	try {
		return SAFE_PROTOCOLS.has(new URL(source, SAFE_BASE).protocol);
	} catch {
		return false;
	}
};

// href/src value, or undefined when the URL isn't a safe protocol — blocks
// javascript:/data: and other injection schemes from reaching a link or media
// element sourced from untrusted (other users') data.
export const safeUrl = (value: unknown): string | undefined =>
	typeof value === 'string' && isSafeUrl(value) ? value : undefined;

// Does an already-protocol-screened url leave this site? Decided on the
// RESOLVED url rather than a scheme prefix, because the URL parser folds `\`
// into `/` for http(s): `/\evil.example` reads as site-relative but resolves to
// another origin, so a prefix test would call it internal and navigate the
// viewer's own tab off-site with the opener attached. Relative urls keep the
// sentinel origin and stay internal; mailto:/tel: hand off to another app
// rather than navigating, so they are not "external" for link-target purposes.
export const isExternalHref = (value: unknown): boolean => {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value.trim(), SAFE_BASE);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
		return url.origin !== new URL(SAFE_BASE).origin;
	} catch {
		return false;
	}
};

// Shared untrusted-content screening for BOTH thing renderers (Chakra + HTML),
// so a new CSS-escape vector or handler-prop bypass is patched in ONE place
// instead of drifting between two copied deny-lists.

// Block CSS escape hatches anywhere a string value lands (backgroundImage can
// carry url(…), sx/style carry whole blocks): javascript: URLs, expression(),
// and @import. Returns true when the value is free of all three.
export const isSafeCssText = (value: unknown): boolean => {
	const text = String(value).toLowerCase();
	return !text.includes('javascript:') && !text.includes('expression(') && !text.includes('@import');
};

// Event-handler prop screen (onClick, onError, …) — untrusted data must never
// wire up a React/DOM handler.
export const isEventHandlerProp = (key: string): boolean => /^on/i.test(key);

// External links must drop the opener (reverse-tabnabbing): mutates the given
// already-sanitized props object in place for any non-self target. Browsers
// match target names case-insensitively ("_BLANK" still opens a new window),
// and any NAMED target window also receives an opener, so everything except
// the same-tab targets gets the rel.
export const applyNoOpener = (props: Record<string, unknown>): void => {
	if (typeof props.target !== 'string') return;
	const target = props.target.toLowerCase();
	if (target === '_self' || target === '_top' || target === '_parent' || target === '') return;
	props.rel = 'noopener noreferrer';
};

// CSS `url("…")` value for backgroundImage, or undefined. Scheme-checked like
// safeUrl, then every character that could terminate or escape the url("…")
// string token — C0 control chars and whitespace (a raw newline ends a CSS
// string), quotes, backslash, angle brackets, and parens — is stripped or
// percent-encoded, so the result can only ever be a single url() token and can
// never inject a further CSS rule or HTML. (The URL parser in isSafeUrl strips
// \n/\r/\t before the scheme check, so those must be removed here explicitly.)
export const safeCssUrl = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || !isSafeUrl(value)) return undefined;
	const cleaned = value
		.replace(/[\u0000-\u001F\u007F\u2028\u2029"'\\<>]/g, '')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29');
	return `url("${cleaned}")`;
};
