import { astroPack } from './astro/index';
import { pokeworldPack } from './pokeworld/index';
import type { ActionPack, PackContext, PackFunction } from './types';

// The server-bound pack table the executor hands to the expression engine.
// Every key here must be declared (name + arity) in the isomorphic catalogue
// at schemas/actionExpressions.ts — save-time validation only knows the
// catalogue, so a pack function the catalogue does not list is unreachable,
// and a catalogue entry with no binding is a run-time refusal.

export const ACTION_PACKS: ActionPack = {
	...astroPack,
	...pokeworldPack
};

// Bind a pack table to one run's context so the expression engine sees plain
// (args) => value functions.
export const bindPacks = (
	context: PackContext,
	packs: ActionPack = ACTION_PACKS
): Record<string, (args: unknown[]) => unknown> => {
	const bound: Record<string, (args: unknown[]) => unknown> = {};
	for (const [name, implementation] of Object.entries(packs)) {
		bound[name] = (args: unknown[]) => (implementation as PackFunction)(args, context);
	}
	return bound;
};
