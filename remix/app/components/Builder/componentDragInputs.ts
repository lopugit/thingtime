export type ComponentDragData = { group: string; inputs: Record<string, string | number | boolean> };

// Drag data is supplied by a live Component in this page, never parsed from
// operating-system or cross-tab DataTransfer text. It carries data, not authority.
export function componentDragData(group: unknown, inputs: unknown): ComponentDragData | null {
	if (typeof group !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(group) || !inputs || typeof inputs !== 'object' || Array.isArray(inputs))
		return null;
	const entries = Object.entries(inputs);
	if (
		entries.length > 16 ||
		entries.some(
			([key, value]) =>
				!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key) ||
				['__proto__', 'constructor', 'prototype'].includes(key) ||
				!(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 2000))
		)
	)
		return null;
	return { group, inputs: Object.fromEntries(entries) };
}

export function componentDropInputs(
	drag: ComponentDragData | null,
	group: unknown,
	allowed: unknown,
	target: unknown
): Record<string, unknown> | null {
	if (
		!drag ||
		drag.group !== group ||
		!Array.isArray(allowed) ||
		allowed.length > 16 ||
		allowed.some((key) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(drag.inputs, key))
	)
		return null;
	if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
	const result = { ...target, ...Object.fromEntries(allowed.map((key) => [key, drag.inputs[key]])) };
	return Object.keys(result).length <= 32 ? result : null;
}
