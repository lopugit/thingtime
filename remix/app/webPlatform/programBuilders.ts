import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
export const parameter = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => ({
	name,
	label,
	type,
	default: value
});
export const global = (name: string) => ({ op: 'global', name });
export const input = (name: string) => ({ op: 'input', name });
export const literal = (value: unknown) => ({ op: 'literal', value });
export const get = (target: unknown, key: unknown) => ({ op: 'get', target, key });
export const method = (target: unknown, key: string, args: unknown[] = []) => ({ op: 'method', target, key, args });
export const make = (name: string, args: unknown[] = []) => ({ op: 'new', target: global(name), args });
export const returns = (value: unknown) => [{ op: 'return', value }];
export const base = (f: Feature): PlatformProgram => ({
	version: 1,
	title: f.name.slice(0, 200),
	description: f.description || `${f.kind} from ${f.group}.`
});
export const recipe = (
	program: PlatformProgram,
	coverage: Recipe['coverage'] = 'interactive',
	note = 'Edit the inputs and run the real browser implementation.'
): Recipe => ({ program, coverage, note });

// Reusable data-expression builders shared by catalogue authors. These create
// ordinary editable program nodes; execution stays in the bounded compiler.
export const variable = (name: string) => ({ op: 'variable', name });
export const object = (entries: Record<string, unknown>) => ({ op: 'object', entries: Object.entries(entries) });
export const array = (...items: unknown[]) => ({ op: 'array', items });
export const fn = (params: string[], value: unknown) => ({ op: 'function', params, value });
export const call = (target: unknown, args: unknown[] = []) => ({ op: 'call', target, args });
export const awaited = (value: unknown) => ({ op: 'await', value });
export const declare = (name: string, value: unknown): PlatformExpression => ({ op: 'let', name, value });
export const perform = (value: unknown): PlatformExpression => ({ op: 'expression', value });
export const project = (target: unknown, names: string[]) => object(Object.fromEntries(names.map((name) => [name, get(target, name)])));
export const setProperty = (target: unknown, key: string, value: unknown) => method(global('Reflect'), 'set', [target, key, value]);
/** Async native DOM operations on run-local handles, composed with ordinary JS. */
export const domDocument = () => awaited({ op: 'dom', action: 'document' });
export const domGet = (target: unknown, key: string) => awaited({ op: 'dom', action: 'get', target, key });
export const domSet = (target: unknown, key: string, value: unknown) => awaited({ op: 'dom', action: 'set', target, key, args: [value] });
export const domCall = (target: unknown, key: string, args: unknown[] = []) => awaited({ op: 'dom', action: 'call', target, key, args });
