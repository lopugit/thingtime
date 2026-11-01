// Transit detection: aspects between today's sky and the natal chart.
// Ported verbatim from StarsAlign (src/lib/astro/aspects.ts).

import type { PlanetPosition } from './engine';
import { arcBetween } from './engine';
import type { AspectMeta, PlanetId } from './meta';
import { ASPECTS, PLANET_BY_ID } from './meta';

export interface Transit {
	transiting: PlanetId;
	natal: PlanetId;
	aspect: AspectMeta;
	/** Degrees away from exact — smaller is stronger. */
	orb: number;
	/** 0..1 — 1 is exact. */
	strength: number;
}

const CATEGORY_WEIGHT: Record<string, number> = {
	luminary: 1.15,
	personal: 1.1,
	social: 1.0,
	outer: 0.95
};

/**
 * All in-orb aspects between transiting and natal positions, strongest first.
 * The transiting Moon is excluded — it aspects everything for a few hours at a
 * time and would drown the list; its mood is reported separately.
 */
export const findTransits = (sky: PlanetPosition[], natal: PlanetPosition[]): Transit[] => {
	const transits: Transit[] = [];
	for (const t of sky) {
		if (t.id === 'moon') continue;
		for (const n of natal) {
			const separation = Math.abs(arcBetween(t.lon, n.lon));
			for (const aspect of ASPECTS) {
				const orb = Math.abs(separation - aspect.angle);
				if (orb <= aspect.orb) {
					const closeness = 1 - orb / aspect.orb;
					const weight = (CATEGORY_WEIGHT[PLANET_BY_ID.get(t.id)!.category] ?? 1) * (CATEGORY_WEIGHT[PLANET_BY_ID.get(n.id)!.category] ?? 1);
					transits.push({ transiting: t.id, natal: n.id, aspect, orb, strength: closeness * weight });
				}
			}
		}
	}
	return transits.sort((a, b) => b.strength - a.strength);
};
