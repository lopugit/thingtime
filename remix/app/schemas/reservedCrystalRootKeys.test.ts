import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { RESERVED_CRYSTAL_ROOT_KEYS, validateThingtimeCrystal } from './registry.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { KIND_BLIND_UNIQUE_CRYSTAL_ROOT_KEYS } from '../api/utils/mongodb/collections.ts';

// The unique-slot squat guard (see KIND_BLIND_UNIQUE_CRYSTAL_ROOT_KEYS in
// collections.ts): the kind-blind partial unique indexes fire on
// `crystal.<key>` alone, so a free-form data thing carrying one of those keys
// at its crystal root would permanently occupy another user's slot (e.g.
// crystal.followKey '<followerId>:<followeeId>' blocks the victim's real
// follow with E11000). sanitizeDataCrystal must reject every reserved key at
// the root — and ONLY at the root — for creates and merged updates alike.

test('every kind-blind unique crystal key is reserved at the data-crystal root', () => {
	for (const key of KIND_BLIND_UNIQUE_CRYSTAL_ROOT_KEYS) {
		assert.ok(RESERVED_CRYSTAL_ROOT_KEYS.has(key), `collections.ts index key '${key}' is missing from RESERVED_CRYSTAL_ROOT_KEYS`);
	}
});

test('voteKey is reserved ahead of its index landing', () => {
	// The poll-voting branch adds things_vote_key_unique; reserving the root
	// key first means the merge can never open a squat window.
	assert.ok(RESERVED_CRYSTAL_ROOT_KEYS.has('voteKey'));
});

test('data crystals reject every reserved key at the root', () => {
	for (const key of RESERVED_CRYSTAL_ROOT_KEYS) {
		const result = validateThingtimeCrystal(['data'], { [key]: 'squatter:victim' });
		assert.equal(result.ok, false, `crystal.${key} must be rejected at the data-crystal root`);
		if (result.ok === false) {
			assert.equal(result.status, 400);
			assert.ok(result.error.includes(key), `rejection must name the offending key (got: ${result.error})`);
		}
	}
});

test('schema-less crystals (thingtime omitted) get the same reservation', () => {
	// Omitting thingtime defaults to ['data'] — the squat must not slip through
	// the convenience path.
	const result = validateThingtimeCrystal(undefined, { memberKey: 'community:victim' });
	assert.equal(result.ok, false);
});

test('reservation is name-based, not type-based', () => {
	// things_friend_unique fires on $exists (any BSON type), and one
	// deterministic rule beats a per-index type carve-out.
	for (const value of [42, true, null, { nested: 'x' }, ['a']]) {
		const result = validateThingtimeCrystal(['data'], { friendKey: value });
		assert.equal(result.ok, false, `friendKey with a ${typeof value} value must still be rejected`);
	}
});

test('nested occurrences of reserved keys stay legal', () => {
	// The indexes only see the ROOT path crystal.<key>; nesting is the
	// documented escape hatch for users who legitimately want these names.
	const result = validateThingtimeCrystal(['data'], { profile: { followKey: 'a:b', inviteCode: 'tt-abc' }, list: [{ dmKey: 'x:y' }] });
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.crystal, { profile: { followKey: 'a:b', inviteCode: 'tt-abc' }, list: [{ dmKey: 'x:y' }] });
	}
});

test('non-reserved root keys are untouched', () => {
	const result = validateThingtimeCrystal(['data'], { followKeys: 'plural is fine', member: 'ok', note: 'hello' });
	assert.equal(result.ok, true);
});
