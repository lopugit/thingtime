// Factual astrological metadata: glyphs, rulerships, elements, house themes.
// Ported verbatim from StarsAlign (src/lib/astro/meta.ts). Prose content for
// the school lives in ./content/*.json; this file is the structured backbone
// both the engine and the day model join against.

export type SignId =
	| 'aries'
	| 'taurus'
	| 'gemini'
	| 'cancer'
	| 'leo'
	| 'virgo'
	| 'libra'
	| 'scorpio'
	| 'sagittarius'
	| 'capricorn'
	| 'aquarius'
	| 'pisces';

export type PlanetId = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

export interface SignMeta {
	id: SignId;
	name: string;
	glyph: string;
	element: 'fire' | 'earth' | 'air' | 'water';
	modality: 'cardinal' | 'fixed' | 'mutable';
	ruler: PlanetId;
	traditionalRuler?: PlanetId;
	symbol: string;
	dates: string;
}

export const SIGNS: SignMeta[] = [
	{
		id: 'aries',
		name: 'Aries',
		glyph: '♈\uFE0E',
		element: 'fire',
		modality: 'cardinal',
		ruler: 'mars',
		symbol: 'The Ram',
		dates: 'Mar 21 – Apr 19'
	},
	{
		id: 'taurus',
		name: 'Taurus',
		glyph: '♉\uFE0E',
		element: 'earth',
		modality: 'fixed',
		ruler: 'venus',
		symbol: 'The Bull',
		dates: 'Apr 20 – May 20'
	},
	{
		id: 'gemini',
		name: 'Gemini',
		glyph: '♊\uFE0E',
		element: 'air',
		modality: 'mutable',
		ruler: 'mercury',
		symbol: 'The Twins',
		dates: 'May 21 – Jun 20'
	},
	{
		id: 'cancer',
		name: 'Cancer',
		glyph: '♋\uFE0E',
		element: 'water',
		modality: 'cardinal',
		ruler: 'moon',
		symbol: 'The Crab',
		dates: 'Jun 21 – Jul 22'
	},
	{ id: 'leo', name: 'Leo', glyph: '♌\uFE0E', element: 'fire', modality: 'fixed', ruler: 'sun', symbol: 'The Lion', dates: 'Jul 23 – Aug 22' },
	{
		id: 'virgo',
		name: 'Virgo',
		glyph: '♍\uFE0E',
		element: 'earth',
		modality: 'mutable',
		ruler: 'mercury',
		symbol: 'The Maiden',
		dates: 'Aug 23 – Sep 22'
	},
	{
		id: 'libra',
		name: 'Libra',
		glyph: '♎\uFE0E',
		element: 'air',
		modality: 'cardinal',
		ruler: 'venus',
		symbol: 'The Scales',
		dates: 'Sep 23 – Oct 22'
	},
	{
		id: 'scorpio',
		name: 'Scorpio',
		glyph: '♏\uFE0E',
		element: 'water',
		modality: 'fixed',
		ruler: 'pluto',
		traditionalRuler: 'mars',
		symbol: 'The Scorpion',
		dates: 'Oct 23 – Nov 21'
	},
	{
		id: 'sagittarius',
		name: 'Sagittarius',
		glyph: '♐\uFE0E',
		element: 'fire',
		modality: 'mutable',
		ruler: 'jupiter',
		symbol: 'The Archer',
		dates: 'Nov 22 – Dec 21'
	},
	{
		id: 'capricorn',
		name: 'Capricorn',
		glyph: '♑\uFE0E',
		element: 'earth',
		modality: 'cardinal',
		ruler: 'saturn',
		symbol: 'The Sea-Goat',
		dates: 'Dec 22 – Jan 19'
	},
	{
		id: 'aquarius',
		name: 'Aquarius',
		glyph: '♒\uFE0E',
		element: 'air',
		modality: 'fixed',
		ruler: 'uranus',
		traditionalRuler: 'saturn',
		symbol: 'The Water-Bearer',
		dates: 'Jan 20 – Feb 18'
	},
	{
		id: 'pisces',
		name: 'Pisces',
		glyph: '♓\uFE0E',
		element: 'water',
		modality: 'mutable',
		ruler: 'neptune',
		traditionalRuler: 'jupiter',
		symbol: 'The Fish',
		dates: 'Feb 19 – Mar 20'
	}
];

export const SIGN_BY_ID = new Map(SIGNS.map((s) => [s.id, s]));

export interface PlanetMeta {
	id: PlanetId;
	name: string;
	glyph: string;
	category: 'luminary' | 'personal' | 'social' | 'outer';
	/** What this planet represents when it is the one being touched by a transit. */
	domain: string;
	/** What this planet does when it is the one transiting. */
	action: string;
}

export const PLANETS: PlanetMeta[] = [
	{ id: 'sun', name: 'Sun', glyph: '☉\uFE0E', category: 'luminary', domain: 'your core self and vitality', action: 'puts a spotlight on' },
	{ id: 'moon', name: 'Moon', glyph: '☾\uFE0E', category: 'luminary', domain: 'your feelings and needs', action: 'stirs the waters of' },
	{ id: 'mercury', name: 'Mercury', glyph: '☿\uFE0E', category: 'personal', domain: 'your mind and voice', action: 'starts a conversation with' },
	{
		id: 'venus',
		name: 'Venus',
		glyph: '♀\uFE0E',
		category: 'personal',
		domain: 'your affections and sense of worth',
		action: 'softens and sweetens'
	},
	{ id: 'mars', name: 'Mars', glyph: '♂\uFE0E', category: 'personal', domain: 'your drive and desire', action: 'charges up' },
	{ id: 'jupiter', name: 'Jupiter', glyph: '♃\uFE0E', category: 'social', domain: 'your faith and appetite for more', action: 'expands' },
	{ id: 'saturn', name: 'Saturn', glyph: '♄\uFE0E', category: 'social', domain: 'your commitments and limits', action: 'pressure-tests' },
	{ id: 'uranus', name: 'Uranus', glyph: '♅\uFE0E', category: 'outer', domain: 'your need for freedom', action: 'electrifies' },
	{ id: 'neptune', name: 'Neptune', glyph: '♆\uFE0E', category: 'outer', domain: 'your dreams and ideals', action: 'casts a mist over' },
	{ id: 'pluto', name: 'Pluto', glyph: '♇\uFE0E', category: 'outer', domain: 'your buried power', action: 'excavates' }
];

export const PLANET_BY_ID = new Map(PLANETS.map((p) => [p.id, p]));

export const HOUSE_ORDINALS = [
	'First',
	'Second',
	'Third',
	'Fourth',
	'Fifth',
	'Sixth',
	'Seventh',
	'Eighth',
	'Ninth',
	'Tenth',
	'Eleventh',
	'Twelfth'
] as const;

export interface HouseMeta {
	n: number;
	id: string;
	name: string;
	theme: string;
	shortTheme: string;
	kind: 'angular' | 'succedent' | 'cadent';
	naturalSign: SignId;
}

const HOUSE_THEMES: Array<[string, string]> = [
	['self, identity, appearance, beginnings', 'the self'],
	['money, possessions, resources, self-worth', 'resources'],
	['communication, siblings, learning, the local world', 'communication'],
	['home, family, roots, inner foundations', 'home & roots'],
	['creativity, pleasure, romance, self-expression', 'creativity & play'],
	['work, health, routines, service', 'work & wellbeing'],
	['partnership, marriage, one-to-one relationships', 'partnership'],
	['intimacy, shared resources, transformation', 'depth & merging'],
	['travel, higher learning, belief, meaning', 'meaning & travel'],
	['career, public role, reputation, ambition', 'career & calling'],
	['friendship, community, groups, the future', 'community'],
	['rest, solitude, the unconscious, release', 'the inner world']
];

export const HOUSES: HouseMeta[] = HOUSE_THEMES.map(([theme, shortTheme], i) => ({
	n: i + 1,
	id: `house-${i + 1}`,
	name: `The ${HOUSE_ORDINALS[i]} House`,
	theme,
	shortTheme,
	kind: i % 3 === 0 ? 'angular' : i % 3 === 1 ? 'succedent' : 'cadent',
	naturalSign: SIGNS[i].id
}));

export const HOUSE_BY_N = new Map(HOUSES.map((h) => [h.n, h]));

export type AspectId = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';

export interface AspectMeta {
	id: AspectId;
	name: string;
	glyph: string;
	angle: number;
	orb: number;
	quality: 'flowing' | 'frictional' | 'blending';
	verb: string;
}

export const ASPECTS: AspectMeta[] = [
	{ id: 'conjunction', name: 'Conjunction', glyph: '☌', angle: 0, orb: 8, quality: 'blending', verb: 'joins' },
	{ id: 'sextile', name: 'Sextile', glyph: '⚹', angle: 60, orb: 4, quality: 'flowing', verb: 'sextiles' },
	{ id: 'square', name: 'Square', glyph: '□', angle: 90, orb: 7, quality: 'frictional', verb: 'squares' },
	{ id: 'trine', name: 'Trine', glyph: '△', angle: 120, orb: 7, quality: 'flowing', verb: 'trines' },
	{ id: 'opposition', name: 'Opposition', glyph: '☍', angle: 180, orb: 8, quality: 'frictional', verb: 'opposes' }
];

export const RETROGRADE_GLYPH = '℞';

export const ordinal = (n: number): string => {
	const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
	return `${n}${suffix}`;
};
