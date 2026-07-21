// Serialization codec for the persisted `thingtime` object (localforage /
// IndexedDB). Pure and dependency-light on purpose so it can be unit-tested in
// Node without a browser or React (see thingtimePersistCodec.test.ts).
//
// Security-relevant history (TODO/claude-todo/09-security-hardening.md §C, §D):
// - Functions used to persist as {ttype:'function', code} and revive via
//   `eval(code)`, giving anything that can write same-origin storage (XSS,
//   extension, another tab) persistent code execution on every load. Functions
//   are now dropped on both write and read; ThingtimeDefaults re-supplies the
//   real ones on hydrate.
// - The reviver used to turn ANY string that passed the lenient `Date.parse`
//   into a Date ("Post 1", "2024", "March 2024" all parse), and the replacer
//   then rewrote it as an ISO string — permanently corrupting user data after
//   one save/reload cycle. Only strict ISO-8601 timestamps revive now.

// @ts-ignore - flatted ships without bundled types in this project
import { parse as parseAux, stringify as stringifyAux } from 'flatted';

// A full ISO-8601 timestamp with a time component: what Date.toISOString()
// emits and what `flatted` stores for a Date (Date.toJSON runs before the
// replacer, so Dates are already ISO strings by the time we serialize). Human
// values like "Post 1", "1", "2024", "March 2024", "5 April", or even a bare
// "2024-03-15" deliberately do NOT match, so they can never be revived.
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const reviver = (key: string, value: any): any => {
	// Revive ONLY strict ISO-8601 timestamps. Anything looser corrupts ordinary
	// user strings (see file header).
	if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
		const revived = new Date(value);
		if (!isNaN(revived.getTime())) {
			return revived;
		}
	}

	// Legacy persisted functions ({ttype:'function', code, ttScope}) are dropped,
	// never revived (no eval on storage-controlled code). Dropping the key lets
	// the hydration merge re-supply the real function from ThingtimeDefaults.
	if (value?.ttype === 'function') {
		return undefined;
	}

	return value;
};

export const replacer = (key: string, value: any): any => {
	// Dates serialize to their ISO string (Date.toJSON already did this before
	// we get here; kept explicit for clarity). The reviver only re-hydrates
	// strict ISO-8601 timestamps, never plain strings.
	if (value instanceof Date) {
		return value.toISOString();
	}

	// Functions never persist (and are never revived — see the reviver above).
	// Omitting them keeps executable code out of storage; defaults restore the
	// real functions on the next load.
	if (typeof value === 'function') {
		return undefined;
	}

	return value;
};

export const parse = (text: string): any => {
	try {
		return parseAux(text, reviver);
	} catch (err) {
		console.error('There was an error parsing the thingtime data:', err);
		return null;
	}
};

export const stringify = (data: any): string => {
	try {
		return stringifyAux(data, replacer);
	} catch (err) {
		console.error('There was an error stringifying the thingtime data:', err);
		return '';
	}
};
