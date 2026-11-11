import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { thingmonPack as pack, THINGMON_PACK_ARITIES, THINGMON_SPECIES_SEED } from './index';
import { calcStats, canEvolve, catchRoll, effectiveness, evolve, expForLevel, getSpecies, grantExp, itemById, levelForExp, movesFor, newCritter, normalizeCritter, resolveTurn, rollEncounter, SPECIES, SPECIES_COUNT, TYPE_INFO, TYPE_KEYS, ZONES, type Critter } from './rules';

// a seeded generator so every roll below is replayable
const seeded = (seed = 7) => {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let x = t;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
};
const ctx = (seed = 7) => ({ random: seeded(seed), now: () => new Date('2026-09-21T00:00:00.000Z') });

describe('catalogue', () => {
	it('holds 60 species with unique ids, slugs, names and sprite paths', () => {
		assert.equal(SPECIES_COUNT, 60);
		for (const key of ['id', 'slug', 'name', 'sprite'] as const) assert.equal(new Set(SPECIES.map((entry) => entry[key])).size, 60, `${key} collides`);
		for (const species of SPECIES) {
			assert.ok(species.sprite.startsWith('/demos/thingmon/') && species.sprite.endsWith('.png'), species.sprite);
			assert.ok(species.types.every((type) => TYPE_KEYS.includes(type)), `${species.name} types`);
			assert.ok(species.habitats.every((zone) => ZONES.some((entry) => entry.id === zone)), `${species.name} habitats`);
			assert.ok(species.catchRate >= 1 && species.catchRate <= 255);
		}
	});
	it('evolution lines chain forward and back', () => {
		for (const species of SPECIES) {
			if (species.evolvesTo) {
				const next = getSpecies(species.evolvesTo.id);
				assert.equal(next.evolvesFrom, species.id, `${species.name} → ${next.name}`);
				assert.equal(next.stage, species.stage + 1);
			}
		}
		assert.equal(SPECIES.filter((entry) => entry.rarity === 'legendary').length, 4);
	});
	it('every type is strong against something and resisted by something', () => {
		for (const type of TYPE_KEYS) {
			assert.ok(TYPE_INFO[type].strong.length >= 2);
			assert.ok(TYPE_INFO[type].resist.length >= 2);
		}
		assert.equal(effectiveness('ember', ['bloom']), 2);
		assert.equal(effectiveness('ember', ['tide']), 0.5);
		assert.equal(effectiveness('ember', ['bloom', 'stone']), 1);
		assert.equal(effectiveness('stone', ['ember', 'frost']), 4);
	});
	it('the seed projection carries what the dex page renders', () => {
		assert.equal(THINGMON_SPECIES_SEED.length, 60);
		assert.equal(THINGMON_SPECIES_SEED[0].name, 'Cindrel');
		assert.equal(THINGMON_SPECIES_SEED[0].typeEmoji, '🔥');
	});
});

describe('stats, moves, experience', () => {
	it('stats scale with level and iv', () => {
		const low = calcStats(getSpecies(1), 5, 0);
		const high = calcStats(getSpecies(1), 30, 15);
		assert.ok(high.hp > low.hp && high.atk > low.atk && high.spd > low.spd);
		assert.equal(levelForExp(expForLevel(12)), 12);
		assert.equal(levelForExp(0), 1);
		assert.equal(levelForExp(1e9), 50);
	});
	it('a level-1 creature knows two moves, a level-26 one knows four of its types', () => {
		assert.deepEqual(movesFor(['ember'], 1).map((entry) => entry.id), ['bump', 'ember-flick']);
		const grown = movesFor(['ember', 'stone'], 26);
		assert.equal(grown.length, 4);
		assert.ok(grown.every((entry) => entry.type === 'neutral' || entry.type === 'ember' || entry.type === 'stone'));
	});
	it('experience levels up, and evolution unlocks at the line’s level', () => {
		const critter = newCritter({ speciesId: 1, level: 11 }, seeded(1));
		const grant = grantExp(critter, expForLevel(12) - critter.exp + 1);
		assert.equal(grant.leveledUp, true);
		assert.equal(grant.to, 12);
		assert.equal(canEvolve(grant.critter)?.name, 'Flamlet');
		const evolved = evolve(grant.critter);
		assert.equal(evolved.to, 'Flamlet');
		assert.equal(evolved.critter.speciesId, 2);
		assert.ok(evolved.critter.maxHp > grant.critter.maxHp);
		assert.throws(() => evolve(newCritter({ speciesId: 3, level: 40 }, seeded(2))), /not ready/);
	});
});

describe('battle', () => {
	const player = newCritter({ speciesId: 1, level: 10, iv: 15 }, seeded(3));
	const wild = newCritter({ speciesId: 7, level: 5, iv: 0 }, seeded(4));
	it('a turn damages the wild, logs both actions, and ends with a verdict', () => {
		const turn = resolveTurn(player, wild, 1, seeded(5));
		assert.ok(turn.wild.hp < wild.hp);
		assert.ok(turn.log.length >= 1);
		assert.ok(['continue', 'won', 'fainted'].includes(turn.outcome));
	});
	it('fighting to the end wins against a much weaker foe', () => {
		let state = { player, wild };
		let outcome = 'continue';
		for (let i = 0; i < 20 && outcome === 'continue'; i++) {
			const turn = resolveTurn(state.player, state.wild, 1, seeded(10 + i));
			state = { player: turn.player, wild: turn.wild };
			outcome = turn.outcome;
		}
		assert.equal(outcome, 'won');
	});
	it('a stored record with stale fields normalises to a valid creature', () => {
		const normalized = normalizeCritter({ speciesId: 2, level: 14, hp: 999, moves: ['ember-flick', 'nope'], status: 'weird' }, 'test');
		assert.equal(normalized.hp, normalized.maxHp);
		assert.equal(normalized.status, 'ok');
		assert.deepEqual(normalized.moves.map((entry) => entry.id), ['ember-flick']);
		assert.throws(() => normalizeCritter({ speciesId: 999 }, 'test'), /No Thingmon species/);
	});
	it('a non-finite iv, hp or exp cannot produce a NaN creature or an endless battle', () => {
		for (const hostile of [NaN, Infinity, -Infinity]) {
			const normalized = normalizeCritter({ speciesId: 1, level: 10, iv: hostile, hp: hostile, exp: hostile }, 'test');
			for (const key of ['iv', 'level', 'hp', 'maxHp', 'atk', 'def', 'spd', 'exp'] as const) assert.ok(Number.isFinite(normalized[key]), `${key} is ${normalized[key]} for iv/hp/exp ${hostile}`);
			assert.ok(normalized.hp > 0 && normalized.hp <= normalized.maxHp);
			assert.ok(normalized.iv >= 0 && normalized.iv <= 15);
			assert.ok(normalized.exp <= expForLevel(50));
		}
		// with NaN stats every hp comparison is false, so the battle loop could
		// never reach 'won' or 'fainted' — it ran forever against a level-5 foe
		let state = { player: normalizeCritter({ speciesId: 1, level: 10, iv: NaN }, 'test'), wild: normalizeCritter({ speciesId: 7, level: 5 }, 'test') };
		let outcome = 'continue';
		for (let i = 0; i < 40 && outcome === 'continue'; i++) {
			const turn = resolveTurn(state.player, state.wild, 0, seeded(10 + i));
			state = { player: turn.player, wild: turn.wild };
			outcome = turn.outcome;
		}
		assert.notEqual(outcome, 'continue');
	});
	it('stats clamp a hostile iv the same way every other entry point does', () => {
		const context = ctx();
		assert.deepEqual(pack['thingmon.stats']([{ speciesId: 1, level: 10, iv: NaN }], context), calcStats(getSpecies(1), 10, 8));
		assert.deepEqual(pack['thingmon.stats']([{ speciesId: 1, level: 10, iv: 1e9 }], context), calcStats(getSpecies(1), 10, 15));
		assert.deepEqual(pack['thingmon.stats']([{ speciesId: 1, level: 10, iv: -50 }], context), calcStats(getSpecies(1), 10, 0));
	});
	it('experience reports what was banked, not what was asked for', () => {
		const context = ctx();
		const capped = newCritter({ speciesId: 3, level: 50 }, seeded(1));
		const atCap = pack['thingmon.expGain']([{ member: capped, amount: 1e9 }], context) as { gained: number; leveledUp: boolean };
		assert.equal(atCap.gained, 0);
		assert.equal(atCap.leveledUp, false);
		const young = newCritter({ speciesId: 3, level: 5 }, seeded(1));
		const grew = pack['thingmon.expGain']([{ member: young, amount: 500 }], context) as { gained: number; member: { exp: number } };
		assert.equal(grew.gained, 500);
		assert.equal(grew.member.exp, young.exp + 500);
		const nonsense = pack['thingmon.expGain']([{ member: young, amount: NaN }], context) as { gained: number; member: { exp: number } };
		assert.equal(nonsense.gained, 0);
		assert.ok(Number.isFinite(nonsense.member.exp));
	});
	it('catch odds rise as HP falls and with a better crystal; a full-HP legendary is nearly uncatchable', () => {
		const wounded: Critter = { ...wild, hp: 1 };
		const shard = itemById('shard-crystal');
		const prism = itemById('prism-crystal');
		const caughtRolls = (target: Critter, item: typeof shard) => Array.from({ length: 200 }, (_, i) => catchRoll(target, item, seeded(100 + i)).caught).filter(Boolean).length;
		assert.ok(caughtRolls(wounded, shard) > caughtRolls(wild, shard));
		assert.ok(caughtRolls(wild, prism) > caughtRolls(wild, shard));
		const legendary = newCritter({ speciesId: 55, level: 30 }, seeded(9));
		assert.ok(caughtRolls(legendary, shard) < 10);
		assert.throws(() => catchRoll(wild, itemById('tonic'), seeded(1)), /not a capture crystal/);
	});
});

describe('encounters + pack bindings', () => {
	it('encounters respect the zone’s habitats, level range and the legendary gate', () => {
		for (let i = 0; i < 100; i++) {
			const rolled = rollEncounter('meadow', 0, seeded(300 + i));
			const species = getSpecies(rolled.speciesId);
			assert.ok(species.habitats.includes('meadow'), species.name);
			assert.notEqual(species.rarity, 'legendary');
			assert.ok(rolled.level >= 2 && rolled.level <= 7);
		}
		const withLegendary = new Set(Array.from({ length: 2000 }, (_, i) => getSpecies(rollEncounter('skybluff', 40, seeded(900 + i)).speciesId).rarity));
		assert.ok(withLegendary.has('legendary'), 'a fuller dex admits legendaries');
		assert.throws(() => rollEncounter('moon', 0, seeded(1)), /No such zone/);
	});
	it('every declared function is bound with a matching arity and answers', () => {
		for (const name of Object.keys(THINGMON_PACK_ARITIES)) assert.equal(typeof pack[name], 'function', name);
		const context = ctx();
		assert.equal((pack['thingmon.species'](['cindrel'], context) as { id: number }).id, 1);
		assert.equal((pack['thingmon.dex']([2, 25], context) as { items: unknown[] }).items.length, 25);
		assert.equal((pack['thingmon.zones']([], context) as unknown[]).length, 6);
		assert.equal((pack['thingmon.starters']([], context) as Array<{ name: string }>).map((entry) => entry.name).join(','), 'Cindrel,Puddlin,Sproutle');
		const critter = pack['thingmon.newCritter']([{ speciesId: 4, level: 6 }], context) as Record<string, unknown>;
		assert.equal(critter.hpPercent, 100);
		const encounter = pack['thingmon.encounter']([{ zone: 'tidepool', dexCaught: 0 }], context) as Record<string, unknown>;
		assert.ok(typeof encounter.sprite === 'string');
		const turn = pack['thingmon.battleTurn']([{ player: critter, wild: encounter, moveIndex: 0 }], context) as { log: string[]; outcome: string };
		assert.ok(turn.log.length >= 1);
		const flee = pack['thingmon.fleeRoll']([{ player: critter, wild: encounter, attempts: 9 }], context) as { escaped: boolean };
		assert.equal(flee.escaped, true);
		const healed = pack['thingmon.heal']([{ ...critter, hp: 1 }], context) as { hp: number; maxHp: number };
		assert.equal(healed.hp, healed.maxHp);
		const tonic = pack['thingmon.useItem']([{ member: { ...critter, hp: 1 }, itemId: 'tonic' }], context) as { consumed: boolean; member: { hp: number } };
		assert.equal(tonic.consumed, true);
		assert.ok(tonic.member.hp > 1);
		assert.throws(() => pack['thingmon.useItem']([{ member: critter, itemId: 'shard-crystal' }], context), /only be thrown/);
		const gain = pack['thingmon.expGain']([{ member: critter, amount: 5000 }], context) as { leveledUp: boolean; to: number; canEvolve: boolean };
		assert.equal(gain.leveledUp, true);
		assert.ok(gain.to >= 12);
		assert.equal(gain.canEvolve, true);
	});
});
