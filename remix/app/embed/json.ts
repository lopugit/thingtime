export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_BYTES = 256 * 1024;

export const parseThingPath = (input?: string | Array<string | number>): string[] => {
	if (input === undefined || input === null || input === '' || input === '.') return [];

	const parts = Array.isArray(input)
		? input.map(String)
		: String(input)
				.replace(/\[([0-9]+)\]/g, '.$1')
				.split('.')
				.filter(Boolean);

	for (const part of parts) {
		if (FORBIDDEN_PATH_PARTS.has(part)) throw new Error(`Unsafe Thingtime path: ${part}`);
	}
	return parts;
};

export const sanitizeJson = (input: unknown): JsonValue => {
	let nodes = 0;

	const visit = (value: unknown, depth: number): JsonValue => {
		nodes += 1;
		if (nodes > MAX_NODES) throw new Error('Thing has too many values');
		if (depth > MAX_DEPTH) throw new Error('Thing is nested too deeply');

		if (value === null) return null;
		if (typeof value === 'boolean' || typeof value === 'string') return value;
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) throw new Error('Thing numbers must be finite');
			return value;
		}
		if (Array.isArray(value)) return value.map((entry) => visit(entry, depth + 1));
		if (!value || typeof value !== 'object') throw new Error('Thing values must be JSON data');

		const output: Record<string, JsonValue> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (!key || key.startsWith('$') || key.includes('.') || FORBIDDEN_PATH_PARTS.has(key)) {
				throw new Error(`Unsafe Thingtime key: ${key || '(empty)'}`);
			}
			output[key] = visit(entry, depth + 1);
		}
		return output;
	};

	const value = visit(input, 0);
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_BYTES) {
		throw new Error(`Thing data is too large (max ${MAX_BYTES} bytes)`);
	}
	return value;
};

export const getJsonPath = (root: JsonValue, input?: string | Array<string | number>): JsonValue | undefined => {
	const parts = parseThingPath(input);
	let value: any = root;
	for (const part of parts) {
		if (value === null || typeof value !== 'object') return undefined;
		value = value[part];
	}
	return value as JsonValue | undefined;
};

export const setJsonPath = (root: JsonValue, input: string | Array<string | number> | undefined, nextInput: unknown): JsonValue => {
	const parts = parseThingPath(input);
	const nextValue = sanitizeJson(nextInput);
	if (!parts.length) return nextValue;

	const setAt = (current: JsonValue | undefined, index: number): JsonValue => {
		const part = parts[index];
		const isLast = index === parts.length - 1;
		const currentIsArray = Array.isArray(current);
		const output: any = currentIsArray
			? [...(current as JsonValue[])]
			: current && typeof current === 'object'
			? { ...(current as Record<string, JsonValue>) }
			: /^[0-9]+$/.test(part)
			? []
			: {};

		output[part] = isLast ? nextValue : setAt(output[part], index + 1);
		return output;
	};

	return sanitizeJson(setAt(root, 0));
};

export const cloneJson = (value: JsonValue) => sanitizeJson(value);

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong');
