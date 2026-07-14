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
// safeUrl, then every character that could terminate or escape the url("…")
// string token — C0 control chars and whitespace (a raw newline ends a CSS
// string), quotes, backslash, angle brackets, and parens — is stripped or
// percent-encoded, so the result can only ever be a single url() token and can
// never inject a further CSS rule or HTML. (The URL parser in isSafeUrl strips
// \n/\r/\t before the scheme check, so those must be removed here explicitly.)
export const safeCssUrl = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || !isSafeUrl(value)) return undefined;
	const cleaned = value
		.replace(/[\u0000-\u0020"'\\<>]/g, '')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29');
	return `url("${cleaned}")`;
};
