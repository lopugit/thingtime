// Wild-encounter spawn rules, ported from the Pokeworld app
// (src/lib/encounters.ts): biome detection, geofencing, the deterministic
// default rule table (every species spawns world-wide fenced by biome at world
// levels 2-7, weight = catch rate; legendaries ship with curated geofences),
// and the weighted encounter roll. Admin override plumbing is intentionally
// not ported — the pack never touches storage.

import { allSpecies, DEFAULT_SHINY_DENOMINATOR, getSpecies, rollGender, rollShiny, type PokedexEntry, type PokemonGender, type Rng } from './pokedex';

export type EncounterBiome = 'long-grass' | 'water' | 'cave';

export const ENCOUNTER_BIOMES: EncounterBiome[] = ['long-grass', 'water', 'cave'];

export type GeoFence = { kind: 'global' } | { kind: 'circle'; lat: number; lng: number; radiusKm: number };

export interface SpawnRule {
	id: string;
	speciesId: number;
	enabled: boolean;
	/** Relative selection weight among matching rules (Emerald-style table weight). */
	weight: number;
	biomes: EncounterBiome[];
	fence: GeoFence;
	levelMin: number;
	levelMax: number;
	genderOverride?: PokemonGender;
	/** 1-in-N shiny odds for this rule; defaults to the global 1/8192. */
	shinyDenominator?: number;
	source: 'default' | 'custom';
}

/** The subset of a map tile the biome detector reads. */
export type TileLike = {
	img?: string;
	img2?: string;
	terrain?: string;
	feature?: string;
	solid?: boolean;
};

// --- Biome detection -------------------------------------------------------

export const isWaterTile = (tile: TileLike | undefined): boolean =>
	!!tile && (tile.terrain === 'water' || String(tile.img ?? '').startsWith('pond-') || String(tile.img ?? '').startsWith('water'));

export const isLongGrassTile = (tile: TileLike | undefined): boolean => !!tile && (tile.feature === 'long-grass' || tile.img2 === 'grass-2');

/**
 * The biome an encounter check runs against for the tile the player just
 * stepped onto. Cave hunting happens in the rocky mouth area around cave
 * entrances, which `nearCave` reports.
 */
export function encounterBiomeFor(tile: TileLike | undefined, options: { surfing?: boolean; nearCave?: boolean } = {}): EncounterBiome | null {
	if (options.surfing && isWaterTile(tile)) return 'water';
	if (isLongGrassTile(tile)) return 'long-grass';
	if (options.nearCave) return 'cave';
	return null;
}

/** Per-step encounter chance by biome (Emerald-ish rates). */
export const ENCOUNTER_STEP_CHANCE: Record<EncounterBiome, number> = {
	'long-grass': 0.12,
	water: 0.1,
	cave: 0.1
};

export const encounterTriggered = (biome: EncounterBiome, rng: Rng): boolean => rng() < ENCOUNTER_STEP_CHANCE[biome];

// --- Geofencing -------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLng = (lng2 - lng1) * rad;
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function fenceContains(fence: GeoFence, lat: number, lng: number): boolean {
	if (fence.kind === 'global') return true;
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
	return haversineKm(fence.lat, fence.lng, lat, lng) <= fence.radiusKm;
}

// --- Default rules ----------------------------------------------------------

// Species that hunt in caves in Emerald even though their types alone don't
// say so (Zubat line, Whismur line, Sableye, Mawile, Abra...).
export const CAVE_SPECIES = new Set([
	35, 36, 41, 42, 46, 47, 50, 51, 63, 64, 65, 66, 67, 68, 74, 75, 76, 92, 93, 94, 95, 104, 105, 132, 169, 202, 293, 294, 295, 296, 297, 302, 303, 304,
	305, 306, 307, 308, 337, 338, 343, 344, 353, 354, 355, 356, 360, 371, 372, 373, 374, 375, 376
]);

export const WORLD_LEVEL_MIN = 2;
export const WORLD_LEVEL_MAX = 7;

export function defaultBiomesFor(entry: PokedexEntry): EncounterBiome[] {
	const biomes = new Set<EncounterBiome>();
	const types = entry.types.map((type) => type.toUpperCase());
	if (types.includes('WATER')) biomes.add('water');
	if (CAVE_SPECIES.has(entry.id) || types.includes('ROCK') || types.includes('GROUND') || types.includes('STEEL')) {
		biomes.add('cave');
	}
	if (biomes.size === 0 || (biomes.size === 1 && biomes.has('water') && types.length > 1 && types.includes('GRASS'))) {
		biomes.add('long-grass');
	}
	return [...biomes];
}

interface LegendaryHome {
	fence: GeoFence;
	biomes: EncounterBiome[];
	levelMin: number;
	levelMax: number;
	weight?: number;
}

// Curated legendary geofences.
export const LEGENDARY_HOMES: Record<number, LegendaryHome> = {
	// Kanto birds
	144: { fence: { kind: 'circle', lat: -43.5321, lng: 170.1418, radiusKm: 150 }, biomes: ['long-grass', 'cave'], levelMin: 50, levelMax: 55 }, // Articuno — Southern Alps, NZ
	145: { fence: { kind: 'circle', lat: 43.0962, lng: -79.0377, radiusKm: 150 }, biomes: ['long-grass'], levelMin: 50, levelMax: 55 }, // Zapdos — Niagara Falls
	146: { fence: { kind: 'circle', lat: 40.8214, lng: 14.426, radiusKm: 150 }, biomes: ['long-grass', 'cave'], levelMin: 50, levelMax: 55 }, // Moltres — Mt Vesuvius
	150: { fence: { kind: 'circle', lat: 35.6762, lng: 139.6503, radiusKm: 100 }, biomes: ['cave'], levelMin: 70, levelMax: 70 }, // Mewtwo — Tokyo
	151: { fence: { kind: 'circle', lat: 4.86, lng: -58.93, radiusKm: 300 }, biomes: ['long-grass'], levelMin: 30, levelMax: 30 }, // Mew — Guyana
	// Johto beasts + duo
	243: { fence: { kind: 'circle', lat: 55.7558, lng: 37.6173, radiusKm: 300 }, biomes: ['long-grass'], levelMin: 40, levelMax: 50 }, // Raikou — Moscow steppe
	244: { fence: { kind: 'circle', lat: -1.9403, lng: 29.8739, radiusKm: 300 }, biomes: ['long-grass'], levelMin: 40, levelMax: 50 }, // Entei — Virunga volcanoes
	245: { fence: { kind: 'circle', lat: 59.3293, lng: 18.0686, radiusKm: 300 }, biomes: ['water'], levelMin: 40, levelMax: 50 }, // Suicune — Baltic
	249: { fence: { kind: 'circle', lat: 40.0, lng: 135.0, radiusKm: 400 }, biomes: ['water'], levelMin: 60, levelMax: 70 }, // Lugia — Sea of Japan
	250: { fence: { kind: 'circle', lat: 35.0116, lng: 135.7681, radiusKm: 100 }, biomes: ['long-grass'], levelMin: 60, levelMax: 70 }, // Ho-Oh — Kyoto
	251: { fence: { kind: 'circle', lat: 30.358, lng: 130.546, radiusKm: 100 }, biomes: ['long-grass'], levelMin: 30, levelMax: 30 }, // Celebi — Yakushima forest
	// Hoenn
	377: { fence: { kind: 'circle', lat: 31.0461, lng: 34.8516, radiusKm: 300 }, biomes: ['cave'], levelMin: 40, levelMax: 40 }, // Regirock — Negev desert
	378: { fence: { kind: 'circle', lat: 64.9631, lng: -19.0208, radiusKm: 300 }, biomes: ['cave'], levelMin: 40, levelMax: 40 }, // Regice — Iceland
	379: { fence: { kind: 'circle', lat: 61.4978, lng: 23.761, radiusKm: 300 }, biomes: ['cave'], levelMin: 40, levelMax: 40 }, // Registeel — Finnish steelworks
	380: { fence: { kind: 'circle', lat: 41.9028, lng: 12.4964, radiusKm: 500 }, biomes: ['long-grass', 'water'], levelMin: 50, levelMax: 50 }, // Latias — Mediterranean
	381: { fence: { kind: 'circle', lat: 37.9838, lng: 23.7275, radiusKm: 500 }, biomes: ['long-grass', 'water'], levelMin: 50, levelMax: 50 }, // Latios — Aegean
	382: { fence: { kind: 'circle', lat: -18.2871, lng: 147.6992, radiusKm: 250 }, biomes: ['water'], levelMin: 50, levelMax: 70 }, // Kyogre — Great Barrier Reef
	383: { fence: { kind: 'circle', lat: -25.3444, lng: 131.0369, radiusKm: 100 }, biomes: ['cave', 'long-grass'], levelMin: 50, levelMax: 70 }, // Groudon — Uluru
	384: { fence: { kind: 'circle', lat: 27.9881, lng: 86.925, radiusKm: 150 }, biomes: ['long-grass', 'cave'], levelMin: 70, levelMax: 70 }, // Rayquaza — Mt Everest
	385: { fence: { kind: 'circle', lat: 35.3606, lng: 138.7274, radiusKm: 100 }, biomes: ['long-grass'], levelMin: 30, levelMax: 30 }, // Jirachi — Mt Fuji
	386: { fence: { kind: 'circle', lat: 37.235, lng: -115.8111, radiusKm: 150 }, biomes: ['cave'], levelMin: 70, levelMax: 70 } // Deoxys — Nevada desert
};

export const defaultRuleId = (speciesId: number, index = 0): string => (index === 0 ? `${speciesId}:default` : `${speciesId}:default:${index}`);

export function defaultRulesFor(entry: PokedexEntry): SpawnRule[] {
	const home = LEGENDARY_HOMES[entry.id];
	if (home || entry.isLegendary) {
		return [
			{
				id: defaultRuleId(entry.id),
				speciesId: entry.id,
				enabled: true,
				weight: home?.weight ?? 1,
				biomes: home?.biomes ?? defaultBiomesFor(entry),
				fence: home?.fence ?? { kind: 'global' },
				levelMin: home?.levelMin ?? 40,
				levelMax: home?.levelMax ?? 60,
				shinyDenominator: undefined,
				source: 'default'
			}
		];
	}
	return [
		{
			id: defaultRuleId(entry.id),
			speciesId: entry.id,
			enabled: true,
			// Commonness tracks Gen III catch rate (Zigzagoon 255 ... Dragonite 45).
			weight: Math.max(1, entry.catchRate),
			biomes: defaultBiomesFor(entry),
			fence: { kind: 'global' },
			levelMin: WORLD_LEVEL_MIN,
			levelMax: WORLD_LEVEL_MAX,
			source: 'default'
		}
	];
}

let defaultRulesCache: SpawnRule[] | null = null;

export function defaultSpawnRules(): SpawnRule[] {
	if (!defaultRulesCache) defaultRulesCache = allSpecies().flatMap((entry) => defaultRulesFor(entry));
	return defaultRulesCache;
}

// --- The encounter roll -----------------------------------------------------

export interface EncounterResult {
	speciesId: number;
	level: number;
	gender: PokemonGender;
	shiny: boolean;
	ruleId: string;
}

export function matchingRules(rules: SpawnRule[], biome: EncounterBiome, lat: number, lng: number): SpawnRule[] {
	return rules.filter((rule) => rule.enabled && rule.weight > 0 && rule.biomes.includes(biome) && fenceContains(rule.fence, lat, lng));
}

export function rollEncounter(rules: SpawnRule[], biome: EncounterBiome, lat: number, lng: number, rng: Rng): EncounterResult | null {
	const candidates = matchingRules(rules, biome, lat, lng);
	if (!candidates.length) return null;
	const totalWeight = candidates.reduce((sum, rule) => sum + rule.weight, 0);
	let remaining = rng() * totalWeight;
	let chosen = candidates[candidates.length - 1];
	for (const rule of candidates) {
		remaining -= rule.weight;
		if (remaining < 0) {
			chosen = rule;
			break;
		}
	}
	const species = getSpecies(chosen.speciesId);
	if (!species) return null;
	const level = chosen.levelMin + Math.floor(rng() * (chosen.levelMax - chosen.levelMin + 1));
	const gender =
		chosen.genderOverride && species.genderRate >= 0
			? chosen.genderOverride
			: chosen.genderOverride === 'genderless'
			? 'genderless'
			: rollGender(species.genderRate, rng);
	return {
		speciesId: chosen.speciesId,
		level: Math.max(1, Math.min(100, level)),
		gender: species.genderRate < 0 ? 'genderless' : gender,
		shiny: rollShiny(rng, chosen.shinyDenominator ?? DEFAULT_SHINY_DENOMINATOR),
		ruleId: chosen.id
	};
}
