// @ts-ignore flatted does not bundle types in this project.
import { parse as parseAux, stringify as stringifyAux } from 'flatted';

export type ParsedThingtime = {
	value: any;
	repaired: boolean;
	removedFunctionCount: number;
};

const ROOT_RUNTIME_METHODS = new Set<PropertyKey>(['set', 'get']);

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

type ParseDiagnostics = {
	removedFunctionCount: number;
};

const INERT_PERSISTED_FUNCTION = Symbol('thingtime-inert-persisted-function');

const revivePersistedValue = (value: any, diagnostics: ParseDiagnostics, seen = new WeakMap<object, unknown>()): any => {
	// Untagged strings are always user data. The legacy serializer made real
	// Dates indistinguishable from ISO-looking text, so guessing here would
	// corrupt one of those two cases. Schema-aware callers can migrate known
	// date fields separately; the generic persistence boundary stays lossless.
	if (typeof value === 'string') return value;

	if (!value || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);

	// Persisted state is data, never a code-delivery mechanism. Every legacy
	// function tag is removed regardless of whether its source looks valid.
	if (value.ttype === 'function') {
		diagnostics.removedFunctionCount += 1;
		seen.set(value, INERT_PERSISTED_FUNCTION);
		return INERT_PERSISTED_FUNCTION;
	}

	if (value.ttype === 'date' && typeof value.iso === 'string') {
		const revived = new Date(value.iso);
		if (!isNaN(revived.getTime())) {
			seen.set(value, revived);
			return revived;
		}
	}

	seen.set(value, value);

	for (const key of Reflect.ownKeys(value)) {
		const revived = revivePersistedValue(value[key], diagnostics, seen);

		if (revived === INERT_PERSISTED_FUNCTION) {
			delete value[key];
		} else {
			value[key] = revived;
		}
	}

	return value;
};

// Date.toJSON runs before a JSON/flatted replacer, so inspect the holder's
// original value through this[key]. This must remain a normal function so the
// serializer supplies that holder as this.
const replacer = function (this: any, key: string, value: any): any {
	const original = this?.[key];

	// JSON/flatted invokes toJSON before the replacer. Check the holder's
	// original value as well so a Function with a custom toJSON method cannot
	// smuggle source text or a function-shaped tag into a new snapshot.
	if (typeof original === 'function' || typeof value === 'function') return undefined;

	if (original instanceof Date && !isNaN(original.getTime())) {
		return { ttype: 'date', iso: original.toISOString() };
	}

	return value;
};

export const hasPersistedThingtimeRuntimeMethods = (value: unknown): boolean => {
	return isRecord(value) && [...ROOT_RUNTIME_METHODS].some((key) => Object.prototype.hasOwnProperty.call(value, key));
};

export const parseThingtimeWithDiagnostics = (text: string): ParsedThingtime => {
	const diagnostics: ParseDiagnostics = {
		removedFunctionCount: 0
	};

	try {
		const parsed = parseAux(text);
		const value = revivePersistedValue(parsed, diagnostics);
		return {
			value: value === INERT_PERSISTED_FUNCTION || value === undefined ? null : value,
			repaired: diagnostics.removedFunctionCount > 0,
			...diagnostics
		};
	} catch (error) {
		console.error('There was an error parsing the thingtime data:', error);
		return {
			value: null,
			repaired: false,
			removedFunctionCount: 0
		};
	}
};

export const parseThingtime = (text: string): any => {
	return parseThingtimeWithDiagnostics(text).value;
};

export const stringifyThingtime = (data: any): string => {
	try {
		return stringifyAux(data, replacer);
	} catch (error) {
		console.error('There was an error stringifying the thingtime data:', error);
		return '';
	}
};

export const stringifyThingtimeForStorage = (data: any): string => {
	try {
		return stringifyAux(data, function (this: any, key: string, value: any) {
			// set/get are live React closures attached to the root. Nested user
			// properties with those names remain ordinary data.
			if (this === data && ROOT_RUNTIME_METHODS.has(key)) return undefined;
			return replacer.call(this, key, value);
		});
	} catch (error) {
		console.error('There was an error stringifying the thingtime data for storage:', error);
		return '';
	}
};
