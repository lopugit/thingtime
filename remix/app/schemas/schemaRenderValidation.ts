export const MAX_SCHEMA_RENDER_BYTES = 48 * 1024;
export const MAX_SCHEMA_RENDER_DEPTH = 48;
export const MAX_SCHEMA_RENDER_NODES = 2000;

export type SchemaRenderValidation =
	| { ok: true; render: Record<string, unknown> }
	| { ok: false; error: string };

export type SchemaRenderTreeValidation = true | { ok: false; error: string };

const SCHEMA_RENDER_BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const checkSchemaRenderTree = (
	value: unknown,
	depth: number,
	counter: { nodes: number }
): SchemaRenderTreeValidation => {
	counter.nodes++;
	if (counter.nodes > MAX_SCHEMA_RENDER_NODES) {
		return { ok: false, error: `render can hold at most ${MAX_SCHEMA_RENDER_NODES} nodes` };
	}
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
	if (depth >= MAX_SCHEMA_RENDER_DEPTH) {
		return { ok: false, error: `render nests at most ${MAX_SCHEMA_RENDER_DEPTH} levels` };
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			const checked = checkSchemaRenderTree(entry, depth + 1, counter);
			if (checked !== true) return checked;
		}
		return true;
	}
	if (typeof value === 'object') {
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (key.includes('\u0000') || key.includes('.') || key.startsWith('$') || SCHEMA_RENDER_BLOCKED_KEYS.has(key)) {
				return {
					ok: false,
					error: `render keys can’t contain dots or null bytes, start with $, or shadow object internals (${key.slice(0, 40)})`
				};
			}
			const checked = checkSchemaRenderTree(entry, depth + 1, counter);
			if (checked !== true) return checked;
		}
		return true;
	}
	return { ok: false, error: 'render must be JSON-serializable (objects, arrays, strings, numbers, booleans)' };
};

export const validateSchemaRender = (input: unknown): SchemaRenderValidation => {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return { ok: false, error: 'render must be a serialised component object' };
	}
	const root = input as Record<string, unknown>;
	const chakraShaped = typeof root.chakra === 'string' || root.type === 'chakra';
	const elementShaped = typeof root.tag === 'string';
	if (!chakraShaped && !elementShaped) {
		return {
			ok: false,
			error: 'render must be chakra shaped ({ chakra: "Box", … }) or element shaped ({ tag: "div", … })'
		};
	}
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(input);
	} catch {
		return { ok: false, error: 'render must be JSON-serializable' };
	}
	if (typeof serialized !== 'string') return { ok: false, error: 'render must be JSON-serializable' };
	if (serialized.length > MAX_SCHEMA_RENDER_BYTES) {
		return { ok: false, error: `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit` };
	}
	if (serialized.length * 3 > MAX_SCHEMA_RENDER_BYTES) {
		const bytes = new TextEncoder().encode(serialized).byteLength;
		if (bytes > MAX_SCHEMA_RENDER_BYTES) {
			return { ok: false, error: `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit` };
		}
	}
	const checked = checkSchemaRenderTree(input, 0, { nodes: 0 });
	if (checked !== true) return checked;
	return { ok: true, render: root };
};
