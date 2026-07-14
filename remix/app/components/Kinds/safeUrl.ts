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

// CSS `url("…")` value for backgroundImage, or undefined. Scheme-checked like
// safeUrl, then the quote/backslash/paren chars that could break out of the
// url("…") context are stripped/encoded so the value can only ever be a URL.
export const safeCssUrl = (value: unknown): string | undefined =>
	typeof value === 'string' && isSafeUrl(value)
		? `url("${value.replace(/["\\]/g, '').replace(/\)/g, '%29')}")`
		: undefined;
