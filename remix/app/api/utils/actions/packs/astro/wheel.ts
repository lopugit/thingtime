// The zodiac wheel as precomputed SVG geometry: today's sky on the outer
// ring, natal planets (when known) on the inner ring. Same radii, rotation
// rule and glyph spreading as StarsAlign's ChartWheel.tsx, minus the React —
// a declarative template draws the circles/lines/text from these numbers.

import type { PlanetPosition } from './engine';
import { PLANET_BY_ID, SIGNS } from './meta';

export interface WheelPoint {
	glyph: string;
	x: number;
	y: number;
}

export interface WheelLine {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface WheelPlanet extends WheelPoint {
	id: string;
	tickX: number;
	tickY: number;
}

export interface WheelGeometry {
	size: number;
	cx: number;
	cy: number;
	rOuter: number;
	rSignsInner: number;
	rSky: number;
	rNatal: number;
	rHub: number;
	signs: WheelPoint[];
	spokes: WheelLine[];
	asc: (WheelLine & { labelX: number; labelY: number }) | null;
	natal: WheelPlanet[];
	sky: WheelPlanet[];
	caption: string;
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
	const rad = (deg * Math.PI) / 180;
	return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
};

/** Nudge same-degree planets apart so glyphs never overlap. */
const spread = (positions: PlanetPosition[], minGap: number): Map<string, number> => {
	const sorted = [...positions].sort((a, b) => a.lon - b.lon);
	const out = new Map<string, number>();
	let prev = -Infinity;
	for (const p of sorted) {
		let lon = p.lon;
		if (lon - prev < minGap) lon = prev + minGap;
		out.set(p.id, lon);
		prev = lon;
	}
	return out;
};

/** One decimal is plenty for a 340px viewBox and keeps the payload small. */
const r1 = (value: number): number => {
	const rounded = Math.round(value * 10) / 10;
	return rounded === 0 ? 0 : rounded;
};

export const wheelGeometry = (sky: PlanetPosition[], natal: PlanetPosition[] | null, ascendant: number | null, size = 340): WheelGeometry => {
	const c = size / 2;
	const rOuter = c - 4;
	const rSignsInner = rOuter - 26;
	const rSky = rSignsInner - 17;
	const rNatal = rSky - 34;
	const rHub = natal?.length ? rNatal - 20 : rSky - 24;

	// Rotate so the ascendant sits at 180° (left edge) — chart convention.
	const rotation = ascendant != null ? 180 - ascendant : 180 - 0;
	const angleOf = (lon: number) => lon + rotation;

	const skyLons = spread(sky, 7);
	const natalLons = natal ? spread(natal, 7) : null;

	const signs: WheelPoint[] = [];
	const spokes: WheelLine[] = [];
	SIGNS.forEach((sign, i) => {
		const start = i * 30;
		const [x1, y1] = polar(c, c, rHub, angleOf(start));
		const [x2, y2] = polar(c, c, rOuter, angleOf(start));
		const [gx, gy] = polar(c, c, (rOuter + rSignsInner) / 2, angleOf(start + 15));
		spokes.push({ x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2) });
		signs.push({ glyph: sign.glyph, x: r1(gx), y: r1(gy) });
	});

	let asc: WheelGeometry['asc'] = null;
	if (ascendant != null) {
		const [x1, y1] = polar(c, c, rHub, 180);
		const [x2, y2] = polar(c, c, rOuter, 180);
		asc = { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), labelX: 8, labelY: c - 8 };
	}

	const natalRing: WheelPlanet[] = (natal ?? []).map((p) => {
		const lon = natalLons?.get(p.id) ?? p.lon;
		const [x, y] = polar(c, c, rNatal, angleOf(lon));
		const [tx, ty] = polar(c, c, rNatal, angleOf(p.lon));
		return { id: p.id, glyph: PLANET_BY_ID.get(p.id)!.glyph, x: r1(x), y: r1(y), tickX: r1(tx), tickY: r1(ty) };
	});

	const skyRing: WheelPlanet[] = sky.map((p) => {
		const lon = skyLons.get(p.id) ?? p.lon;
		const [x, y] = polar(c, c, rSky, angleOf(lon));
		const [tx, ty] = polar(c, c, rSignsInner, angleOf(p.lon));
		return { id: p.id, glyph: PLANET_BY_ID.get(p.id)!.glyph, x: r1(x), y: r1(y), tickX: r1(tx), tickY: r1(ty) };
	});

	return {
		size,
		cx: c,
		cy: c,
		rOuter,
		rSignsInner,
		rSky,
		rNatal,
		rHub,
		signs,
		spokes,
		asc,
		natal: natalRing,
		sky: skyRing,
		caption: natal?.length ? 'SKY ✶ YOU' : 'THE SKY'
	};
};
