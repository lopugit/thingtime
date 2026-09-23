import type { Feature, PlatformProgram, Recipe } from './types';
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
