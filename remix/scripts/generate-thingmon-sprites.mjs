#!/usr/bin/env node
// generate-thingmon-sprites.mjs — the ORIGINAL creature art + catalogue for
// the Thingmon app suite (schemas/appSuites/thingmon.ts).
//
//   node scripts/generate-thingmon-sprites.mjs [--sheet <path.png>]
//
// Every one of the 60 species is drawn here, deterministically, as a 48×48
// pixel-art PNG (no dependencies: a tiny PNG encoder over node:zlib) into
// public/demos/thingmon/<id>-<slug>.png, and the species catalogue the
// domain pack reads is written to
// api/utils/actions/packs/thingmon/data/species.ts (a TypeScript module rather
// than JSON: the Nitro dev bundler leaves a JSON module's initialiser
// unwired inside this import graph). Re-running the script
// is a no-op unless the tables below change — the art is a pure function of
// the species definition and its seed, so the PNGs are reproducible and
// reviewable in a pull request.
//
// The drawing model: a body archetype (blob / beast / bird / serpent /
// sprite / golem / bug / fish) laid down as flat shapes in the type's
// palette, features added per evolution stage (ears, horns, wings, tail,
// spikes, crown, aura), then a one-pixel outline, a top-left highlight and a
// bottom-right shadow pass for the classic hand-pixelled look.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const remixRoot = path.resolve(here, '..');
const SPRITE_DIR = path.join(remixRoot, 'public', 'demos', 'thingmon');
const DATA_FILE = path.join(remixRoot, 'app', 'api', 'utils', 'actions', 'packs', 'thingmon', 'data', 'species.ts');
const SPRITE_URL_PREFIX = '/demos/thingmon/';

const args = process.argv.slice(2);
const sheetPath = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : null;

// ── PRNG + hashing ──────────────────────────────────────────────────────────
const hashSeed = (text) => {
	let h = 2166136261;
	for (const ch of text) {
		h ^= ch.charCodeAt(0);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};
const mulberry32 = (seed) => () => {
	let t = (seed += 0x6d2b79f5);
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── PNG encoder ─────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (bytes) => {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, crc]);
};
const encodePng = (width, height, rgba) => {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0; // filter: none
		rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

// ── colours ─────────────────────────────────────────────────────────────────
const hex = (value) => {
	const n = parseInt(value.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lighten = (c, t) => mix(c, [255, 255, 255], t);
const darken = (c, t) => mix(c, [0, 0, 0], t);

export const TYPES = {
	ember: { emoji: '🔥', base: '#f0623a', light: '#ffb27a', dark: '#8c2a1c', accent: '#ffd166' },
	tide: { emoji: '🌊', base: '#3f8fe0', light: '#9ad0ff', dark: '#1d3f7a', accent: '#b8f3ff' },
	bloom: { emoji: '🌿', base: '#5fb85a', light: '#b9f0a0', dark: '#2c5e2b', accent: '#ffd6e8' },
	spark: { emoji: '⚡', base: '#f4c430', light: '#fff3a3', dark: '#8a6a00', accent: '#5ee6ff' },
	frost: { emoji: '❄️', base: '#9fd8f5', light: '#e9fbff', dark: '#3f6f8f', accent: '#c9c2ff' },
	stone: { emoji: '🪨', base: '#9a8f82', light: '#d4c9bb', dark: '#4a4038', accent: '#e0b458' },
	shade: { emoji: '🌙', base: '#5d4f8a', light: '#a493d8', dark: '#241c40', accent: '#ff6b9d' },
	glow: { emoji: '✨', base: '#ffd86b', light: '#fff8d0', dark: '#a86f12', accent: '#7ef0d0' }
};
const OUTLINE = hex('#1a1428');
const EYE_WHITE = hex('#ffffff');
const EYE_DARK = hex('#1a1428');

// ── species tables ──────────────────────────────────────────────────────────
// 18 evolution lines × 3 stages + 6 singular rarities = 60 species.
// [line key, archetype, types, [stage names], habitats, genus, flavour bits]
const LINES = [
	['cinder', 'beast', ['ember'], ['Cindrel', 'Flamlet', 'Pyrothorn'], ['embercave', 'meadow'], 'Kindling', 'a warm fox-like thing whose tail ember never quite goes out'],
	['puddle', 'blob', ['tide'], ['Puddlin', 'Rippleo', 'Tidalisk'], ['tidepool', 'duskmarsh'], 'Puddle', 'a shy droplet that giggles when it rains'],
	['sprout', 'sprite', ['bloom'], ['Sproutle', 'Thistlon', 'Verdantis'], ['meadow', 'duskmarsh'], 'Seedling', 'a hopping seed that roots wherever it naps'],
	['zap', 'beast', ['spark'], ['Zapik', 'Voltrix', 'Thundrake'], ['meadow', 'skybluff'], 'Static', 'a twitchy creature that charges itself by running in circles'],
	['snow', 'bird', ['frost'], ['Snowbi', 'Glacielle', 'Rimeghast'], ['frostpeak', 'skybluff'], 'Flurry', 'a round bird whose feathers are tiny snowflakes'],
	['pebble', 'golem', ['stone'], ['Pebblit', 'Cragmaw', 'Monolythe'], ['embercave', 'frostpeak'], 'Rubble', 'a stack of pebbles that decided to be a creature'],
	['umbra', 'bug', ['shade'], ['Umbrit', 'Duskwing', 'Nocturnex'], ['duskmarsh', 'embercave'], 'Moth', 'a moth that flies toward the dark instead of the light'],
	['lumin', 'sprite', ['glow'], ['Lumin', 'Glimmerie', 'Starlune'], ['skybluff', 'meadow'], 'Wisp', 'a floating spark that hums old lullabies'],
	['magma', 'golem', ['ember', 'stone'], ['Magmite', 'Slagbone', 'Vulcanoth'], ['embercave'], 'Slag', 'a chunk of cooled lava with a molten heart'],
	['chill', 'fish', ['tide', 'frost'], ['Chillip', 'Frostfin', 'Berglord'], ['tidepool', 'frostpeak'], 'Iceberg', 'a fish that swims through ice as if it were water'],
	['petal', 'sprite', ['bloom', 'glow'], ['Petalume', 'Blossara', 'Lumiflora'], ['meadow'], 'Bloom', 'a flower whose petals glow brighter the more it is admired'],
	['static', 'sprite', ['spark', 'shade'], ['Statik', 'Voltghast', 'Stormwraith'], ['skybluff', 'duskmarsh'], 'Stormwisp', 'a crackle of static that haunts old radios'],
	['beetle', 'bug', ['bloom', 'stone'], ['Buggle', 'Beetlore', 'Scarabor'], ['meadow', 'embercave'], 'Beetle', 'a beetle whose shell is a pebble it grew into'],
	['squid', 'fish', ['tide', 'shade'], ['Squidge', 'Tentakit', 'Krakenoth'], ['tidepool', 'duskmarsh'], 'Tentacle', 'a squid that writes with its own ink and never finishes a sentence'],
	['aurora', 'bird', ['glow', 'frost'], ['Frostfae', 'Auroril', 'Borealisk'], ['frostpeak', 'skybluff'], 'Aurora', 'a bird that paints the sky when it stretches'],
	['blaze', 'beast', ['ember', 'spark'], ['Sparkit', 'Blazehound', 'Infernox'], ['embercave', 'skybluff'], 'Blaze', 'a hound that runs so fast its paws leave sparks'],
	['shard', 'golem', ['stone', 'shade'], ['Shardow', 'Obsidra', 'Nightspire'], ['frostpeak', 'duskmarsh'], 'Obsidian', 'a splinter of night-black glass that dislikes mirrors'],
	['murk', 'serpent', ['shade', 'tide'], ['Murklet', 'Bogwyrm', 'Abyssaur'], ['duskmarsh', 'tidepool'], 'Bog', 'a slow serpent that lives under the reeds and collects lost keys']
];
const SINGLES = [
	['solaris', 'sprite', ['ember', 'glow'], 'Solaris', ['skybluff'], 'Sunheart', 'said to be a piece of noon that fell off the sun', 'legendary'],
	['tempest', 'bird', ['spark', 'tide'], 'Tempestra', ['skybluff'], 'Tempest', 'a storm with wings; every feather is a different weather', 'legendary'],
	['glacier', 'golem', ['frost', 'stone'], 'Glacierex', ['frostpeak'], 'Glacier', 'a walking glacier that carves valleys when it is bored', 'legendary'],
	['umbraking', 'beast', ['shade'], 'Umbraking', ['duskmarsh'], 'Nightfall', 'the shadow that other shadows are afraid of', 'legendary'],
	['chrono', 'bug', ['glow', 'shade'], 'Chronomoth', ['embercave'], 'Hourglass', 'a moth whose wingbeats keep the time of the whole world', 'rare'],
	['terra', 'serpent', ['bloom', 'stone'], 'Terravine', ['meadow'], 'Rootwyrm', 'a vine so old it has become a landscape', 'rare']
];
const ZONE_LEVELS = { meadow: [2, 7], tidepool: [4, 10], embercave: [8, 16], duskmarsh: [10, 20], frostpeak: [12, 22], skybluff: [15, 28] };

const slugOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const STAGE_RARITY = ['common', 'uncommon', 'rare'];
const STAGE_CATCH = [190, 90, 35];
const RARITY_CATCH = { legendary: 8, rare: 30 };

// base stats: per-type leanings + stage growth + a per-species jitter
const TYPE_LEAN = {
	ember: { hp: 0, atk: 6, def: -2, spd: 3 },
	tide: { hp: 4, atk: -1, def: 3, spd: 0 },
	bloom: { hp: 5, atk: 0, def: 4, spd: -3 },
	spark: { hp: -2, atk: 3, def: -3, spd: 8 },
	frost: { hp: 2, atk: 1, def: 5, spd: -2 },
	stone: { hp: 3, atk: 4, def: 9, spd: -8 },
	shade: { hp: -1, atk: 5, def: 0, spd: 4 },
	glow: { hp: 1, atk: 2, def: 1, spd: 5 }
};
const baseStats = (types, stage, rng, rarity) => {
	const stageBase = [42, 60, 82][stage] + (rarity === 'legendary' ? 24 : rarity === 'rare' && stage === 2 ? 6 : 0);
	const lean = types.reduce((acc, type) => ({ hp: acc.hp + TYPE_LEAN[type].hp, atk: acc.atk + TYPE_LEAN[type].atk, def: acc.def + TYPE_LEAN[type].def, spd: acc.spd + TYPE_LEAN[type].spd }), { hp: 0, atk: 0, def: 0, spd: 0 });
	const jitter = () => Math.round((rng() - 0.5) * 10);
	return {
		hp: stageBase + 8 + lean.hp + jitter(),
		atk: stageBase + lean.atk + jitter(),
		def: stageBase + lean.def + jitter(),
		spd: stageBase - 4 + lean.spd + jitter()
	};
};

const buildSpecies = () => {
	const species = [];
	let id = 1;
	for (const [line, archetype, types, names, habitats, genus, blurb] of LINES) {
		const ids = [id, id + 1, id + 2];
		names.forEach((name, stage) => {
			const rng = mulberry32(hashSeed(`${line}:${stage}:stats`));
			species.push({
				id: ids[stage],
				slug: slugOf(name),
				name,
				line,
				archetype,
				stage: stage + 1,
				types: [...types],
				rarity: STAGE_RARITY[stage],
				evolvesTo: stage < 2 ? { id: ids[stage + 1], level: [12, 26][stage] } : null,
				evolvesFrom: stage > 0 ? ids[stage - 1] : null,
				habitats: stage === 2 ? [habitats[0]] : [...habitats],
				genus: `${genus} thingmon`,
				flavor: stage === 0 ? `Cute, small, and ${blurb}.` : stage === 1 ? `Grown bolder: ${blurb}, now with something to prove.` : `Fully grown — ${blurb}. Trainers speak of it in a lower voice.`,
				baseStats: baseStats(types, stage, rng, STAGE_RARITY[stage]),
				catchRate: STAGE_CATCH[stage],
				baseExp: [60, 120, 200][stage],
				heightM: Number(([0.4, 0.9, 1.7][stage] + (rng() - 0.5) * 0.2).toFixed(1)),
				weightKg: Number(([6, 28, 90][stage] * (0.8 + rng() * 0.4)).toFixed(1))
			});
		});
		id += 3;
	}
	for (const [line, archetype, types, name, habitats, genus, blurb, rarity] of SINGLES) {
		const rng = mulberry32(hashSeed(`${line}:single:stats`));
		species.push({
			id,
			slug: slugOf(name),
			name,
			line,
			archetype,
			stage: 3,
			types: [...types],
			rarity,
			evolvesTo: null,
			evolvesFrom: null,
			habitats: [...habitats],
			genus: `${genus} thingmon`,
			flavor: `${blurb[0].toUpperCase()}${blurb.slice(1)}. ${rarity === 'legendary' ? 'Only a keeper with a full-ish dex ever meets one.' : 'Seen rarely, and never twice in the same place.'}`,
			baseStats: baseStats(types, 2, rng, rarity),
			catchRate: RARITY_CATCH[rarity],
			baseExp: rarity === 'legendary' ? 320 : 240,
			heightM: Number((2.2 + rng() * 1.5).toFixed(1)),
			weightKg: Number((140 + rng() * 200).toFixed(1))
		});
		id += 1;
	}
	return species.map((entry) => ({ ...entry, sprite: `${SPRITE_URL_PREFIX}${String(entry.id).padStart(2, '0')}-${entry.slug}.png` }));
};

// ── the canvas ──────────────────────────────────────────────────────────────
const W = 48;
const H = 48;
class Canvas {
	constructor() {
		this.data = Buffer.alloc(W * H * 4);
		this.layer = new Int8Array(W * H); // 0 empty, 1 body, 2 detail (never outlined-over), 3 outline
	}
	set(x, y, color, layer = 1) {
		x = Math.round(x);
		y = Math.round(y);
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4;
		this.data[i] = color[0];
		this.data[i + 1] = color[1];
		this.data[i + 2] = color[2];
		this.data[i + 3] = 255;
		this.layer[y * W + x] = layer;
	}
	get(x, y) {
		if (x < 0 || y < 0 || x >= W || y >= H) return 0;
		return this.layer[y * W + x];
	}
	color(x, y) {
		const i = (y * W + x) * 4;
		return [this.data[i], this.data[i + 1], this.data[i + 2]];
	}
	ellipse(cx, cy, rx, ry, color, layer = 1) {
		for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
			for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
				const dx = (x - cx) / rx;
				const dy = (y - cy) / ry;
				if (dx * dx + dy * dy <= 1) this.set(x, y, color, layer);
			}
		}
	}
	rect(x0, y0, w, h, color, layer = 1) {
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, color, layer);
	}
	line(x0, y0, x1, y1, color, thickness = 1, layer = 1) {
		const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
		for (let s = 0; s <= steps; s++) {
			const x = x0 + ((x1 - x0) * s) / steps;
			const y = y0 + ((y1 - y0) * s) / steps;
			if (thickness <= 1) this.set(x, y, color, layer);
			else this.ellipse(x, y, thickness / 2, thickness / 2, color, layer);
		}
	}
	triangle(ax, ay, bx, by, cx, cy, color, layer = 1) {
		const minX = Math.floor(Math.min(ax, bx, cx));
		const maxX = Math.ceil(Math.max(ax, bx, cx));
		const minY = Math.floor(Math.min(ay, by, cy));
		const maxY = Math.ceil(Math.max(ay, by, cy));
		const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const d1 = sign(x, y, ax, ay, bx, by);
				const d2 = sign(x, y, bx, by, cx, cy);
				const d3 = sign(x, y, cx, cy, ax, ay);
				const neg = d1 < 0 || d2 < 0 || d3 < 0;
				const pos = d1 > 0 || d2 > 0 || d3 > 0;
				if (!(neg && pos)) this.set(x, y, color, layer);
			}
		}
	}
	// mirror the left half onto the right (symmetric archetypes)
	mirror() {
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W / 2; x++) {
				const src = y * W + x;
				const dst = y * W + (W - 1 - x);
				if (this.layer[src]) {
					this.data.copy(this.data, dst * 4, src * 4, src * 4 + 4);
					this.layer[dst] = this.layer[src];
				}
			}
		}
	}
	// classic pass: outline every edge pixel, highlight top-left, shade bottom-right
	finish() {
		const isSolid = (x, y) => this.get(x, y) > 0;
		const outline = [];
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				if (!isSolid(x, y)) continue;
				if (!isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1)) outline.push([x, y]);
			}
		}
		const shaded = [];
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				if (this.get(x, y) !== 1) continue;
				const edgeUp = !isSolid(x, y - 1) || !isSolid(x - 1, y) || this.get(x, y - 1) === 3 || this.get(x - 1, y) === 3;
				const edgeDown = !isSolid(x, y + 1) || !isSolid(x + 1, y) || this.get(x, y + 1) === 3 || this.get(x + 1, y) === 3;
				const inner = isSolid(x - 2, y) && isSolid(x, y - 2) && isSolid(x + 2, y) && isSolid(x, y + 2);
				if (edgeUp && !edgeDown) shaded.push([x, y, 0.28]);
				else if (edgeDown && !edgeUp && inner) shaded.push([x, y, -0.22]);
			}
		}
		for (const [x, y] of outline) this.set(x, y, OUTLINE, 3);
		for (const [x, y, t] of shaded) {
			if (this.get(x, y) === 3) continue;
			const c = this.color(x, y);
			this.set(x, y, t > 0 ? lighten(c, t) : darken(c, -t), 1);
		}
	}
}

// ── feature drawing ─────────────────────────────────────────────────────────
const eye = (c, x, y, style, size = 2) => {
	if (style === 'sleepy') {
		c.line(x - size, y, x + size, y, EYE_DARK, 1, 2);
		return;
	}
	c.ellipse(x, y, size, size, EYE_WHITE, 2);
	c.set(x + (style === 'left' ? -1 : 0), y + (style === 'angry' ? -1 : 0), EYE_DARK, 2);
	if (size >= 2) c.set(x + (style === 'left' ? -1 : 0) + 1, y + (style === 'angry' ? -1 : 0), EYE_DARK, 2);
	if (style === 'angry') c.line(x - size, y - size - 1, x + size, y - size, EYE_DARK, 1, 2);
	c.set(x - size + 1, y - 1, EYE_WHITE, 2);
};
const mouth = (c, x, y, style, pal) => {
	if (style === 'smile') {
		c.set(x - 2, y - 1, EYE_DARK, 2);
		c.set(x - 1, y, EYE_DARK, 2);
		c.set(x, y, EYE_DARK, 2);
		c.set(x + 1, y, EYE_DARK, 2);
		c.set(x + 2, y - 1, EYE_DARK, 2);
	} else if (style === 'fangs') {
		c.line(x - 3, y, x + 3, y, EYE_DARK, 1, 2);
		c.set(x - 2, y + 1, EYE_WHITE, 2);
		c.set(x + 2, y + 1, EYE_WHITE, 2);
	} else if (style === 'beak') {
		c.triangle(x - 3, y - 2, x + 3, y - 2, x, y + 3, pal.accent, 2);
	} else if (style === 'o') {
		c.ellipse(x, y, 1.2, 1.2, EYE_DARK, 2);
	}
};

const ARCHETYPES = {
	blob: (c, s, pal, rng) => {
		const r = 9 + s.stage * 3;
		const cy = 30 - s.stage;
		c.ellipse(24, cy, r + 2, r, pal.base);
		c.ellipse(24, cy + r * 0.45, r * 0.9, r * 0.35, pal.dark);
		// a drip / crest on top
		c.ellipse(24, cy - r + 1, 2 + s.stage, 3 + s.stage, pal.light);
		if (s.stage >= 2) {
			c.ellipse(24 - r + 2, cy - 2, 3, 3, pal.accent);
			c.ellipse(24 + r - 2, cy - 2, 3, 3, pal.accent);
		}
		if (s.stage >= 3) {
			// a crown of droplets
			for (let i = -2; i <= 2; i++) c.ellipse(24 + i * 5, cy - r - 4 + Math.abs(i), 2, 2.5, pal.accent);
		}
		eye(c, 20 - s.stage, cy - 3, s.eyes, 2 + (s.stage > 1 ? 1 : 0));
		eye(c, 28 + s.stage, cy - 3, s.eyes, 2 + (s.stage > 1 ? 1 : 0));
		mouth(c, 24, cy + 3, s.mouth, pal);
		return false;
	},
	sprite: (c, s, pal, rng) => {
		const r = 7 + s.stage * 2;
		const cy = 24;
		// wisps / trail beneath
		for (let i = 0; i < 3 + s.stage; i++) c.ellipse(24 + (i - 1 - s.stage / 2) * 4, cy + r + 4 + (i % 2) * 3, 2, 3 + (i % 2), pal.light);
		c.ellipse(24, cy, r, r + 1, pal.base);
		c.ellipse(24, cy - 2, r - 3, r - 4, pal.light);
		// halo / petals / aura
		if (s.stage >= 2) for (let i = 0; i < 6; i++) c.ellipse(24 + Math.cos((i / 6) * Math.PI * 2) * (r + 4), cy + Math.sin((i / 6) * Math.PI * 2) * (r + 4), 2, 2, pal.accent);
		if (s.stage >= 3) for (let i = 0; i < 8; i++) c.set(24 + Math.round(Math.cos((i / 8) * Math.PI * 2) * (r + 9)), cy + Math.round(Math.sin((i / 8) * Math.PI * 2) * (r + 9)), pal.accent, 2);
		// little arms
		c.ellipse(24 - r - 2, cy + 3, 3, 2, pal.base);
		c.ellipse(24 + r + 2, cy + 3, 3, 2, pal.base);
		eye(c, 21, cy - 1, s.eyes, 2);
		eye(c, 27, cy - 1, s.eyes, 2);
		mouth(c, 24, cy + 4, s.mouth, pal);
		return false;
	},
	golem: (c, s, pal, rng) => {
		const w = 14 + s.stage * 4;
		const h = 12 + s.stage * 4;
		const top = 40 - h - 6;
		// legs
		c.rect(24 - w / 2 + 2, 40 - 6, 5, 7, pal.dark);
		c.rect(24 + w / 2 - 7, 40 - 6, 5, 7, pal.dark);
		c.rect(24 - w / 2, top, w, h, pal.base);
		// chunky corners cut
		c.rect(24 - w / 2 - 3, top + 4, 4, h - 8, pal.base);
		c.rect(24 + w / 2 - 1, top + 4, 4, h - 8, pal.base);
		// cracks / gem
		c.ellipse(24, top + h / 2 + 2, 2 + s.stage, 2 + s.stage, pal.accent, 2);
		if (s.stage >= 2) {
			c.triangle(24 - w / 2, top, 24 - w / 2 + 6, top, 24 - w / 2 + 2, top - 6, pal.dark);
			c.triangle(24 + w / 2, top, 24 + w / 2 - 6, top, 24 + w / 2 - 2, top - 6, pal.dark);
		}
		if (s.stage >= 3) for (let i = -1; i <= 1; i++) c.triangle(24 + i * 6 - 2, top, 24 + i * 6 + 2, top, 24 + i * 6, top - 7 - (i === 0 ? 3 : 0), pal.accent);
		eye(c, 24 - 4 - s.stage, top + 5, s.eyes === 'sleepy' ? 'sleepy' : 'angry', 2);
		eye(c, 24 + 4 + s.stage, top + 5, s.eyes === 'sleepy' ? 'sleepy' : 'angry', 2);
		mouth(c, 24, top + 11, 'fangs', pal);
		return false;
	},
	bug: (c, s, pal, rng) => {
		const r = 6 + s.stage * 2;
		// wings
		if (s.stage >= 1) {
			c.ellipse(24 - r - 4, 22, 6 + s.stage * 2, 4 + s.stage * 2, pal.light);
			c.ellipse(24 + r + 4, 22, 6 + s.stage * 2, 4 + s.stage * 2, pal.light);
		}
		if (s.stage >= 3) {
			c.ellipse(24 - r - 6, 30, 5, 3, pal.accent);
			c.ellipse(24 + r + 6, 30, 5, 3, pal.accent);
		}
		// segmented body
		c.ellipse(24, 30, r - 1, r - 1, pal.base);
		c.ellipse(24, 22, r, r - 1, pal.base);
		c.ellipse(24, 15, r - 2, r - 3, pal.base);
		// legs
		for (let i = 0; i < 3; i++) {
			c.line(24 - r + 1, 20 + i * 5, 24 - r - 4, 24 + i * 5, pal.dark, 1);
			c.line(24 + r - 1, 20 + i * 5, 24 + r + 4, 24 + i * 5, pal.dark, 1);
		}
		// antennae
		c.line(22, 12, 18, 6, pal.dark, 1);
		c.line(26, 12, 30, 6, pal.dark, 1);
		c.set(18, 5, pal.accent, 2);
		c.set(30, 5, pal.accent, 2);
		// spots
		if (s.stage >= 2) {
			c.ellipse(21, 30, 1.5, 1.5, pal.accent, 2);
			c.ellipse(27, 30, 1.5, 1.5, pal.accent, 2);
		}
		eye(c, 22, 15, s.eyes, 1);
		eye(c, 26, 15, s.eyes, 1);
		return false;
	},
	bird: (c, s, pal, rng) => {
		// a round body low, a smaller head above, wings spread behind
		const r = 6 + s.stage * 2;
		const by = 31 - s.stage;
		const hr = 4 + s.stage;
		const hy = by - r - hr + 3;
		// tail feathers
		for (let i = 0; i < 2 + s.stage; i++) c.ellipse(24, by + r + 1 + i * 2, 2 + i, 2.5, i % 2 ? pal.accent : pal.light);
		// wings: wide, angled up and out, behind the body
		c.line(24 - r + 2, by, 24 - r - 6 - s.stage * 3, by - 5 - s.stage * 2, pal.dark, 5 + s.stage);
		c.line(24 + r - 2, by, 24 + r + 6 + s.stage * 3, by - 5 - s.stage * 2, pal.dark, 5 + s.stage);
		if (s.stage >= 2) {
			c.line(24 - r + 1, by + 1, 24 - r - 5 - s.stage * 3, by - 3 - s.stage * 2, pal.accent, 2);
			c.line(24 + r - 1, by + 1, 24 + r + 5 + s.stage * 3, by - 3 - s.stage * 2, pal.accent, 2);
		}
		c.ellipse(24, by, r, r - 1, pal.base);
		c.ellipse(24, by + 2, r - 3, r - 4, pal.light);
		c.ellipse(24, hy, hr + 1, hr, pal.base);
		// head crest
		if (s.stage >= 2) {
			c.triangle(24 - 1, hy - hr + 1, 24 - 5, hy - hr - 6 - s.stage, 24 + 1, hy - hr - 2, pal.accent);
			c.triangle(24 + 1, hy - hr + 1, 24 + 5, hy - hr - 6 - s.stage, 24 - 1, hy - hr - 2, pal.accent);
		}
		if (s.stage >= 3) c.ellipse(24, hy - hr - 8, 2.5, 2.5, pal.accent);
		// feet
		c.line(22, by + r - 1, 20, by + r + 3, pal.dark, 1);
		c.line(26, by + r - 1, 28, by + r + 3, pal.dark, 1);
		eye(c, 24 - hr + 2, hy - 1, s.eyes, 1 + (s.stage > 1 ? 1 : 0));
		eye(c, 24 + hr - 2, hy - 1, s.eyes, 1 + (s.stage > 1 ? 1 : 0));
		mouth(c, 24, hy + 2, 'beak', pal);
		return false;
	},
	beast: (c, s, pal, rng) => {
		// side view, facing left
		const bodyL = 12 + s.stage * 3;
		const bodyH = 7 + s.stage * 2;
		const bx = 26;
		const by = 30 - s.stage;
		// tail
		const tailUp = -6 - s.stage * 3;
		c.line(bx + bodyL / 2, by, bx + bodyL / 2 + 5 + s.stage * 2, by + tailUp, pal.base, 3 + s.stage);
		c.ellipse(bx + bodyL / 2 + 5 + s.stage * 2, by + tailUp, 2 + s.stage, 2 + s.stage, pal.accent);
		// legs
		const legY = by + bodyH - 2;
		for (const lx of [bx - bodyL / 2 + 3, bx - 2, bx + bodyL / 2 - 4]) c.rect(lx, legY, 3 + (s.stage > 1 ? 1 : 0), 8, pal.dark);
		// body
		c.ellipse(bx, by, bodyL / 2 + 1, bodyH, pal.base);
		c.ellipse(bx + 1, by + 3, bodyL / 2 - 3, bodyH / 2, pal.light);
		// head
		const hx = bx - bodyL / 2 - 2;
		const hy = by - bodyH + 1;
		const hr = 5 + s.stage;
		c.ellipse(hx, hy, hr, hr - 1, pal.base);
		// ears / horns
		c.triangle(hx - 3, hy - hr + 2, hx - 6, hy - hr - 5 - s.stage, hx, hy - hr - 1, pal.base);
		c.triangle(hx + 3, hy - hr + 2, hx + 6, hy - hr - 5 - s.stage, hx, hy - hr - 1, pal.base);
		if (s.stage >= 2) {
			// back spikes / mane
			for (let i = 0; i < 3 + s.stage; i++) c.triangle(bx - bodyL / 2 + 2 + i * 4, by - bodyH + 1, bx - bodyL / 2 + 6 + i * 4, by - bodyH + 1, bx - bodyL / 2 + 4 + i * 4, by - bodyH - 4 - (s.stage - 1) * 2, pal.accent);
		}
		if (s.stage >= 3) c.ellipse(hx + 2, hy + hr - 2, 3, 2, pal.accent, 2); // a glowing jaw
		// snout
		c.ellipse(hx - hr + 1, hy + 2, 3, 2, pal.light);
		c.set(hx - hr - 1, hy + 1, EYE_DARK, 2);
		eye(c, hx - 1, hy - 1, s.eyes, 2);
		mouth(c, hx - hr + 2, hy + 4, s.stage >= 2 ? 'fangs' : 'smile', pal);
		return true;
	},
	serpent: (c, s, pal, rng) => {
		const thick = 4 + s.stage;
		// an S-curve body from bottom-right to head at top-left
		const pts = [
			[40, 40],
			[30, 38],
			[22, 34],
			[28, 28],
			[34, 24],
			[26, 18],
			[18, 16]
		];
		for (let i = 0; i < pts.length - 1; i++) c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pal.base, thick * 2);
		// belly stripe
		for (let i = 0; i < pts.length - 1; i++) c.line(pts[i][0], pts[i][1] + 2, pts[i + 1][0], pts[i + 1][1] + 2, pal.light, Math.max(1, thick - 2));
		// fins along the back
		if (s.stage >= 2) for (let i = 1; i < pts.length - 1; i += 1) c.triangle(pts[i][0] - 2, pts[i][1] - thick, pts[i][0] + 2, pts[i][1] - thick, pts[i][0], pts[i][1] - thick - 5 - s.stage, pal.accent);
		// head
		const hx = 16;
		const hy = 15;
		const hr = 5 + s.stage;
		c.ellipse(hx, hy, hr + 1, hr - 1, pal.base);
		if (s.stage >= 3) {
			c.triangle(hx - 2, hy - hr + 1, hx + 2, hy - hr + 1, hx, hy - hr - 6, pal.accent);
			c.triangle(hx + 4, hy - hr + 2, hx + 7, hy - hr + 2, hx + 6, hy - hr - 4, pal.accent);
		}
		// tongue
		c.line(hx - hr - 1, hy + 1, hx - hr - 4, hy + 2, pal.accent, 1, 2);
		eye(c, hx - 1, hy - 1, s.eyes, 2);
		mouth(c, hx - hr + 3, hy + 3, 'fangs', pal);
		return true;
	},
	fish: (c, s, pal, rng) => {
		const rx = 10 + s.stage * 2;
		const ry = 6 + s.stage * 2;
		const cx = 26;
		const cy = 26;
		// tail
		c.triangle(cx + rx - 2, cy, cx + rx + 6 + s.stage, cy - 7 - s.stage, cx + rx + 6 + s.stage, cy + 7 + s.stage, pal.dark);
		// dorsal
		c.triangle(cx - 4, cy - ry + 1, cx + 6, cy - ry + 1, cx + 1, cy - ry - 5 - s.stage * 2, pal.accent);
		// body
		c.ellipse(cx, cy, rx, ry, pal.base);
		c.ellipse(cx - 2, cy + 2, rx - 4, ry / 2, pal.light);
		// fin
		c.triangle(cx - 2, cy + 2, cx + 4, cy + 4, cx - 1, cy + 8 + s.stage, pal.dark);
		// scales / tentacles
		if (s.stage >= 2) for (let i = 0; i < 3; i++) c.ellipse(cx - 4 + i * 4, cy - 1, 1.5, 1.5, pal.accent, 2);
		if (s.stage >= 3) for (let i = 0; i < 4; i++) c.line(cx - rx + 4 + i * 3, cy + ry - 1, cx - rx + 2 + i * 4, cy + ry + 8 + (i % 2) * 2, pal.base, 2);
		eye(c, cx - rx + 4, cy - 2, s.eyes, 2);
		mouth(c, cx - rx + 2, cy + 3, 'o', pal);
		return true;
	}
};
const SYMMETRIC = new Set(['blob', 'sprite', 'golem', 'bug', 'bird']);

const drawSpecies = (species) => {
	const rng = mulberry32(hashSeed(`${species.line}:${species.stage}:art`));
	const primary = TYPES[species.types[0]];
	const secondary = TYPES[species.types[1] || species.types[0]];
	const pal = {
		base: hex(primary.base),
		light: hex(primary.light),
		dark: hex(primary.dark),
		accent: hex(species.types[1] ? secondary.base : primary.accent)
	};
	if (species.rarity === 'legendary') pal.accent = hex('#ffe27a');
	const eyes = ['round', 'round', 'left', 'angry', 'sleepy'][Math.floor(rng() * 5)];
	const mouthStyle = ['smile', 'smile', 'o', 'fangs'][Math.floor(rng() * 4)];
	const c = new Canvas();
	const style = { stage: species.stage, eyes: species.stage === 3 && eyes === 'sleepy' ? 'angry' : eyes, mouth: mouthStyle };
	ARCHETYPES[species.archetype](c, style, pal, rng);
	if (SYMMETRIC.has(species.archetype)) c.mirror();
	// a few freckles of the accent colour, per species
	const freckles = species.stage + 1;
	for (let i = 0; i < freckles; i++) {
		const x = Math.floor(rng() * W);
		const y = Math.floor(rng() * H);
		if (c.get(x, y) === 1) c.set(x, y, pal.accent, 2);
	}
	c.finish();
	return c;
};

// ── main ────────────────────────────────────────────────────────────────────
const species = buildSpecies();
mkdirSync(SPRITE_DIR, { recursive: true });
mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let written = 0;
let unchanged = 0;
const canvases = [];
for (const entry of species) {
	const canvas = drawSpecies(entry);
	canvases.push(canvas);
	const png = encodePng(W, H, canvas.data);
	const file = path.join(SPRITE_DIR, path.basename(entry.sprite));
	if (existsSync(file) && readFileSync(file).equals(png)) unchanged += 1;
	else {
		writeFileSync(file, png);
		written += 1;
	}
}
const catalogue = species.map(({ archetype, line, ...rest }) => ({ ...rest, line, archetype }));
const json =
	'// GENERATED by scripts/generate-thingmon-sprites.mjs — do not edit by hand.\n' +
	'// The sixty Thingmon species; the sprites live in public/demos/thingmon.\n' +
	'/* eslint-disable */\n' +
	`export const THINGMON_SPECIES_DATA = ${JSON.stringify(catalogue, null, '\t')} as const;\n`;
if (existsSync(DATA_FILE) && readFileSync(DATA_FILE, 'utf8') === json) console.log(`species.ts unchanged (${catalogue.length} species)`);
else {
	writeFileSync(DATA_FILE, json);
	console.log(`species.ts written (${catalogue.length} species)`);
}
console.log(`sprites: ${written} written, ${unchanged} unchanged → ${path.relative(remixRoot, SPRITE_DIR)}`);

if (sheetPath) {
	// a contact sheet at 3× for eyeballing the set: 10 per row, labelled by id
	const scale = 3;
	const cols = 10;
	const rowsCount = Math.ceil(species.length / cols);
	const cell = W * scale + 6;
	const sheetW = cols * cell;
	const sheetH = rowsCount * cell;
	const sheet = Buffer.alloc(sheetW * sheetH * 4);
	for (let i = 0; i < sheetW * sheetH; i++) {
		sheet[i * 4] = 245;
		sheet[i * 4 + 1] = 245;
		sheet[i * 4 + 2] = 248;
		sheet[i * 4 + 3] = 255;
	}
	species.forEach((entry, index) => {
		const canvas = canvases[index];
		const ox = (index % cols) * cell + 3;
		const oy = Math.floor(index / cols) * cell + 3;
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const src = (y * W + x) * 4;
				if (!canvas.data[src + 3]) continue;
				for (let sy = 0; sy < scale; sy++) {
					for (let sx = 0; sx < scale; sx++) {
						const dst = ((oy + y * scale + sy) * sheetW + ox + x * scale + sx) * 4;
						sheet[dst] = canvas.data[src];
						sheet[dst + 1] = canvas.data[src + 1];
						sheet[dst + 2] = canvas.data[src + 2];
						sheet[dst + 3] = 255;
					}
				}
			}
		}
	});
	writeFileSync(sheetPath, encodePng(sheetW, sheetH, sheet));
	console.log(`contact sheet → ${sheetPath}`);
}
