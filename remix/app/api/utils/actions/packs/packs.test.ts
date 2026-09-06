import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXPRESSION_CATALOGUE } from '~/schemas/actionExpressions';
import { ACTION_PACKS, bindPacks } from './index';
import { ASTRO_PACK_ARITIES } from './astro/index';
import { POKEWORLD_PACK_ARITIES } from './pokeworld/index';

// The isomorphic catalogue (save-time validation) and the server-bound packs
// (run-time evaluation) must agree name for name and arity for arity — a
// catalogue entry with no binding is a run-time refusal, and a binding the
// catalogue does not list is unreachable.

test('every pack function is declared in the expression catalogue with the same arity', () => {
	const declared = { ...ASTRO_PACK_ARITIES, ...POKEWORLD_PACK_ARITIES };
	for (const [name, arity] of Object.entries(declared)) {
		const entry = EXPRESSION_CATALOGUE[name];
		assert.ok(entry, `${name} is missing from EXPRESSION_CATALOGUE`);
		assert.equal(entry.min, arity.min, `${name} min arity`);
		assert.equal(entry.max, arity.max, `${name} max arity`);
		assert.ok(entry.pack === name.split('.')[0], `${name} names its pack`);
		assert.ok(typeof ACTION_PACKS[name] === 'function', `${name} is bound`);
	}
	for (const [name, entry] of Object.entries(EXPRESSION_CATALOGUE)) {
		if (!entry.pack) continue;
		assert.ok(typeof ACTION_PACKS[name] === 'function', `catalogue pack function ${name} has no server binding`);
	}
});

test('bound packs run with the supplied context', () => {
	const packs = bindPacks({ random: () => 0.25, now: () => new Date('2026-09-02T00:00:00.000Z') });
	const meta = packs['astro.meta']([]) as Record<string, unknown[]>;
	assert.equal(meta.signs.length, 12);
	const species = packs['pokeworld.species']([25]) as Record<string, unknown>;
	assert.equal(species.name, 'pikachu');
});
