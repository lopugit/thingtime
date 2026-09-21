// Local controls use the same declarative binding as server Actions, but can
// only change bounded scalar presentation state in this component instance.
// They cannot overwrite the page runtime, resolve a path, or execute code.
export const LOCAL_UI_ACTION = '$ui';
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'result', 'last', 'viewer', 'query', 'state', 'error', 'installing', 'hasSource']);
const scalar = (value: unknown): value is string | number | boolean =>
	typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 2000);
export const reduceLocalUi = (
	current: Record<string, unknown>,
	defaults: Record<string, unknown>,
	input: Record<string, unknown>
): Record<string, unknown> => {
	if (input.op === 'reset') return {};
	const key = typeof input.key === 'string' ? input.key : '';
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) || RESERVED.has(key)) return current;
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
	return scalar(value) ? { ...current, [key]: value } : current;
};
