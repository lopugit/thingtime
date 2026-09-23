// A change event may fill one authored input path. It never selects the Action.
export function componentChangeInputs(inputs: unknown, path: unknown, value: string | number | boolean): Record<string, unknown> | null {
	if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || typeof path !== 'string') return null;
	const keys = path.split('.');
	if (
		!keys.length ||
		keys.length > 4 ||
		keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))
	)
		return null;
	const result = { ...inputs } as Record<string, unknown>;
	let target = result;
	for (const key of keys.slice(0, -1)) {
		const previous = target[key];
		if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) return null;
		target[key] = { ...((previous as Record<string, unknown>) || {}) };
		target = target[key] as Record<string, unknown>;
	}
	target[keys[keys.length - 1]] = value;
	return result;
}
