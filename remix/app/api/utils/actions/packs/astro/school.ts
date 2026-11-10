// School content: the six prose sections (static JSON, bundled), the compact
// search index, decoration (glyphs/chips) derived from astro metadata,
// cross-section search, and the bundled birth-place city list. Ported from
// StarsAlign src/school/content.ts (search made synchronous over the compact
// index — every section is already in memory server-side) and
// src/components/BirthForm.tsx (city matching rules).

import citiesJson from './content/cities.json';
import housesJson from './content/houses.json';
import indexJson from './content/index.json';
import planetHouseJson from './content/planet-house.json';
import planetSignJson from './content/planet-sign.json';
import planetsJson from './content/planets.json';
import signHouseJson from './content/sign-house.json';
import signsJson from './content/signs.json';
import type { HouseMeta, PlanetMeta, SignMeta } from './meta';
import { HOUSES, HOUSE_ORDINALS, PLANETS, PLANET_BY_ID, SIGNS, SIGN_BY_ID } from './meta';

export interface SchoolEntry {
	id: string;
	title: string;
	essence: string;
	keywords: string[];
	short: string[];
	deep: string[];
}

export type SectionId = 'signs' | 'houses' | 'planets' | 'sign-house' | 'planet-sign' | 'planet-house';

export interface SectionMeta {
	id: SectionId;
	title: string;
	blurb: string;
	count: number;
}

export const SECTIONS: SectionMeta[] = [
	{ id: 'signs', title: 'The 12 Signs', blurb: 'Twelve styles of being — the how of the zodiac.', count: 12 },
	{ id: 'houses', title: 'The 12 Houses', blurb: 'Twelve arenas of life — the where.', count: 12 },
	{ id: 'planets', title: 'The 10 Planets', blurb: 'Ten inner functions — the what.', count: 10 },
	{ id: 'sign-house', title: 'Signs × Houses', blurb: 'Every sign in every house — all 144 blends.', count: 144 },
	{ id: 'planet-sign', title: 'Planets × Signs', blurb: 'Every planet through every sign — all 120.', count: 120 },
	{ id: 'planet-house', title: 'Planets × Houses', blurb: 'Every planet in every house — all 120.', count: 120 }
];

export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export const isSectionId = (value: unknown): value is SectionId => typeof value === 'string' && SECTION_BY_ID.has(value as SectionId);

export const SECTION_ENTRIES: Record<SectionId, SchoolEntry[]> = {
	signs: signsJson as SchoolEntry[],
	houses: housesJson as SchoolEntry[],
	planets: planetsJson as SchoolEntry[],
	'sign-house': signHouseJson as SchoolEntry[],
	'planet-sign': planetSignJson as SchoolEntry[],
	'planet-house': planetHouseJson as SchoolEntry[]
};

export interface SchoolEntryWithSection extends SchoolEntry {
	section: SectionId;
}

/** Every entry across the six sections, in section order, tagged with its section. */
export const ASTRO_SCHOOL_ENTRIES: SchoolEntryWithSection[] = SECTIONS.flatMap((section) =>
	SECTION_ENTRIES[section.id].map((entry) => ({ ...entry, section: section.id }))
);

/** Entry ids are unique across sections, so one map answers every deep link. */
export const ENTRY_BY_ID = new Map(ASTRO_SCHOOL_ENTRIES.map((entry) => [entry.id, entry]));

/** The compact search index (content/index.json): everything but `deep`. */
export interface IndexEntry {
	id: string;
	section: SectionId;
	title: string;
	essence: string;
	keywords: string[];
	short: string[];
}

export const SCHOOL_INDEX: IndexEntry[] = indexJson as IndexEntry[];

// ---------------------------------------------------------------------------
// Decor: parse an entry id back into its parts and derive glyphs + fact chips.

export interface EntryDecor {
	glyph: string;
	chips: string[];
}

const houseFromId = (id: string): HouseMeta | undefined => {
	const match = id.match(/house-(\d+)/);
	return match ? HOUSES[Number(match[1]) - 1] : undefined;
};

const rulesText = (planet: PlanetMeta): string => {
	const ruled = SIGNS.filter((s) => s.ruler === planet.id).map((s) => s.name);
	return ruled.length ? `rules ${ruled.join(' & ')}` : '';
};

export const entryDecor = (section: SectionId, id: string): EntryDecor => {
	const signPart: SignMeta | undefined = SIGNS.find((s) => id === s.id || id.startsWith(`${s.id}-`) || id.endsWith(`-${s.id}`));
	const planetPart: PlanetMeta | undefined = PLANETS.find((p) => id === p.id || id.startsWith(`${p.id}-`));
	const housePart = houseFromId(id);

	switch (section) {
		case 'signs': {
			const s = signPart!;
			return {
				glyph: s.glyph,
				chips: [s.element, s.modality, `ruled by ${PLANET_BY_ID.get(s.ruler)!.name}`, s.symbol, s.dates]
			};
		}
		case 'houses': {
			const h = housePart!;
			return {
				glyph: String(h.n),
				chips: [h.kind, `natural sign ${SIGN_BY_ID.get(h.naturalSign)!.name}`, h.theme]
			};
		}
		case 'planets': {
			const p = planetPart!;
			return { glyph: p.glyph, chips: [p.category, rulesText(p)].filter(Boolean) };
		}
		case 'sign-house': {
			const s = signPart!;
			const h = housePart!;
			return { glyph: s.glyph, chips: [`${s.element} · ${s.modality}`, `${HOUSE_ORDINALS[h.n - 1]} house — ${h.shortTheme}`] };
		}
		case 'planet-sign': {
			const p = planetPart!;
			const s = signPart!;
			return { glyph: `${p.glyph}${s.glyph}`, chips: [p.category, `${s.name}: ${s.element} · ${s.modality}`] };
		}
		case 'planet-house': {
			const p = planetPart!;
			const h = housePart!;
			return { glyph: `${p.glyph}${h.n}`, chips: [p.category, `${HOUSE_ORDINALS[h.n - 1]} house — ${h.shortTheme}`] };
		}
	}
};

// ---------------------------------------------------------------------------
// Search across every section — the original scoring, run synchronously over
// the compact index (which preserves section order, so ties break the same).

export interface SearchHit {
	section: SectionId;
	entry: IndexEntry;
	score: number;
}

export const searchSchool = (query: string, limit = 30): SearchHit[] => {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return [];
	const terms = q.split(/\s+/).filter(Boolean);

	const hits: SearchHit[] = [];
	for (const entry of SCHOOL_INDEX) {
		const title = entry.title.toLowerCase();
		const keywords = entry.keywords.join(' ').toLowerCase();
		const essence = entry.essence.toLowerCase();
		const body = entry.short.join(' ').toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (title === q) score += 60;
			if (title.includes(term)) score += 22;
			if (keywords.includes(term)) score += 12;
			if (essence.includes(term)) score += 8;
			else if (body.includes(term)) score += 3;
		}
		if (score > 0 && terms.every((t) => `${title} ${keywords} ${essence} ${body}`.includes(t))) {
			hits.push({ section: entry.section, entry, score });
		}
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

/** SchoolSection's in-section filter: title, keywords, or essence contains the query. */
export const filterSection = (entries: SchoolEntry[], filter: string): SchoolEntry[] => {
	const q = filter.trim().toLowerCase();
	if (!q) return entries;
	return entries.filter(
		(e) => e.title.toLowerCase().includes(q) || e.keywords.join(' ').toLowerCase().includes(q) || e.essence.toLowerCase().includes(q)
	);
};

// ---------------------------------------------------------------------------
// Birth-place picker: the bundled city list and BirthForm's matching rules.

export interface City {
	name: string;
	country: string;
	lat: number;
	lon: number;
	tz: string;
}

export const ASTRO_CITIES: City[] = citiesJson as City[];

export const searchCities = (query: string, limit = 8): City[] => {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return [];
	return ASTRO_CITIES.filter((c) => c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q))
		.sort((a, b) => {
			const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
			const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
			return aStarts - bStarts || a.name.localeCompare(b.name);
		})
		.slice(0, limit);
};
