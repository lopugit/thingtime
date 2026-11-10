type SourceInputArgument = { ttArg: string; fallback?: string };

export type SourceInputValue = string | number | boolean | SourceInputArgument;

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000 &&
	value.split('.').every(segment => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment) && !forbidden.has(segment));

/** Saved source inputs may read a scalar from the existing template scope. */
export function parseSourceInputArgument(value: unknown): SourceInputArgument | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, 'ttArg')) return null;
	const fields = value as Record<string, unknown>;
	if (Object.keys(fields).some(key => key !== 'ttArg' && key !== 'fallback') || !isPath(fields.ttArg)) return null;
	if (!Object.prototype.hasOwnProperty.call(fields, 'fallback')) return { ttArg: fields.ttArg };
	return isPath(fields.fallback) ? { ttArg: fields.ttArg, fallback: fields.fallback } : null;
}
