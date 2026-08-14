// @ts-ignore
import { parse as parseAux, stringify as stringifyAux } from 'flatted';

type ThingtimeFunction = ((...args: any[]) => any) & {
	ttScope?: Record<string, unknown>;
};

type SerializedThingtimeFunction = {
	ttype: 'function';
	code: string;
	ttScope?: Record<string, unknown>;
};

const UNREVIVABLE_FUNCTION = Symbol('thingtime-unrevivable-function');
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_IDENTIFIERS = new Set([
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'function',
	'if',
	'import',
	'in',
	'instanceof',
	'let',
	'new',
	'null',
	'return',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield'
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const isLegacyFailedRevival = (code: string): boolean => {
	return code.includes('Function could not be revived:') && code.includes('value.code');
};

const validateScopeKeys = (scopeKeys: string[]): void => {
	for (const key of scopeKeys) {
		if (!IDENTIFIER_PATTERN.test(key) || RESERVED_IDENTIFIERS.has(key)) {
			throw new SyntaxError(`Thingtime function scope contains an invalid identifier: ${JSON.stringify(key)}`);
		}
	}
};

const compileFunction = (code: string, scope: Record<string, unknown>): ThingtimeFunction => {
	if (typeof code !== 'string') {
		throw new TypeError('Thingtime function source must be a string');
	}
	const normalizedCode = code.trim();
	if (!normalizedCode || isLegacyFailedRevival(normalizedCode)) {
		throw new SyntaxError('Thingtime function contains an invalid legacy fallback');
	}

	const scopeKeys = Object.keys(scope);
	validateScopeKeys(scopeKeys);
	const scopeValues = scopeKeys.map((key) => scope[key]);
	let factory: (...values: unknown[]) => unknown;

	try {
		// eslint-disable-next-line no-new-func -- Thingtime explicitly persists local function source and its allowlisted scope keys.
		factory = Function(...scopeKeys, `"use strict"; return (${normalizedCode});`) as (...values: unknown[]) => unknown;
	} catch (expressionError) {
		// Function.prototype.toString() emits object-method syntax for methods.
		// It is not a standalone expression, but remains valid inside an object.
		try {
			// eslint-disable-next-line no-new-func -- Object-method source needs the same explicit local-function revival path.
			factory = Function(
				...scopeKeys,
				`"use strict"; const holder = ({${normalizedCode}}); return holder[Reflect.ownKeys(holder)[0]];`
			) as (...values: unknown[]) => unknown;
		} catch {
			throw expressionError;
		}
	}

	const revived = factory(...scopeValues);
	if (typeof revived !== 'function') {
		throw new TypeError('Thingtime function source did not evaluate to a function');
	}

	const revivedFunction = revived as ThingtimeFunction;
	if (scopeKeys.length > 0) revivedFunction.ttScope = scope;
	return revivedFunction;
};

const revivePersistedValue = (value: any, seen = new WeakMap<object, unknown>()): any => {
	if (typeof value === 'string' && !isNaN(Date.parse(value))) {
		return new Date(value);
	}

	if (value?.ttype === 'function') {
		try {
			const serialized = value as SerializedThingtimeFunction;
			const scope = isRecord(serialized.ttScope) ? serialized.ttScope : {};
			const revived = compileFunction(serialized.code, scope);
			seen.set(value, revived);
			return revived;
		} catch (error) {
			console.error('There was an error evaluating persisted Thingtime function code:', error);
			return UNREVIVABLE_FUNCTION;
		}
	}

	if (!value || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value);
	seen.set(value, value);

	for (const key of Reflect.ownKeys(value)) {
		const revivedChild = revivePersistedValue((value as Record<PropertyKey, unknown>)[key], seen);
		if (revivedChild === UNREVIVABLE_FUNCTION) {
			delete (value as Record<PropertyKey, unknown>)[key];
		} else {
			(value as Record<PropertyKey, unknown>)[key] = revivedChild;
		}
	}

	return value;
};

const replacer = (_key: string, value: any): any => {
	if (value instanceof Date) {
		return value.toISOString();
	}

	if (typeof value === 'function') {
		return {
			ttype: 'function',
			code: value.toString(),
			ttScope: value?.ttScope || {}
		};
	}

	return value;
};

export const parseThingtime = (text: string): any => {
	try {
		const parsed = parseAux(text);
		const revived = revivePersistedValue(parsed);
		return revived === UNREVIVABLE_FUNCTION ? null : revived;
	} catch (error) {
		console.error('There was an error parsing the thingtime data:', error);
		return null;
	}
};

export const stringifyThingtime = (data: any): string => {
	try {
		return stringifyAux(data, replacer);
	} catch (error) {
		console.error('There was an error stringifying the thingtime data:', error);
		return '';
	}
};
