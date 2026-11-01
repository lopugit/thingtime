import { copyBoundedJson } from '../utils/boundedJson.ts';

/** JSON Action inputs remain data, including strings resembling Action refs.
 * These structural limits supplement the Action's existing total byte budget. */
export const MAX_ACTION_JSON_BYTES = 64 * 1024;
export const MAX_ACTION_JSON_DEPTH = 64;
export const MAX_ACTION_JSON_NODES = 4000;

export function copyActionJson(value: unknown): unknown {
	return copyBoundedJson(value, { maxBytes: MAX_ACTION_JSON_BYTES, maxDepth: MAX_ACTION_JSON_DEPTH, maxNodes: MAX_ACTION_JSON_NODES }, 'JSON input');
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
