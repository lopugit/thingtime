import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PackContext } from '../types';
import { catchAttempt, battleMonFromMember, movesFor } from './battle';
import {
	defaultRulesFor,
	defaultSpawnRules,
	encounterBiomeFor,
	encounterTriggered,
	fenceContains,
	haversineKm,
	matchingRules,
	rollEncounter,
	type SpawnRule
} from './encounters';
import { pokeworldPack as pack, POKEWORLD_PACK_ARITIES, blockForCoordinates } from './index';
import {
	allSpecies,
	calcStats,
	expForLevel,
	expGainForDefeat,
	getSpecies,
	levelForExp,
	NATIONAL_DEX_COUNT,
	rollGender,
	rollShiny,
	speciesByName,
	speciesSpriteUrl,
	typeEffectiveness
} from './pokedex';
import {
	cavePagesFor,
	fieldItemFor,
	formatDialogPages,
	hashUnit,
	interactionFor,
	isFieldItemTile,
	isLedgeTile,
	isNearCaveEntrance,
	isSignTile,
	isSolidFor,
	resolveMove,
	signPagesFor,
	type RuleTile,
	type TileLookup
} from './rules';
import type { PartyMember } from './trainer';
import { BIOMES, BLOCK_TILES, generateBlock, portalsFor, tileAt, tileKey, type WorldBlock, type WorldTile } from './world';

// Deterministic RNG from a fixed sequence (repeats the last value).
const seq = (...values: number[]) => {
	let index = 0;
	return () => values[Math.min(index++, values.length - 1)];
};

const context = (random: () => number = seq(0.5)): PackContext => ({ random, now: () => new Date(1_700_000_000_000) });

const call = <T = any>(name: string, args: unknown[] = [], random?: () => number): T => {
	const fn = pack[name];
	assert.ok(fn, `pack function ${name} exists`);
	return fn(args, context(random)) as T;
};

const trainer = () => call('pokeworld.defaultTrainer');
const wildOf = (speciesId: number, level: number): PartyMember => call('pokeworld.newPokemon', [{ speciesId, level, gender: 'male' }]);

const ULURU = { lat: -25.3444, lng: 131.0369 };

// --- Pokédex ------------------------------------------------------------------

describe('pokedex dataset', () => {
	it('ships all 386 Gen I-III species with complete battle data', () => {
		const entries = allSpecies();
		assert.equal(entries.length, NATIONAL_DEX_COUNT);
		for (const entry of entries) {
			assert.ok(entry.id >= 1 && entry.id <= 386);
			assert.ok(entry.types.length >= 1);
			assert.ok(entry.catchRate >= 1);
			assert.ok(entry.baseStats.hp > 0);
			assert.ok(entry.baseStats.spe > 0);
			assert.ok(entry.displayName.length > 0);
		}
	});

	it('resolves species by dex id and by name', () => {
		assert.equal(getSpecies(383)?.displayName, 'GROUDON');
		assert.equal(speciesByName('groudon')?.id, 383);
		assert.equal(speciesByName('TREECKO')?.id, 252);
		assert.equal(getSpecies(999), undefined);
	});

	it('builds absolute sprite urls for every variant', () => {
		assert.equal(speciesSpriteUrl(25), 'https://www.pokeworld.center/sprites/pokemon/gen3/25.png');
		assert.equal(speciesSpriteUrl(25, { shiny: true }), 'https://www.pokeworld.center/sprites/pokemon/gen3/shiny/25.png');
		assert.equal(speciesSpriteUrl(25, { back: true }), 'https://www.pokeworld.center/sprites/pokemon/gen3/back/25.png');
		assert.equal(speciesSpriteUrl(25, { back: true, shiny: true }), 'https://www.pokeworld.center/sprites/pokemon/gen3/back-shiny/25.png');
	});
});

describe('gen III math', () => {
	it('computes level-100 stats matching the Gen III formula', () => {
		const mewtwo = getSpecies(150)!;
		const stats = calcStats(mewtwo.baseStats, 100, 0);
		assert.equal(stats.hp, 2 * 106 + 110); // 2*base + level + 10
		assert.equal(stats.atk, 2 * 110 + 5);
	});

	it('exp curves are monotonic and match known anchors', () => {
		assert.equal(expForLevel('medium', 100), 1_000_000);
		assert.equal(expForLevel('fast', 100), 800_000);
		assert.equal(expForLevel('slow', 100), 1_250_000);
		assert.equal(expForLevel('medium-slow', 100), 1_059_860);
		for (const curve of ['medium', 'fast', 'slow', 'medium-slow', 'erratic', 'fluctuating']) {
			let previous = expForLevel(curve, 2);
			for (let level = 3; level <= 100; level += 1) {
				const current = expForLevel(curve, level);
				assert.ok(current > previous, `${curve} L${level}`);
				previous = current;
			}
		}
	});

	it('levelForExp inverts expForLevel', () => {
		for (const level of [1, 7, 36, 99, 100]) {
			assert.equal(levelForExp('medium-slow', expForLevel('medium-slow', level)), level);
		}
	});

	it('yields Gen III flat exp for defeated wild Pokémon', () => {
		const zigzagoon = getSpecies(263)!;
		assert.equal(expGainForDefeat(zigzagoon, 7), Math.floor((zigzagoon.baseExp * 7) / 7));
	});

	it('rolls gender by species ratio and respects genderless', () => {
		assert.equal(
			rollGender(-1, () => 0),
			'genderless'
		);
		assert.equal(
			rollGender(0, () => 0.99),
			'male'
		);
		assert.equal(
			rollGender(8, () => 0),
			'female'
		);
		assert.equal(
			rollGender(1, () => 0.01),
			'female'
		);
		assert.equal(
			rollGender(1, () => 0.9),
			'male'
		);
	});

	it('rolls shinies at the requested denominator', () => {
		assert.equal(
			rollShiny(() => 0, 8192),
			true
		);
		assert.equal(
			rollShiny(() => 0.99, 8192),
			false
		);
		assert.equal(
			rollShiny(() => 0.4, 2),
			true
		);
		assert.equal(
			rollShiny(() => 0.6, 2),
			false
		);
	});

	it('applies the Gen III type chart with dual-type stacking', () => {
		assert.equal(typeEffectiveness('WATER', ['FIRE']), 2);
		assert.equal(typeEffectiveness('WATER', ['FIRE', 'ROCK']), 4);
		assert.equal(typeEffectiveness('ELECTRIC', ['GROUND']), 0);
		assert.equal(typeEffectiveness('NORMAL', ['GHOST']), 0);
		assert.equal(typeEffectiveness('GRASS', ['FIRE', 'FLYING']), 0.25);
		assert.equal(typeEffectiveness('DRAGON', ['DRAGON']), 2);
	});
});

// --- Battle -------------------------------------------------------------------

describe('movepools', () => {
	it('derives level-appropriate STAB movesets, capped at four', () => {
		const low = movesFor(['FIRE'], 5);
		assert.ok(low.some((move) => move.name === 'EMBER'));
		assert.ok(low.every((move) => move.power <= 40));
		const high = movesFor(['FIRE', 'FLYING'], 50);
		assert.equal(high.length, 4);
		assert.ok(high.some((move) => move.type === 'FIRE'));
		assert.ok(high.some((move) => move.type === 'FLYING'));
		assert.deepEqual(call('pokeworld.moves', [[' fire ', 'flying'], 50]), high);
		assert.deepEqual(call('pokeworld.moves', [252, 12]), movesFor(['GRASS'], 12));
	});
});

describe('battle flow', () => {
	it('resolves a full damage turn with Gen III math and both sides acting', () => {
		const player = trainer().party[0];
		const wild = wildOf(263, 5); // Zigzagoon
		// Treecko L12 spe > Zigzagoon L5 → player first; neutral rolls all hit.
		const turn = call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }], seq(0.5));
		assert.ok(turn.log.some((message: string) => message.includes('TREECKO used')));
		assert.ok(turn.wild.hp < turn.wild.maxHp);
		if (turn.wild.hp > 0) assert.ok(turn.player.hp < turn.player.maxHp);
		assert.equal(turn.player.moves[0].pp, turn.player.moves[0].maxPp - 1);
		assert.equal(turn.outcome, 'continue');
	});

	it('awards experience and can level up after a knockout', () => {
		const player = trainer().party[0];
		const wild = { ...wildOf(263, 5), hp: 1 };
		const turn = call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }], seq(0.5, 0.5, 0.99, 0.5));
		assert.equal(turn.outcome, 'won');
		assert.ok(turn.log.some((message: string) => message.includes('gained')));
		assert.ok(turn.expGained > 0);
		assert.equal(turn.player.exp, player.exp + turn.expGained);
		assert.equal(turn.leveledUp, false);
		assert.equal(turn.newLevel, player.level);
	});

	it('levels the player up when the exp crosses the curve, keeping the hp delta', () => {
		const player = { ...trainer().party[0], exp: expForLevel('medium-slow', 13) - 1 };
		const wild = { ...wildOf(263, 5), hp: 1 };
		const turn = call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }], seq(0.5, 0.5, 0.99, 0.5));
		assert.equal(turn.outcome, 'won');
		assert.equal(turn.leveledUp, true);
		assert.equal(turn.newLevel, 13);
		assert.equal(turn.player.level, 13);
		assert.ok(turn.log.some((message: string) => message.includes('grew to LV. 13')));
		assert.equal(turn.player.maxHp, calcStats(getSpecies(252)!.baseStats, 13).hp);
	});

	it('reports a fainted player when the wild wins the exchange', () => {
		const player = { ...trainer().party[0], hp: 1 };
		const wild = wildOf(383, 50); // Groudon outspeeds and one-shots.
		const turn = call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }], seq(0.5));
		assert.equal(turn.outcome, 'fainted');
		assert.equal(turn.player.hp, 0);
		assert.ok(turn.log.some((message: string) => message.includes('TREECKO fainted!')));
	});

	it('gates paralysed attackers and applies end-of-turn poison chip', () => {
		const player = { ...trainer().party[0], status: 'poisoned' };
		const wild = { ...wildOf(263, 5), status: 'paralyzed' };
		// Player first; wild's paralysis roll (0.1 < 0.25) skips its move.
		const turn = call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }], seq(0.5, 0.5, 0.5, 0.5, 0.1));
		assert.ok(turn.log.some((message: string) => message.includes('paralyzed! It can')));
		assert.ok(turn.log.some((message: string) => message.includes('hurt by poison')));
		assert.equal(turn.player.hp, player.maxHp - Math.max(1, Math.floor(player.maxHp / 8)));
	});

	it('run-away uses the Gen III escape odds', () => {
		const player = trainer().party[0];
		const wild = wildOf(263, 5);
		const run = call('pokeworld.runRoll', [{ player, wild, attempts: 0 }], seq(0.99));
		assert.equal(run.escaped, true);
		assert.equal(run.message, 'Got away safely!');
		assert.equal(run.attempts, 1);
		// Slower than a Groudon: odds = floor(spe*128/wildSpe) + 30 → a top roll fails and the wild attacks.
		const failed = call('pokeworld.runRoll', [{ player, wild: wildOf(383, 50), attempts: 0 }], seq(0.999));
		assert.equal(failed.escaped, false);
		assert.equal(failed.message, "Can't escape!");
		assert.ok(failed.log.some((message: string) => message.includes('Wild GROUDON used')));
	});

	it('in-battle potions heal, useless items report without consuming', () => {
		const hurt = { ...trainer().party[0], hp: 5 };
		const used = call('pokeworld.useItem', [{ member: hurt, itemId: 'potion', inBattle: true }]);
		assert.equal(used.consumed, true);
		assert.equal(used.member.hp, 25);
		const full = call('pokeworld.useItem', [{ member: trainer().party[0], itemId: 'potion', inBattle: true }]);
		assert.equal(full.consumed, false);
		assert.ok(full.message.includes('full HP'));
		const revived = call('pokeworld.useItem', [{ member: { ...hurt, hp: 0 }, itemId: 'revive', inBattle: true }]);
		assert.equal(revived.member.hp, Math.ceil(hurt.maxHp / 2));
		assert.throws(() => call('pokeworld.useItem', [{ member: hurt, itemId: 'master-ball' }]), /itemId must be one of/);
	});
});

describe('catching', () => {
	it('guaranteed catch when the Gen III formula saturates', () => {
		// Zigzagoon (rate 255) at 1 HP asleep with an ultra ball: a >= 255.
		const wild = battleMonFromMember({ ...wildOf(263, 5), hp: 1, status: 'asleep', sleepTurns: 2 }, true);
		assert.equal(catchAttempt(wild, 'ultra-ball', seq(0.99)).caught, true);
	});

	it('legendaries at full HP are hard to catch', () => {
		const groudon = battleMonFromMember(wildOf(383, 50), true);
		// rng always rolls the top of the shake range → every check fails.
		assert.equal(catchAttempt(groudon, 'poke-ball', seq(0.999999)).caught, false);
	});

	it('a successful throw returns a party-ready member', () => {
		const wild = { ...wildOf(25, 5), hp: 1, status: 'asleep' };
		const result = call('pokeworld.catchRoll', [{ wild, ball: 'ultra-ball' }], seq(0, 0, 0, 0));
		assert.equal(result.caught, true);
		assert.equal(result.shakes, 3);
		assert.ok(result.log.some((message: string) => message.includes('was caught')));
		assert.ok(result.member.id.startsWith('caught-'));
		assert.equal(result.member.speciesId, 25);
		assert.equal(result.member.hp, 1);
		assert.equal(result.member.exp, expForLevel(getSpecies(25)!.growthRate, 5));
	});

	it('a failed throw reports the shake count and the wild attacks', () => {
		const player = trainer().party[0];
		const wild = wildOf(383, 50);
		const result = call('pokeworld.catchRoll', [{ wild, ball: 'poke-ball', player }], seq(0.999999, 0.5, 0.99, 0.5));
		assert.equal(result.caught, false);
		assert.equal(result.shakes, 0);
		assert.equal(result.message, 'Oh no! The POKéMON broke free!');
		assert.equal(result.log[0], 'You threw a POKE BALL!');
		assert.ok(result.log.some((message: string) => message.includes('Wild GROUDON used')));
		assert.ok(result.player.hp < player.hp);
		assert.throws(() => call('pokeworld.catchRoll', [{ wild, ball: 'master-ball' }]), /ball must be/);
	});
});

// --- Encounters ---------------------------------------------------------------

describe('biome detection', () => {
	it('detects long grass by feature and by img2 fallback', () => {
		assert.equal(encounterBiomeFor({ feature: 'long-grass' }), 'long-grass');
		assert.equal(encounterBiomeFor({ img2: 'grass-2' }), 'long-grass');
		assert.equal(encounterBiomeFor({ feature: 'sign' }), null);
	});

	it('only treats water as encounterable while surfing', () => {
		const water = { terrain: 'water', img: 'pond-center-1', solid: true };
		assert.equal(encounterBiomeFor(water), null);
		assert.equal(encounterBiomeFor(water, { surfing: true }), 'water');
	});

	it('uses the cave biome near cave entrances', () => {
		assert.equal(encounterBiomeFor({}, { nearCave: true }), 'cave');
		assert.equal(encounterBiomeFor({ feature: 'long-grass' }, { nearCave: true }), 'long-grass');
	});

	it('triggers encounters at the configured per-step rate', () => {
		assert.equal(
			encounterTriggered('long-grass', () => 0.11),
			true
		);
		assert.equal(
			encounterTriggered('long-grass', () => 0.13),
			false
		);
	});
});

describe('geofencing', () => {
	it('computes real-world distances', () => {
		const distance = haversineKm(-37.8136, 144.9631, -33.8688, 151.2093);
		assert.ok(distance > 680 && distance < 740);
	});

	it('contains points inside circles and everywhere for global', () => {
		assert.equal(fenceContains({ kind: 'global' }, 0, 0), true);
		const uluru = { kind: 'circle' as const, ...ULURU, radiusKm: 100 };
		assert.equal(fenceContains(uluru, -25.35, 131.04), true);
		assert.equal(fenceContains(uluru, -37.81, 144.96), false);
		assert.equal(fenceContains(uluru, Number.NaN, 131), false);
	});
});

describe('default rules', () => {
	it('gives every species at least one rule and biomes match types', () => {
		const rules = defaultSpawnRules();
		const bySpecies = new Map<number, SpawnRule[]>();
		for (const rule of rules) bySpecies.set(rule.speciesId, [...(bySpecies.get(rule.speciesId) ?? []), rule]);
		assert.equal(bySpecies.size, 386);
		const treecko = bySpecies.get(252)![0];
		assert.deepEqual(treecko.biomes, ['long-grass']);
		assert.ok(bySpecies.get(129)![0].biomes.includes('water'));
		assert.ok(bySpecies.get(41)![0].biomes.includes('cave'));
		assert.equal(treecko.levelMin, 2);
		assert.equal(treecko.levelMax, 7);
		assert.equal(treecko.fence.kind, 'global');
		assert.equal(bySpecies.get(263)![0].weight, 255);
	});

	it('geofences Groudon to a 100km circle around Uluru at level 50-70', () => {
		const [groudon] = defaultRulesFor(getSpecies(383)!);
		assert.deepEqual(groudon.fence, { kind: 'circle', ...ULURU, radiusKm: 100 });
		assert.equal(groudon.levelMin, 50);
		assert.equal(groudon.levelMax, 70);
		assert.equal(groudon.weight, 1);
	});
});

describe('encounter rolls', () => {
	const rules = defaultSpawnRules();

	it('only rolls species whose fence contains the player', () => {
		assert.equal(
			matchingRules(rules, 'long-grass', -37.81, 144.96).some((rule) => rule.speciesId === 383),
			false
		);
		assert.equal(
			matchingRules(rules, 'long-grass', -25.35, 131.04).some((rule) => rule.speciesId === 383),
			true
		);
	});

	it('respects biome fencing (grass types never on water)', () => {
		const waterMatches = matchingRules(rules, 'water', -37.81, 144.96);
		assert.equal(
			waterMatches.some((rule) => rule.speciesId === 252),
			false
		);
		assert.equal(
			waterMatches.some((rule) => rule.speciesId === 129),
			true
		);
	});

	it("rolls a level inside the rule's range and applies overrides", () => {
		const custom: SpawnRule[] = [
			{
				id: 'x',
				speciesId: 25,
				enabled: true,
				weight: 1,
				biomes: ['long-grass'],
				fence: { kind: 'global' },
				levelMin: 50,
				levelMax: 55,
				genderOverride: 'female',
				shinyDenominator: 1,
				source: 'custom'
			}
		];
		const result = rollEncounter(custom, 'long-grass', 0, 0, seq(0.1, 0.99, 0.5, 0));
		assert.ok(result);
		assert.equal(result.speciesId, 25);
		assert.ok(result.level >= 50 && result.level <= 55);
		assert.equal(result.gender, 'female');
		assert.equal(result.shiny, true);
	});

	it('weighted selection is deterministic under a seeded rng', () => {
		const custom: SpawnRule[] = [
			{
				id: 'a',
				speciesId: 1,
				enabled: true,
				weight: 90,
				biomes: ['long-grass'],
				fence: { kind: 'global' },
				levelMin: 5,
				levelMax: 5,
				source: 'custom'
			},
			{
				id: 'b',
				speciesId: 4,
				enabled: true,
				weight: 10,
				biomes: ['long-grass'],
				fence: { kind: 'global' },
				levelMin: 5,
				levelMax: 5,
				source: 'custom'
			}
		];
		assert.equal(rollEncounter(custom, 'long-grass', 0, 0, seq(0.5, 0.5, 0.5, 0.9))!.speciesId, 1);
		assert.equal(rollEncounter(custom, 'long-grass', 0, 0, seq(0.95, 0.5, 0.5, 0.9))!.speciesId, 4);
		const disabled = custom.map((rule) => ({ ...rule, enabled: false }));
		assert.equal(rollEncounter(disabled, 'long-grass', 0, 0, seq(0.5)), null);
	});

	it('genderless species stay genderless even with a gender override', () => {
		const custom: SpawnRule[] = [
			{
				id: 'g',
				speciesId: 81,
				enabled: true,
				weight: 1,
				biomes: ['cave'],
				fence: { kind: 'global' },
				levelMin: 10,
				levelMax: 10,
				genderOverride: 'female',
				source: 'custom'
			}
		];
		assert.equal(rollEncounter(custom, 'cave', 0, 0, seq(0.2, 0.2, 0.2, 0.9))!.gender, 'genderless');
	});

	it('the pack rolls world encounters, seeded or from the context rng', () => {
		const rolled = call('pokeworld.encounter', [{ biome: 'long-grass' }], seq(0.3, 0.5, 0.5, 0.9));
		assert.ok(rolled);
		assert.ok(rolled.level >= 2 && rolled.level <= 7);
		assert.equal(rolled.sprite, speciesSpriteUrl(rolled.speciesId));
		assert.deepEqual(
			call('pokeworld.encounter', [{ biome: 'water', seed: 'tide' }]),
			call('pokeworld.encounter', [{ biome: 'water', seed: 'tide' }])
		);
		// Without coordinates geofenced legendaries never appear; at Uluru Groudon can.
		const uluruCandidates = matchingRules(defaultSpawnRules(), 'cave', ULURU.lat, ULURU.lng);
		assert.ok(uluruCandidates.some((rule) => rule.speciesId === 383));
		const groudonOffset = uluruCandidates
			.slice(
				0,
				uluruCandidates.findIndex((rule) => rule.speciesId === 383)
			)
			.reduce((sum, rule) => sum + rule.weight, 0);
		const total = uluruCandidates.reduce((sum, rule) => sum + rule.weight, 0);
		const groudon = call('pokeworld.encounter', [{ biome: 'cave', ...ULURU }], seq((groudonOffset + 0.5) / total, 0.5, 0.5, 0.9));
		assert.equal(groudon.speciesId, 383);
		assert.ok(groudon.level >= 50 && groudon.level <= 70);
		assert.throws(() => call('pokeworld.encounter', [{ biome: 'lava' }]), /biome must be/);
	});
});

// --- Rules ---------------------------------------------------------------------

const ruleTile = (extra: Partial<RuleTile> = {}): RuleTile => ({ ...extra });

const lookupFrom = (tiles: Array<{ x: number; y: number; tile: RuleTile }>): TileLookup => {
	const db = new Map(tiles.map((entry) => [`${entry.x},${entry.y}`, entry.tile]));
	return (x, y) => {
		const tile = db.get(`${x},${y}`);
		return tile ? { tile, key: `${x},${y}` } : undefined;
	};
};

const nothingCollected = () => false;

describe('hashUnit', () => {
	it('is deterministic and in [0, 1)', () => {
		for (let index = 0; index < 50; index += 1) {
			const value = hashUnit(index * 32, index * 64, 'check');
			assert.ok(value >= 0 && value < 1);
			assert.equal(hashUnit(index * 32, index * 64, 'check'), value);
		}
		assert.notEqual(hashUnit(1, 2, 'a'), hashUnit(1, 2, 'b'));
		assert.notEqual(hashUnit(1, 2), hashUnit(2, 1));
	});
});

describe('feature detection', () => {
	it('detects ledges via feature or img2 prefix', () => {
		assert.equal(isLedgeTile(ruleTile({ feature: 'ledge' })), true);
		assert.equal(isLedgeTile(ruleTile({ img2: 'ledge-middle-1' })), true);
		assert.equal(isLedgeTile(ruleTile({ img2: 'tree-1' })), false);
		assert.equal(isLedgeTile(undefined), false);
	});

	it('detects field items and signs', () => {
		assert.equal(isFieldItemTile(ruleTile({ feature: 'field-item' })), true);
		assert.equal(isFieldItemTile(ruleTile({ feature: 'hidden-item', img2: 'grass' })), true);
		assert.equal(isFieldItemTile(ruleTile({ img2: 'field-item-1' })), true);
		assert.equal(isSignTile(ruleTile({ feature: 'sign' })), true);
		assert.equal(isSignTile(ruleTile({ img2: 'route-sign-1' })), true);
	});
});

describe('resolveMove', () => {
	it('moves into empty void (unloaded tiles stay walkable)', () => {
		assert.deepEqual(resolveMove(lookupFrom([]), 0, 0, 'right', nothingCollected), { kind: 'move', toX: 1, toY: 0 });
	});

	it('blocks solid tiles and walks onto walkable ones', () => {
		const lookup = lookupFrom([{ x: 1, y: 0, tile: ruleTile({ solid: true, img2: 'tree-1' }) }]);
		assert.deepEqual(resolveMove(lookup, 0, 0, 'right', nothingCollected), { kind: 'blocked' });
		const open = lookupFrom([{ x: 1, y: 0, tile: ruleTile({ img: 'grass' }) }]);
		assert.deepEqual(resolveMove(open, 0, 0, 'right', nothingCollected), { kind: 'move', toX: 1, toY: 0 });
	});

	it('jumps ledges only when moving screen-down (world -y)', () => {
		const lookup = lookupFrom([
			{ x: 0, y: 1, tile: ruleTile({ feature: 'ledge', img2: 'ledge-middle-1', solid: true }) },
			{ x: 0, y: 0, tile: ruleTile({ img: 'grass' }) }
		]);
		assert.deepEqual(resolveMove(lookup, 0, 2, 'down', nothingCollected), { kind: 'jump', toX: 0, toY: 0, overX: 0, overY: 1 });
		assert.deepEqual(resolveMove(lookup, 0, 0, 'up', nothingCollected), { kind: 'blocked' });
		const side = lookupFrom([{ x: 1, y: 0, tile: ruleTile({ feature: 'ledge', solid: true }) }]);
		assert.deepEqual(resolveMove(side, 0, 0, 'right', nothingCollected), { kind: 'blocked' });
	});

	it('refuses ledge jumps onto solid or ledge landings', () => {
		const solidLanding = lookupFrom([
			{ x: 0, y: 1, tile: ruleTile({ feature: 'ledge', solid: true }) },
			{ x: 0, y: 0, tile: ruleTile({ solid: true, img2: 'rock-1' }) }
		]);
		assert.deepEqual(resolveMove(solidLanding, 0, 2, 'down', nothingCollected), { kind: 'blocked' });
		const doubleLedge = lookupFrom([
			{ x: 0, y: 1, tile: ruleTile({ feature: 'ledge', solid: true }) },
			{ x: 0, y: 0, tile: ruleTile({ feature: 'ledge', solid: true }) }
		]);
		assert.deepEqual(resolveMove(doubleLedge, 0, 2, 'down', nothingCollected), { kind: 'blocked' });
	});

	it('treats collected field items as walkable', () => {
		const itemTile = ruleTile({ feature: 'field-item', img2: 'field-item-1', solid: true });
		const lookup = lookupFrom([{ x: 1, y: 0, tile: itemTile }]);
		assert.deepEqual(resolveMove(lookup, 0, 0, 'right', nothingCollected), { kind: 'blocked' });
		const collected = (key: string) => key === '1,0';
		assert.deepEqual(resolveMove(lookup, 0, 0, 'right', collected), { kind: 'move', toX: 1, toY: 0 });
		assert.equal(isSolidFor({ tile: itemTile, key: '1,0' }, collected), false);
	});

	it('water stays solid on foot but opens up while surfing, and surfers dismount onto land', () => {
		const water = ruleTile({ terrain: 'water', img: 'pond-center-1', solid: true });
		const lookup = lookupFrom([{ x: 1, y: 0, tile: water }]);
		assert.deepEqual(resolveMove(lookup, 0, 0, 'right', nothingCollected), { kind: 'blocked' });
		assert.deepEqual(resolveMove(lookup, 0, 0, 'right', nothingCollected, { surfing: true }), { kind: 'move', toX: 1, toY: 0 });
		const shore = lookupFrom([
			{ x: 1, y: 0, tile: ruleTile({}) },
			{ x: -1, y: 0, tile: ruleTile({ solid: true, feature: 'house' }) }
		]);
		assert.deepEqual(resolveMove(shore, 0, 0, 'right', nothingCollected, { surfing: true }), { kind: 'move', toX: 1, toY: 0 });
		assert.deepEqual(resolveMove(shore, 0, 0, 'left', nothingCollected, { surfing: true }), { kind: 'blocked' });
	});
});

describe('interactions', () => {
	it('offers an item for uncollected field items and nothing afterwards', () => {
		const located = { tile: ruleTile({ feature: 'field-item', solid: true }), key: '2,3', x: 2, y: 3 };
		assert.deepEqual(interactionFor(located, nothingCollected), { type: 'item' });
		assert.deepEqual(
			interactionFor(located, (key) => key === '2,3'),
			{ type: 'none' }
		);
	});

	it('returns deterministic seeded sign, cave and house pages', () => {
		const pages = signPagesFor(320, 640);
		assert.ok(pages.length > 0);
		assert.deepEqual(pages, signPagesFor(320, 640));
		assert.match(pages[0], /^ROUTE \d+/);
		const cave = interactionFor({ tile: ruleTile({ feature: 'cave-entrance' }), key: '0,0', x: 0, y: 0 }, nothingCollected);
		assert.equal(cave.type, 'cave');
		assert.ok(cave.pages!.length > 0);
		assert.deepEqual(cavePagesFor(0, 0), cavePagesFor(0, 0));
		const house = interactionFor({ tile: ruleTile({ feature: 'house' }), key: '0,0', x: 0, y: 0 }, nothingCollected);
		assert.equal(house.type, 'house');
		assert.deepEqual(interactionFor({ tile: ruleTile({ img: 'grass' }), key: '0,0', x: 0, y: 0 }, nothingCollected), { type: 'none' });
		assert.deepEqual(interactionFor(undefined, nothingCollected), { type: 'none' });
	});

	it('detects cave entrances within a 3-tile radius', () => {
		const lookup = lookupFrom([{ x: 3, y: 3, tile: ruleTile({ feature: 'cave-entrance' }) }]);
		assert.equal(isNearCaveEntrance(lookup, 0, 0), true);
		assert.equal(isNearCaveEntrance(lookup, 3, 6), true);
		assert.equal(isNearCaveEntrance(lookup, -1, 0), false);
		assert.equal(isNearCaveEntrance(lookup, 3, 7, 3), false);
	});

	it('replaces {PLAYER} tokens in every page', () => {
		assert.deepEqual(formatDialogPages(['Hi {PLAYER}!', 'Good luck,\n{PLAYER}.'], 'NIKO'), ['Hi NIKO!', 'Good luck,\nNIKO.']);
		assert.deepEqual(formatDialogPages(['No tokens here.'], 'NIKO'), ['No tokens here.']);
	});
});

describe('fieldItemFor', () => {
	it('is deterministic per coordinate and spreads across the table', () => {
		assert.deepEqual(fieldItemFor(320, 640), fieldItemFor(320, 640));
		const seen = new Set<string>();
		for (let index = 0; index < 400; index += 1) seen.add(fieldItemFor(index * 32, index * 96).id);
		assert.ok(seen.size > 3);
		assert.ok(seen.has('poke-ball'));
		assert.equal(fieldItemFor(320, 640, 'pokeball').id, 'poke-ball');
		assert.equal(fieldItemFor(320, 640, 'poke-ball').id, 'poke-ball');
	});
});

// --- Trainer -------------------------------------------------------------------

describe('trainer state', () => {
	it('starts with the Emerald party, bag, badges, and Box 1', () => {
		const state = trainer();
		assert.equal(state.name, 'LOPU');
		assert.equal(state.gender, 'boy');
		assert.equal(state.party[0].speciesId, 252);
		assert.ok(state.pokedex.caught.includes(258));
		assert.deepEqual(
			state.party.map((member: PartyMember) => member.species),
			['TREECKO', 'RALTS', 'ZIGZAGOON']
		);
		assert.deepEqual(
			state.box.map((member: PartyMember) => member.species),
			['MUDKIP', 'TORCHIC', 'WINGULL']
		);
		assert.deepEqual(
			state.party.map((member: PartyMember) => member.level),
			[12, 9, 8]
		);
		assert.ok(
			[...state.party, ...state.box].every((member: PartyMember) => member.sprite.startsWith('https://www.pokeworld.center/sprites/pokemon/gen3/'))
		);
		assert.ok(
			[...state.party, ...state.box].every((member: PartyMember) => member.moves.length > 0 && member.moves.every((move) => move.pp === move.maxPp))
		);
		assert.equal(state.badges.length, 8);
		assert.equal(state.bag.items.find((item: { id: string }) => item.id === 'potion')?.quantity, 3);
		assert.equal(state.bag.pokeballs[0].quantity, 6);
		assert.deepEqual(state.pokedex.seen, [252, 255, 258, 263, 278, 280]);
	});

	it('heals once and does not consume an item when it has no effect', () => {
		const hurt = { ...trainer().party[0], hp: 9 };
		const used = call('pokeworld.useItem', [{ member: hurt, itemId: 'potion' }]);
		assert.equal(used.consumed, true);
		assert.equal(used.member.hp, 29);
		const full = trainer().party[0];
		const unchanged = call('pokeworld.useItem', [{ member: full, itemId: 'potion' }]);
		assert.equal(unchanged.consumed, false);
		assert.deepEqual(unchanged.member, full);
		const rope = call('pokeworld.useItem', [{ member: full, itemId: 'escape-rope' }]);
		assert.equal(rope.consumed, false);
		assert.ok(rope.message.includes('field use'));
		const cured = call('pokeworld.useItem', [{ member: { ...full, status: 'burned' }, itemId: 'full-heal' }]);
		assert.equal(cured.member.status, 'healthy');
	});

	it('rare candies raise one level along the growth curve', () => {
		const member = trainer().party[0];
		const candied = call('pokeworld.useItem', [{ member, itemId: 'rare-candy' }]);
		assert.equal(candied.consumed, true);
		assert.equal(candied.member.level, 13);
		assert.equal(candied.member.exp, expForLevel('medium-slow', 13));
		assert.equal(candied.member.maxHp, calcStats(getSpecies(252)!.baseStats, 13).hp);
		assert.equal(candied.member.hp, member.hp + (candied.member.maxHp - member.maxHp));
	});

	it('grants defeat experience with level-ups keeping the hp delta', () => {
		const member = trainer().party[0];
		const gained = call('pokeworld.expGain', [{ member, defeatedSpeciesId: 263, defeatedLevel: 5 }]);
		assert.equal(gained.gained, expGainForDefeat(getSpecies(263)!, 5));
		assert.equal(gained.member.exp, member.exp + gained.gained);
		assert.equal(gained.leveledUp, false);
		const big = call('pokeworld.expGain', [{ member: { ...member, hp: 10 }, defeatedSpeciesId: 383, defeatedLevel: 70 }]);
		assert.equal(big.leveledUp, true);
		assert.ok(big.newLevel > 12);
		assert.equal(big.member.hp, 10 + (big.member.maxHp - member.maxHp));
	});

	it('exposes badges, items and level lookups', () => {
		const badges = call('pokeworld.badges');
		assert.equal(badges.length, 8);
		assert.deepEqual(badges[0], { id: 'stone', name: 'STONE BADGE', color: '#a8a878', earned: false });
		const items = call('pokeworld.items');
		assert.deepEqual(items.map((item: { id: string }) => item.id).sort(), [
			'antidote',
			'escape-rope',
			'full-heal',
			'great-ball',
			'max-revive',
			'nugget',
			'poke-ball',
			'potion',
			'rare-candy',
			'revive',
			'super-potion',
			'ultra-ball'
		]);
		assert.ok(
			items.every(
				(item: { pocket: string; kind: string }) =>
					['items', 'pokeballs', 'keyItems'].includes(item.pocket) && ['heal', 'status', 'utility'].includes(item.kind)
			)
		);
		assert.equal(call('pokeworld.levelFor', ['medium', 1_000_000]), 100);
		assert.equal(call('pokeworld.levelFor', ['erratic', 0]), 1);
		assert.throws(() => call('pokeworld.levelFor', ['medium', -1]), /non-negative/);
	});

	it('builds new party members with rolled gender and level-appropriate moves', () => {
		const member = call('pokeworld.newPokemon', [{ speciesId: 25, level: 20, nickname: 'Sparky' }], seq(0.9));
		assert.match(member.id, /^pm-[0-9a-z]+-[0-9a-z]{6}$/);
		assert.equal(member.species, 'PIKACHU');
		assert.equal(member.nickname, 'Sparky');
		assert.equal(member.gender, 'male'); // 4/8 female, roll 0.9 → male
		assert.equal(member.level, 20);
		assert.equal(member.exp, expForLevel('medium', 20));
		assert.deepEqual(member.stats, calcStats(getSpecies(25)!.baseStats, 20));
		assert.equal(member.hp, member.maxHp);
		assert.equal(member.status, 'healthy');
		assert.equal(member.spriteBack, 'https://www.pokeworld.center/sprites/pokemon/gen3/back/25.png');
		assert.ok(member.moves.some((move: { name: string }) => move.name === 'SPARK'));
		const genderless = call('pokeworld.newPokemon', [{ speciesId: 81, level: 5 }]);
		assert.equal(genderless.gender, 'genderless');
		const shiny = call('pokeworld.newPokemon', [{ speciesId: 'treecko', level: 5, shiny: true, ivs: 31 }]);
		assert.equal(shiny.sprite, 'https://www.pokeworld.center/sprites/pokemon/gen3/shiny/252.png');
		assert.deepEqual(shiny.stats, calcStats(getSpecies(252)!.baseStats, 5, 31));
		assert.deepEqual(call('pokeworld.stats', [{ speciesId: 150, level: 100, ivs: 0 }]), {
			stats: calcStats(getSpecies(150)!.baseStats, 100, 0),
			maxHp: 2 * 106 + 110
		});
		assert.throws(() => call('pokeworld.newPokemon', [{ speciesId: 999, level: 5 }]), /known species/);
	});
});

// --- World ---------------------------------------------------------------------

const SAMPLE_BLOCKS: Array<[number, number]> = [
	[0, 0],
	[1, 0],
	[0, 1],
	[-1, -1],
	[5, 7],
	[12, -3],
	[-40, 22],
	[100, 100],
	[473261, 244376],
	[473262, 244376],
	[7, 7],
	[8, 7],
	[9, 9],
	[-9, 9],
	[3, -12],
	[64, 64],
	[65, 64],
	[2048, 1],
	[-2048, -1],
	[31, 17]
];

const KNOWN_IMG =
	/^(grass|grass-2|tree-1|tree-grand-[1-4]|rock-1|boulder-mossy-1|flower-[1-3]|route-sign-1|rocky-1|cave-door-1|house-red-([1-9]|1[0-2])|path-[1-9]|pond-[1-9]|pond-2[0145]|pond-center-[1-4])$/;

const walkable = (tile: WorldTile | undefined) => !!tile && !tile.solid;

const reachesPortal = (block: WorldBlock): boolean => {
	const seen = new Set<string>();
	const queue: Array<[number, number]> = [[8, 8]];
	seen.add('8,8');
	while (queue.length) {
		const [x, y] = queue.shift()!;
		const tile = tileAt(block, x, y);
		if (!walkable(tile)) continue;
		if ((x === 0 || y === 0 || x === 15 || y === 15) && tile!.terrain === 'path') return true;
		for (const [dx, dy] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		]) {
			const key = `${x + dx},${y + dy}`;
			if (!seen.has(key) && walkable(tileAt(block, x + dx, y + dy))) {
				seen.add(key);
				queue.push([x + dx, y + dy]);
			}
		}
	}
	return false;
};

describe('world generator', () => {
	it('is deterministic and returns 256 tiles in row-major order', () => {
		const first = generateBlock(3, 4);
		const second = call('pokeworld.block', [3, 4]);
		assert.deepEqual(first, second);
		assert.equal(first.tiles.length, 256);
		first.tiles.forEach((tile, index) => {
			assert.equal(tile.x, index % BLOCK_TILES);
			assert.equal(tile.y, Math.floor(index / BLOCK_TILES));
			assert.match(tile.img, KNOWN_IMG);
			if (tile.img2) assert.match(tile.img2, KNOWN_IMG);
		});
		assert.ok(BIOMES.includes(first.biome));
		// Returned blocks are independent copies.
		second.tiles[0].img = 'mutated';
		assert.equal(generateBlock(3, 4).tiles[0].img, first.tiles[0].img);
	});

	it('agrees with every neighbour at the seam portals', () => {
		for (const [bx, by] of SAMPLE_BLOCKS) {
			const block = generateBlock(bx, by);
			const east = generateBlock(bx + 1, by);
			const north = generateBlock(bx, by + 1);
			const edgeRows = (candidate: WorldBlock, x: number) =>
				candidate.tiles.filter((tile) => tile.x === x && tile.terrain === 'path').map((tile) => tile.y);
			const edgeCols = (candidate: WorldBlock, y: number) =>
				candidate.tiles.filter((tile) => tile.y === y && tile.terrain === 'path').map((tile) => tile.x);
			const portals = portalsFor(bx, by);
			assert.deepEqual(edgeRows(block, 15), [portals.east, portals.east + 1], `east portal ${bx},${by}`);
			assert.deepEqual(edgeRows(east, 0), edgeRows(block, 15), `vertical seam ${bx},${by}`);
			assert.deepEqual(edgeCols(north, 0), edgeCols(block, 15), `horizontal seam ${bx},${by}`);
			assert.deepEqual(edgeCols(block, 15), portals.north === null ? [] : [portals.north, portals.north + 1]);
			// Water never touches the border ring, so ponds always close inside a block.
			assert.ok(block.tiles.every((tile) => tile.terrain !== 'water' || (tile.x > 0 && tile.x < 15 && tile.y > 0 && tile.y < 15)));
		}
	});

	it('keeps the spawn walkable and connected to a portal, with grass and a path in every block', () => {
		for (const [bx, by] of SAMPLE_BLOCKS) {
			const block = generateBlock(bx, by);
			assert.ok(walkable(tileAt(block, 8, 8)), `spawn ${bx},${by}`);
			assert.ok(reachesPortal(block), `portal reachable ${bx},${by}`);
			assert.ok(
				block.tiles.some((tile) => tile.feature === 'long-grass' && tile.img2 === 'grass-2' && !tile.solid),
				`long grass ${bx},${by}`
			);
			assert.ok(
				block.tiles.some((tile) => tile.terrain === 'path' && /^path-[1-9]$/.test(tile.img) && !tile.solid),
				`path ${bx},${by}`
			);
		}
	});

	it('always draws ponds as 2×2-composable water with solid pond autotiles', () => {
		let waterTiles = 0;
		for (const [bx, by] of SAMPLE_BLOCKS) {
			const block = generateBlock(bx, by);
			const water = (x: number, y: number) => tileAt(block, x, y)?.terrain === 'water';
			for (const tile of block.tiles) {
				if (tile.terrain !== 'water') continue;
				waterTiles += 1;
				assert.equal(tile.solid, true);
				assert.match(tile.img, /^pond-/);
				const inSquare = [
					[1, 1],
					[1, -1],
					[-1, 1],
					[-1, -1]
				].some(([dx, dy]) => water(tile.x + dx, tile.y) && water(tile.x, tile.y + dy) && water(tile.x + dx, tile.y + dy));
				assert.ok(inSquare, `water ${bx},${by}:${tile.x},${tile.y} sits in a 2×2 square`);
			}
		}
		assert.ok(waterTiles > 0, 'the sample contains ponds');
	});

	it('places complete 3×4 houses, cave aprons, signs beside the path and hidden items', () => {
		let houses = 0;
		let caves = 0;
		let signs = 0;
		let hidden = 0;
		for (let bx = -6; bx <= 6; bx += 1) {
			for (let by = -6; by <= 6; by += 1) {
				const block = generateBlock(bx, by);
				const anchor = block.tiles.find((tile) => tile.img2 === 'house-red-1');
				if (anchor) {
					houses += 1;
					for (let index = 0; index < 12; index += 1) {
						const tile = tileAt(block, anchor.x + (index % 3), anchor.y - Math.floor(index / 3));
						assert.equal(tile?.img2, `house-red-${index + 1}`);
						assert.equal(tile?.feature, 'house');
						assert.equal(tile?.solid, true);
					}
					assert.ok(walkable(tileAt(block, anchor.x + 1, anchor.y - 4)), 'doorstep is walkable');
				}
				const door = block.tiles.find((tile) => tile.feature === 'cave-entrance');
				if (door) {
					caves += 1;
					assert.equal(door.img, 'rocky-1');
					assert.equal(door.img2, 'cave-door-1');
					assert.equal(door.solid, false);
					assert.equal(tileAt(block, door.x, door.y - 1)?.feature, 'rocky-ground');
				}
				for (const sign of block.tiles.filter((tile) => tile.feature === 'sign')) {
					signs += 1;
					assert.equal(sign.solid, true);
					assert.ok(
						[
							[1, 0],
							[-1, 0],
							[0, 1],
							[0, -1]
						].some(([dx, dy]) => tileAt(block, sign.x + dx, sign.y + dy)?.terrain === 'path')
					);
				}
				hidden += block.tiles.filter((tile) => tile.feature === 'hidden-item' && !tile.solid).length;
			}
		}
		assert.ok(houses > 0, 'some blocks have houses');
		assert.ok(caves > 0, 'some blocks have caves');
		assert.ok(signs > 0, 'some blocks have signs');
		assert.ok(hidden > 0, 'some blocks hide items');
	});

	it('maps coordinates onto Mercator blocks (zoom 19, scale 2, width 512)', () => {
		const melbourne = call('pokeworld.blockFor', [-37.8136, 144.9631]);
		assert.deepEqual(melbourne, blockForCoordinates(-37.8136, 144.9631));
		assert.deepEqual(melbourne, { blockX: 473261, blockY: 244376 });
		const sydney = call('pokeworld.blockFor', [-33.8688, 151.2093]);
		assert.ok(sydney.blockX > melbourne.blockX && sydney.blockY > melbourne.blockY);
		assert.deepEqual(call('pokeworld.blockFor', [-90, -180]), { blockX: 0, blockY: 0 });
		assert.throws(() => call('pokeworld.blockFor', ['north', 0]), /lat must be a number/);
	});
});

// --- View + step ----------------------------------------------------------------

describe('view', () => {
	it('centres a 13×11 viewport on the player, rows north to south', () => {
		const view = call('pokeworld.view', [{ blockX: 0, blockY: 0, x: 8, y: 8, facing: 'left', gender: 'girl' }]);
		assert.equal(view.width, 13);
		assert.equal(view.height, 11);
		assert.equal(view.rows.length, 11);
		assert.ok(view.rows.every((row: unknown[]) => row.length === 13));
		assert.equal(view.rows[0][6].key, tileKey(0, 0, 8, 13));
		assert.equal(view.rows[10][6].key, tileKey(0, 0, 8, 3));
		const player = view.rows[5][6];
		assert.equal(player.isPlayer, true);
		assert.equal(player.key, tileKey(0, 0, 8, 8));
		assert.equal(player.playerUrl, 'https://www.pokeworld.center/sprites/player/girl/side-0.png');
		assert.equal(player.flip, true);
		assert.ok(view.rows.flat().filter((cell: { isPlayer: boolean }) => cell.isPlayer).length === 1);
		assert.ok(view.rows.flat().every((cell: { url: string }) => cell.url.startsWith('https://www.pokeworld.center/tiles/')));
		assert.equal(view.biome, generateBlock(0, 0).biome);
		assert.equal(view.position.playerUrl, player.playerUrl);
	});

	it('spans block seams and clamps the radius', () => {
		const view = call('pokeworld.view', [{ blockX: 0, blockY: 0, x: 0, y: 15, facing: 'up' }, 8, 6]);
		assert.equal(view.width, 17);
		assert.equal(view.height, 13);
		assert.equal(view.rows[0][0].key, tileKey(-1, 1, 8, 5));
		assert.equal(view.rows[6][8].key, tileKey(0, 0, 0, 15));
		assert.equal(view.rows[6][8].playerUrl, 'https://www.pokeworld.center/sprites/player/boy/up-0.png');
		assert.equal(view.rows[6][8].flip, false);
		const seamTile = generateBlock(-1, 0).tiles[15 * 16 + 15];
		assert.equal(view.rows[6][7].url, `https://www.pokeworld.center/tiles/${seamTile.img}.png`);
		assert.throws(() => call('pokeworld.view', [{ blockX: 0, blockY: 0, x: 0, y: 0 }, 9]), /radiusX must be between 1 and 8/);
		assert.throws(() => call('pokeworld.view', [{ blockX: 0, blockY: 0, x: 16, y: 0 }]), /position\.x must be between 0 and 15/);
	});
});

describe('step', () => {
	it('walks across a block seam along the shared portal', () => {
		const portals = portalsFor(0, 0);
		const start = { blockX: 0, blockY: 0, x: 0, y: portals.west, facing: 'down' };
		const step = call('pokeworld.step', [start, 'left']);
		assert.equal(step.outcome, 'move');
		assert.deepEqual(step.position, { blockX: -1, blockY: 0, x: 15, y: portals.west, facing: 'left', surfing: false, gender: 'boy' });
		assert.equal(step.tile.terrain, 'path');
		assert.equal(step.biome, null);
		assert.equal(step.encounterChance, 0);
		const back = call('pokeworld.step', [step.position, 'right']);
		assert.deepEqual(back.position, { ...start, facing: 'right', surfing: false, gender: 'boy' });
	});

	it('stays put but turns to face a solid tile, reading signs and houses', () => {
		const block = generateBlock(0, 0);
		const bump = block.tiles.find((tile) => !tile.solid && tileAt(block, tile.x + 1, tile.y)?.solid);
		assert.ok(bump, 'a walkable tile with a solid east neighbour');
		const step = call('pokeworld.step', [{ blockX: 0, blockY: 0, x: bump!.x, y: bump!.y, facing: 'up' }, 'right']);
		assert.equal(step.outcome, 'blocked');
		assert.deepEqual(step.position, { blockX: 0, blockY: 0, x: bump!.x, y: bump!.y, facing: 'right', surfing: false, gender: 'boy' });
		assert.equal(step.tile.solid, true);
		assert.equal(step.item, null);

		let signStep: any = null;
		let houseStep: any = null;
		for (let bx = -6; bx <= 6 && !(signStep && houseStep); bx += 1) {
			for (let by = -6; by <= 6 && !(signStep && houseStep); by += 1) {
				const candidate = generateBlock(bx, by);
				for (const tile of candidate.tiles) {
					const south = tileAt(candidate, tile.x, tile.y - 1);
					if (!south || south.solid) continue;
					const position = { blockX: bx, blockY: by, x: tile.x, y: tile.y - 1, facing: 'down', name: 'NIKO' };
					if (!signStep && tile.feature === 'sign') signStep = call('pokeworld.step', [position, 'up']);
					if (!houseStep && tile.feature === 'house') houseStep = call('pokeworld.step', [position, 'up']);
				}
			}
		}
		assert.ok(signStep && houseStep, 'found a sign and a house to bump');
		assert.equal(signStep.outcome, 'blocked');
		assert.match(signStep.sign, /^ROUTE \d+/);
		assert.ok(!signStep.sign.includes('{PLAYER}'));
		assert.equal(houseStep.outcome, 'blocked');
		assert.ok(houseStep.house.length > 0);
		assert.equal(houseStep.sign, null);
	});

	it('reports encounter biomes, hidden items and cave mouths on the destination tile', () => {
		let grassStep: any = null;
		let itemStep: any = null;
		let caveStep: any = null;
		let itemKey = '';
		for (let bx = -6; bx <= 6 && !(grassStep && itemStep && caveStep); bx += 1) {
			for (let by = -6; by <= 6 && !(grassStep && itemStep && caveStep); by += 1) {
				const block = generateBlock(bx, by);
				for (const tile of block.tiles) {
					const west = tileAt(block, tile.x - 1, tile.y);
					if (!west || west.solid || tile.solid) continue;
					const position = { blockX: bx, blockY: by, x: tile.x - 1, y: tile.y, facing: 'down' };
					if (!grassStep && tile.feature === 'long-grass') grassStep = call('pokeworld.step', [position, 'right'], seq(0.05));
					if (!itemStep && tile.feature === 'hidden-item') {
						itemKey = tileKey(bx, by, tile.x, tile.y);
						itemStep = call('pokeworld.step', [position, 'right', { [itemKey]: 'poke-ball' }]);
						const fresh = call('pokeworld.step', [position, 'right', []]);
						assert.equal(fresh.itemKey, itemKey);
						assert.deepEqual(fresh.item, {
							id: fieldItemFor(bx * 16 + tile.x, by * 16 + tile.y).id,
							name: fieldItemFor(bx * 16 + tile.x, by * 16 + tile.y).name
						});
					}
					if (!caveStep && tile.feature === 'cave-entrance') caveStep = call('pokeworld.step', [position, 'right'], seq(0.5));
				}
			}
		}
		assert.ok(grassStep && itemStep && caveStep, 'found long grass, a hidden item and a cave mouth');
		assert.equal(grassStep.biome, 'long-grass');
		assert.equal(grassStep.encounterChance, 0.12);
		assert.equal(grassStep.encounterTriggered, true);
		assert.equal(itemStep.item, null, 'collected keys suppress the item');
		assert.equal(itemStep.itemKey, null);
		assert.equal(caveStep.biome, 'cave');
		assert.equal(caveStep.encounterChance, 0.1);
		assert.equal(caveStep.encounterTriggered, false);
		assert.ok(caveStep.cave.length > 0);
	});

	it('validates its arguments with clear messages', () => {
		assert.throws(
			() => call('pokeworld.step', [{ blockX: 0, blockY: 0, x: 8, y: 8 }, 'north']),
			/pokeworld\.step: direction must be up\/down\/left\/right/
		);
		assert.throws(() => call('pokeworld.step', ['here', 'up']), /position must be an object/);
		assert.throws(() => call('pokeworld.battleTurn', [{ player: {}, wild: {} }]), /spec\.player\.speciesId/);
		assert.throws(() => call('pokeworld.species', ['missingno']), /known species/);
		assert.throws(() => call('pokeworld.dex', [1, 500]), /perPage must be between 1 and 200/);
	});
});

// --- Pack surface ----------------------------------------------------------------

describe('pack surface', () => {
	it('exports exactly the documented functions with matching arities', () => {
		assert.deepEqual(Object.keys(pack).sort(), Object.keys(POKEWORLD_PACK_ARITIES).sort());
		for (const [name, arity] of Object.entries(POKEWORLD_PACK_ARITIES)) {
			assert.ok(arity.min >= 0 && arity.max >= arity.min, name);
		}
	});

	it('species and dex return sprite-bearing records', () => {
		const groudon = call('pokeworld.species', ['groudon']);
		assert.equal(groudon.id, 383);
		assert.equal(groudon.sprite, speciesSpriteUrl(383));
		assert.equal(groudon.spriteShiny, speciesSpriteUrl(383, { shiny: true }));
		assert.equal(groudon.spriteBack, speciesSpriteUrl(383, { back: true }));
		assert.equal(groudon.spriteBackShiny, speciesSpriteUrl(383, { back: true, shiny: true }));
		assert.equal(call('pokeworld.species', ['25']).displayName, 'PIKACHU');
		const dex = call('pokeworld.dex');
		assert.deepEqual({ page: dex.page, pages: dex.pages, total: dex.total, perPage: dex.perPage }, { page: 1, pages: 4, total: 386, perPage: 100 });
		assert.equal(dex.entries.length, 100);
		assert.deepEqual(Object.keys(dex.entries[0]).sort(), ['displayName', 'genus', 'id', 'isLegendary', 'name', 'sprite', 'types']);
		const last = call('pokeworld.dex', [2, 200]);
		assert.equal(last.entries.length, 186);
		assert.equal(last.entries[185].id, 386);
	});

	it('every function returns JSON-safe output', () => {
		const player = trainer().party[0];
		const wild = wildOf(263, 5);
		const outputs = [
			call('pokeworld.species', [1]),
			call('pokeworld.dex', [1, 5]),
			call('pokeworld.blockFor', [0, 0]),
			call('pokeworld.block', [0, 0]),
			call('pokeworld.view', [{ blockX: 0, blockY: 0, x: 8, y: 8 }]),
			call('pokeworld.step', [{ blockX: 0, blockY: 0, x: 8, y: 8 }, 'up']),
			call('pokeworld.encounter', [{ biome: 'cave', seed: 1 }]),
			call('pokeworld.newPokemon', [{ speciesId: 1, level: 5 }]),
			call('pokeworld.stats', [{ speciesId: 1, level: 5 }]),
			call('pokeworld.moves', [1, 5]),
			call('pokeworld.battleTurn', [{ player, wild, moveIndex: 0 }]),
			call('pokeworld.catchRoll', [{ player, wild, ball: 'poke-ball' }]),
			call('pokeworld.runRoll', [{ player, wild }]),
			call('pokeworld.useItem', [{ member: player, itemId: 'nugget' }]),
			call('pokeworld.items'),
			call('pokeworld.defaultTrainer'),
			call('pokeworld.badges'),
			call('pokeworld.expGain', [{ member: player, defeatedSpeciesId: 1, defeatedLevel: 5 }]),
			call('pokeworld.levelFor', ['slow', 1000])
		];
		for (const output of outputs) {
			const encoded = JSON.stringify(output);
			assert.ok(encoded.length < 200_000);
			assert.deepEqual(JSON.parse(encoded), output);
		}
	});
});
