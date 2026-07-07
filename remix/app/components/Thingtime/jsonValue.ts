// Shared helpers for moving thing values through JSON text — used by the
// context menu's paste command and the editor's raw {} content mode.

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

// pretty-print any thing value; undefined/functions/circulars degrade to a
// readable placeholder instead of throwing
export const stringifyThingValue = (value: unknown): string => {
	if (value === undefined) {
		return '';
	}

	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
};

// parse JSON text into a safe thing value; returns an error message instead
// of throwing so editors can surface it
export const parseThingValueJson = (text: string): { ok: true; value: unknown } | { ok: false; error: string } => {
	const trimmed = text.trim();

	if (!trimmed) {
		return { ok: true, value: undefined };
	}

	try {
		return { ok: true, value: sanitizeParsedJson(JSON.parse(trimmed)) };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
	}
};
