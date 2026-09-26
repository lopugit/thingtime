// Local controls use the same declarative binding as server Actions, but can
// only change bounded scalar presentation state in this component instance.
// They cannot overwrite the page runtime, resolve a path, or execute code.
export const LOCAL_UI_ACTION = '$ui';
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'result', 'last', 'viewer', 'query', 'state', 'error', 'installing', 'installAvailable', 'hasSource', 'pending', 'pendingAction']);
const scalar = (value: unknown): value is string | number | boolean =>
	typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 2000);
const validKey = (key: string) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) && !RESERVED.has(key);
export const reduceLocalUi = (
	current: Record<string, unknown>,
	defaults: Record<string, unknown>,
	input: Record<string, unknown>
): Record<string, unknown> => {
	if (input.op === 'reset') return {};
	if (input.op === 'patch') {
		if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) return current;
		const entries = Object.entries(input.values);
		if (!entries.length || entries.length > 32 || entries.some(([key, value]) => !validKey(key) || !scalar(value))) return current;
		const next = { ...current, ...input.values };
		return Object.keys(next).length <= 32 ? next : current;
	}
	const key = typeof input.key === 'string' ? input.key : '';
	if (!validKey(key)) return current;
	if (!Object.prototype.hasOwnProperty.call(current, key) && Object.keys(current).length >= 32) return current;
	const previous = Object.prototype.hasOwnProperty.call(current, key)
		? current[key]
		: Object.prototype.hasOwnProperty.call(defaults, key)
		? defaults[key]
		: undefined;
	let value: unknown;
	if (input.op === 'set') value = input.value;
	else if (input.op === 'toggle') value = !(previous === true || previous === 'true');
	else if (input.op === 'increment') {
		const step = Number(input.step ?? 1);
		if (!Number.isFinite(step)) return current;
		value = Math.max(
			Number.isFinite(Number(input.min)) ? Number(input.min) : -1e6,
			Math.min(Number.isFinite(Number(input.max)) ? Number(input.max) : 1e6, (Number(previous) || 0) + step)
		);
	} else if (input.op === 'cycle' && Array.isArray(input.values) && input.values.length <= 32 && input.values.every(scalar)) {
		value = input.values[(input.values.findIndex((entry) => String(entry) === String(previous)) + 1) % input.values.length];
	} else return current;
	if (!scalar(value)) return current;
	const clears = input.clear === undefined ? [] : input.clear;
	if (!Array.isArray(clears) || clears.length > 32 || clears.some((entry) => typeof entry !== 'string' || !validKey(entry) || entry === key))
		return current;
	const next = { ...current, ...Object.fromEntries(clears.map((entry) => [entry, ''])), [key]: value };
	return Object.keys(next).length <= 32 ? next : current;
};

// Explicit user navigation only. Parameters are encoded, never concatenated
// into executable URLs, and navigation remains on the current Builder page.
export function localQueryHref(pageId: string | null, params: unknown): string | null {
	if (!pageId || !/^[A-Za-z0-9_-]{1,160}$/.test(pageId) || !params || typeof params !== 'object' || Array.isArray(params)) return null;
	const values = Object.entries(params);
	if (values.length > 32) return null;
	const query = new URLSearchParams();
	for (const [key, value] of values) {
		if (!/^[A-Za-z_][A-Za-z0-9_-]{0,39}$/.test(key) || ['key', 'mode', '__proto__', 'constructor', 'prototype'].includes(key) || !scalar(value))
			return null;
		if (String(value).length > 200) return null;
		query.set(key, String(value));
	}
	return `/p/${encodeURIComponent(pageId)}?${query.toString()}`;
}

// Form navigation is opt-in and only collects explicitly declared parameter
// names. The caller uses gatherFormFields, which excludes credentials/files.
// Empty text wins; untouched or excluded fields preserve authored defaults.
export function localQueryFormInput(input: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
	if (input.op !== 'query' || input.form !== true || !input.params || typeof input.params !== 'object' || Array.isArray(input.params)) return input;
	return { ...input, params: Object.fromEntries(Object.entries(input.params).map(([key, value]) => [key,
		Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : value
	])) };
}
