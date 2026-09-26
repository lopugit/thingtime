/** JSON Action inputs remain data, including strings resembling Action refs.
 * These structural limits supplement the Action's existing total byte budget. */
export const MAX_ACTION_JSON_BYTES = 64 * 1024;
export const MAX_ACTION_JSON_DEPTH = 64;
export const MAX_ACTION_JSON_NODES = 4000;

export function copyActionJson(value: unknown): unknown {
	let nodes = 0;
	const seen = new WeakSet<object>();
	const visit = (entry: unknown, depth: number): unknown => {
		if (++nodes > MAX_ACTION_JSON_NODES || depth > MAX_ACTION_JSON_DEPTH) throw new Error('JSON input exceeds its structural budget');
		if (entry === null || typeof entry === 'boolean' || typeof entry === 'string') return entry;
		if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
		if (!entry || typeof entry !== 'object') throw new Error('JSON input must contain only JSON values');
		if (seen.has(entry)) throw new Error('JSON input cannot contain cycles');
		seen.add(entry);
		const array = Array.isArray(entry);
		if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new Error('JSON input must contain plain objects');
		const descriptors = Object.getOwnPropertyDescriptors(entry);
		const entries = Object.entries(descriptors).filter(([key]) => !(array && key === 'length'));
		if (Object.getOwnPropertySymbols(entry).length || entries.some(([, descriptor]) => !descriptor.enumerable || !('value' in descriptor)))
			throw new Error('JSON input cannot contain accessors or hidden properties');
		let copy: unknown;
		if (array) {
			if (entry.length !== entries.length || entries.some(([key], index) => key !== String(index))) throw new Error('JSON input arrays must be dense');
			copy = entries.map(([, descriptor]) => visit(descriptor.value, depth + 1));
		} else copy = Object.fromEntries(entries.map(([key, descriptor]) => [key, visit(descriptor.value, depth + 1)]));
		seen.delete(entry);
		return copy;
	};
	const copy = visit(value, 0);
	if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > MAX_ACTION_JSON_BYTES) throw new Error('JSON input exceeds 64 KB');
	return copy;
}

/** Decode JSON text at the form boundary only. APIs and composed Actions carry
 * actual JSON values, so a literal string is never parsed a second time. */
export function parseActionJson(value: unknown): unknown {
	if (typeof value !== 'string') return copyActionJson(value);
	if (value.length > MAX_ACTION_JSON_BYTES) throw new Error('JSON input exceeds 64 KB');
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('Enter valid JSON');
	}
	return copyActionJson(parsed);
}
