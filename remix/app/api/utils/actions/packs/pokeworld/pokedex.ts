// Gen I-III Pokédex data access + Gen III battle math, ported from the
// Pokeworld app (src/lib/pokedex.ts). Pure: no DOM, no storage, no network.
// Data ships in ./data/pokedex.json (386 species, copied verbatim).

import pokedexData from './data/pokedex.json';

export interface BaseStats {
	hp: number;
	atk: number;
	def: number;
	spa: number;
	spd: number;
	spe: number;
}

export interface PokedexEntry {
	id: number;
	name: string;
	displayName: string;
	types: string[];
	baseStats: BaseStats;
	catchRate: number;
	/** Female chance in eighths (0-8); -1 = genderless. */
	genderRate: number;
	baseExp: number;
	growthRate: string;
	isLegendary: boolean;
	genus: string;
	flavor: string;
	heightM: number;
	weightKg: number;
}

export type PokemonGender = 'male' | 'female' | 'genderless';

export type StatBlock = BaseStats;

export type Rng = () => number;

export const NATIONAL_DEX_COUNT = 386;

const entries = pokedexData as PokedexEntry[];
const byId = new Map<number, PokedexEntry>(entries.map((entry) => [entry.id, entry]));
const byName = new Map<string, PokedexEntry>(entries.map((entry) => [entry.name.toUpperCase(), entry]));
for (const entry of entries) byName.set(entry.displayName.toUpperCase(), entry);

export const allSpecies = (): PokedexEntry[] => entries;

export const getSpecies = (id: number): PokedexEntry | undefined => byId.get(id);

export const speciesByName = (name: string): PokedexEntry | undefined => byName.get(name.trim().toUpperCase());

// --- Asset URLs (served by the live Pokeworld site) ---------------------------

export const ASSET_ORIGIN = 'https://www.pokeworld.center';

/** Battle sprite: /sprites/pokemon/gen3/[back/|shiny/|back-shiny/]<id>.png */
export function speciesSpriteUrl(id: number, options: { shiny?: boolean; back?: boolean } = {}): string {
	const slot = options.back ? (options.shiny ? 'back-shiny/' : 'back/') : options.shiny ? 'shiny/' : '';
	return `${ASSET_ORIGIN}/sprites/pokemon/gen3/${slot}${id}.png`;
}

/** Original relative form kept for parity with the source app's spriteUrl. */
export const spriteUrl = speciesSpriteUrl;

export const tileUrl = (img: string): string => `${ASSET_ORIGIN}/tiles/${img}.png`;

export type PlayerGender = 'boy' | 'girl';
export type PlayerFacing = 'up' | 'down' | 'left' | 'right';

export function playerSpriteUrl(gender: PlayerGender, facing: PlayerFacing, frame: 0 | 1 | 2 = 0): string {
	const sheet = facing === 'up' ? 'up' : facing === 'down' ? 'down' : 'side';
	return `${ASSET_ORIGIN}/sprites/player/${gender === 'girl' ? 'girl' : 'boy'}/${sheet}-${frame}.png`;
}

export function speciesSpriteSet(id: number, shiny = false) {
	return {
		sprite: speciesSpriteUrl(id, { shiny }),
		spriteShiny: speciesSpriteUrl(id, { shiny: true }),
		spriteBack: speciesSpriteUrl(id, { shiny, back: true }),
		spriteBackShiny: speciesSpriteUrl(id, { shiny: true, back: true })
	};
}

// --- Gen III stat math (neutral nature, EVs ignored) ---------------------------

export function calcStats(base: BaseStats, level: number, iv = 15): StatBlock {
	const other = (stat: number) => Math.floor(((2 * stat + iv) * level) / 100) + 5;
	return {
		hp: Math.floor(((2 * base.hp + iv) * level) / 100) + level + 10,
		atk: other(base.atk),
		def: other(base.def),
		spa: other(base.spa),
		spd: other(base.spd),
		spe: other(base.spe)
	};
}

// --- Experience growth curves (Gen III) ----------------------------------------

export function expForLevel(growthRate: string, level: number): number {
	const n = Math.max(1, Math.min(100, Math.floor(level)));
	if (n === 1) return 0;
	switch (growthRate) {
		case 'fast':
			return Math.floor((4 * n ** 3) / 5);
		case 'slow':
			return Math.floor((5 * n ** 3) / 4);
		case 'medium-slow':
			return Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140);
		case 'erratic': {
			if (n < 50) return Math.floor((n ** 3 * (100 - n)) / 50);
			if (n < 68) return Math.floor((n ** 3 * (150 - n)) / 100);
			if (n < 98) return Math.floor((n ** 3 * Math.floor((1911 - 10 * n) / 3)) / 500);
			return Math.floor((n ** 3 * (160 - n)) / 100);
		}
		case 'fluctuating': {
			if (n < 15) return Math.floor((n ** 3 * (Math.floor((n + 1) / 3) + 24)) / 50);
			if (n < 36) return Math.floor((n ** 3 * (n + 14)) / 50);
			return Math.floor((n ** 3 * (Math.floor(n / 2) + 32)) / 50);
		}
		default:
			return n ** 3; // "medium" / medium-fast
	}
}

export function levelForExp(growthRate: string, exp: number): number {
	let level = 1;
	while (level < 100 && expForLevel(growthRate, level + 1) <= exp) level += 1;
	return level;
}

/** Gen III flat wild-battle experience yield. */
export function expGainForDefeat(defeated: PokedexEntry, defeatedLevel: number): number {
	return Math.max(1, Math.floor((defeated.baseExp * defeatedLevel) / 7));
}

// --- Gender / shiny rolls ------------------------------------------------------

export function rollGender(genderRate: number, rng: Rng): PokemonGender {
	if (genderRate < 0) return 'genderless';
	if (genderRate === 0) return 'male';
	if (genderRate >= 8) return 'female';
	return rng() * 8 < genderRate ? 'female' : 'male';
}

export const DEFAULT_SHINY_DENOMINATOR = 8192;

export const rollShiny = (rng: Rng, denominator = DEFAULT_SHINY_DENOMINATOR): boolean => denominator > 0 && Math.floor(rng() * denominator) === 0;

// --- Type effectiveness (Gen III chart) ----------------------------------------

const TYPE_CHART: Record<string, Partial<Record<string, number>>> = {
	NORMAL: { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
	FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
	WATER: { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
	ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
	GRASS: { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
	ICE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
	FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2 },
	POISON: { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0 },
	GROUND: { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
	FLYING: { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
	PSYCHIC: { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
	BUG: { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5 },
	ROCK: { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
	GHOST: { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5, STEEL: 0.5 },
	DRAGON: { DRAGON: 2, STEEL: 0.5 },
	DARK: { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, STEEL: 0.5 },
	STEEL: { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5 }
};

export function typeEffectiveness(moveType: string, defenderTypes: string[]): number {
	const row = TYPE_CHART[moveType.toUpperCase()];
	if (!row) return 1;
	return defenderTypes.reduce((multiplier, type) => multiplier * (row[type.toUpperCase()] ?? 1), 1);
}
