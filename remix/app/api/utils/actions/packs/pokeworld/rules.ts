// Overworld rules, ported from the Pokeworld app (src/lib/game-rules.ts) plus
// the deterministic hash/noise helpers from the legacy terrain generator
// (server/services/map/legacy/mods/terrain-life.ts). Coordinates here are
// WORLD TILE coordinates (one unit = one tile) rather than the source app's
// 32px map pixels; world +y is north, exactly like the original.

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

// World-tile deltas. World +y is north/up-screen, so `up` increases y.
export const directionDelta: Record<Direction, { dx: number; dy: number }> = {
	up: { dx: 0, dy: 1 },
	down: { dx: 0, dy: -1 },
	left: { dx: -1, dy: 0 },
	right: { dx: 1, dy: 0 }
};

// --- Deterministic hashing ---------------------------------------------------

/** Unit-interval hash of an integer coordinate pair + salt (terrain-life parity). */
export const hashUnit = (x: number, y: number, salt = ''): number => {
	let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b);
	value ^= Math.imul((y | 0) ^ 0xc2b2ae35, 0x27d4eb2d);
	for (let index = 0; index < salt.length; index += 1) {
		value = Math.imul(value ^ salt.charCodeAt(index), 0x165667b1);
	}
	value ^= value >>> 16;
	return (value >>> 0) / 0x100000000;
};

const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
const smoothstep = (value: number) => value * value * (3 - 2 * value);

/** Smoothly interpolated value noise over `scale`-sized cells (terrain-life parity). */
export const coarseNoise = (x: number, y: number, salt = '', scale = 6): number => {
	const cellX = Math.floor(x / scale);
	const cellY = Math.floor(y / scale);
	const offsetX = smoothstep(x / scale - cellX);
	const offsetY = smoothstep(y / scale - cellY);
	const top = lerp(hashUnit(cellX, cellY, salt), hashUnit(cellX + 1, cellY, salt), offsetX);
	const bottom = lerp(hashUnit(cellX, cellY + 1, salt), hashUnit(cellX + 1, cellY + 1, salt), offsetX);
	return lerp(top, bottom, offsetY);
};

// --- Tile predicates ---------------------------------------------------------

export type RuleTile = {
	img?: string;
	img2?: string;
	terrain?: string;
	feature?: string;
	solid?: boolean;
};

const img2Of = (tile: RuleTile | undefined) => String(tile?.img2 ?? '');

export const isLedgeTile = (tile: RuleTile | undefined): boolean => !!tile && (tile.feature === 'ledge' || img2Of(tile).startsWith('ledge-'));

export const isFieldItemTile = (tile: RuleTile | undefined): boolean =>
	!!tile && (tile.feature === 'field-item' || tile.feature === 'hidden-item' || img2Of(tile).startsWith('field-item'));

export const isSignTile = (tile: RuleTile | undefined): boolean => !!tile && (tile.feature === 'sign' || img2Of(tile).startsWith('route-sign'));

export const isCaveEntranceTile = (tile: RuleTile | undefined): boolean => !!tile && tile.feature === 'cave-entrance';

export const isHouseTile = (tile: RuleTile | undefined): boolean => !!tile && tile.feature === 'house';

// Surfable water: solid to walkers, open water to surfers.
export const isSurfableTile = (tile: RuleTile | undefined): boolean =>
	!!tile && (tile.terrain === 'water' || String(tile.img ?? '').startsWith('pond-') || String(tile.img ?? '').startsWith('water'));

/** Tile lookup by world tile coordinate; `key` is the collected-item key for the tile. */
export type TileLookup = (x: number, y: number) => { tile: RuleTile; key: string } | undefined;
export type CollectedLookup = (coordKey: string) => boolean;

export const isSolidFor = (located: { tile: RuleTile; key: string } | undefined, collected: CollectedLookup): boolean => {
	if (!located || !located.tile.solid) return false;
	if (isFieldItemTile(located.tile) && collected(located.key)) return false;
	return true;
};

export type MoveResolution =
	| { kind: 'move'; toX: number; toY: number }
	| { kind: 'jump'; toX: number; toY: number; overX: number; overY: number }
	| { kind: 'blocked' };

export function resolveMove(
	lookup: TileLookup,
	fromX: number,
	fromY: number,
	direction: Direction,
	collected: CollectedLookup,
	options: { surfing?: boolean } = {}
): MoveResolution {
	const { dx, dy } = directionDelta[direction];
	const toX = fromX + dx;
	const toY = fromY + dy;
	const target = lookup(toX, toY);
	if (!target) return { kind: 'move', toX, toY };

	// While surfing, water is open and everything else keeps its walking rules
	// (stepping onto walkable land dismounts — the caller handles that flag).
	if (options.surfing && isSurfableTile(target.tile)) return { kind: 'move', toX, toY };

	if (isLedgeTile(target.tile)) {
		// Ledges are jumped from above, moving screen-down (world -y), landing on
		// the far side. Every other approach is a wall.
		if (direction === 'down') {
			const landX = toX + dx;
			const landY = toY + dy;
			const landing = lookup(landX, landY);
			if (!isSolidFor(landing, collected) && !isLedgeTile(landing?.tile)) {
				return { kind: 'jump', toX: landX, toY: landY, overX: toX, overY: toY };
			}
		}
		return { kind: 'blocked' };
	}

	if (isSolidFor(target, collected)) return { kind: 'blocked' };
	return { kind: 'move', toX, toY };
}

// --- Field items -------------------------------------------------------------

export type PocketName = 'items' | 'pokeballs' | 'keyItems';

export interface FieldItem {
	id: string;
	name: string;
	pocket: PocketName;
	description: string;
}

export const FIELD_ITEM_TABLE: Array<{ weight: number; item: FieldItem }> = [
	{ weight: 30, item: { id: 'poke-ball', name: 'POKé BALL', pocket: 'pokeballs', description: 'A tool for catching wild POKéMON.' } },
	{ weight: 18, item: { id: 'potion', name: 'POTION', pocket: 'items', description: 'Restores 20 HP of one POKéMON.' } },
	{ weight: 10, item: { id: 'super-potion', name: 'SUPER POTION', pocket: 'items', description: 'Restores 50 HP of one POKéMON.' } },
	{ weight: 10, item: { id: 'great-ball', name: 'GREAT BALL', pocket: 'pokeballs', description: 'A good BALL with a higher catch rate.' } },
	{ weight: 8, item: { id: 'antidote', name: 'ANTIDOTE', pocket: 'items', description: 'Heals a poisoned POKéMON.' } },
	{ weight: 7, item: { id: 'revive', name: 'REVIVE', pocket: 'items', description: 'Revives a fainted POKéMON with half HP.' } },
	{ weight: 6, item: { id: 'rare-candy', name: 'RARE CANDY', pocket: 'items', description: "Raises a POKéMON's level by one." } },
	{ weight: 5, item: { id: 'nugget', name: 'NUGGET', pocket: 'items', description: 'A pure gold nugget. Sells high.' } },
	{ weight: 4, item: { id: 'ultra-ball', name: 'ULTRA BALL', pocket: 'pokeballs', description: 'A top-grade BALL with a great catch rate.' } },
	{ weight: 2, item: { id: 'max-revive', name: 'MAX REVIVE', pocket: 'items', description: 'Fully revives a fainted POKéMON.' } }
];

export function fieldItemFor(x: number, y: number, preferredId?: string): FieldItem {
	const normalizedPreferredId = preferredId === 'pokeball' ? 'poke-ball' : preferredId;
	const preferred = FIELD_ITEM_TABLE.find((entry) => entry.item.id === normalizedPreferredId);
	if (preferred) return preferred.item;
	const roll = hashUnit(x, y, 'field-item');
	const total = FIELD_ITEM_TABLE.reduce((sum, entry) => sum + entry.weight, 0);
	let remaining = roll * total;
	for (const entry of FIELD_ITEM_TABLE) {
		remaining -= entry.weight;
		if (remaining < 0) return entry.item;
	}
	return FIELD_ITEM_TABLE[0].item;
}

// --- Dialog ------------------------------------------------------------------

const SIGN_PAGES: Array<(route: number) => string[]> = [
	(route) => [`ROUTE ${route}`, 'TRAINER TIPS\nLong grass loves to hide\nsurprises... and POKéMON.'],
	(route) => [`ROUTE ${route}`, 'TRAINER TIPS\nLedges only work one way.\nGravity is famously stubborn.'],
	(route) => [`ROUTE ${route}`, 'Berry seedlings planted here\nwill grow one day. Probably.'],
	(route) => [`ROUTE ${route} — scenic outlook`, 'Someone has scratched a doodle\nof a MUDKIP into the corner.'],
	(route) => [`ROUTE ${route}`, 'NOTICE\nHidden items sparkle for those\nwho press A with conviction.'],
	(route) => [`ROUTE ${route}`, '“The world is bigger than any\nmap of it.” — a wandering sage'],
	(route) => [`ROUTE ${route}`, 'LOST: one BIKE.\nIf found, please ride it\nsomewhere fun.'],
	(route) => [`ROUTE ${route}`, 'TRAINER TIPS\nTalk to signs. You never know\nwhich ones talk back.'],
	(route) => [`ROUTE ${route}`, 'Is that {PLAYER}?!\nSomeone carved your name\ninto this very sign.'],
	(route) => [`ROUTE ${route}`, 'TRAINER TIPS\nKeep it up, {PLAYER}!\nEvery master started small.']
];

/** Replaces {PLAYER} tokens so NPC/sign dialog addresses the trainer by name. */
export const formatDialogPages = (pages: string[], playerName: string): string[] => pages.map((page) => page.split('{PLAYER}').join(playerName));

/** True when a tile within `radius` tiles hosts a cave entrance (cave hunting zone). */
export function isNearCaveEntrance(lookup: TileLookup, x: number, y: number, radius = 3): boolean {
	for (let dx = -radius; dx <= radius; dx += 1) {
		for (let dy = -radius; dy <= radius; dy += 1) {
			if (isCaveEntranceTile(lookup(x + dx, y + dy)?.tile)) return true;
		}
	}
	return false;
}

export function signPagesFor(x: number, y: number): string[] {
	const route = 101 + Math.floor(hashUnit(x, y, 'route') * 33);
	const index = Math.floor(hashUnit(x, y, 'sign-text') * SIGN_PAGES.length);
	return SIGN_PAGES[Math.min(index, SIGN_PAGES.length - 1)](route);
}

const CAVE_PAGES: string[][] = [
	['The cave mouth yawns darkly.', 'A cool draft whispers from\nsomewhere deep within...'],
	['Rough stone steps descend\ninto the dark.', "You'll need more courage\n(and a later update) to enter."],
	['Something glitters faintly\ninside the cave.', 'The darkness stares back,\npolitely, for now.']
];

export function cavePagesFor(x: number, y: number): string[] {
	const index = Math.floor(hashUnit(x, y, 'cave-text') * CAVE_PAGES.length);
	return CAVE_PAGES[Math.min(index, CAVE_PAGES.length - 1)];
}

const HOUSE_PAGES: string[][] = [
	['Knock knock.', '...no one answered.\nThe curtains twitched, though.'],
	['The door is locked.', 'A doormat reads:\n“GO AWAY (unless you brought\nBERRIES).”'],
	['You hear a TV inside.', 'Someone is watching a show\nabout dramatic WAILORD rescues.'],
	['Voices drift through the door.', '“...and then {PLAYER} walked by!\nA real TRAINER, right here!”']
];

export function housePagesFor(x: number, y: number): string[] {
	const index = Math.floor(hashUnit(x, y, 'house-text') * HOUSE_PAGES.length);
	return HOUSE_PAGES[Math.min(index, HOUSE_PAGES.length - 1)];
}

export interface Interaction {
	type: 'sign' | 'item' | 'cave' | 'house' | 'none';
	pages?: string[];
}

export function interactionFor(located: { tile: RuleTile; key: string; x: number; y: number } | undefined, collected: CollectedLookup): Interaction {
	if (!located) return { type: 'none' };
	const { tile } = located;
	if (isFieldItemTile(tile)) {
		if (collected(located.key)) return { type: 'none' };
		return { type: 'item' };
	}
	if (isSignTile(tile)) return { type: 'sign', pages: signPagesFor(located.x, located.y) };
	if (isCaveEntranceTile(tile)) return { type: 'cave', pages: cavePagesFor(located.x, located.y) };
	if (tile.feature === 'house') return { type: 'house', pages: housePagesFor(located.x, located.y) };
	return { type: 'none' };
}
