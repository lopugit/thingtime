// The Pokeworld domain pack: pure, bounded game functions for Thingtime
// actions. Every roll goes through context.random() so runs are replayable
// under a pinned generator; every function validates its already-resolved
// args defensively and returns plain JSON-safe data of bounded size.

import type { ActionPack, PackContext } from '../types';
import {
	applyBattleItem,
	BALL_BONUS,
	BALL_BREAK_FLAVOR,
	battleMonFromMember,
	catchAttempt,
	memberFromBattleMon,
	movesFor,
	resolveMoveTurn,
	resolveWildTurn,
	runAttempt,
	type TurnResult
} from './battle';
import { defaultSpawnRules, ENCOUNTER_BIOMES, ENCOUNTER_STEP_CHANCE, encounterBiomeFor, rollEncounter, type EncounterBiome } from './encounters';
import {
	allSpecies,
	expForLevel,
	expGainForDefeat,
	getSpecies,
	levelForExp,
	NATIONAL_DEX_COUNT,
	playerSpriteUrl,
	rollGender,
	speciesByName,
	speciesSpriteSet,
	speciesSpriteUrl,
	tileUrl,
	type PokedexEntry,
	type PokemonGender,
	type Rng
} from './pokedex';
import {
	cavePagesFor,
	DIRECTIONS,
	directionDelta,
	fieldItemFor,
	formatDialogPages,
	housePagesFor,
	isCaveEntranceTile,
	isFieldItemTile,
	isHouseTile,
	isNearCaveEntrance,
	isSignTile,
	isSurfableTile,
	resolveMove,
	signPagesFor,
	type Direction,
	type TileLookup
} from './rules';
import {
	createPartyMember,
	defaultTrainer as buildDefaultTrainer,
	grantExperience,
	HOENN_BADGES,
	ITEM_CATALOGUE,
	catalogueItem,
	applyBagItem,
	normalizeMember,
	type PartyMember
} from './trainer';
import { BLOCK_TILES, fromGlobal, generateBlock, toGlobal, WorldReader, type WorldTile } from './world';

// --- Argument helpers -------------------------------------------------------------

const fail = (fn: string, message: string): Error => new Error(`pokeworld.${fn}: ${message}`);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (fn: string, value: unknown, label: string): Record<string, unknown> => {
	if (!isRecord(value)) throw fail(fn, `${label} must be an object`);
	return value;
};

const asInt = (fn: string, value: unknown, label: string, min: number, max: number, fallback?: number): number => {
	if (value === undefined || value === null) {
		if (fallback !== undefined) return fallback;
		throw fail(fn, `${label} is required`);
	}
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof number !== 'number' || !Number.isFinite(number)) throw fail(fn, `${label} must be a number`);
	const int = Math.floor(number);
	if (int < min || int > max) throw fail(fn, `${label} must be between ${min} and ${max}`);
	return int;
};

const asFinite = (fn: string, value: unknown, label: string): number => {
	const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof number !== 'number' || !Number.isFinite(number)) throw fail(fn, `${label} must be a number`);
	return number;
};

const asDirection = (fn: string, value: unknown): Direction => {
	if (typeof value !== 'string' || !DIRECTIONS.includes(value as Direction)) throw fail(fn, 'direction must be up/down/left/right');
	return value as Direction;
};

const asSpecies = (fn: string, value: unknown, label: string): PokedexEntry => {
	if (typeof value === 'number' || (typeof value === 'string' && /^\s*\d+\s*$/.test(value))) {
		const entry = Number.isFinite(Number(value)) ? getSpecies(Math.floor(Number(value))) : undefined;
		if (entry) return entry;
	} else if (typeof value === 'string' && value.trim()) {
		const entry = speciesByName(value.slice(0, 64));
		if (entry) return entry;
	}
	throw fail(fn, `${label} must name a known species (1-${NATIONAL_DEX_COUNT} or a name)`);
};

const asGender = (fn: string, value: unknown, species: PokedexEntry, rng: Rng): PokemonGender => {
	if (species.genderRate < 0) return 'genderless';
	if (value === undefined || value === null) return rollGender(species.genderRate, rng);
	if (value === 'male' || value === 'female') return value;
	throw fail(fn, 'gender must be male or female');
};

const MAX_BLOCK_INDEX = 100_000_000;

const bagOfKeys = (value: unknown): ((key: string) => boolean) => {
	if (Array.isArray(value)) {
		const keys = new Set(value.filter((entry): entry is string => typeof entry === 'string'));
		return (key) => keys.has(key);
	}
	if (isRecord(value)) return (key) => Object.prototype.hasOwnProperty.call(value, key) && Boolean(value[key]);
	return () => false;
};

type PlayerFacing = Direction;
type PlayerGender = 'boy' | 'girl';

interface PlayerPosition {
	blockX: number;
	blockY: number;
	x: number;
	y: number;
	facing: PlayerFacing;
	surfing: boolean;
	gender: PlayerGender;
	name?: string;
}

const parsePosition = (fn: string, value: unknown): PlayerPosition => {
	const record = asRecord(fn, value, 'position');
	const position: PlayerPosition = {
		blockX: asInt(fn, record.blockX, 'position.blockX', -MAX_BLOCK_INDEX, MAX_BLOCK_INDEX),
		blockY: asInt(fn, record.blockY, 'position.blockY', -MAX_BLOCK_INDEX, MAX_BLOCK_INDEX),
		x: asInt(fn, record.x, 'position.x', 0, BLOCK_TILES - 1, 8),
		y: asInt(fn, record.y, 'position.y', 0, BLOCK_TILES - 1, 8),
		facing: record.facing === undefined ? 'down' : asDirection(fn, record.facing),
		surfing: record.surfing === true,
		gender: record.gender === 'girl' ? 'girl' : 'boy'
	};
	if (typeof record.name === 'string' && record.name.trim()) position.name = record.name.trim().slice(0, 16);
	return position;
};

// Mulberry32 over a numeric or string seed, for replayable encounter rolls.
const seededRng = (seed: unknown): Rng => {
	let state = 0;
	if (typeof seed === 'number' && Number.isFinite(seed)) state = Math.floor(seed) >>> 0;
	else {
		const text = String(seed);
		for (let index = 0; index < text.length; index += 1) state = Math.imul(state ^ text.charCodeAt(index), 0x9e3779b1) >>> 0;
	}
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const randomSuffix = (rng: Rng): string =>
	Math.floor(rng() * 36 ** 6)
		.toString(36)
		.padStart(6, '0');

// --- Mercator block mapper (server/services/map/coordinates.ts, zoom 19, scale 2, width 512) ---

const EARTH_RADIUS_METRES = 6_378_137;
const MIN_LATITUDE = -87;
const MAX_LATITUDE = 87;
const ZOOM = 19;
const WIDTH = 512;
const SCALE = 2;
const degreesPerMeterAtEquator = 360 / (2 * Math.PI * EARTH_RADIUS_METRES);
const metresAtEquatorPerTilePixel = 156_543.03392 / 2 ** ZOOM;
const xIncrement = degreesPerMeterAtEquator * metresAtEquatorPerTilePixel * (WIDTH / SCALE);
const yIndexScale = 180 / (Math.PI * xIncrement);
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const projectLatitude = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + toRadians(latitude) / 2));
const minLatitudeProjected = projectLatitude(MIN_LATITUDE);

export function blockForCoordinates(latitudeRaw: number, longitudeRaw: number): { blockX: number; blockY: number } {
	const latitude = Math.min(Math.max(latitudeRaw, MIN_LATITUDE), MAX_LATITUDE);
	const longitude = Math.min(Math.max(longitudeRaw, -180), 180 - Number.EPSILON);
	return {
		blockX: Math.max(0, Math.floor((longitude + 180) / xIncrement)),
		blockY: Math.max(0, Math.floor((projectLatitude(latitude) - minLatitudeProjected) * yIndexScale))
	};
}

// --- Shared shapes ------------------------------------------------------------------

const publicTile = (tile: WorldTile) => ({
	img: tile.img,
	img2: tile.img2 ?? null,
	terrain: tile.terrain,
	feature: tile.feature ?? null,
	solid: tile.solid
});

const turnPayload = (playerRecord: PartyMember, wildRecord: PartyMember, result: TurnResult) => ({
	player: memberFromBattleMon(playerRecord, result.player),
	wild: memberFromBattleMon(wildRecord, result.wild),
	log: result.log,
	outcome: result.outcome,
	...(result.exp ? { expGained: result.exp.gained, leveledUp: result.exp.leveledUp, newLevel: result.exp.newLevel } : {})
});

const MAX_VIEW_RADIUS_X = 8;
const MAX_VIEW_RADIUS_Y = 6;

// --- The pack -------------------------------------------------------------------------

export const POKEWORLD_PACK_ARITIES: Record<string, { min: number; max: number }> = {
	'pokeworld.species': { min: 1, max: 1 },
	'pokeworld.dex': { min: 0, max: 2 },
	'pokeworld.blockFor': { min: 2, max: 2 },
	'pokeworld.block': { min: 2, max: 2 },
	'pokeworld.view': { min: 1, max: 3 },
	'pokeworld.step': { min: 2, max: 3 },
	'pokeworld.encounter': { min: 1, max: 1 },
	'pokeworld.newPokemon': { min: 1, max: 1 },
	'pokeworld.stats': { min: 1, max: 1 },
	'pokeworld.moves': { min: 2, max: 2 },
	'pokeworld.battleTurn': { min: 1, max: 1 },
	'pokeworld.catchRoll': { min: 1, max: 1 },
	'pokeworld.runRoll': { min: 1, max: 1 },
	'pokeworld.useItem': { min: 1, max: 1 },
	'pokeworld.items': { min: 0, max: 0 },
	'pokeworld.defaultTrainer': { min: 0, max: 0 },
	'pokeworld.badges': { min: 0, max: 0 },
	'pokeworld.expGain': { min: 1, max: 1 },
	'pokeworld.levelFor': { min: 2, max: 2 }
};

export const pokeworldPack: ActionPack = {
	'pokeworld.species': ([idOrName]) => {
		const entry = asSpecies('species', idOrName, 'idOrName');
		return { ...entry, ...speciesSpriteSet(entry.id) };
	},

	'pokeworld.dex': ([pageArg, perPageArg]) => {
		const perPage = asInt('dex', perPageArg, 'perPage', 1, 200, 100);
		const total = NATIONAL_DEX_COUNT;
		const pages = Math.max(1, Math.ceil(total / perPage));
		const page = asInt('dex', pageArg, 'page', 1, pages, 1);
		const entries = allSpecies()
			.slice((page - 1) * perPage, page * perPage)
			.map((entry) => ({
				id: entry.id,
				name: entry.name,
				displayName: entry.displayName,
				types: entry.types,
				sprite: speciesSpriteUrl(entry.id),
				genus: entry.genus,
				isLegendary: entry.isLegendary
			}));
		return { page, pages, total, perPage, entries };
	},

	'pokeworld.blockFor': ([lat, lng]) => blockForCoordinates(asFinite('blockFor', lat, 'lat'), asFinite('blockFor', lng, 'lng')),

	'pokeworld.block': ([blockX, blockY]) =>
		generateBlock(
			asInt('block', blockX, 'blockX', -MAX_BLOCK_INDEX, MAX_BLOCK_INDEX),
			asInt('block', blockY, 'blockY', -MAX_BLOCK_INDEX, MAX_BLOCK_INDEX)
		),

	'pokeworld.view': ([positionArg, radiusXArg, radiusYArg]) => {
		const position = parsePosition('view', positionArg);
		const radiusX = asInt('view', radiusXArg, 'radiusX', 1, MAX_VIEW_RADIUS_X, 6);
		const radiusY = asInt('view', radiusYArg, 'radiusY', 1, MAX_VIEW_RADIUS_Y, 5);
		const reader = new WorldReader();
		const { gx, gy } = toGlobal(position);
		const playerUrl = playerSpriteUrl(position.gender, position.facing, 0);
		const rows = [];
		for (let dy = radiusY; dy >= -radiusY; dy -= 1) {
			const row = [];
			for (let dx = -radiusX; dx <= radiusX; dx += 1) {
				const located = reader.at(gx + dx, gy + dy);
				const isPlayer = dx === 0 && dy === 0;
				const cell: Record<string, unknown> = {
					url: tileUrl(located.tile.img),
					overlayUrl: located.tile.img2 ? tileUrl(located.tile.img2) : null,
					solid: located.tile.solid,
					feature: located.tile.feature ?? null,
					terrain: located.tile.terrain,
					isPlayer,
					playerUrl: isPlayer ? playerUrl : null,
					key: located.key
				};
				if (isPlayer) cell.flip = position.facing === 'left';
				row.push(cell);
			}
			rows.push(row);
		}
		return {
			rows,
			width: radiusX * 2 + 1,
			height: radiusY * 2 + 1,
			biome: reader.block(position.blockX, position.blockY).biome,
			position: { ...position, playerUrl, flip: position.facing === 'left' }
		};
	},

	'pokeworld.step': ([positionArg, directionArg, collectedArg], context) => {
		const position = parsePosition('step', positionArg);
		const direction = asDirection('step', directionArg);
		const collected = bagOfKeys(collectedArg);
		const reader = new WorldReader();
		const lookup: TileLookup = (x, y) => {
			const located = reader.at(x, y);
			return { tile: located.tile, key: located.key };
		};
		const { gx, gy } = toGlobal(position);
		const resolution = resolveMove(lookup, gx, gy, direction, collected, { surfing: position.surfing });
		const { dx, dy } = directionDelta[direction];
		const dialog = (pages: string[]) => (position.name ? formatDialogPages(pages, position.name) : pages).join('\n');

		if (resolution.kind === 'blocked') {
			const target = reader.at(gx + dx, gy + dy);
			return {
				position: { ...position, facing: direction },
				outcome: 'blocked',
				tile: publicTile(target.tile),
				biome: null,
				encounterChance: 0,
				encounterTriggered: false,
				item: null,
				itemKey: null,
				sign: isSignTile(target.tile) ? dialog(signPagesFor(target.gx, target.gy)) : null,
				house: isHouseTile(target.tile) ? dialog(housePagesFor(target.gx, target.gy)) : null,
				cave: null
			};
		}

		const destination = reader.at(resolution.toX, resolution.toY);
		const surfing = position.surfing && isSurfableTile(destination.tile);
		const outcome = position.surfing && !surfing ? 'dismount' : resolution.kind;
		const nearCave = isNearCaveEntrance(lookup, resolution.toX, resolution.toY, 3);
		const biome = encounterBiomeFor(destination.tile, { surfing, nearCave });
		const encounterChance = biome ? ENCOUNTER_STEP_CHANCE[biome] : 0;
		const hasItem = isFieldItemTile(destination.tile) && !collected(destination.key);
		const item = hasItem ? fieldItemFor(destination.gx, destination.gy) : null;
		return {
			position: { ...position, ...fromGlobal(resolution.toX, resolution.toY), facing: direction, surfing },
			outcome,
			tile: publicTile(destination.tile),
			biome,
			encounterChance,
			encounterTriggered: biome ? context.random() < encounterChance : false,
			item: item ? { id: item.id, name: item.name } : null,
			itemKey: item ? destination.key : null,
			sign: null,
			house: null,
			cave: isCaveEntranceTile(destination.tile) ? dialog(cavePagesFor(destination.gx, destination.gy)) : null
		};
	},

	'pokeworld.encounter': ([specArg], context) => {
		const spec = asRecord('encounter', specArg, 'spec');
		if (typeof spec.biome !== 'string' || !ENCOUNTER_BIOMES.includes(spec.biome as EncounterBiome)) {
			throw fail('encounter', 'biome must be long-grass, water or cave');
		}
		const lat = spec.lat === undefined || spec.lat === null ? Number.NaN : asFinite('encounter', spec.lat, 'lat');
		const lng = spec.lng === undefined || spec.lng === null ? Number.NaN : asFinite('encounter', spec.lng, 'lng');
		const rng = spec.seed === undefined || spec.seed === null ? context.random : seededRng(spec.seed);
		const result = rollEncounter(defaultSpawnRules(), spec.biome as EncounterBiome, lat, lng, rng);
		if (!result) return null;
		const species = getSpecies(result.speciesId) as PokedexEntry;
		return {
			speciesId: species.id,
			name: species.name,
			displayName: species.displayName,
			level: result.level,
			gender: result.gender,
			shiny: result.shiny,
			types: species.types,
			sprite: speciesSpriteUrl(species.id, { shiny: result.shiny }),
			ruleId: result.ruleId
		};
	},

	'pokeworld.newPokemon': ([specArg], context) => {
		const spec = asRecord('newPokemon', specArg, 'spec');
		const species = asSpecies('newPokemon', spec.speciesId ?? spec.species, 'speciesId');
		const level = asInt('newPokemon', spec.level, 'level', 1, 100, 5);
		const gender = asGender('newPokemon', spec.gender, species, context.random);
		const nickname = typeof spec.nickname === 'string' && spec.nickname.trim() ? spec.nickname.trim().slice(0, 12) : null;
		const iv = spec.ivs === undefined || spec.ivs === null ? undefined : asInt('newPokemon', spec.ivs, 'ivs', 0, 31);
		const id =
			typeof spec.id === 'string' && spec.id.trim()
				? spec.id.trim().slice(0, 64)
				: `pm-${context.now().getTime().toString(36)}-${randomSuffix(context.random)}`;
		return createPartyMember({ id, speciesId: species.id, level, gender, shiny: spec.shiny === true, nickname, iv });
	},

	'pokeworld.stats': ([specArg]) => {
		const spec = asRecord('stats', specArg, 'spec');
		const species = asSpecies('stats', spec.speciesId ?? spec.species, 'speciesId');
		const level = asInt('stats', spec.level, 'level', 1, 100);
		const iv = spec.ivs === undefined || spec.ivs === null ? undefined : asInt('stats', spec.ivs, 'ivs', 0, 31);
		const member = createPartyMember({ id: 'preview', speciesId: species.id, level, gender: 'male', iv });
		return { stats: member.stats, maxHp: member.maxHp };
	},

	'pokeworld.moves': ([speciesIdOrTypes, levelArg]) => {
		const level = asInt('moves', levelArg, 'level', 1, 100);
		let types: string[];
		if (Array.isArray(speciesIdOrTypes)) {
			types = speciesIdOrTypes.filter((type): type is string => typeof type === 'string').map((type) => type.trim().toUpperCase().slice(0, 16));
			if (!types.length || types.length > 2) throw fail('moves', 'types must list one or two type names');
		} else {
			types = asSpecies('moves', speciesIdOrTypes, 'speciesIdOrTypes').types;
		}
		return movesFor(types, level);
	},

	'pokeworld.battleTurn': ([specArg], context) => {
		const spec = asRecord('battleTurn', specArg, 'spec');
		const player = normalizeMember(spec.player, 'spec.player');
		const wild = normalizeMember(spec.wild, 'spec.wild');
		const moveIndex = asInt('battleTurn', spec.moveIndex, 'moveIndex', 0, 3, 0);
		return turnPayload(player, wild, resolveMoveTurn(player, wild, moveIndex, context.random));
	},

	'pokeworld.catchRoll': ([specArg], context) => {
		const spec = asRecord('catchRoll', specArg, 'spec');
		const wild = normalizeMember(spec.wild, 'spec.wild');
		// hasOwnProperty, not `in`: `in` walks the prototype chain, so
		// ball: 'constructor' would clear this guard and then multiply the catch
		// formula by a function — NaN all the way to a silent "broke free".
		if (typeof spec.ball !== 'string' || !Object.prototype.hasOwnProperty.call(BALL_BONUS, spec.ball)) {
			throw fail('catchRoll', 'ball must be poke-ball, great-ball or ultra-ball');
		}
		const ball = spec.ball;
		const player = spec.player === undefined || spec.player === null ? null : normalizeMember(spec.player, 'spec.player');
		const thrown = `You threw a ${ball.replace(/-/g, ' ').toUpperCase()}!`;
		const result = catchAttempt(battleMonFromMember(wild, true), ball, context.random);
		if (result.caught) {
			const species = getSpecies(wild.speciesId) as PokedexEntry;
			const member: PartyMember = {
				...wild,
				id: `caught-${context.now().getTime().toString(36)}-${randomSuffix(context.random)}`,
				exp: expForLevel(species.growthRate, wild.level),
				hp: Math.max(1, wild.hp)
			};
			const log = [thrown, 'Gotcha!', `${wild.species} was caught!`];
			return { caught: true, shakes: 3, message: log.slice(1).join(' '), log, wild, member, ...(player ? { player } : {}) };
		}
		const message = BALL_BREAK_FLAVOR[result.shakes];
		if (!player) return { caught: false, shakes: result.shakes, message, log: [thrown, message], wild };
		return {
			caught: false,
			shakes: result.shakes,
			message,
			...turnPayload(player, wild, resolveWildTurn(player, wild, context.random, [thrown, message]))
		};
	},

	'pokeworld.runRoll': ([specArg], context) => {
		const spec = asRecord('runRoll', specArg, 'spec');
		const player = normalizeMember(spec.player, 'spec.player');
		const wild = normalizeMember(spec.wild, 'spec.wild');
		const attempts = asInt('runRoll', spec.attempts, 'attempts', 0, 1000, 0) + 1;
		const result = runAttempt(battleMonFromMember(player), battleMonFromMember(wild, true), attempts, context.random);
		if (result.escaped) return { escaped: true, message: 'Got away safely!', attempts, log: ['Got away safely!'], player, wild };
		return {
			escaped: false,
			message: "Can't escape!",
			attempts,
			...turnPayload(player, wild, resolveWildTurn(player, wild, context.random, ["Can't escape!"]))
		};
	},

	'pokeworld.useItem': ([specArg]) => {
		const spec = asRecord('useItem', specArg, 'spec');
		const member = normalizeMember(spec.member, 'spec.member');
		if (typeof spec.itemId !== 'string' || !catalogueItem(spec.itemId)) {
			throw fail('useItem', `itemId must be one of ${ITEM_CATALOGUE.map((item) => item.id).join(', ')}`);
		}
		if (spec.inBattle === true) {
			const applied = applyBattleItem(battleMonFromMember(member), spec.itemId);
			return { member: memberFromBattleMon(member, applied.mon), message: applied.message, consumed: applied.changed };
		}
		const used = applyBagItem(member, spec.itemId);
		return { member: used.member, message: used.message, consumed: used.consumed };
	},

	'pokeworld.items': () => ITEM_CATALOGUE.map((item) => ({ ...item })),

	'pokeworld.defaultTrainer': (_args, context) =>
		buildDefaultTrainer((spec) => {
			const species = getSpecies(spec.speciesId) as PokedexEntry;
			return createPartyMember({ ...spec, gender: rollGender(species.genderRate, context.random) });
		}),

	'pokeworld.badges': () => HOENN_BADGES.map((badge) => ({ ...badge, earned: false })),

	'pokeworld.expGain': ([specArg]) => {
		const spec = asRecord('expGain', specArg, 'spec');
		const member = normalizeMember(spec.member, 'spec.member');
		const defeated = asSpecies('expGain', spec.defeatedSpeciesId, 'defeatedSpeciesId');
		const defeatedLevel = asInt('expGain', spec.defeatedLevel, 'defeatedLevel', 1, 100);
		const gained = expGainForDefeat(defeated, defeatedLevel);
		const granted = grantExperience(member, gained);
		return { member: granted.member, gained, leveledUp: granted.levelsGained > 0, newLevel: granted.member.level };
	},

	'pokeworld.levelFor': ([growthRate, exp]) => {
		if (typeof growthRate !== 'string' || !growthRate.trim()) throw fail('levelFor', 'growthRate must be a growth curve name');
		const amount = asFinite('levelFor', exp, 'exp');
		if (amount < 0) throw fail('levelFor', 'exp must be non-negative');
		return levelForExp(growthRate.trim().toLowerCase(), amount);
	}
};

export type PokeworldPackFunctionName = keyof typeof POKEWORLD_PACK_ARITIES;

export const pokeworldPackContext = (random: Rng, now: () => Date = () => new Date()): PackContext => ({ random, now });


// The species catalogue as PUBLIC DATA THINGS (seeded by
// api/utils/webpages/seed.ts as data-app-pokeworld-species-<id>): the same
// record `pokeworld.species` answers with, minus the long flavour text, so
// the pokédex is browsable on /things and searchable in public scope.
export type PokeworldSpeciesSeed = {
	id: number;
	name: string;
	displayName: string;
	types: string[];
	baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
	catchRate: number;
	genderRate: number;
	baseExp: number;
	growthRate: string;
	isLegendary: boolean;
	genus: string;
	flavor: string;
	heightM: number;
	weightKg: number;
	sprite: string;
};

export const POKEWORLD_SPECIES_SEED: PokeworldSpeciesSeed[] = allSpecies().map((species) => ({
	id: species.id,
	name: species.name,
	displayName: species.displayName,
	types: [...species.types],
	baseStats: { ...species.baseStats },
	catchRate: species.catchRate,
	genderRate: species.genderRate,
	baseExp: species.baseExp,
	growthRate: species.growthRate,
	isLegendary: species.isLegendary,
	genus: species.genus,
	flavor: species.flavor,
	heightM: species.heightM,
	weightKg: species.weightKg,
	sprite: speciesSpriteUrl(species.id)
}));
