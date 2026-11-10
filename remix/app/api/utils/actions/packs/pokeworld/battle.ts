// Wild-battle engine, ported from the Pokeworld app (src/lib/battle.ts):
// Gen III damage formula, type chart + STAB, crits, status gates and chip,
// the Gen III capture/shake formula, run-away odds, PP, in-battle items and
// experience with growth-curve level-ups. The party-switching state machine
// of the original is replaced by per-turn transforms over one player record
// and one wild record, which is what the action pack exposes. Every roll goes
// through the injected `Rng`.

import { calcStats, expGainForDefeat, getSpecies, levelForExp, typeEffectiveness, type PokemonGender, type Rng, type StatBlock } from './pokedex';
import { memberDisplayName, memberIv, type PartyMember, type StatusCondition } from './trainer';

// --- Moves ------------------------------------------------------------------

export interface BattleMove {
	id: string;
	name: string;
	type: string;
	power: number;
	/** null = never misses */
	accuracy: number | null;
	pp: number;
	maxPp: number;
	/** Chance (0-1) to inflict `inflicts` on the target. */
	effectChance?: number;
	inflicts?: Exclude<StatusCondition, 'healthy'>;
}

interface MoveSpec {
	name: string;
	power: number;
	accuracy: number | null;
	minLevel: number;
	pp: number;
	effectChance?: number;
	inflicts?: Exclude<StatusCondition, 'healthy'>;
}

export const MOVE_LIBRARY: Record<string, MoveSpec[]> = {
	NORMAL: [
		{ name: 'TACKLE', power: 35, accuracy: 95, minLevel: 1, pp: 35 },
		{ name: 'HEADBUTT', power: 70, accuracy: 100, minLevel: 12, pp: 15 },
		{ name: 'BODY SLAM', power: 85, accuracy: 100, minLevel: 24, pp: 15, effectChance: 0.3, inflicts: 'paralyzed' },
		{ name: 'DOUBLE-EDGE', power: 120, accuracy: 100, minLevel: 38, pp: 15 }
	],
	FIRE: [
		{ name: 'EMBER', power: 40, accuracy: 100, minLevel: 1, pp: 25, effectChance: 0.1, inflicts: 'burned' },
		{ name: 'FLAME WHEEL', power: 60, accuracy: 100, minLevel: 14, pp: 25, effectChance: 0.1, inflicts: 'burned' },
		{ name: 'FLAMETHROWER', power: 95, accuracy: 100, minLevel: 28, pp: 15, effectChance: 0.1, inflicts: 'burned' },
		{ name: 'FIRE BLAST', power: 120, accuracy: 85, minLevel: 42, pp: 5, effectChance: 0.1, inflicts: 'burned' }
	],
	WATER: [
		{ name: 'WATER GUN', power: 40, accuracy: 100, minLevel: 1, pp: 25 },
		{ name: 'BUBBLEBEAM', power: 65, accuracy: 100, minLevel: 14, pp: 20 },
		{ name: 'SURF', power: 95, accuracy: 100, minLevel: 28, pp: 15 },
		{ name: 'HYDRO PUMP', power: 120, accuracy: 80, minLevel: 42, pp: 5 }
	],
	GRASS: [
		{ name: 'ABSORB', power: 20, accuracy: 100, minLevel: 1, pp: 25 },
		{ name: 'MEGA DRAIN', power: 40, accuracy: 100, minLevel: 10, pp: 15 },
		{ name: 'RAZOR LEAF', power: 55, accuracy: 95, minLevel: 18, pp: 25 },
		{ name: 'PETAL DANCE', power: 70, accuracy: 100, minLevel: 30, pp: 20 },
		{ name: 'SOLARBEAM', power: 120, accuracy: 100, minLevel: 44, pp: 10 }
	],
	ELECTRIC: [
		{ name: 'THUNDERSHOCK', power: 40, accuracy: 100, minLevel: 1, pp: 30, effectChance: 0.1, inflicts: 'paralyzed' },
		{ name: 'SPARK', power: 65, accuracy: 100, minLevel: 16, pp: 20, effectChance: 0.3, inflicts: 'paralyzed' },
		{ name: 'THUNDERBOLT', power: 95, accuracy: 100, minLevel: 30, pp: 15, effectChance: 0.1, inflicts: 'paralyzed' },
		{ name: 'THUNDER', power: 120, accuracy: 70, minLevel: 44, pp: 10, effectChance: 0.3, inflicts: 'paralyzed' }
	],
	ICE: [
		{ name: 'POWDER SNOW', power: 40, accuracy: 100, minLevel: 1, pp: 25, effectChance: 0.1, inflicts: 'frozen' },
		{ name: 'AURORA BEAM', power: 65, accuracy: 100, minLevel: 16, pp: 20 },
		{ name: 'ICE BEAM', power: 95, accuracy: 100, minLevel: 30, pp: 10, effectChance: 0.1, inflicts: 'frozen' },
		{ name: 'BLIZZARD', power: 120, accuracy: 70, minLevel: 44, pp: 5, effectChance: 0.1, inflicts: 'frozen' }
	],
	FIGHTING: [
		{ name: 'KARATE CHOP', power: 50, accuracy: 100, minLevel: 1, pp: 25 },
		{ name: 'BRICK BREAK', power: 75, accuracy: 100, minLevel: 20, pp: 15 },
		{ name: 'CROSS CHOP', power: 100, accuracy: 80, minLevel: 38, pp: 5 }
	],
	POISON: [
		{ name: 'POISON STING', power: 15, accuracy: 100, minLevel: 1, pp: 35, effectChance: 0.3, inflicts: 'poisoned' },
		{ name: 'ACID', power: 40, accuracy: 100, minLevel: 8, pp: 30 },
		{ name: 'SLUDGE', power: 65, accuracy: 100, minLevel: 20, pp: 20, effectChance: 0.3, inflicts: 'poisoned' },
		{ name: 'SLUDGE BOMB', power: 90, accuracy: 100, minLevel: 36, pp: 10, effectChance: 0.3, inflicts: 'poisoned' }
	],
	GROUND: [
		{ name: 'MUD-SLAP', power: 20, accuracy: 100, minLevel: 1, pp: 10 },
		{ name: 'MUD SHOT', power: 55, accuracy: 95, minLevel: 15, pp: 15 },
		{ name: 'DIG', power: 60, accuracy: 100, minLevel: 24, pp: 10 },
		{ name: 'EARTHQUAKE', power: 100, accuracy: 100, minLevel: 40, pp: 10 }
	],
	FLYING: [
		{ name: 'PECK', power: 35, accuracy: 100, minLevel: 1, pp: 35 },
		{ name: 'WING ATTACK', power: 60, accuracy: 100, minLevel: 16, pp: 35 },
		{ name: 'AERIAL ACE', power: 60, accuracy: null, minLevel: 22, pp: 20 },
		{ name: 'DRILL PECK', power: 80, accuracy: 100, minLevel: 34, pp: 20 }
	],
	PSYCHIC: [
		{ name: 'CONFUSION', power: 50, accuracy: 100, minLevel: 1, pp: 25 },
		{ name: 'PSYBEAM', power: 65, accuracy: 100, minLevel: 18, pp: 20 },
		{ name: 'PSYCHIC', power: 90, accuracy: 100, minLevel: 34, pp: 10 }
	],
	BUG: [
		{ name: 'LEECH LIFE', power: 20, accuracy: 100, minLevel: 1, pp: 15 },
		{ name: 'SILVER WIND', power: 60, accuracy: 100, minLevel: 22, pp: 5 },
		{ name: 'MEGAHORN', power: 120, accuracy: 85, minLevel: 42, pp: 10 }
	],
	ROCK: [
		{ name: 'ROCK THROW', power: 50, accuracy: 90, minLevel: 1, pp: 15 },
		{ name: 'ANCIENTPOWER', power: 60, accuracy: 100, minLevel: 16, pp: 5 },
		{ name: 'ROCK SLIDE', power: 75, accuracy: 90, minLevel: 26, pp: 10 }
	],
	GHOST: [
		{ name: 'LICK', power: 20, accuracy: 100, minLevel: 1, pp: 30, effectChance: 0.3, inflicts: 'paralyzed' },
		{ name: 'SHADOW PUNCH', power: 60, accuracy: null, minLevel: 18, pp: 20 },
		{ name: 'SHADOW BALL', power: 80, accuracy: 100, minLevel: 32, pp: 15 }
	],
	DRAGON: [
		{ name: 'DRAGONBREATH', power: 60, accuracy: 100, minLevel: 1, pp: 20, effectChance: 0.3, inflicts: 'paralyzed' },
		{ name: 'DRAGON CLAW', power: 80, accuracy: 100, minLevel: 30, pp: 15 },
		{ name: 'OUTRAGE', power: 90, accuracy: 100, minLevel: 45, pp: 15 }
	],
	DARK: [
		{ name: 'BITE', power: 60, accuracy: 100, minLevel: 1, pp: 25 },
		{ name: 'FAINT ATTACK', power: 60, accuracy: null, minLevel: 18, pp: 20 },
		{ name: 'CRUNCH', power: 80, accuracy: 100, minLevel: 32, pp: 15 }
	],
	STEEL: [
		{ name: 'METAL CLAW', power: 50, accuracy: 95, minLevel: 1, pp: 35 },
		{ name: 'IRON TAIL', power: 100, accuracy: 75, minLevel: 30, pp: 15 },
		{ name: 'METEOR MASH', power: 100, accuracy: 85, minLevel: 40, pp: 10 }
	]
};

// Gen III: damage category is decided by the move's TYPE, not the move.
const SPECIAL_TYPES = new Set(['FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK']);

export const isSpecialType = (type: string): boolean => SPECIAL_TYPES.has(type.toUpperCase());

const moveId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const toBattleMove = (spec: MoveSpec, type: string): BattleMove => {
	const move: BattleMove = {
		id: moveId(spec.name),
		name: spec.name,
		type,
		power: spec.power,
		accuracy: spec.accuracy,
		pp: spec.pp,
		maxPp: spec.pp
	};
	if (spec.inflicts) {
		move.inflicts = spec.inflicts;
		move.effectChance = spec.effectChance;
	}
	return move;
};

/** Deterministic level-appropriate moveset: best STAB tiers + NORMAL filler. */
export function movesFor(types: string[], level: number): BattleMove[] {
	const stab: BattleMove[] = [];
	for (const type of types) {
		const pool = MOVE_LIBRARY[type.toUpperCase()];
		if (!pool) continue;
		const available = pool.filter((spec) => spec.minLevel <= level);
		for (const spec of available.slice(-2)) stab.push(toBattleMove(spec, type.toUpperCase()));
	}
	const normals = (MOVE_LIBRARY.NORMAL ?? []).filter((spec) => spec.minLevel <= level).map((spec) => toBattleMove(spec, 'NORMAL'));
	const moves: BattleMove[] = [];
	const seen = new Set<string>();
	for (const move of [...stab, ...normals.slice(-2).reverse()]) {
		if (seen.has(move.id) || moves.length >= 4) continue;
		seen.add(move.id);
		moves.push(move);
	}
	if (!moves.length) moves.push(toBattleMove(MOVE_LIBRARY.NORMAL[0], 'NORMAL'));
	return moves;
}

export const STRUGGLE: BattleMove = {
	id: 'struggle',
	name: 'STRUGGLE',
	type: 'NORMAL',
	power: 50,
	accuracy: 100,
	pp: Number.POSITIVE_INFINITY,
	maxPp: Number.POSITIVE_INFINITY
};

// --- Combatants ---------------------------------------------------------------

export interface BattleMon {
	/** Trainer party member id, or "wild". */
	memberId: string;
	speciesId: number;
	name: string;
	level: number;
	exp: number;
	types: string[];
	stats: StatBlock;
	hp: number;
	maxHp: number;
	status: StatusCondition;
	sleepTurns: number;
	moves: BattleMove[];
	gender?: PokemonGender;
	shiny?: boolean;
}

export function battleMonFromMember(member: PartyMember, wild = false): BattleMon {
	return {
		memberId: wild ? 'wild' : member.id,
		speciesId: member.speciesId,
		name: wild ? member.species : memberDisplayName(member),
		level: member.level,
		exp: member.exp,
		types: member.types,
		stats: { ...member.stats, hp: member.maxHp },
		hp: member.hp,
		maxHp: member.maxHp,
		status: member.status,
		sleepTurns: member.status === 'asleep' ? member.sleepTurns ?? 1 : 0,
		moves: member.moves.map((move) => ({ ...move })),
		gender: member.gender,
		shiny: member.shiny
	};
}

/** Folds a battle copy back onto its party-member record (hp, status, exp, level, stats, moves). */
export function memberFromBattleMon(member: PartyMember, mon: BattleMon): PartyMember {
	const next: PartyMember = {
		...member,
		hp: mon.hp,
		maxHp: mon.maxHp,
		status: mon.status,
		exp: Math.max(member.exp, mon.exp),
		level: Math.max(member.level, mon.level),
		stats: mon.stats,
		moves: mon.moves.filter((move) => Number.isFinite(move.pp))
	};
	if (mon.status === 'asleep') next.sleepTurns = mon.sleepTurns;
	else delete next.sleepTurns;
	return next;
}

// --- Turn resolution ------------------------------------------------------------

const STATUS_LABEL: Record<Exclude<StatusCondition, 'healthy'>, string> = {
	poisoned: 'poisoned',
	paralyzed: 'paralyzed',
	asleep: 'fast asleep',
	burned: 'burned',
	frozen: 'frozen solid'
};

export const effectiveSpeed = (mon: BattleMon): number => (mon.status === 'paralyzed' ? Math.floor(mon.stats.spe / 4) : mon.stats.spe);

const effectiveAttack = (mon: BattleMon, special: boolean): number => {
	const base = special ? mon.stats.spa : mon.stats.atk;
	return !special && mon.status === 'burned' ? Math.floor(base / 2) : base;
};

const labelOf = (mon: BattleMon) => (mon.memberId === 'wild' ? `Wild ${mon.name}` : mon.name);

interface StrikeResult {
	target: BattleMon;
	attacker: BattleMon;
	messages: string[];
}

export function strike(attacker: BattleMon, target: BattleMon, move: BattleMove, rng: Rng): StrikeResult {
	const messages: string[] = [];
	const attackerName = labelOf(attacker);
	const targetName = labelOf(target);

	// Pre-move status gates.
	let mutableAttacker = attacker;
	if (attacker.status === 'asleep') {
		if (attacker.sleepTurns <= 0) {
			mutableAttacker = { ...attacker, status: 'healthy' };
			messages.push(`${attackerName} woke up!`);
		} else {
			return {
				attacker: { ...attacker, sleepTurns: attacker.sleepTurns - 1 },
				target,
				messages: [`${attackerName} is fast asleep.`]
			};
		}
	}
	if (mutableAttacker.status === 'frozen') {
		if (rng() < 0.2) {
			mutableAttacker = { ...mutableAttacker, status: 'healthy' };
			messages.push(`${attackerName} thawed out!`);
		} else {
			return { attacker: mutableAttacker, target, messages: [...messages, `${attackerName} is frozen solid!`] };
		}
	}
	if (mutableAttacker.status === 'paralyzed' && rng() < 0.25) {
		return { attacker: mutableAttacker, target, messages: [...messages, `${attackerName} is paralyzed! It can't move!`] };
	}

	messages.push(`${attackerName} used ${move.name}!`);
	if (move.accuracy !== null && rng() * 100 >= move.accuracy) {
		return { attacker: mutableAttacker, target, messages: [...messages, `${attackerName}'s attack missed!`] };
	}

	const special = isSpecialType(move.type);
	const effectiveness = typeEffectiveness(move.type, target.types);
	if (effectiveness === 0) {
		return {
			attacker: mutableAttacker,
			target,
			messages: [...messages, `It doesn't affect ${targetName}...`]
		};
	}
	const stab = mutableAttacker.types.some((type) => type.toUpperCase() === move.type) ? 1.5 : 1;
	const crit = rng() < 1 / 16 ? 2 : 1;
	const attack = effectiveAttack(mutableAttacker, special);
	const defense = special ? target.stats.spd : target.stats.def;
	const base = Math.floor((Math.floor((2 * mutableAttacker.level) / 5 + 2) * move.power * attack) / Math.max(1, defense) / 50) + 2;
	const randomFactor = 0.85 + rng() * 0.15;
	const damage = Math.max(1, Math.floor(base * stab * effectiveness * crit * randomFactor));
	let nextTarget = { ...target, hp: Math.max(0, target.hp - damage) };
	if (crit > 1) messages.push('A critical hit!');
	if (effectiveness > 1) messages.push("It's super effective!");
	if (effectiveness < 1) messages.push("It's not very effective...");

	if (
		move.inflicts &&
		nextTarget.hp > 0 &&
		nextTarget.status === 'healthy' &&
		rng() < (move.effectChance ?? 0) &&
		!(move.inflicts === 'burned' && nextTarget.types.includes('FIRE')) &&
		!(move.inflicts === 'poisoned' && (nextTarget.types.includes('POISON') || nextTarget.types.includes('STEEL'))) &&
		!(move.inflicts === 'frozen' && nextTarget.types.includes('ICE')) &&
		!(move.inflicts === 'paralyzed' && nextTarget.types.includes('ELECTRIC'))
	) {
		nextTarget = {
			...nextTarget,
			status: move.inflicts,
			sleepTurns: move.inflicts === 'asleep' ? 1 + Math.floor(rng() * 3) : 0
		};
		messages.push(`${targetName} was ${STATUS_LABEL[move.inflicts]}!`);
	}
	return { attacker: mutableAttacker, target: nextTarget, messages };
}

function endOfTurnStatus(mon: BattleMon): { mon: BattleMon; messages: string[] } {
	if (mon.hp <= 0) return { mon, messages: [] };
	if (mon.status === 'poisoned' || mon.status === 'burned') {
		const chip = Math.max(1, Math.floor(mon.maxHp / 8));
		return {
			mon: { ...mon, hp: Math.max(0, mon.hp - chip) },
			messages: [`${labelOf(mon)} is hurt by ${mon.status === 'poisoned' ? 'poison' : 'its burn'}!`]
		};
	}
	return { mon, messages: [] };
}

export const wildPickMove = (wild: BattleMon, rng: Rng): BattleMove => {
	const usable = wild.moves.filter((move) => move.pp > 0);
	if (!usable.length) return STRUGGLE;
	return usable[Math.floor(rng() * usable.length)];
};

export const decrementPp = (mon: BattleMon, id: string): BattleMon => ({
	...mon,
	moves: mon.moves.map((move) => (move.id === id && Number.isFinite(move.pp) ? { ...move, pp: Math.max(0, move.pp - 1) } : move))
});

export interface ExpGrant {
	mon: BattleMon;
	gained: number;
	leveledUp: boolean;
	newLevel: number;
}

/** Grants exp for the defeated wild mon to the player's mon, with level-ups. */
export function grantBattleExp(active: BattleMon, wild: BattleMon, messages: string[], iv = 15): ExpGrant | null {
	const species = getSpecies(wild.speciesId);
	const activeSpecies = getSpecies(active.speciesId);
	if (!species || !activeSpecies || active.hp <= 0) return null;
	const gained = expGainForDefeat(species, wild.level);
	messages.push(`${active.name} gained ${gained} EXP. Points!`);
	const exp = active.exp + gained;
	let level = active.level;
	const targetLevel = Math.max(level, levelForExp(activeSpecies.growthRate, exp));
	let stats = active.stats;
	let hp = active.hp;
	let maxHp = active.maxHp;
	if (targetLevel > level) {
		stats = calcStats(activeSpecies.baseStats, targetLevel, iv);
		const gainedHp = Math.max(0, stats.hp - maxHp);
		maxHp = stats.hp;
		hp = Math.min(maxHp, hp + gainedHp);
		messages.push(`${active.name} grew to LV. ${targetLevel}!`);
		level = targetLevel;
	}
	const mon: BattleMon = {
		...active,
		exp,
		level,
		stats,
		hp,
		maxHp,
		moves: level > active.level ? movesFor(active.types, level) : active.moves
	};
	return { mon, gained, leveledUp: level > active.level, newLevel: level };
}

// Gen III capture formula.
export const BALL_BONUS: Record<string, number> = {
	'poke-ball': 1,
	'great-ball': 1.5,
	'ultra-ball': 2
};

export const STATUS_CATCH_BONUS: Record<StatusCondition, number> = {
	healthy: 1,
	poisoned: 1.5,
	paralyzed: 1.5,
	burned: 1.5,
	asleep: 2,
	frozen: 2
};

export function catchAttempt(wild: BattleMon, ballId: string, rng: Rng): { caught: boolean; shakes: number } {
	const species = getSpecies(wild.speciesId);
	const rate = species?.catchRate ?? 45;
	const ballBonus = BALL_BONUS[ballId] ?? 1;
	const a = Math.min(255, Math.floor(((3 * wild.maxHp - 2 * wild.hp) * rate * ballBonus) / (3 * wild.maxHp)) * STATUS_CATCH_BONUS[wild.status]);
	if (a >= 255) return { caught: true, shakes: 3 };
	if (a <= 0) return { caught: false, shakes: 0 };
	const b = Math.floor(1048560 / Math.floor(Math.sqrt(Math.sqrt(16711680 / a))));
	let shakes = 0;
	for (let check = 0; check < 4; check += 1) {
		if (Math.floor(rng() * 65536) < b) shakes += 1;
		else break;
	}
	return { caught: shakes === 4, shakes: Math.min(shakes, 3) };
}

export const BALL_BREAK_FLAVOR = [
	'Oh no! The POKéMON broke free!',
	'Aww! It appeared to be caught!',
	'Aargh! Almost had it!',
	'Shoot! It was so close, too!'
];

/** Gen III run odds: escapes outright on a speed advantage, else a growing roll. */
export function runAttempt(player: BattleMon, wild: BattleMon, attempts: number, rng: Rng): { escaped: boolean; odds: number } {
	const playerSpeed = effectiveSpeed(player);
	const wildSpeed = Math.max(1, effectiveSpeed(wild));
	const odds = (Math.floor((playerSpeed * 128) / wildSpeed) + 30 * attempts) % 256;
	return { escaped: playerSpeed >= wildSpeed || Math.floor(rng() * 256) < odds, odds };
}

// In-battle bag items on party mons.
export function applyBattleItem(mon: BattleMon, itemId: string): { mon: BattleMon; changed: boolean; message: string } {
	if (itemId === 'potion' || itemId === 'super-potion') {
		if (mon.hp <= 0) return { mon, changed: false, message: `${mon.name} has fainted. Use a REVIVE.` };
		if (mon.hp >= mon.maxHp) return { mon, changed: false, message: `${mon.name} already has full HP.` };
		const heal = itemId === 'super-potion' ? 50 : 20;
		return {
			mon: { ...mon, hp: Math.min(mon.maxHp, mon.hp + heal) },
			changed: true,
			message: `${mon.name} recovered HP!`
		};
	}
	if (itemId === 'antidote') {
		if (mon.status !== 'poisoned') return { mon, changed: false, message: `${mon.name} isn't poisoned.` };
		return { mon: { ...mon, status: 'healthy' }, changed: true, message: `${mon.name} was cured of its poison!` };
	}
	if (itemId === 'full-heal') {
		if (mon.status === 'healthy') return { mon, changed: false, message: `${mon.name} is healthy.` };
		return { mon: { ...mon, status: 'healthy', sleepTurns: 0 }, changed: true, message: `${mon.name} became healthy!` };
	}
	if (itemId === 'revive' || itemId === 'max-revive') {
		if (mon.hp > 0) return { mon, changed: false, message: `${mon.name} hasn't fainted.` };
		const hp = itemId === 'max-revive' ? mon.maxHp : Math.ceil(mon.maxHp / 2);
		return { mon: { ...mon, hp, status: 'healthy', sleepTurns: 0 }, changed: true, message: `${mon.name} was revived!` };
	}
	return { mon, changed: false, message: "It won't have any effect." };
}

// --- Whole-turn transforms -------------------------------------------------------

export type TurnOutcome = 'continue' | 'won' | 'fainted';

export interface TurnResult {
	player: BattleMon;
	wild: BattleMon;
	log: string[];
	outcome: TurnOutcome;
	exp: ExpGrant | null;
}

interface TurnState {
	player: BattleMon;
	wild: BattleMon;
	outcome: TurnOutcome;
	exp: ExpGrant | null;
}

function wildTurn(state: TurnState, messages: string[], rng: Rng): TurnState {
	if (state.wild.hp <= 0 || state.player.hp <= 0) return state;
	const move = wildPickMove(state.wild, rng);
	const wild = decrementPp(state.wild, move.id);
	const result = strike(wild, state.player, move, rng);
	messages.push(...result.messages);
	return { ...state, wild: result.attacker, player: result.target };
}

function concludeIfFainted(state: TurnState, messages: string[], iv: number): TurnState {
	let next = state;
	if (next.wild.hp <= 0 && next.outcome === 'continue') {
		messages.push(`Wild ${next.wild.name} fainted!`);
		const exp = grantBattleExp(next.player, next.wild, messages, iv);
		next = { ...next, outcome: 'won', exp, player: exp ? exp.mon : next.player };
	}
	if (next.player.hp <= 0 && next.outcome === 'continue') {
		messages.push(`${next.player.name} fainted!`);
		next = { ...next, outcome: 'fainted' };
	}
	return next;
}

function applyEndOfTurn(state: TurnState, messages: string[], iv: number): TurnState {
	if (state.outcome !== 'continue') return state;
	const playerResult = endOfTurnStatus(state.player);
	const wildResult = endOfTurnStatus(state.wild);
	messages.push(...playerResult.messages, ...wildResult.messages);
	return concludeIfFainted({ ...state, player: playerResult.mon, wild: wildResult.mon }, messages, iv);
}

const finish = (state: TurnState, log: string[]): TurnResult => ({ ...state, log: log.length ? log : ['...'] });

/**
 * The player's mon uses `moveIndex` and the wild replies, in speed order
 * (ties broken by the rng), with status gates, PP, chip damage and exp.
 */
export function resolveMoveTurn(playerMember: PartyMember, wildMember: PartyMember, moveIndex: number, rng: Rng): TurnResult {
	const iv = memberIv(playerMember);
	const messages: string[] = [];
	let state: TurnState = { player: battleMonFromMember(playerMember), wild: battleMonFromMember(wildMember, true), outcome: 'continue', exp: null };
	const active = state.player;
	const usable = active.moves.some((move) => move.pp > 0);
	const move = usable ? active.moves[moveIndex] : STRUGGLE;
	if (!move || (Number.isFinite(move.pp) && move.pp <= 0)) {
		return finish(state, ["There's no PP left for this move!"]);
	}
	if (!usable) messages.push(`${active.name} has no moves left!`);
	const playerFirst = effectiveSpeed(active) > effectiveSpeed(state.wild) || (effectiveSpeed(active) === effectiveSpeed(state.wild) && rng() < 0.5);

	const playerStrike = (current: TurnState): TurnState => {
		const mon = decrementPp(current.player, move.id);
		const result = strike(mon, current.wild, move, rng);
		messages.push(...result.messages);
		return { ...current, wild: result.target, player: result.attacker };
	};

	if (playerFirst) {
		state = playerStrike(state);
		state = concludeIfFainted(state, messages, iv);
		if (state.outcome === 'continue') state = wildTurn(state, messages, rng);
		state = concludeIfFainted(state, messages, iv);
	} else {
		state = wildTurn(state, messages, rng);
		state = concludeIfFainted(state, messages, iv);
		if (state.outcome === 'continue' && state.player.hp > 0) state = playerStrike(state);
		state = concludeIfFainted(state, messages, iv);
	}
	state = applyEndOfTurn(state, messages, iv);
	return finish(state, messages);
}

/** The wild's free attack after a failed throw / failed run / item use. */
export function resolveWildTurn(playerMember: PartyMember, wildMember: PartyMember, rng: Rng, preface: string[] = []): TurnResult {
	const iv = memberIv(playerMember);
	const messages: string[] = [...preface];
	let state: TurnState = { player: battleMonFromMember(playerMember), wild: battleMonFromMember(wildMember, true), outcome: 'continue', exp: null };
	state = wildTurn(state, messages, rng);
	state = concludeIfFainted(state, messages, iv);
	state = applyEndOfTurn(state, messages, iv);
	return finish(state, messages);
}
