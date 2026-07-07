// Shared helpers for moving thing values through JSON text (e.g. the context
// menu's clipboard paste).

// strip prototype-polluting keys from parsed JSON before it enters the
// thingtime tree
export const sanitizeParsedJson = (value: unknown): unknown => {
	if (!value || typeof value !== 'object') {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(sanitizeParsedJson);
	}

	const out: Record<string, unknown> = {};
	Object.keys(value as Record<string, unknown>).forEach((key) => {
		if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
			return;
		}
		out[key] = sanitizeParsedJson((value as Record<string, unknown>)[key]);
	});

	return out;
};
