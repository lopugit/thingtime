export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonBudget = { maxBytes: number; maxDepth: number; maxNodes: number; sortKeys?: boolean };

/** Copy inert JSON without invoking getters/toJSON or losing non-JSON values.
 * Object.fromEntries defines own properties, including a literal __proto__ key.
 * Budgets apply before serialization as well as to the final UTF-8 bytes. */
export function copyBoundedJson(value: unknown, budget: JsonBudget, label = 'JSON'): JsonValue {
	let nodes = 0;
	let characters = 0;
	const ancestors = new WeakSet<object>();
	const countText = (value: string) => {
		characters += value.length;
		if (characters > budget.maxBytes) throw new Error(`${label} exceeds its byte budget`);
	};
	const visit = (entry: unknown, depth: number): JsonValue => {
		if (++nodes > budget.maxNodes || depth > budget.maxDepth) throw new Error(`${label} exceeds its structural budget`);
		if (typeof entry === 'string') { countText(entry); return entry; }
		if (entry === null) return null;
		if (typeof entry === 'boolean') return entry;
		if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
		if (!entry || typeof entry !== 'object') throw new Error(`${label} must contain only JSON values`);
		if (ancestors.has(entry)) throw new Error(`${label} cannot contain cycles`);
		ancestors.add(entry);
		const array = Array.isArray(entry);
		if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) throw new Error(`${label} must contain plain objects`);
		const descriptors = Object.getOwnPropertyDescriptors(entry);
		let entries = Object.entries(descriptors).filter(([key]) => !(array && key === 'length'));
		if (Object.getOwnPropertySymbols(entry).length || entries.some(([, descriptor]) => !descriptor.enumerable || !('value' in descriptor)))
			throw new Error(`${label} cannot contain accessors or hidden properties`);
		let copy: JsonValue;
		if (array) {
			if (entry.length !== entries.length || entries.some(([key], index) => key !== String(index))) throw new Error(`${label} arrays must be dense`);
			copy = entries.map(([, descriptor]) => visit(descriptor.value, depth + 1));
		} else {
			if (budget.sortKeys) entries = entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
			copy = Object.fromEntries(entries.map(([key, descriptor]) => { countText(key); return [key, visit(descriptor.value, depth + 1)]; }));
		}
		ancestors.delete(entry);
		return copy;
	};
	const copy = visit(value, 0);
	if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > budget.maxBytes) throw new Error(`${label} exceeds its byte budget`);
	return copy;
}
