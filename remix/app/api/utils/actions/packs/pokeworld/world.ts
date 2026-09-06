// Deterministic procedural overworld: 16×16 tile blocks generated purely from
// (blockX, blockY), in the spirit of the legacy terrain-life generator but
// without Google Maps. Every decision is a hash of coordinates, so the same
// block is always identical and neighbouring blocks agree at their seams
// without ever seeing each other:
//
// - Path portals are hashed on the SEAM's identity (`sharedPortal`, exactly
//   like terrain-life): the east portal of (x, y) and the west portal of
//   (x+1, y) are both `sharedPortal(x + 1, y, 'vertical-portal')`. West/east
//   seams are always open, so a two-tile-wide winding path always crosses the
//   block; north/south seams open on a seam-hashed coin flip.
// - Forest, meadow and pond noise is sampled in WORLD tile coordinates, so
//   groves and meadows continue across seams.
// - Water is kept off the border ring and eroded into pond-tileset-legal
//   shapes (every water tile in a 2×2 square, at most one land diagonal,
//   no kissing corners), so every pond composes with pond-1..9 / 20 / 21 /
//   24 / 25 / center-*.
// - The central 4×4 landing (6..9) is always plain grass or path, so the
//   spawn tile (8,8) is walkable and, because the path's waypoint sits inside
//   the landing, connected to both the west and east portals.
//
// Tile coordinates: x 0..15 west→east, y 0..15 south→north (+y = north).

import { coarseNoise, hashUnit } from './rules';

export const BLOCK_TILES = 16;
export const SPAWN_TILE = { x: 8, y: 8 } as const;

export const BIOMES = ['emerald-meadow', 'petal-woodland', 'granite-highland', 'tidal-green', 'village-green', 'wild-route'] as const;
export type BiomeName = (typeof BIOMES)[number];

export type WorldTerrain = 'grass' | 'water' | 'path' | 'rocky';

export interface WorldTile {
	x: number;
	y: number;
	img: string;
	img2?: string;
	terrain: WorldTerrain;
	solid: boolean;
	feature?: string;
}

export interface WorldBlock {
	x: number;
	y: number;
	biome: BiomeName;
	tiles: WorldTile[];
}

interface BiomeProfile {
	/** coarseNoise threshold above which a tile grows a tree (lower = denser). */
	forest: number;
	/** coarseNoise threshold above which grass becomes long grass. */
	meadow: number;
	/** coarseNoise threshold above which land becomes pond water. */
	pond: number;
	/** Per-tile rock chance on plain grass. */
	rocks: number;
	/** Per-tile flower chance inside flower noise. */
	flowers: number;
	/** Per-block chances. */
	house: number;
	sign: number;
	cave: number;
	/** Per-tile hidden item chance on plain grass. */
	hiddenItems: number;
}

const BIOME_PROFILES: Record<BiomeName, BiomeProfile> = {
	'emerald-meadow': { forest: 0.66, meadow: 0.5, pond: 0.64, rocks: 0.015, flowers: 0.35, house: 0.12, sign: 0.45, cave: 0.1, hiddenItems: 0.012 },
	'petal-woodland': { forest: 0.53, meadow: 0.56, pond: 0.68, rocks: 0.015, flowers: 0.6, house: 0.06, sign: 0.3, cave: 0.08, hiddenItems: 0.014 },
	'granite-highland': { forest: 0.6, meadow: 0.58, pond: 0.7, rocks: 0.07, flowers: 0.1, house: 0.04, sign: 0.35, cave: 0.5, hiddenItems: 0.014 },
	'tidal-green': { forest: 0.64, meadow: 0.54, pond: 0.56, rocks: 0.025, flowers: 0.25, house: 0.08, sign: 0.4, cave: 0.05, hiddenItems: 0.012 },
	'village-green': { forest: 0.7, meadow: 0.58, pond: 0.68, rocks: 0.008, flowers: 0.5, house: 0.45, sign: 0.7, cave: 0.03, hiddenItems: 0.01 },
	'wild-route': { forest: 0.58, meadow: 0.48, pond: 0.66, rocks: 0.035, flowers: 0.2, house: 0.05, sign: 0.4, cave: 0.2, hiddenItems: 0.016 }
};

type Role =
	| 'grass'
	| 'long-grass'
	| 'tree'
	| 'grand-1'
	| 'grand-2'
	| 'grand-3'
	| 'grand-4'
	| 'water'
	| 'path'
	| 'rock'
	| 'boulder'
	| 'flower-1'
	| 'flower-2'
	| 'flower-3'
	| 'sign'
	| 'rocky'
	| 'cave'
	| 'hidden-item'
	| `house-${number}`;

const LANDING_MIN = 6;
const LANDING_MAX = 9;

const inBlock = (x: number, y: number) => x >= 0 && x < BLOCK_TILES && y >= 0 && y < BLOCK_TILES;
const isInterior = (x: number, y: number) => x >= 1 && x <= BLOCK_TILES - 2 && y >= 1 && y <= BLOCK_TILES - 2;
const isLanding = (x: number, y: number) => x >= LANDING_MIN && x <= LANDING_MAX && y >= LANDING_MIN && y <= LANDING_MAX;

export const biomeFor = (blockX: number, blockY: number): BiomeName =>
	BIOMES[Math.min(BIOMES.length - 1, Math.floor(hashUnit(blockX, blockY, 'biome') * BIOMES.length))];

/** Seam-shared portal offset (1..13) — identical from both sides of a seam. */
export const sharedPortal = (x: number, y: number, salt: string): number => 1 + Math.floor(hashUnit(x, y, salt) * (BLOCK_TILES - 3));

/** Whether the seam between (x, y) and (x, y+1) carries a path (always true for west/east seams). */
export const horizontalSeamOpen = (x: number, yNorth: number): boolean => hashUnit(x, yNorth, 'horizontal-seam') < 0.55;

export interface BlockPortals {
	west: number; // y of the two west portal tiles (west, west+1)
	east: number;
	south: number | null; // x of the two south portal tiles, or null when closed
	north: number | null;
}

export function portalsFor(blockX: number, blockY: number): BlockPortals {
	return {
		west: sharedPortal(blockX, blockY, 'vertical-portal'),
		east: sharedPortal(blockX + 1, blockY, 'vertical-portal'),
		south: horizontalSeamOpen(blockX, blockY) ? sharedPortal(blockX, blockY, 'horizontal-portal') : null,
		north: horizontalSeamOpen(blockX, blockY + 1) ? sharedPortal(blockX, blockY + 1, 'horizontal-portal') : null
	};
}

class Grid {
	readonly roles: Role[] = new Array<Role>(BLOCK_TILES * BLOCK_TILES).fill('grass');

	get(x: number, y: number): Role | undefined {
		return inBlock(x, y) ? this.roles[y * BLOCK_TILES + x] : undefined;
	}

	set(x: number, y: number, role: Role): void {
		if (inBlock(x, y)) this.roles[y * BLOCK_TILES + x] = role;
	}

	is(x: number, y: number, role: Role): boolean {
		return this.get(x, y) === role;
	}
}

// --- Path ----------------------------------------------------------------------

type Cell = [number, number];

const lineCells = (from: Cell, to: Cell): Cell[] => {
	const cells: Cell[] = [];
	const [x0, y0] = from;
	const [x1, y1] = to;
	if (x0 === x1) {
		const step = y1 >= y0 ? 1 : -1;
		for (let y = y0; y !== y1 + step; y += step) cells.push([x0, y]);
	} else {
		const step = x1 >= x0 ? 1 : -1;
		for (let x = x0; x !== x1 + step; x += step) cells.push([x, y0]);
	}
	return cells;
};

/** Manhattan L-route from → bend → to, as a cell list. */
const lRoute = (from: Cell, bend: Cell, to: Cell): Cell[] => [...lineCells(from, bend), ...lineCells(bend, to)];

const stampPath = (grid: Grid, cells: Cell[]) => {
	for (const [x, y] of cells) {
		for (const [dx, dy] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1]
		]) {
			if (inBlock(x + dx, y + dy)) grid.set(x + dx, y + dy, 'path');
		}
	}
};

const rangeHash = (blockX: number, blockY: number, salt: string, min: number, max: number) =>
	min + Math.floor(hashUnit(blockX, blockY, salt) * Math.max(1, max - min + 1));

function carvePath(grid: Grid, blockX: number, blockY: number, portals: BlockPortals): Cell {
	// Waypoint inside the landing (6..8 so the 2×2 stamp stays within 6..9).
	const wx = rangeHash(blockX, blockY, 'waypoint-x', LANDING_MIN, LANDING_MAX - 1);
	const wy = rangeHash(blockX, blockY, 'waypoint-y', LANDING_MIN, LANDING_MAX - 1);
	const waypoint: Cell = [wx, wy];

	// West leg: (0, west) → bend column → waypoint row.
	const bendWest = rangeHash(blockX, blockY, 'bend-west', 1, wx - 1);
	stampPath(grid, [...lineCells([0, portals.west], [bendWest, portals.west]), ...lRoute([bendWest, portals.west], [bendWest, wy], waypoint)]);

	// East leg: waypoint → bend column → (15, east). Route cells stay ≤ 13 so the
	// 2×2 stamp never touches the border except at the portal pair itself.
	const bendEast = rangeHash(blockX, blockY, 'bend-east', wx + 2, BLOCK_TILES - 3);
	stampPath(grid, [
		...lRoute(waypoint, [bendEast, wy], [bendEast, portals.east]),
		...lineCells([bendEast, portals.east], [BLOCK_TILES - 1, portals.east])
	]);

	// Optional north branch: (north, 15) ↓ bend row → waypoint column ↓ waypoint.
	if (portals.north !== null) {
		const bendNorth = rangeHash(blockX, blockY, 'bend-north', wy + 2, BLOCK_TILES - 3);
		stampPath(grid, [
			...lineCells([portals.north, BLOCK_TILES - 1], [portals.north, bendNorth]),
			...lRoute([portals.north, bendNorth], [wx, bendNorth], waypoint)
		]);
	}

	// Optional south branch: (south, 0) ↑ bend row → waypoint column ↑ waypoint.
	if (portals.south !== null) {
		const bendSouth = rangeHash(blockX, blockY, 'bend-south', 1, wy - 2);
		stampPath(grid, [...lineCells([portals.south, 0], [portals.south, bendSouth]), ...lRoute([portals.south, bendSouth], [wx, bendSouth], waypoint)]);
	}
	return waypoint;
}

// --- Water ---------------------------------------------------------------------

const DIAGONALS: Cell[] = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1]
];

interface WaterNeighbours {
	north: boolean;
	east: boolean;
	south: boolean;
	west: boolean;
	northWest: boolean;
	northEast: boolean;
	southWest: boolean;
	southEast: boolean;
}

const waterNeighbours = (grid: Grid, x: number, y: number): WaterNeighbours => ({
	north: grid.is(x, y + 1, 'water'),
	east: grid.is(x + 1, y, 'water'),
	south: grid.is(x, y - 1, 'water'),
	west: grid.is(x - 1, y, 'water'),
	northWest: grid.is(x - 1, y + 1, 'water'),
	northEast: grid.is(x + 1, y + 1, 'water'),
	southWest: grid.is(x - 1, y - 1, 'water'),
	southEast: grid.is(x + 1, y - 1, 'water')
});

const inWaterSquare = (grid: Grid, x: number, y: number) =>
	DIAGONALS.some(([dx, dy]) => grid.is(x + dx, y, 'water') && grid.is(x, y + dy, 'water') && grid.is(x + dx, y + dy, 'water'));

const FLOODABLE: Role[] = ['grass', 'long-grass', 'tree'];

// Port of terrain-life smoothWater: the pond tileset can only draw a closed
// shoreline when every water tile sits inside at least one full 2×2 square,
// surrounded tiles have at most one land diagonal, and no two water bodies
// touch corner-to-corner. Erode offenders (and flood SW/SE notches, whose
// inner-corner art is unusable) until the water mass is representable.
function smoothWater(grid: Grid, reserved: Set<number>) {
	for (let pass = 0; pass < 40; pass += 1) {
		let changed = false;
		for (let y = 0; y < BLOCK_TILES; y += 1) {
			for (let x = 0; x < BLOCK_TILES; x += 1) {
				if (!grid.is(x, y, 'water')) continue;
				const n = waterNeighbours(grid, x, y);
				const landDiagonals = [n.northWest, n.northEast, n.southWest, n.southEast].filter((value) => !value).length;
				const surrounded = n.north && n.east && n.south && n.west;
				const kissingCorner =
					(!n.north && !n.east && n.northEast) ||
					(!n.north && !n.west && n.northWest) ||
					(!n.south && !n.east && n.southEast) ||
					(!n.south && !n.west && n.southWest);
				if (!inWaterSquare(grid, x, y) || (surrounded && landDiagonals >= 2) || kissingCorner) {
					grid.set(x, y, 'grass');
					changed = true;
					continue;
				}
				for (const [offsetX, offsetY] of [
					[-1, -1],
					[1, -1]
				]) {
					const diagonalSame = offsetX === -1 ? n.southWest : n.southEast;
					if (!surrounded || diagonalSame) continue;
					const nx = x + offsetX;
					const ny = y + offsetY;
					const role = grid.get(nx, ny);
					if (role && FLOODABLE.includes(role) && isInterior(nx, ny) && !reserved.has(ny * BLOCK_TILES + nx)) {
						grid.set(nx, ny, 'water');
						changed = true;
					}
				}
			}
		}
		if (!changed) break;
	}
	// Final pure erosion so the 2×2 invariant holds even if the pass cap hit.
	for (;;) {
		let changed = false;
		for (let y = 0; y < BLOCK_TILES; y += 1) {
			for (let x = 0; x < BLOCK_TILES; x += 1) {
				if (grid.is(x, y, 'water') && !inWaterSquare(grid, x, y)) {
					grid.set(x, y, 'grass');
					changed = true;
				}
			}
		}
		if (!changed) break;
	}
}

// --- Autotiles ----------------------------------------------------------------

export const getAutotileIndex = ({ north, east, south, west }: { north: boolean; east: boolean; south: boolean; west: boolean }): number => {
	if (!north && east && south && !west) return 1;
	if (!north && east && south && west) return 2;
	if (!north && !east && south && west) return 3;
	if (north && east && south && !west) return 4;
	if (north && !east && south && west) return 6;
	if (north && east && !south && !west) return 7;
	if (north && east && !south && west) return 8;
	if (north && !east && !south && west) return 9;
	return 5;
};

export const getWaterTileName = (neighbours: WaterNeighbours, gx: number, gy: number): string => {
	const { north, east, south, west, northWest, northEast } = neighbours;
	if (north && south && east && west) {
		if (!northWest) return 'pond-20';
		if (!northEast) return 'pond-21';
		return `pond-center-${1 + Math.floor(hashUnit(gx, gy, 'water-ripple') * 4)}`;
	}
	if (north && south && east && !west && !neighbours.northWest && !neighbours.southWest) return 'pond-25';
	if (north && south && !east && west && !neighbours.northEast && !neighbours.southEast) return 'pond-24';
	return `pond-${getAutotileIndex(neighbours)}`;
};

// Out-of-block neighbours count as "same" (terrain-life parity): the only path
// tiles on the border are portal pairs, whose continuation across the seam is
// guaranteed by construction.
const pathNeighbours = (grid: Grid, x: number, y: number) => {
	const same = (nx: number, ny: number) => !inBlock(nx, ny) || grid.is(nx, ny, 'path');
	return { north: same(x, y + 1), east: same(x + 1, y), south: same(x, y - 1), west: same(x - 1, y) };
};

// --- Structures ----------------------------------------------------------------

const scanOrder = (blockX: number, blockY: number, salt: string): Cell[] => {
	const startX = Math.floor(hashUnit(blockX, blockY, `${salt}-x`) * BLOCK_TILES);
	const startY = Math.floor(hashUnit(blockX, blockY, `${salt}-y`) * BLOCK_TILES);
	const cells: Cell[] = [];
	for (let dy = 0; dy < BLOCK_TILES; dy += 1) {
		for (let dx = 0; dx < BLOCK_TILES; dx += 1) {
			cells.push([(startX + dx) % BLOCK_TILES, (startY + dy) % BLOCK_TILES]);
		}
	}
	return cells;
};

/** A columns×rows footprint of plain interior grass whose top-left (north-west) corner is (left, top). */
const plainFootprint = (grid: Grid, reserved: Set<number>, left: number, top: number, columns: number, rows: number): Cell[] | null => {
	const cells: Cell[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const x = left + column;
			const y = top - row;
			if (!isInterior(x, y) || !grid.is(x, y, 'grass') || reserved.has(y * BLOCK_TILES + x)) return null;
			cells.push([x, y]);
		}
	}
	return cells;
};

const touchesRole = (grid: Grid, x: number, y: number, role: Role) =>
	grid.is(x + 1, y, role) || grid.is(x - 1, y, role) || grid.is(x, y + 1, role) || grid.is(x, y - 1, role);

function placeHouse(grid: Grid, reserved: Set<number>, blockX: number, blockY: number) {
	for (const [left, top] of scanOrder(blockX, blockY, 'house')) {
		// Keep one clear grass row south of the door so the house is approachable.
		const footprint = plainFootprint(grid, reserved, left, top, 3, 4);
		if (!footprint) continue;
		const doorstep = plainFootprint(grid, reserved, left, top - 4, 3, 1);
		if (!doorstep) continue;
		footprint.forEach(([x, y], index) => {
			grid.set(x, y, `house-${index + 1}`);
			reserved.add(y * BLOCK_TILES + x);
		});
		for (const [x, y] of doorstep) reserved.add(y * BLOCK_TILES + x);
		return;
	}
}

function placeCave(grid: Grid, reserved: Set<number>, blockX: number, blockY: number) {
	for (const [left, top] of scanOrder(blockX, blockY, 'cave')) {
		const footprint = plainFootprint(grid, reserved, left, top, 3, 3);
		if (!footprint) continue;
		footprint.forEach(([x, y], index) => {
			grid.set(x, y, index === 1 ? 'cave' : 'rocky');
			reserved.add(y * BLOCK_TILES + x);
		});
		return;
	}
}

function placeSign(grid: Grid, reserved: Set<number>, blockX: number, blockY: number) {
	for (const [x, y] of scanOrder(blockX, blockY, 'sign')) {
		if (!isInterior(x, y) || !grid.is(x, y, 'grass') || reserved.has(y * BLOCK_TILES + x) || isLanding(x, y)) continue;
		if (!touchesRole(grid, x, y, 'path')) continue;
		grid.set(x, y, 'sign');
		reserved.add(y * BLOCK_TILES + x);
		return;
	}
}

function placeGrandTrees(grid: Grid, blockX: number, blockY: number) {
	// Row-major from the north-west corner, like footprintAt in terrain-life.
	for (let y = BLOCK_TILES - 1; y >= 1; y -= 1) {
		for (let x = 0; x < BLOCK_TILES - 1; x += 1) {
			if (!grid.is(x, y, 'tree') || !grid.is(x + 1, y, 'tree') || !grid.is(x, y - 1, 'tree') || !grid.is(x + 1, y - 1, 'tree')) continue;
			if (hashUnit(blockX * BLOCK_TILES + x, blockY * BLOCK_TILES + y, 'grand-tree') >= 0.55) continue;
			grid.set(x, y, 'grand-1');
			grid.set(x + 1, y, 'grand-2');
			grid.set(x, y - 1, 'grand-3');
			grid.set(x + 1, y - 1, 'grand-4');
		}
	}
}

function ensureLongGrass(grid: Grid, reserved: Set<number>, blockX: number, blockY: number) {
	let count = 0;
	for (const role of grid.roles) if (role === 'long-grass') count += 1;
	if (count >= 4) return;
	for (const [x, y] of scanOrder(blockX, blockY, 'meadow-guarantee')) {
		const patch = plainFootprint(grid, reserved, x, y, 2, 2);
		if (!patch) continue;
		for (const [px, py] of patch) grid.set(px, py, 'long-grass');
		return;
	}
	// Degenerate fallback: single plain tiles anywhere.
	for (let index = 0; index < grid.roles.length && count < 4; index += 1) {
		if (grid.roles[index] === 'grass' && !reserved.has(index)) {
			grid.roles[index] = 'long-grass';
			count += 1;
		}
	}
}

// --- Generation ------------------------------------------------------------------

function buildRoles(blockX: number, blockY: number, biome: BiomeName): Grid {
	const profile = BIOME_PROFILES[biome];
	const grid = new Grid();
	const reserved = new Set<number>();
	const portals = portalsFor(blockX, blockY);
	carvePath(grid, blockX, blockY, portals);

	// The landing stays plain grass/path so the spawn is walkable and connected.
	for (let y = LANDING_MIN; y <= LANDING_MAX; y += 1) {
		for (let x = LANDING_MIN; x <= LANDING_MAX; x += 1) reserved.add(y * BLOCK_TILES + x);
	}
	const gxOf = (x: number) => blockX * BLOCK_TILES + x;
	const gyOf = (y: number) => blockY * BLOCK_TILES + y;

	// Noise layers over world coordinates.
	for (let y = 0; y < BLOCK_TILES; y += 1) {
		for (let x = 0; x < BLOCK_TILES; x += 1) {
			if (!grid.is(x, y, 'grass') || reserved.has(y * BLOCK_TILES + x)) continue;
			const gx = gxOf(x);
			const gy = gyOf(y);
			if (coarseNoise(gx, gy, 'forest', 6) > profile.forest) {
				grid.set(x, y, 'tree');
			} else if (coarseNoise(gx, gy, 'meadow', 5) > profile.meadow) {
				grid.set(x, y, 'long-grass');
			}
		}
	}

	// Ponds: interior only, then eroded into tileset-legal shapes.
	for (let y = 1; y < BLOCK_TILES - 1; y += 1) {
		for (let x = 1; x < BLOCK_TILES - 1; x += 1) {
			const role = grid.get(x, y);
			if (!role || !FLOODABLE.includes(role) || reserved.has(y * BLOCK_TILES + x)) continue;
			if (coarseNoise(gxOf(x), gyOf(y), 'pond', 5) > profile.pond) grid.set(x, y, 'water');
		}
	}
	smoothWater(grid, reserved);

	// Structures on plain grass.
	if (hashUnit(blockX, blockY, 'house-roll') < profile.house) placeHouse(grid, reserved, blockX, blockY);
	if (hashUnit(blockX, blockY, 'cave-roll') < profile.cave) placeCave(grid, reserved, blockX, blockY);
	if (hashUnit(blockX, blockY, 'sign-roll') < profile.sign) placeSign(grid, reserved, blockX, blockY);

	// Big canopy trees where four single trees meet.
	placeGrandTrees(grid, blockX, blockY);

	// Rocks, flowers, hidden items on the remaining plain grass.
	for (let y = 0; y < BLOCK_TILES; y += 1) {
		for (let x = 0; x < BLOCK_TILES; x += 1) {
			if (!grid.is(x, y, 'grass') || reserved.has(y * BLOCK_TILES + x)) continue;
			const gx = gxOf(x);
			const gy = gyOf(y);
			if (hashUnit(gx, gy, 'hidden-item') < profile.hiddenItems) {
				grid.set(x, y, 'hidden-item');
			} else if (hashUnit(gx, gy, 'rock') < profile.rocks) {
				grid.set(x, y, hashUnit(gx, gy, 'rock-kind') < 0.5 ? 'rock' : 'boulder');
			} else if (coarseNoise(gx, gy, 'flowers', 4) > 0.58 && hashUnit(gx, gy, 'flower') < profile.flowers) {
				grid.set(x, y, `flower-${1 + Math.floor(hashUnit(gx, gy, 'flower-colour') * 3)}` as Role);
			}
		}
	}

	ensureLongGrass(grid, reserved, blockX, blockY);
	return grid;
}

function tileFor(grid: Grid, x: number, y: number, blockX: number, blockY: number): WorldTile {
	const role = grid.get(x, y) ?? 'grass';
	const gx = blockX * BLOCK_TILES + x;
	const gy = blockY * BLOCK_TILES + y;
	switch (role) {
		case 'grass':
			return { x, y, img: 'grass', terrain: 'grass', solid: false };
		case 'long-grass':
			return { x, y, img: 'grass', img2: 'grass-2', terrain: 'grass', solid: false, feature: 'long-grass' };
		case 'tree':
			return { x, y, img: 'grass', img2: 'tree-1', terrain: 'grass', solid: true, feature: 'tree' };
		case 'grand-1':
		case 'grand-2':
		case 'grand-3':
		case 'grand-4':
			return { x, y, img: 'grass', img2: `tree-grand-${role.slice(-1)}`, terrain: 'grass', solid: true, feature: 'tree' };
		case 'water':
			return { x, y, img: getWaterTileName(waterNeighbours(grid, x, y), gx, gy), terrain: 'water', solid: true };
		case 'path':
			return { x, y, img: `path-${getAutotileIndex(pathNeighbours(grid, x, y))}`, terrain: 'path', solid: false };
		case 'rock':
			return { x, y, img: 'grass', img2: 'rock-1', terrain: 'grass', solid: true, feature: 'boulder' };
		case 'boulder':
			return { x, y, img: 'grass', img2: 'boulder-mossy-1', terrain: 'grass', solid: true, feature: 'boulder' };
		case 'flower-1':
		case 'flower-2':
		case 'flower-3':
			return { x, y, img: 'grass', img2: role, terrain: 'grass', solid: false, feature: 'flower' };
		case 'sign':
			return { x, y, img: 'grass', img2: 'route-sign-1', terrain: 'grass', solid: true, feature: 'sign' };
		case 'rocky':
			return { x, y, img: 'rocky-1', terrain: 'rocky', solid: false, feature: 'rocky-ground' };
		case 'cave':
			return { x, y, img: 'rocky-1', img2: 'cave-door-1', terrain: 'rocky', solid: false, feature: 'cave-entrance' };
		case 'hidden-item':
			return { x, y, img: 'grass', terrain: 'grass', solid: false, feature: 'hidden-item' };
		default: {
			if (role.startsWith('house-')) {
				return { x, y, img: 'grass', img2: `house-red-${role.slice(6)}`, terrain: 'grass', solid: true, feature: 'house' };
			}
			return { x, y, img: 'grass', terrain: 'grass', solid: false };
		}
	}
}

const MAX_CACHED_BLOCKS = 256;
const blockCache = new Map<string, WorldBlock>();

const cloneBlock = (block: WorldBlock): WorldBlock => ({ ...block, tiles: block.tiles.map((tile) => ({ ...tile })) });

/** The deterministic block at (blockX, blockY); tiles are in row-major order by (y, x). */
export function generateBlock(blockX: number, blockY: number): WorldBlock {
	const key = `${blockX},${blockY}`;
	const cached = blockCache.get(key);
	if (cached) return cloneBlock(cached);
	const biome = biomeFor(blockX, blockY);
	const grid = buildRoles(blockX, blockY, biome);
	const tiles: WorldTile[] = [];
	for (let y = 0; y < BLOCK_TILES; y += 1) {
		for (let x = 0; x < BLOCK_TILES; x += 1) tiles.push(tileFor(grid, x, y, blockX, blockY));
	}
	const block: WorldBlock = { x: blockX, y: blockY, biome, tiles };
	if (blockCache.size >= MAX_CACHED_BLOCKS) blockCache.delete(blockCache.keys().next().value as string);
	blockCache.set(key, block);
	return cloneBlock(block);
}

export const tileAt = (block: WorldBlock, x: number, y: number): WorldTile | undefined =>
	inBlock(x, y) ? block.tiles[y * BLOCK_TILES + x] : undefined;

// --- World-coordinate access ------------------------------------------------------

export interface WorldPosition {
	blockX: number;
	blockY: number;
	x: number;
	y: number;
}

export const tileKey = (blockX: number, blockY: number, x: number, y: number): string => `${blockX},${blockY}:${x},${y}`;

export const toGlobal = (position: WorldPosition): { gx: number; gy: number } => ({
	gx: position.blockX * BLOCK_TILES + position.x,
	gy: position.blockY * BLOCK_TILES + position.y
});

export const fromGlobal = (gx: number, gy: number): WorldPosition => {
	const blockX = Math.floor(gx / BLOCK_TILES);
	const blockY = Math.floor(gy / BLOCK_TILES);
	return { blockX, blockY, x: gx - blockX * BLOCK_TILES, y: gy - blockY * BLOCK_TILES };
};

export interface LocatedTile {
	tile: WorldTile;
	key: string;
	blockX: number;
	blockY: number;
	x: number;
	y: number;
	gx: number;
	gy: number;
	biome: BiomeName;
}

/** A per-call block cache so one view/step generates each block at most once. */
export class WorldReader {
	private readonly blocks = new Map<string, WorldBlock>();

	block(blockX: number, blockY: number): WorldBlock {
		const key = `${blockX},${blockY}`;
		let block = this.blocks.get(key);
		if (!block) {
			block = generateBlock(blockX, blockY);
			this.blocks.set(key, block);
		}
		return block;
	}

	at(gx: number, gy: number): LocatedTile {
		const position = fromGlobal(gx, gy);
		const block = this.block(position.blockX, position.blockY);
		const tile = tileAt(block, position.x, position.y) as WorldTile;
		return {
			tile,
			key: tileKey(position.blockX, position.blockY, position.x, position.y),
			...position,
			gx,
			gy,
			biome: block.biome
		};
	}
}
