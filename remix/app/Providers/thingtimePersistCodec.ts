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
// emits. Human values like "Post 1", "1", "2024", "March 2024", "5 April", or
// even a bare "2024-03-15" deliberately do NOT match. Used only for (a)
// escaping user strings that would be ambiguous and (b) reviving LEGACY
// pre-tagging persists (which stored Dates as bare ISO strings).
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

// The old serializer stored real Dates via Date.toJSON()/toISOString(), whose
// output is always UTC with exactly three fractional digits. Keep the legacy
// migration narrower than the new-string escape rule above: an offset or
// short-fraction timestamp in an old blob could only have been user text.
export const LEGACY_DATE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// NOTE: must be a `function` (not an arrow) — the parser calls the reviver
// with the holder object as `this`, and the inner string of a tag wrapper must
// NOT hit the legacy bare-ISO fallback below (it runs for the inner keys
// before the wrapper itself is revived).
export const reviver = function (this: any, key: string, value: any): any {
	// Canonical persisted form for real Dates (mirrors the ttype:'function'
	// tagging scheme — see the replacer).
	if (value?.ttype === 'date') {
		// `iso` may already be a Date if the holder guard below was bypassed by
		// a serializer that doesn't pass the holder as `this` — accept both.
		if (value.iso instanceof Date) {
			return value.iso;
		}
		if (typeof value.iso === 'string') {
			const revived = new Date(value.iso);
			if (!isNaN(revived.getTime())) {
				return revived;
			}
		}
		// A user object can legitimately contain a tag-looking shape. If it is
		// not a valid codec value, preserve it rather than silently replacing or
		// deleting user data.
		return value;
	}

	// A user STRING that merely looks like a timestamp was escaped by the
	// replacer so it can never be confused with a real Date — unwrap it.
	if (value?.ttype === 'iso-string') {
		if (typeof value.s === 'string') {
			return value.s;
		}
		return value;
	}

	// The inner string of a tag wrapper is handled by the wrapper branches
	// above when the WRAPPER is revived — reviving it here first would hand
	// those branches a Date where they expect the original string.
	const insideOwnTag = (this?.ttype === 'date' && key === 'iso') || (this?.ttype === 'iso-string' && key === 's');

	// Legacy fallback: pre-tagging persists stored real Dates as bare strict
	// ISO strings. New persists never produce these (real Dates are tagged,
	// ISO-lookalike user strings are escaped), so this only migrates old data.
	if (typeof value === 'string' && !insideOwnTag && LEGACY_DATE_TIMESTAMP.test(value)) {
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

// NOTE: must be a `function` (not an arrow) — JSON/flatted call the replacer
// with the holder object as `this`, and Date.toJSON converts real Dates to ISO
// strings BEFORE the replacer sees `value`, so the original Date is only
// reachable via `this[key]`.
export const replacer = function (this: any, key: string, value: any): any {
	const original = this?.[key];

	// Real Dates persist tagged, so revival never has to guess from a string
	// shape (the corruption class behind TODO 9).
	if (original instanceof Date && !isNaN(original.getTime())) {
		return { ttype: 'date', iso: original.toISOString() };
	}

	// The inner string of a wrapper THIS replacer just emitted must pass
	// through untouched, or the escape rule below would re-wrap its own output
	// forever (the serializer walks the returned wrapper's properties too).
	const insideOwnTag = (this?.ttype === 'date' && key === 'iso') || (this?.ttype === 'iso-string' && key === 's');

	// A plain user string that happens to look like a timestamp is escaped so
	// the legacy bare-ISO fallback in the reviver can never capture it.
	if (typeof value === 'string' && !insideOwnTag && ISO_TIMESTAMP.test(value)) {
		return { ttype: 'iso-string', s: value };
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
