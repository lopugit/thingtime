// Trainer / party-member records, ported from the Pokeworld app
// (src/lib/trainer-state.ts) minus the localStorage persistence and save
// migrations. Everything here is a pure transform over JSON-safe records.

import { movesFor, type BattleMove } from './battle';
import { calcStats, expForLevel, getSpecies, levelForExp, speciesSpriteUrl, type PokemonGender, type Rng, type StatBlock } from './pokedex';
import { FIELD_ITEM_TABLE, type PocketName } from './rules';

export type TrainerItemKind = 'heal' | 'status' | 'utility';
export type TrainerGender = 'boy' | 'girl';
export type StatusCondition = 'healthy' | 'poisoned' | 'paralyzed' | 'asleep' | 'burned' | 'frozen';

export const STATUS_VALUES: StatusCondition[] = ['healthy', 'poisoned', 'paralyzed', 'asleep', 'burned', 'frozen'];

export interface PartyMember {
	id: string;
	speciesId: number;
	species: string;
	nickname: string | null;
	level: number;
	exp: number;
	hp: number;
	maxHp: number;
	stats: StatBlock;
	types: string[];
	status: StatusCondition;
	gender: PokemonGender;
	shiny: boolean;
	sprite: string;
	spriteBack: string;
	moves: BattleMove[];
	/** Remaining sleep turns while `status === 'asleep'`. */
	sleepTurns?: number;
	/** Uniform IV used for stat math when it differs from the Gen III default of 15. */
	iv?: number;
}

export interface BagItem {
	id: string;
	name: string;
	quantity: number;
	description: string;
	kind: TrainerItemKind;
}

export interface Badge {
	id: string;
	name: string;
	color: string;
	earned: boolean;
}

export interface CatalogueItem {
	id: string;
	name: string;
	description: string;
	kind: TrainerItemKind;
	pocket: PocketName;
}

export const HOENN_BADGES: Array<{ id: string; name: string; color: string }> = [
	{ id: 'stone', name: 'STONE BADGE', color: '#a8a878' },
	{ id: 'knuckle', name: 'KNUCKLE BADGE', color: '#c05038' },
	{ id: 'dynamo', name: 'DYNAMO BADGE', color: '#f8d030' },
	{ id: 'heat', name: 'HEAT BADGE', color: '#f08030' },
	{ id: 'balance', name: 'BALANCE BADGE', color: '#8890f0' },
	{ id: 'feather', name: 'FEATHER BADGE', color: '#78c8e0' },
	{ id: 'mind', name: 'MIND BADGE', color: '#f85888' },
	{ id: 'rain', name: 'RAIN BADGE', color: '#6890f0' }
];

export const itemKindFor = (id: string): TrainerItemKind => {
	if (id.includes('potion') || id.includes('revive')) return 'heal';
	if (id === 'antidote' || id === 'full-heal') return 'status';
	return 'utility';
};

const EXTRA_ITEMS: Array<{ id: string; name: string; pocket: PocketName; description: string }> = [
	{ id: 'full-heal', name: 'FULL HEAL', pocket: 'items', description: 'Heals all status problems of one POKéMON.' },
	{ id: 'escape-rope', name: 'ESCAPE ROPE', pocket: 'items', description: 'Use it to escape instantly from a cave.' }
];

export const ITEM_CATALOGUE: CatalogueItem[] = [...FIELD_ITEM_TABLE.map((entry) => entry.item), ...EXTRA_ITEMS].map((item) => ({
	id: item.id,
	name: item.name,
	description: item.description,
	kind: itemKindFor(item.id),
	pocket: item.pocket
}));

export const catalogueItem = (id: string): CatalogueItem | undefined => ITEM_CATALOGUE.find((item) => item.id === id);

export const DEFAULT_IV = 15;

export const memberIv = (member: { iv?: number }): number => (typeof member.iv === 'number' && Number.isFinite(member.iv) ? member.iv : DEFAULT_IV);

export function createPartyMember(options: {
	id: string;
	speciesId: number;
	level: number;
	gender: PokemonGender;
	shiny?: boolean;
	nickname?: string | null;
	iv?: number;
}): PartyMember {
	const species = getSpecies(options.speciesId);
	if (!species) throw new Error(`pokeworld: unknown species #${options.speciesId}`);
	const level = Math.max(1, Math.min(100, Math.floor(options.level)));
	const iv = typeof options.iv === 'number' ? options.iv : DEFAULT_IV;
	const stats = calcStats(species.baseStats, level, iv);
	const shiny = options.shiny === true;
	const member: PartyMember = {
		id: options.id,
		speciesId: species.id,
		species: species.displayName,
		nickname: options.nickname ?? null,
		level,
		exp: expForLevel(species.growthRate, level),
		hp: stats.hp,
		maxHp: stats.hp,
		stats,
		types: [...species.types],
		status: 'healthy',
		gender: species.genderRate < 0 ? 'genderless' : options.gender,
		shiny,
		sprite: speciesSpriteUrl(species.id, { shiny }),
		spriteBack: speciesSpriteUrl(species.id, { shiny, back: true }),
		moves: movesFor(species.types, level)
	};
	if (iv !== DEFAULT_IV) member.iv = iv;
	return member;
}

export const memberDisplayName = (member: Pick<PartyMember, 'nickname' | 'species'>): string => member.nickname ?? member.species;

/** Re-derives level-dependent stats, keeping the current HP delta. */
export const levelUpMember = (member: PartyMember, levels = 1): PartyMember => {
	const species = getSpecies(member.speciesId);
	const level = Math.min(100, member.level + levels);
	if (!species) return { ...member, level };
	const stats = calcStats(species.baseStats, level, memberIv(member));
	const hpGain = stats.hp - member.maxHp;
	return {
		...member,
		level,
		exp: Math.max(member.exp, expForLevel(species.growthRate, level)),
		stats,
		maxHp: stats.hp,
		hp: Math.min(stats.hp, member.hp + Math.max(0, hpGain)),
		moves: movesFor(member.types, level)
	};
};

/** Adds experience, applying any level-ups (Gen III growth curves). */
export function grantExperience(member: PartyMember, amount: number): { member: PartyMember; levelsGained: number } {
	const species = getSpecies(member.speciesId);
	if (!species || amount <= 0 || member.level >= 100) return { member, levelsGained: 0 };
	const exp = member.exp + amount;
	const level = Math.max(member.level, levelForExp(species.growthRate, exp));
	const levelsGained = level - member.level;
	let next = { ...member, exp };
	if (levelsGained > 0) next = { ...levelUpMember(next, levelsGained), exp };
	return { member: next, levelsGained };
}

export interface ItemUse {
	member: PartyMember;
	consumed: boolean;
	message: string;
}

/** Out-of-battle bag item semantics (trainer-state useBagItem) on one member. */
export function applyBagItem(member: PartyMember, itemId: string): ItemUse {
	const item = catalogueItem(itemId);
	const unchanged = (message: string): ItemUse => ({ member, consumed: false, message });
	if (!item) return unchanged('There are none left.');
	const name = member.species;

	if (item.id === 'rare-candy') {
		if (member.level >= 100) return unchanged(`${name} is already level 100.`);
		const leveled = levelUpMember(member);
		return { member: leveled, consumed: true, message: `${name} grew to level ${leveled.level}!` };
	}
	if (item.kind === 'utility') return unchanged(`${item.name} is ready for field use.`);
	if (item.kind === 'heal' && !item.id.includes('revive') && member.hp <= 0) {
		return unchanged(`${name} has fainted. Use a REVIVE.`);
	}
	if (item.kind === 'heal' && item.id.includes('revive') && member.hp > 0) {
		return unchanged(`${name} hasn't fainted.`);
	}
	if (item.kind === 'heal' && member.hp >= member.maxHp) {
		return unchanged(`${name} already has full HP.`);
	}
	if (item.kind === 'status' && member.status === 'healthy') {
		return unchanged(`${name} has no status condition.`);
	}

	const healAmount = item.id === 'super-potion' ? 50 : item.id.includes('revive') ? Math.ceil(member.maxHp / 2) : 20;
	let next: PartyMember;
	if (item.kind === 'heal') {
		const base = item.id === 'max-revive' ? member.maxHp : member.hp + healAmount;
		next = { ...member, hp: Math.min(member.maxHp, Math.max(healAmount, base)) };
		if (next.hp > 0 && item.id.includes('revive')) next = { ...next, status: 'healthy' };
	} else {
		next = { ...member, status: 'healthy', sleepTurns: 0 };
	}
	return { member: next, consumed: true, message: `${item.name} used on ${name}.` };
}

// --- Default trainer -----------------------------------------------------------

export interface TrainerRecord {
	name: string;
	gender: TrainerGender;
	party: PartyMember[];
	box: PartyMember[];
	bag: Record<PocketName, BagItem[]>;
	badges: Badge[];
	pokedex: { seen: number[]; caught: number[] };
}

const bagItem = (id: string, name: string, quantity: number, description: string, kind: TrainerItemKind): BagItem => ({
	id,
	name,
	quantity,
	description,
	kind
});

export const DEFAULT_PARTY: Array<{ id: string; speciesId: number; level: number }> = [
	{ id: 'treecko', speciesId: 252, level: 12 },
	{ id: 'ralts', speciesId: 280, level: 9 },
	{ id: 'zigzagoon', speciesId: 263, level: 8 }
];

export const DEFAULT_BOX: Array<{ id: string; speciesId: number; level: number }> = [
	{ id: 'mudkip', speciesId: 258, level: 10 },
	{ id: 'torchic', speciesId: 255, level: 10 },
	{ id: 'wingull', speciesId: 278, level: 7 }
];

export function defaultTrainer(makeMember: (spec: { id: string; speciesId: number; level: number }) => PartyMember): TrainerRecord {
	const party = DEFAULT_PARTY.map(makeMember);
	const box = DEFAULT_BOX.map(makeMember);
	const owned = [...new Set([...party, ...box].map((member) => member.speciesId))].sort((a, b) => a - b);
	return {
		name: 'LOPU',
		gender: 'boy',
		party,
		box,
		bag: {
			items: [
				bagItem('potion', 'POTION', 3, 'Restores 20 HP of one POKéMON.', 'heal'),
				bagItem('antidote', 'ANTIDOTE', 2, 'Heals a poisoned POKéMON.', 'status'),
				bagItem('escape-rope', 'ESCAPE ROPE', 1, 'Use it to escape instantly from a cave.', 'utility')
			],
			pokeballs: [bagItem('poke-ball', 'POKé BALL', 6, 'A tool for catching wild POKéMON.', 'utility')],
			keyItems: []
		},
		badges: HOENN_BADGES.map((badge) => ({ ...badge, earned: false })),
		pokedex: { seen: owned, caught: [...owned] }
	};
}

// --- Defensive parsing of incoming records -------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const isStatBlock = (value: unknown): value is StatBlock =>
	isRecord(value) &&
	['hp', 'atk', 'def', 'spa', 'spd', 'spe'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key] as number));

const MAX_MOVES = 4;

const normalizeMove = (value: unknown, fallbackType: string): BattleMove | null => {
	if (!isRecord(value) || typeof value.name !== 'string') return null;
	const maxPp = Math.max(1, Math.min(99, Math.floor(finiteNumber(value.maxPp) ?? finiteNumber(value.pp) ?? 1)));
	const pp = Math.max(0, Math.min(maxPp, Math.floor(finiteNumber(value.pp) ?? maxPp)));
	const inflicts =
		value.inflicts === 'poisoned' ||
		value.inflicts === 'paralyzed' ||
		value.inflicts === 'asleep' ||
		value.inflicts === 'burned' ||
		value.inflicts === 'frozen'
			? value.inflicts
			: undefined;
	const move: BattleMove = {
		id: typeof value.id === 'string' && value.id ? value.id : value.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
		name: value.name.slice(0, 32),
		type: (typeof value.type === 'string' ? value.type : fallbackType).toUpperCase().slice(0, 16),
		power: Math.max(0, Math.min(250, Math.floor(finiteNumber(value.power) ?? 0))),
		accuracy: value.accuracy === null ? null : Math.max(1, Math.min(100, Math.floor(finiteNumber(value.accuracy) ?? 100))),
		pp,
		maxPp
	};
	const effectChance = finiteNumber(value.effectChance);
	if (inflicts && effectChance !== undefined) {
		move.inflicts = inflicts;
		move.effectChance = Math.max(0, Math.min(1, effectChance));
	}
	return move;
};

/**
 * Parses an incoming party-member record, filling derivable gaps (stats,
 * moves, sprites) from the dex and refusing records that cannot describe a
 * battler at all. `label` names the offending argument in error messages.
 */
export function normalizeMember(value: unknown, label: string, rng?: Rng): PartyMember {
	if (!isRecord(value)) throw new Error(`pokeworld: ${label} must be a party-member record`);
	const speciesId = finiteNumber(value.speciesId);
	const species = speciesId !== undefined ? getSpecies(Math.floor(speciesId)) : undefined;
	if (!species) throw new Error(`pokeworld: ${label}.speciesId must be a National Dex number (1-386)`);
	const level = Math.max(1, Math.min(100, Math.floor(finiteNumber(value.level) ?? 1)));
	const iv = finiteNumber(value.iv);
	const boundedIv = iv === undefined ? DEFAULT_IV : Math.max(0, Math.min(31, Math.floor(iv)));
	const stats = isStatBlock(value.stats) ? value.stats : calcStats(species.baseStats, level, boundedIv);
	const maxHp = Math.max(1, Math.floor(finiteNumber(value.maxHp) ?? stats.hp));
	const hp = Math.max(0, Math.min(maxHp, Math.floor(finiteNumber(value.hp) ?? maxHp)));
	const status = STATUS_VALUES.includes(value.status as StatusCondition) ? (value.status as StatusCondition) : 'healthy';
	const shiny = value.shiny === true;
	const types = Array.isArray(value.types)
		? value.types.filter((type): type is string => typeof type === 'string').map((type) => type.toUpperCase().slice(0, 16))
		: [];
	const resolvedTypes = types.length ? types.slice(0, 2) : [...species.types];
	const rawMoves = Array.isArray(value.moves)
		? value.moves.map((move) => normalizeMove(move, resolvedTypes[0])).filter((move): move is BattleMove => !!move)
		: [];
	const moves = rawMoves.length ? rawMoves.slice(0, MAX_MOVES) : movesFor(resolvedTypes, level);
	const gender: PokemonGender =
		species.genderRate < 0
			? 'genderless'
			: value.gender === 'male' || value.gender === 'female'
			? value.gender
			: rng
			? species.genderRate === 0
				? 'male'
				: species.genderRate >= 8
				? 'female'
				: rng() * 8 < species.genderRate
				? 'female'
				: 'male'
			: 'male';
	const member: PartyMember = {
		id: typeof value.id === 'string' && value.id ? value.id.slice(0, 64) : 'wild',
		speciesId: species.id,
		species: typeof value.species === 'string' && value.species ? value.species.slice(0, 32) : species.displayName,
		nickname: typeof value.nickname === 'string' && value.nickname ? value.nickname.slice(0, 32) : null,
		level,
		exp: Math.max(0, Math.floor(finiteNumber(value.exp) ?? expForLevel(species.growthRate, level))),
		hp,
		maxHp,
		stats,
		types: resolvedTypes,
		status,
		gender,
		shiny,
		sprite: typeof value.sprite === 'string' ? value.sprite.slice(0, 256) : speciesSpriteUrl(species.id, { shiny }),
		spriteBack: typeof value.spriteBack === 'string' ? value.spriteBack.slice(0, 256) : speciesSpriteUrl(species.id, { shiny, back: true }),
		moves
	};
	const sleepTurns = finiteNumber(value.sleepTurns);
	if (status === 'asleep') member.sleepTurns = Math.max(0, Math.min(7, Math.floor(sleepTurns ?? 1)));
	if (iv !== undefined && boundedIv !== DEFAULT_IV) member.iv = boundedIv;
	return member;
}
