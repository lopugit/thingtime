import { JSONParser } from '@streamparser/json';

// Working sizes, never limits on the document, container, key or scalar.
export const CANONICAL_JSON_CHUNK_BYTES = 64 * 1024;
const STRING_CHARS = 8 * 1024;
type Frame = { value: any; keys: string[] | null; index: number };
const indexKey = (key: string) => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 4294967295;
// JSON.stringify enumerates integer properties before other sorted keys.
const compareKeys = (a: string, b: string) => indexKey(a) && indexKey(b) ? Number(a) - Number(b)
	: indexKey(a) ? -1 : indexKey(b) ? 1 : a < b ? -1 : a > b ? 1 : 0;
function* stringParts(value: string): Generator<string> {
	yield '"';
	for (let start = 0; start < value.length;) {
		let end = Math.min(value.length, start + STRING_CHARS);
		const last = value.charCodeAt(end - 1);
		if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
		yield JSON.stringify(value.slice(start, end)).slice(1, -1);
		start = end;
	}
	yield '"';
}
/** Same inert JSON grammar and canonical property order as copyBoundedJson +
 * JSON.stringify, without copying the tree or imposing record processing caps.
 * One active frame per depth; wide arrays never enqueue all their children.
 * Strict property validation reflects every container's own names, including a
 * transient input-width key list for arrays; objects retain their sorted lists.
 * This is per-Thing memory, not constant auxiliary RAM. No getter/toJSON runs. */
function* tokens(input: unknown, check: () => void): Generator<string> {
	const stack: Frame[] = [], ancestors = new WeakSet<object>();
	let value = input, entering = true, work = 0;
	for (;;) {
		if (++work % 4096 === 0) check();
		if (entering) {
			if (typeof value === 'string') yield* stringParts(value);
			else if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) yield JSON.stringify(value);
			else {
				if (!value || typeof value !== 'object') throw Error('Canonical JSON requires inert JSON values');
				if (ancestors.has(value)) throw Error('Canonical JSON cannot contain cycles');
				const array = Array.isArray(value);
				if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Canonical JSON requires plain objects');
				if (Object.getOwnPropertySymbols(value).length) throw Error('Canonical JSON cannot contain symbol properties');
				// Arrays walk by index after strict own-property enumeration.
				const keys = array ? null : Object.getOwnPropertyNames(value).sort(compareKeys);
				if (array && Object.getOwnPropertyNames(value).length !== (value as unknown[]).length + 1) throw Error('Canonical JSON arrays must be dense');
				ancestors.add(value);
				stack.push({ value, keys, index: 0 });
				yield array ? '[' : '{';
			}
			entering = false;
		}
		if (!stack.length) return;
		const frame = stack[stack.length - 1], count = frame.keys?.length ?? frame.value.length;
		if (frame.index === count) {
			yield frame.keys ? '}' : ']';
			ancestors.delete(frame.value); stack.pop();
			continue;
		}
		const key = frame.keys ? frame.keys[frame.index] : String(frame.index);
		const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
		if (!descriptor?.enumerable || !('value' in descriptor)) throw Error('Canonical JSON cannot contain accessors, holes or hidden properties');
		if (frame.index++) yield ',';
		if (frame.keys) { yield* stringParts(key); yield ':'; }
		value = descriptor.value; entering = true;
	}
}
/** Backpressure reaches the traversal at each bounded output buffer. The input
 * tree stays caller-owned and must remain pinned until iteration completes. */
export function* canonicalJsonBytes(input: unknown, check: () => void = () => {}): Generator<Uint8Array> {
	check();
	const encoder = new TextEncoder();
	let buffer = new Uint8Array(CANONICAL_JSON_CHUNK_BYTES), used = 0;
	for (const token of tokens(input, check)) {
		const bytes = encoder.encode(token);
		for (let offset = 0; offset < bytes.length;) {
			const length = Math.min(bytes.length - offset, buffer.length - used);
			buffer.set(bytes.subarray(offset, offset + length), used); used += length; offset += length;
			if (used === buffer.length) { check(); yield buffer; buffer = new Uint8Array(CANONICAL_JSON_CHUNK_BYTES); used = 0; }
		}
	}
	check(); if (used) yield buffer.subarray(0, used);
}

/** Reuse the canonical installed streaming parser, with a bounded token working
 * buffer and one materialized result. A scalar/result still requires its actual
 * JS memory; no second whole-document byte or text copy is accumulated. Caller
 * validates canonical bytes/digests and the domain envelope before using it. */
export async function parseJsonBytes(bytes: AsyncIterable<Uint8Array>, check: () => void = () => {}): Promise<unknown> {
	const parser = new JSONParser({ paths: ['$'], stringBufferSize: CANONICAL_JSON_CHUNK_BYTES, numberBufferSize: 128 });
	let result: unknown, complete = false;
	parser.onValue = ({ value }) => { result = value; complete = true; };
	try {
		for await (const chunk of bytes) { check(); parser.write(chunk); }
		if (!parser.isEnded) parser.end();
		check();
		if (!complete || !parser.isEnded) throw Error();
		return result;
	} catch { check(); throw Error('Invalid streamed JSON'); }
}
