// The ephemeris core, ported from StarsAlign (src/lib/astro/engine.ts).
// Everything is computed with astronomy-engine using TRUE ECLIPTIC OF DATE
// longitudes — i.e. the tropical zodiac, where 0° Aries is the equinox of
// the moment being computed. Pure and deterministic: no DOM, no network.

import {
	Body,
	Ecliptic,
	EclipticGeoMoon,
	EquatorFromVector,
	GeoVector,
	Horizon,
	Illumination,
	MakeTime,
	MoonPhase,
	Observer,
	RotateVector,
	Rotation_ECT_EQD,
	Spherical,
	SunPosition,
	VectorFromSphere
} from 'astronomy-engine';

import type { PlanetId, SignId } from './meta';
import { SIGNS } from './meta';

export interface PlanetPosition {
	id: PlanetId;
	/** Ecliptic longitude of date, 0..360 */
	lon: number;
	signIndex: number;
	sign: SignId;
	degInSign: number;
	retrograde: boolean;
}

export interface MoonInfo {
	/** 0..360 — angular separation Sun→Moon; 0 new, 90 first quarter, 180 full. */
	phaseAngle: number;
	phaseName: string;
	/** 0..1 fraction of the lunar disc illuminated. */
	illumination: number;
	emoji: string;
}

export interface GeoPlace {
	lat: number;
	lon: number;
}

export const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Shortest signed arc from a to b, in (-180, 180]. */
export const arcBetween = (a: number, b: number): number => {
	const d = norm360(b - a);
	return d > 180 ? d - 360 : d;
};

export const signIndexFromLongitude = (lon: number): number => Math.floor(norm360(lon) / 30) % 12;

export const signFromLongitude = (lon: number): SignId => SIGNS[signIndexFromLongitude(lon)].id;

export const degInSign = (lon: number): number => norm360(lon) % 30;

export const formatDegree = (lon: number): string => {
	const d = degInSign(lon);
	const whole = Math.floor(d);
	const minutes = Math.floor((d - whole) * 60);
	return `${whole}°${String(minutes).padStart(2, '0')}′`;
};

const PLANET_BODIES: Array<[PlanetId, Body | null]> = [
	['sun', null], // special-cased via SunPosition
	['moon', null], // special-cased via EclipticGeoMoon
	['mercury', Body.Mercury],
	['venus', Body.Venus],
	['mars', Body.Mars],
	['jupiter', Body.Jupiter],
	['saturn', Body.Saturn],
	['uranus', Body.Uranus],
	['neptune', Body.Neptune],
	['pluto', Body.Pluto]
];

export const eclipticLongitude = (id: PlanetId, date: Date): number => {
	if (id === 'sun') return norm360(SunPosition(date).elon);
	if (id === 'moon') return norm360(EclipticGeoMoon(date).lon);
	const body = PLANET_BODIES.find(([pid]) => pid === id)?.[1];
	if (!body) throw new Error(`Unknown planet: ${id}`);
	return norm360(Ecliptic(GeoVector(body, date, true)).elon);
};

/** Positions of all ten planets at an instant, with retrograde flags. */
export const getPositions = (date: Date): PlanetPosition[] => {
	const later = new Date(date.getTime() + 6 * 3600 * 1000);
	return PLANET_BODIES.map(([id]) => {
		const lon = eclipticLongitude(id, date);
		const drift = arcBetween(lon, eclipticLongitude(id, later));
		const signIndex = signIndexFromLongitude(lon);
		return {
			id,
			lon,
			signIndex,
			sign: SIGNS[signIndex].id,
			degInSign: degInSign(lon),
			retrograde: drift < 0
		};
	});
};

const PHASE_NAMES: Array<[number, string, string]> = [
	[22.5, 'New Moon', '🌑'],
	[67.5, 'Waxing Crescent', '🌒'],
	[112.5, 'First Quarter', '🌓'],
	[157.5, 'Waxing Gibbous', '🌔'],
	[202.5, 'Full Moon', '🌕'],
	[247.5, 'Waning Gibbous', '🌖'],
	[292.5, 'Last Quarter', '🌗'],
	[337.5, 'Waning Crescent', '🌘'],
	[360.0, 'New Moon', '🌑']
];

export const moonInfo = (date: Date): MoonInfo => {
	const phaseAngle = MoonPhase(date);
	const illumination = Illumination(Body.Moon, date).phase_fraction;
	const entry = PHASE_NAMES.find(([limit]) => phaseAngle < limit) ?? PHASE_NAMES[0];
	return { phaseAngle, phaseName: entry[1], illumination, emoji: entry[2] };
};

/**
 * Altitude (degrees) above the local horizon of the ecliptic-of-date point at
 * longitude `lambda` (latitude 0), plus its azimuth. Used to solve the
 * ascendant numerically instead of trusting a sign-sensitive closed formula.
 */
const eclipticPointHorizon = (lambda: number, date: Date, place: GeoPlace): { altitude: number; azimuth: number } => {
	const time = MakeTime(date);
	const observer = new Observer(place.lat, place.lon, 0);
	const vecEct = VectorFromSphere(new Spherical(0, norm360(lambda), 1), time);
	const vecEqd = RotateVector(Rotation_ECT_EQD(time), vecEct);
	const eq = EquatorFromVector(vecEqd);
	const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
	return { altitude: hor.altitude, azimuth: hor.azimuth };
};

/**
 * The ascendant: the ecliptic longitude rising on the eastern horizon.
 * Scans for the horizon crossing with eastern azimuth, then bisects.
 * Returns null only for degenerate polar cases where no crossing exists.
 */
export const ascendant = (date: Date, place: GeoPlace): number | null => {
	const STEP = 2;
	const alt = (l: number) => eclipticPointHorizon(l, date, place);

	// Zodiac degrees rise in increasing order, so just below the ascendant's
	// longitude the sky has already risen (altitude > 0) and just above it has
	// not (altitude < 0): the ascendant is the pos→neg crossing along λ. The
	// neg→pos crossing is the descendant, on the western horizon.
	let prev = alt(0);
	for (let deg = STEP; deg <= 360; deg += STEP) {
		const curr = alt(deg % 360);
		if (prev.altitude >= 0 && curr.altitude < 0) {
			let lo = deg - STEP; // altitude >= 0 here
			let hi = deg; // altitude < 0 here
			for (let i = 0; i < 40; i++) {
				const mid = (lo + hi) / 2;
				if (alt(mid % 360).altitude >= 0) lo = mid;
				else hi = mid;
			}
			const asc = norm360((lo + hi) / 2);
			const check = alt(asc);
			// Sanity: the ascendant sits on the eastern half of the horizon.
			if (check.azimuth > 0 && check.azimuth < 180) return asc;
		}
		prev = curr;
	}
	return null;
};

/** Whole-sign houses: house 1 is the whole sign containing the ascendant. */
export const wholeSignHouses = (ascSignIndex: number): number[] => Array.from({ length: 12 }, (_, i) => (ascSignIndex + i) % 12);

/** Which whole-sign house (1-12) a planet falls in, given the rising sign. */
export const houseOf = (planetSignIndex: number, ascSignIndex: number): number => ((planetSignIndex - ascSignIndex + 12) % 12) + 1;

// ---------------------------------------------------------------------------
// Birth data → UTC instant (uses the runtime's IANA tz database via Intl,
// which applies the historically correct offset for the birth moment).

export interface BirthProfile {
	birthDate: string; // YYYY-MM-DD
	birthTime?: string; // HH:mm — omitted when time unknown
	timeKnown: boolean;
	place?: {
		name: string;
		country?: string;
		lat: number;
		lon: number;
		tz: string; // IANA id
	};
}

const wallTimeAsUtcMillis = (instant: Date, tz: string): number => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(instant);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	// hourCycle quirk: 'h23' vs 'h24' — normalize 24 to 0.
	const hour = get('hour') % 24;
	return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
};

/** Convert a wall-clock time in an IANA zone to the actual UTC instant. */
export const zonedTimeToUtc = (y: number, month: number, day: number, hour: number, minute: number, tz: string): Date => {
	const guess = Date.UTC(y, month - 1, day, hour, minute);
	const offset1 = wallTimeAsUtcMillis(new Date(guess), tz) - guess;
	const result1 = guess - offset1;
	const offset2 = wallTimeAsUtcMillis(new Date(result1), tz) - result1;
	return new Date(guess - offset2);
};

/**
 * The UTC instant of birth. Without a known time we use local noon — the
 * standard fallback: planets are close, only Moon/Asc carry real uncertainty.
 */
export const birthInstant = (profile: BirthProfile): Date => {
	const [y, m, d] = profile.birthDate.split('-').map(Number);
	const [hh, mm] = (profile.timeKnown && profile.birthTime ? profile.birthTime : '12:00').split(':').map(Number);
	if (profile.place?.tz) return zonedTimeToUtc(y, m, d, hh, mm, profile.place.tz);
	// No place: treat the time as UTC. Sun sign is unaffected in practice.
	return new Date(Date.UTC(y, m - 1, d, hh, mm));
};

export interface NatalChart {
	positions: PlanetPosition[];
	ascendant: number | null;
	/** Index of the rising sign, or of the Sun sign when time/place unknown (solar chart). */
	risingSignIndex: number;
	solar: boolean;
	instant: Date;
}

export const natalChart = (profile: BirthProfile): NatalChart => {
	const instant = birthInstant(profile);
	const positions = getPositions(instant);
	let asc: number | null = null;
	if (profile.timeKnown && profile.place) {
		asc = ascendant(instant, { lat: profile.place.lat, lon: profile.place.lon });
	}
	const sun = positions.find((p) => p.id === 'sun')!;
	return {
		positions,
		ascendant: asc,
		risingSignIndex: asc !== null ? signIndexFromLongitude(asc) : sun.signIndex,
		solar: asc === null,
		instant
	};
};
