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
