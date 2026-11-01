// The Thingmon domain pack: pure, bounded game functions for Thingtime
// actions (schemas/appSuites/thingmon.ts). Every roll goes through
// context.random() so runs are replayable under a pinned generator; every
// function validates its already-resolved args and returns plain JSON-safe
// data of bounded size. The catalogue (schemas/actionExpressions.ts) declares
// each name + arity; packs.test.ts pins the two tables together.

import type { ActionPack, PackContext } from '../types';
import {
	canEvolve,
	catchRoll,
	displayName,
	evolve,
	expGainFor,
	fleeRoll,
	getSpecies,
	grantExp,
	healFully,
	itemById,
	ITEMS,
	LEGENDARY_DEX_THRESHOLD,
	MOVES,
	newCritter,
	normalizeCritter,
	resolveTurn,
	rollEncounter,
	SHAKE_LINES,
	shardsFor,
	SPECIES,
	SPECIES_COUNT,
	STARTER_BAG,
	STARTER_IDS,
	STARTER_SHARDS,
	TYPE_INFO,
	TYPE_KEYS,
	applyItem,
	wildReply,
	ZONES,
	calcStats,
	type Critter,
	type Rng,
	type Species
} from './rules';

export { SPECIES as THINGMON_SPECIES, ZONES as THINGMON_ZONES, ITEMS as THINGMON_ITEMS, TYPE_INFO as THINGMON_TYPES };

export const THINGMON_PACK_ARITIES: Record<string, { min: number; max: number }> = {
	'thingmon.species': { min: 1, max: 1 },
	'thingmon.dex': { min: 0, max: 2 },
	'thingmon.zones': { min: 0, max: 0 },
	'thingmon.items': { min: 0, max: 0 },
	'thingmon.starters': { min: 0, max: 0 },
	'thingmon.typeChart': { min: 0, max: 0 },
	'thingmon.newCritter': { min: 1, max: 1 },
	'thingmon.encounter': { min: 1, max: 1 },
	'thingmon.battleTurn': { min: 1, max: 1 },
	'thingmon.catchRoll': { min: 1, max: 1 },
	'thingmon.fleeRoll': { min: 1, max: 1 },
	'thingmon.wildTurn': { min: 1, max: 1 },
	'thingmon.expGain': { min: 1, max: 1 },
	'thingmon.evolve': { min: 1, max: 1 },
	'thingmon.useItem': { min: 1, max: 1 },
	'thingmon.heal': { min: 1, max: 1 },
	'thingmon.stats': { min: 1, max: 1 }
};

const asObject = (value: unknown, label: string): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} needs an object argument`);
	return value as Record<string, unknown>;
};
const speciesView = (species: Species) => ({ ...species, types: [...species.types], habitats: [...species.habitats], typeEmoji: species.types.map((type) => TYPE_INFO[type].emoji).join(''), typeLine: species.types.join(' / ') });
const critterView = (critter: Critter) => ({ ...critter, name: displayName(critter), hpPercent: Math.round((100 * critter.hp) / Math.max(1, critter.maxHp)), typeLine: critter.types.join(' / '), typeEmoji: critter.types.map((type) => TYPE_INFO[type].emoji).join(''), fainted: critter.hp <= 0, canEvolve: !!canEvolve(critter), evolvesTo: canEvolve(critter)?.name ?? null });

export const thingmonPack: ActionPack = {
	'thingmon.species': ([idOrSlug]) => speciesView(getSpecies(idOrSlug)),
	'thingmon.dex': ([pageArg, perPageArg]) => {
		const perPage = Math.max(1, Math.min(60, Math.round(Number(perPageArg) || 60)));
		const pages = Math.max(1, Math.ceil(SPECIES_COUNT / perPage));
		const page = Math.max(1, Math.min(pages, Math.round(Number(pageArg) || 1)));
		return { page, perPage, pages, total: SPECIES_COUNT, items: SPECIES.slice((page - 1) * perPage, page * perPage).map(speciesView) };
	},
	'thingmon.zones': () => ZONES.map((zone) => ({ ...zone, levels: [...zone.levels] })),
	'thingmon.items': () => ITEMS.map((item) => ({ ...item })),
	'thingmon.starters': () => STARTER_IDS.map((id) => speciesView(getSpecies(id))),
	'thingmon.typeChart': () => ({ types: TYPE_KEYS.map((key) => ({ key, ...TYPE_INFO[key], strong: [...TYPE_INFO[key].strong], resist: [...TYPE_INFO[key].resist] })), moves: MOVES.map((entry) => ({ ...entry })), legendaryDex: LEGENDARY_DEX_THRESHOLD, starterBag: { ...STARTER_BAG }, starterShards: STARTER_SHARDS }),
	'thingmon.newCritter': ([spec], context) => critterView(newCritter(asObject(spec, 'newCritter') as { speciesId: unknown }, context.random)),
	'thingmon.encounter': ([spec], context) => {
		const raw = asObject(spec, 'encounter');
		return critterView(rollEncounter(raw.zone, Math.max(0, Number(raw.dexCaught) || 0), context.random));
	},
	'thingmon.battleTurn': ([spec], context) => {
		const raw = asObject(spec, 'battleTurn');
		const player = normalizeCritter(raw.player, 'battleTurn.player');
		const wild = normalizeCritter(raw.wild, 'battleTurn.wild');
		if (player.hp <= 0) throw new Error(`${displayName(player)} has fainted and cannot fight`);
		const turn = resolveTurn(player, wild, Number(raw.moveIndex) || 0, context.random);
		return { player: critterView(turn.player), wild: critterView(turn.wild), log: turn.log, outcome: turn.outcome, expGained: turn.outcome === 'won' ? expGainFor(turn.wild) : 0, shards: turn.outcome === 'won' ? shardsFor(turn.wild) : 0 };
	},
	'thingmon.catchRoll': ([spec], context) => {
		const raw = asObject(spec, 'catchRoll');
		const player = normalizeCritter(raw.player, 'catchRoll.player');
		const wild = normalizeCritter(raw.wild, 'catchRoll.wild');
		const item = itemById(raw.itemId);
		const roll = catchRoll(wild, item, context.random);
		const log = [`You threw a ${item.name}!`, SHAKE_LINES[roll.shakes]];
		if (roll.caught) return { caught: true, shakes: roll.shakes, chance: roll.chance, log, message: `Gotcha! ${wild.species} joins your team.`, player: critterView(player), wild: critterView(wild), outcome: 'caught' };
		const reply = wildReply(player, wild, context.random, log);
		return { caught: false, shakes: roll.shakes, chance: roll.chance, log: reply.log, message: reply.log.join(' '), player: critterView(reply.player), wild: critterView(reply.wild), outcome: reply.outcome };
	},
	'thingmon.fleeRoll': ([spec], context) => {
		const raw = asObject(spec, 'fleeRoll');
		const player = normalizeCritter(raw.player, 'fleeRoll.player');
		const wild = normalizeCritter(raw.wild, 'fleeRoll.wild');
		const roll = fleeRoll(player, wild, Number(raw.attempts) || 0, context.random);
		if (roll.escaped) return { escaped: true, odds: roll.odds, log: ['You got away safely!'], message: 'You got away safely!', player: critterView(player), wild: critterView(wild), outcome: 'fled' };
		const reply = wildReply(player, wild, context.random, ['You couldn’t get away!']);
		return { escaped: false, odds: roll.odds, log: reply.log, message: reply.log.join(' '), player: critterView(reply.player), wild: critterView(reply.wild), outcome: reply.outcome };
	},
	'thingmon.wildTurn': ([spec], context) => {
		const raw = asObject(spec, 'wildTurn');
		const player = normalizeCritter(raw.player, 'wildTurn.player');
		const wild = normalizeCritter(raw.wild, 'wildTurn.wild');
		const reply = wildReply(player, wild, context.random, []);
		return { log: reply.log, message: reply.log.join(' '), player: critterView(reply.player), wild: critterView(reply.wild), outcome: reply.outcome };
	},
	'thingmon.expGain': ([spec]) => {
		const raw = asObject(spec, 'expGain');
		const member = normalizeCritter(raw.member, 'expGain.member');
		const amount = typeof raw.amount === 'number' ? raw.amount : raw.defeated ? expGainFor(normalizeCritter(raw.defeated, 'expGain.defeated')) : 0;
		const grant = grantExp(member, amount);
		const next = canEvolve(grant.critter);
		// what was actually banked, not what was asked for — experience stops at
		// the level cap, and the app narrates this number back to the player
		return { member: critterView(grant.critter), gained: grant.critter.exp - member.exp, leveledUp: grant.leveledUp, from: grant.from, to: grant.to, canEvolve: !!next, evolvesTo: next?.name ?? null };
	},
	'thingmon.evolve': ([member]) => {
		const result = evolve(normalizeCritter(member, 'evolve'));
		return { member: critterView(result.critter), from: result.from, to: result.to, message: `What? ${result.from} is evolving… it became ${result.to}!` };
	},
	'thingmon.useItem': ([spec]) => {
		const raw = asObject(spec, 'useItem');
		const result = applyItem(normalizeCritter(raw.member, 'useItem.member'), itemById(raw.itemId), raw.inBattle === true);
		return { member: critterView(result.critter), message: result.message, consumed: result.consumed };
	},
	'thingmon.heal': ([member]) => critterView(healFully(normalizeCritter(member, 'heal'))),
	'thingmon.stats': ([spec]) => {
		const raw = asObject(spec, 'stats');
		return calcStats(getSpecies(raw.speciesId), Number(raw.level) || 1, typeof raw.iv === 'number' ? raw.iv : undefined);
	}
};

export const thingmonPackContext = (random: Rng, now: () => Date = () => new Date()): PackContext => ({ random, now });

// The species catalogue as PUBLIC DATA THINGS (seeded through the suite's
// `content` by api/utils/webpages/seed.ts as data-app-thingmon-species-<id>):
// the record `thingmon.species` answers with, browsable on /things and
// searchable in `system` scope from the dex page.
export const THINGMON_SPECIES_SEED = SPECIES.map(speciesView);
