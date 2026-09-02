// The astro domain pack: StarsAlign's astrology engine bound to the action
// expression catalogue (schemas/actionExpressions.ts declares the names and
// arities; ASTRO_PACK_ARITIES mirrors them). Every function takes already
// resolved JSON args, validates them defensively (an Error message becomes
// the run refusal), and returns plain, bounded, JSON-safe data — no Dates,
// no class instances, no undefined inside arrays. Pure: no database, no
// network, no environment; `context.now()` is the only clock.

import type { ActionPack, PackContext } from '../types';
import { findTransits, type Transit } from './aspects';
import { daySummary, houseLine, moonLine, transitLine } from './compose';
import {
	formatDegree,
	getPositions,
	houseOf,
	moonInfo,
	natalChart,
	wholeSignHouses,
	type BirthProfile,
	type MoonInfo,
	type PlanetPosition
} from './engine';
import {
	ASPECTS,
	HOUSES,
	HOUSE_BY_N,
	HOUSE_ORDINALS,
	PLANETS,
	PLANET_BY_ID,
	RETROGRADE_GLYPH,
	SIGNS,
	SIGN_BY_ID,
	ordinal,
	type PlanetId,
	type SignId
} from './meta';
import {
	ASTRO_CITIES,
	ASTRO_SCHOOL_ENTRIES,
	ENTRY_BY_ID,
	SECTIONS,
	SECTION_BY_ID,
	SECTION_ENTRIES,
	entryDecor,
	filterSection,
	isSectionId,
	searchCities,
	searchSchool,
	type SectionId
} from './school';
import { wheelGeometry } from './wheel';

export { ASTRO_CITIES, ASTRO_SCHOOL_ENTRIES };

/** Where a school entry deep link lands: one seeded page, keyed by entry id. */
export const ASTRO_ENTRY_HREF_PREFIX = '/p/starsalign-entry?id=';
export const entryHref = (id: string): string => `${ASTRO_ENTRY_HREF_PREFIX}${encodeURIComponent(id)}`;

/** Ephemeris sanity window: astronomy-engine is documented as accurate ~1700–2200. */
const MIN_YEAR = 1700;
const MAX_YEAR = 2300;
const MAX_NAME_CHARS = 60;
const MAX_PLACE_NAME_CHARS = 120;
const MAX_QUERY_CHARS = 200;
const MAX_ENTRY_ID_CHARS = 64;
const TOP_TRANSITS = 5;
const CITIES_DEFAULT = 8;
const CITIES_MAX = 24;
const SEARCH_DEFAULT = 30;
const SEARCH_MAX = 60;
const SECTION_PER_PAGE_DEFAULT = 24;
const SECTION_PER_PAGE_MAX = 48;

export const ASTRO_PACK_ARITIES: Record<string, { min: number; max: number }> = {
	'astro.sky': { min: 1, max: 1 },
	'astro.chart': { min: 1, max: 1 },
	'astro.today': { min: 1, max: 3 },
	'astro.entryId': { min: 3, max: 3 },
	'astro.meta': { min: 0, max: 0 },
	'astro.cities': { min: 1, max: 2 },
	'astro.search': { min: 1, max: 2 },
	'astro.section': { min: 1, max: 4 },
	'astro.entry': { min: 1, max: 1 }
};

// ---------------------------------------------------------------------------
// Argument validation. Every refusal names the function and the field.

const refuse = (fn: string, message: string): never => {
	throw new Error(`astro.${fn}: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const isValidTimeZone = (tz: string): boolean => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

const parseInstant = (fn: string, field: string, value: unknown, context: PackContext): Date => {
	if (isBlank(value)) return new Date(context.now().getTime());
	if (typeof value !== 'string') return refuse(fn, `${field} must be an ISO-8601 date-time string`);
	const date = new Date(value.trim());
	if (!Number.isFinite(date.getTime())) return refuse(fn, `${field} must be an ISO-8601 date-time string`);
	const year = date.getUTCFullYear();
	if (year < MIN_YEAR || year >= MAX_YEAR) return refuse(fn, `${field} must fall between the years ${MIN_YEAR} and ${MAX_YEAR}`);
	return date;
};

const parseTimeZone = (fn: string, field: string, value: unknown, fallback: string): string => {
	if (isBlank(value)) return fallback;
	if (typeof value !== 'string' || !isValidTimeZone(value.trim()))
		return refuse(fn, `${field} must be an IANA time zone id like "Australia/Melbourne"`);
	return value.trim();
};

const parseLimit = (fn: string, field: string, value: unknown, fallback: number, max: number): number => {
	if (isBlank(value)) return fallback;
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return refuse(fn, `${field} must be a number`);
	return Math.min(max, Math.max(1, Math.floor(n)));
};

const parseQuery = (fn: string, field: string, value: unknown): string => {
	if (isBlank(value)) return '';
	if (typeof value !== 'string') return refuse(fn, `${field} must be a string`);
	return value.slice(0, MAX_QUERY_CHARS);
};

const parseBoolean = (fn: string, field: string, value: unknown): boolean => {
	if (isBlank(value)) return false;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') {
		const lowered = value.trim().toLowerCase();
		if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
		if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
	}
	return refuse(fn, `${field} must be true or false`);
};

const parseCoordinate = (fn: string, field: string, value: unknown, limit: number): number => {
	const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
	if (!Number.isFinite(n) || Math.abs(n) > limit) return refuse(fn, `${field} must be a number between -${limit} and ${limit}`);
	return n;
};

const parseBirthDate = (fn: string, value: unknown): string => {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return refuse(fn, 'profile.birthDate must be YYYY-MM-DD');
	const [y, m, d] = value.split('-').map(Number);
	const probe = new Date(Date.UTC(y, m - 1, d));
	const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
	if (!real) return refuse(fn, 'profile.birthDate must be a real calendar date');
	if (y < MIN_YEAR || y >= MAX_YEAR) return refuse(fn, `profile.birthDate must fall between the years ${MIN_YEAR} and ${MAX_YEAR}`);
	return value;
};

const parseBirthTime = (fn: string, value: unknown): string | undefined => {
	if (isBlank(value)) return undefined;
	if (typeof value !== 'string') return refuse(fn, 'profile.birthTime must be HH:mm');
	const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
	if (!match) return refuse(fn, 'profile.birthTime must be HH:mm');
	const hh = Number(match[1]);
	const mm = Number(match[2]);
	if (hh > 23 || mm > 59) return refuse(fn, 'profile.birthTime must be HH:mm');
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

type NormalisedProfile = BirthProfile & { displayName?: string };

const FLAT_PLACE_KEYS = ['placeName', 'placeCountry', 'lat', 'lon', 'tz'] as const;

/**
 * Accepts the StarsAlign BirthProfile shape ({ birthDate, birthTime?,
 * timeKnown, place? }) and a flat form-friendly variant ({ placeName,
 * placeCountry, lat, lon, tz }, timeKnown as 'true'/'false'), returning the
 * engine's BirthProfile. `displayName` is optional and only feeds the day
 * summary's closing line.
 */
export const normaliseProfile = (fn: string, value: unknown): NormalisedProfile => {
	if (!isRecord(value)) return refuse(fn, 'profile must be an object like { birthDate, birthTime?, timeKnown, place? }');
	const birthDate = parseBirthDate(fn, value.birthDate);
	const birthTime = parseBirthTime(fn, value.birthTime);
	// Mirrors BirthForm: the time counts as known only when one was given.
	const timeKnown = parseBoolean(fn, 'profile.timeKnown', value.timeKnown) && birthTime !== undefined;

	let placeSource: Record<string, unknown> | null = null;
	let prefix = 'profile.place';
	if (isRecord(value.place)) {
		placeSource = value.place;
	} else if (!isBlank(value.place)) {
		return refuse(fn, 'profile.place must be an object like { name, country?, lat, lon, tz }');
	} else if (FLAT_PLACE_KEYS.some((key) => !isBlank(value[key]))) {
		placeSource = { name: value.placeName, country: value.placeCountry, lat: value.lat, lon: value.lon, tz: value.tz };
		prefix = 'profile';
	}

	let place: BirthProfile['place'] | undefined;
	if (placeSource) {
		const lat = parseCoordinate(fn, `${prefix}.lat`, placeSource.lat, 90);
		const lon = parseCoordinate(fn, `${prefix}.lon`, placeSource.lon, 180);
		const tz = parseTimeZone(fn, `${prefix}.tz`, placeSource.tz, '');
		if (!tz) return refuse(fn, `${prefix}.tz must be an IANA time zone id like "Australia/Melbourne"`);
		const name = typeof placeSource.name === 'string' ? placeSource.name.trim().slice(0, MAX_PLACE_NAME_CHARS) : '';
		const country = typeof placeSource.country === 'string' ? placeSource.country.trim().slice(0, MAX_PLACE_NAME_CHARS) : '';
		place = country ? { name, country, lat, lon, tz } : { name, lat, lon, tz };
	}

	let displayName: string | undefined;
	if (!isBlank(value.displayName)) {
		if (typeof value.displayName !== 'string') return refuse(fn, 'profile.displayName must be a string');
		displayName = value.displayName.trim().slice(0, MAX_NAME_CHARS);
	}

	const profile: NormalisedProfile = { birthDate, timeKnown };
	if (birthTime !== undefined) profile.birthTime = birthTime;
	if (place) profile.place = place;
	if (displayName) profile.displayName = displayName;
	return profile;
};

// ---------------------------------------------------------------------------
// Output shapes.

const planetShape = (p: PlanetPosition) => {
	const meta = PLANET_BY_ID.get(p.id)!;
	const sign = SIGN_BY_ID.get(p.sign)!;
	return {
		id: p.id,
		name: meta.name,
		glyph: meta.glyph,
		category: meta.category,
		lon: p.lon,
		sign: p.sign,
		signName: sign.name,
		signGlyph: sign.glyph,
		degree: formatDegree(p.lon),
		retrograde: p.retrograde
	};
};

const moonShape = (skyMoon: PlanetPosition, info: MoonInfo) => ({
	phaseAngle: info.phaseAngle,
	phaseName: info.phaseName,
	emoji: info.emoji,
	illumination: info.illumination,
	percent: Math.round(info.illumination * 100),
	sign: skyMoon.sign,
	signName: SIGN_BY_ID.get(skyMoon.sign)!.name
});

const planetRef = (id: PlanetId) => {
	const meta = PLANET_BY_ID.get(id)!;
	return { id, name: meta.name, glyph: meta.glyph };
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Wednesday, 2 September 2026" for the instant, in the viewer's zone. */
const dateLabelIn = (date: Date, tz: string): string => {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(
		date
	);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')}`;
};

/** The 0–23 hour of the instant in the viewer's zone (drives the greeting). */
const hourIn = (date: Date, tz: string): number => {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).formatToParts(date);
	return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
};

/** "15 July 1990" from a YYYY-MM-DD birth date (no zone: it is a calendar date). */
const birthDateLabel = (birthDate: string): string => {
	const [y, m, d] = birthDate.split('-').map(Number);
	return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

const transitShape = (t: Transit) => {
	const line = transitLine(t);
	const orb = Math.round(t.orb * 10) / 10;
	const orbLabel = `${t.orb.toFixed(1)}° from exact`;
	return {
		glyph: t.aspect.glyph,
		aspectId: t.aspect.id,
		aspectName: t.aspect.name,
		orb,
		orbLabel,
		eyebrow: `${t.aspect.glyph} ${t.aspect.name} · ${orbLabel}`,
		title: line.title,
		body: line.body,
		transiting: planetRef(t.transiting),
		natal: planetRef(t.natal),
		transitHref: entryHref(t.transiting),
		natalHref: entryHref(t.natal)
	};
};

const chartShape = (profile: BirthProfile) => {
	const chart = natalChart(profile);
	const rising = SIGNS[chart.risingSignIndex];
	const sun = chart.positions.find((p) => p.id === 'sun')!;
	const moon = chart.positions.find((p) => p.id === 'moon')!;
	return {
		chart,
		result: {
			birthIso: chart.instant.toISOString(),
			timeKnown: profile.timeKnown,
			positions: chart.positions.map((p) => ({ ...planetShape(p), house: houseOf(p.signIndex, chart.risingSignIndex) })),
			ascendant: chart.ascendant,
			risingSignIndex: chart.risingSignIndex,
			risingSign: rising.id,
			risingSignName: rising.name,
			solar: chart.solar,
			houses: wholeSignHouses(chart.risingSignIndex).map((signIndex) => SIGNS[signIndex].id),
			sunSign: sun.sign,
			moonSign: moon.sign
		}
	};
};

// ---------------------------------------------------------------------------
// The day model: everything the Today page prints, precomputed.

const todayModel = (profile: NormalisedProfile | null, now: Date, tz: string) => {
	const sky = getPositions(now);
	const moon = moonInfo(now);
	const skyMoon = sky.find((p) => p.id === 'moon')!;
	const skySun = sky.find((p) => p.id === 'sun')!;

	const natal = profile ? natalChart(profile) : null;
	const transits = natal ? findTransits(sky, natal.positions) : [];
	const topTransits = transits.slice(0, TOP_TRANSITS);
	const houses = natal ? wholeSignHouses(natal.risingSignIndex) : null;

	const natalSun = natal?.positions.find((p) => p.id === 'sun');
	const natalMoon = natal?.positions.find((p) => p.id === 'moon');
	const risingName = natal ? SIGNS[natal.risingSignIndex].name : null;

	const hour = hourIn(now, tz);
	const greeting = hour < 5 ? 'Up late or up early' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const sunHouseNow = natal ? houseOf(skySun.signIndex, natal.risingSignIndex) : null;

	const chipFor = (id: SignId, glyph: string, word: string) => {
		const sign = SIGN_BY_ID.get(id)!;
		return { sign: id, signName: sign.name, glyph, label: `${sign.name} ${word}` };
	};

	return {
		iso: now.toISOString(),
		tz,
		dateLabel: dateLabelIn(now, tz),
		greeting,
		hour,
		displayName: profile?.displayName ?? null,
		chips: {
			sun: natalSun ? chipFor(natalSun.sign, '☉', 'sun') : null,
			moon: natalMoon ? chipFor(natalMoon.sign, '☾', 'moon') : null,
			rising: natal && !natal.solar ? chipFor(SIGNS[natal.risingSignIndex].id, '↑', 'rising') : null
		},
		summary: daySummary(profile?.displayName, natalSun?.sign, skyMoon, moon, topTransits[0]),
		moon: {
			...moonShape(skyMoon, moon),
			line: moonLine(skyMoon, moon)
		},
		sky: sky.map((p) => {
			const shape = planetShape(p);
			const house = natal ? houseOf(p.signIndex, natal.risingSignIndex) : null;
			const entryId = `${p.id}-${p.sign}`;
			return {
				...shape,
				label: `${shape.name} in ${shape.signName}`,
				retrogradeGlyph: p.retrograde ? RETROGRADE_GLYPH : '',
				house,
				houseOrdinal: house ? ordinal(house) : null,
				detail: `${shape.degree}${house ? ` · ${ordinal(house)} house` : ''}`,
				entryId,
				href: entryHref(entryId)
			};
		}),
		houseLine: natal && sunHouseNow != null ? houseLine('sun', sunHouseNow) : null,
		transitsSubtitle: profile ? `The strongest aspects between today’s sky and the sky of ${birthDateLabel(profile.birthDate)}.` : null,
		transits: topTransits.map(transitShape),
		transitsEmpty: natal !== null && topTransits.length === 0,
		housesSubtitle: natal
			? natal.solar
				? 'Solar houses — counted from your Sun sign. Add your birth time and place in Settings for your true rising sign and houses.'
				: `Whole-sign houses from your ${risingName} ascendant.`
			: null,
		houses: (houses ?? []).map((signIndex, i) => {
			const n = i + 1;
			const sign = SIGNS[signIndex];
			const occupants = sky.filter((p) => p.signIndex === signIndex);
			const entryId = `${sign.id}-house-${n}`;
			return {
				n,
				ordinal: ordinal(n),
				sign: sign.id,
				signName: sign.name,
				glyph: sign.glyph,
				shortTheme: HOUSE_BY_N.get(n)!.shortTheme,
				planetGlyphs: occupants.length ? occupants.map((p) => PLANET_BY_ID.get(p.id)!.glyph).join(' ') : '—',
				entryId,
				href: entryHref(entryId)
			};
		}),
		natal:
			natal && profile
				? {
						solar: natal.solar,
						birthDateLabel: birthDateLabel(profile.birthDate),
						birthIso: natal.instant.toISOString(),
						ascendant: natal.ascendant,
						risingSign: SIGNS[natal.risingSignIndex].id,
						risingSignName: risingName,
						sunSign: natalSun!.sign,
						moonSign: natalMoon!.sign
				  }
				: null,
		wheel: wheelGeometry(sky, natal?.positions ?? null, natal?.ascendant ?? null)
	};
};

// ---------------------------------------------------------------------------
// School lookups.

const PLANET_IDS = PLANETS.map((p) => p.id);
const SIGN_IDS = SIGNS.map((s) => s.id);

const parsePlanetPick = (fn: string, value: unknown): PlanetId | null => {
	if (isBlank(value)) return null;
	if (typeof value === 'string' && PLANET_BY_ID.has(value.trim().toLowerCase() as PlanetId)) return value.trim().toLowerCase() as PlanetId;
	return refuse(fn, `planet must be one of ${PLANET_IDS.join(', ')} (or empty)`);
};

const parseSignPick = (fn: string, value: unknown): SignId | null => {
	if (isBlank(value)) return null;
	if (typeof value === 'string' && SIGN_BY_ID.has(value.trim().toLowerCase() as SignId)) return value.trim().toLowerCase() as SignId;
	return refuse(fn, `sign must be one of ${SIGN_IDS.join(', ')} (or empty)`);
};

/** Accepts "house-7", 7, or "7". */
const parseHousePick = (fn: string, value: unknown): number | null => {
	if (isBlank(value)) return null;
	let n = NaN;
	if (typeof value === 'number') n = value;
	else if (typeof value === 'string') {
		const trimmed = value.trim().toLowerCase();
		const match = trimmed.match(/^(?:house-)?(\d{1,2})$/);
		if (match) n = Number(match[1]);
	}
	if (!Number.isInteger(n) || n < 1 || n > 12) return refuse(fn, 'house must be "house-1".."house-12", 1..12, or empty');
	return n;
};

const entryPointer = (id: string, section: SectionId) => ({ id, section, title: ENTRY_BY_ID.get(id)?.title ?? null });

const entryIdFor = (planet: PlanetId | null, sign: SignId | null, house: number | null) => {
	if (planet && sign && house) {
		const p = PLANET_BY_ID.get(planet)!;
		const s = SIGN_BY_ID.get(sign)!;
		return {
			id: null,
			section: null,
			heading: `${p.name} in ${s.name} in the ${HOUSE_ORDINALS[house - 1]} House`,
			pairs: [
				entryPointer(`${planet}-${sign}`, 'planet-sign'),
				entryPointer(`${planet}-house-${house}`, 'planet-house'),
				entryPointer(`${sign}-house-${house}`, 'sign-house')
			]
		};
	}
	if (planet && sign) return entryPointer(`${planet}-${sign}`, 'planet-sign');
	if (planet && house) return entryPointer(`${planet}-house-${house}`, 'planet-house');
	if (sign && house) return entryPointer(`${sign}-house-${house}`, 'sign-house');
	if (planet) return entryPointer(planet, 'planets');
	if (sign) return entryPointer(sign, 'signs');
	if (house) return entryPointer(`house-${house}`, 'houses');
	return null;
};

const fullEntry = (id: string) => {
	const entry = ENTRY_BY_ID.get(id);
	if (!entry) return null;
	const decor = entryDecor(entry.section, entry.id);
	return {
		id: entry.id,
		section: entry.section,
		title: entry.title,
		essence: entry.essence,
		keywords: [...entry.keywords],
		short: [...entry.short],
		deep: [...entry.deep],
		glyph: decor.glyph,
		chips: decor.chips,
		href: entryHref(entry.id)
	};
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------
// The pack.

export const astroPack: ActionPack = {
	'astro.sky': (args, context) => {
		const now = parseInstant('sky', 'iso', args[0], context);
		const sky = getPositions(now);
		const skyMoon = sky.find((p) => p.id === 'moon')!;
		return { iso: now.toISOString(), planets: sky.map(planetShape), moon: moonShape(skyMoon, moonInfo(now)) };
	},

	'astro.chart': (args) => {
		const profile = normaliseProfile('chart', args[0]);
		return chartShape(profile).result;
	},

	'astro.today': (args, context) => {
		const profile = isBlank(args[0]) ? null : normaliseProfile('today', args[0]);
		const now = parseInstant('today', 'iso', args[1], context);
		const tz = parseTimeZone('today', 'tz', args[2], profile?.place?.tz ?? 'UTC');
		return todayModel(profile, now, tz);
	},

	'astro.entryId': (args) => {
		const planet = parsePlanetPick('entryId', args[0]);
		const sign = parseSignPick('entryId', args[1]);
		const house = parseHousePick('entryId', args[2]);
		return entryIdFor(planet, sign, house);
	},

	'astro.meta': () =>
		clone({
			signs: SIGNS,
			planets: PLANETS,
			houses: HOUSES,
			aspects: ASPECTS,
			sections: SECTIONS,
			houseOrdinals: HOUSE_ORDINALS,
			retrogradeGlyph: RETROGRADE_GLYPH
		}),

	'astro.cities': (args) => {
		const q = parseQuery('cities', 'q', args[0]);
		const limit = parseLimit('cities', 'limit', args[1], CITIES_DEFAULT, CITIES_MAX);
		return searchCities(q, limit).map((c) => ({ name: c.name, country: c.country, lat: c.lat, lon: c.lon, tz: c.tz }));
	},

	'astro.search': (args) => {
		const q = parseQuery('search', 'q', args[0]);
		const limit = parseLimit('search', 'limit', args[1], SEARCH_DEFAULT, SEARCH_MAX);
		return searchSchool(q, limit).map((hit) => ({
			id: hit.entry.id,
			section: hit.section,
			title: hit.entry.title,
			essence: hit.entry.essence,
			score: hit.score,
			href: entryHref(hit.entry.id)
		}));
	},

	'astro.section': (args) => {
		const sectionId = typeof args[0] === 'string' ? args[0].trim().toLowerCase() : args[0];
		if (!isSectionId(sectionId)) return refuse('section', `section must be one of ${SECTIONS.map((s) => s.id).join(', ')}`);
		const section = SECTION_BY_ID.get(sectionId)!;
		const filter = parseQuery('section', 'filter', args[1]);
		const perPage = parseLimit('section', 'perPage', args[3], SECTION_PER_PAGE_DEFAULT, SECTION_PER_PAGE_MAX);
		const matching = filterSection(SECTION_ENTRIES[sectionId], filter);
		const total = matching.length;
		const pages = Math.max(1, Math.ceil(total / perPage));
		const page = Math.min(pages, parseLimit('section', 'page', args[2], 1, Number.MAX_SAFE_INTEGER));
		const start = (page - 1) * perPage;
		return {
			section: section.id,
			title: section.title,
			blurb: section.blurb,
			count: section.count,
			filter,
			total,
			page,
			pages,
			perPage,
			entries: matching.slice(start, start + perPage).map((entry) => {
				const decor = entryDecor(sectionId, entry.id);
				return {
					id: entry.id,
					title: entry.title,
					essence: entry.essence,
					keywords: [...entry.keywords],
					glyph: decor.glyph,
					chips: decor.chips,
					href: entryHref(entry.id)
				};
			})
		};
	},

	'astro.entry': (args) => {
		if (typeof args[0] !== 'string') return refuse('entry', 'id must be a school entry id like "sun-aries"');
		const id = args[0].trim().toLowerCase().slice(0, MAX_ENTRY_ID_CHARS);
		return fullEntry(id);
	}
};

/** Exposed for tests and the seeder; the pack functions above are the contract. */
export const astroInternals = { planetShape, todayModel, chartShape, entryIdFor, fullEntry, dateLabelIn, hourIn, birthDateLabel };
