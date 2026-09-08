import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Body, Observer, SearchRiseSet } from 'astronomy-engine';

import type { PackContext } from '../types';
import { findTransits } from './aspects';
import indexJson from './content/index.json';
import {
	arcBetween,
	ascendant,
	birthInstant,
	degInSign,
	eclipticLongitude,
	getPositions,
	houseOf,
	moonInfo,
	natalChart,
	signFromLongitude,
	signIndexFromLongitude,
	wholeSignHouses,
	zonedTimeToUtc
} from './engine';
import { ASTRO_CITIES, ASTRO_PACK_ARITIES, ASTRO_SCHOOL_ENTRIES, astroPack, normaliseProfile } from './index';
import { SECTIONS } from './school';

const closeTo = (actual: number, expected: number, epsilon = 0.005) =>
	assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);

const NOW = new Date('2026-09-02T04:15:00Z');
const context: PackContext = { random: () => 0.5, now: () => new Date(NOW.getTime()) };
const call = (name: string, ...args: unknown[]) => astroPack[name](args, context) as any;

const melbourneProfile = {
	birthDate: '1990-07-15',
	birthTime: '10:30',
	timeKnown: true,
	place: { name: 'Melbourne', country: 'Australia', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' }
};

// JSON-safe means a stringify/parse round trip loses nothing (undefined
// properties, Dates and class instances would all show up as a difference).
const assertJsonSafe = (value: unknown) => assert.deepEqual(JSON.parse(JSON.stringify(value)), value);

// ---------------------------------------------------------------------------
// The original StarsAlign engine suite.

describe('sign mapping', () => {
	it('maps longitudes to tropical signs', () => {
		assert.equal(signFromLongitude(0), 'aries');
		assert.equal(signFromLongitude(29.999), 'aries');
		assert.equal(signFromLongitude(30), 'taurus');
		assert.equal(signFromLongitude(359.9), 'pisces');
		assert.equal(signFromLongitude(-10), 'pisces');
		assert.equal(signFromLongitude(370), 'aries');
	});

	it('computes degree within sign', () => {
		closeTo(degInSign(35.5), 5.5, 1e-5);
	});
});

describe('arcBetween', () => {
	it('takes the short way around', () => {
		closeTo(arcBetween(350, 10), 20);
		closeTo(arcBetween(10, 350), -20);
		closeTo(arcBetween(0, 180), 180);
	});
});

describe('ephemeris', () => {
	it('puts the Sun at ~0° Aries on the March 2026 equinox', () => {
		// 2026 March equinox: Mar 20, 14:46 UTC.
		const lon = eclipticLongitude('sun', new Date(Date.UTC(2026, 2, 20, 14, 46)));
		const distanceFromZero = Math.min(lon, 360 - lon);
		assert.ok(distanceFromZero < 0.1);
	});

	it('puts the Sun in tropical Capricorn on New Year 2026', () => {
		const lon = eclipticLongitude('sun', new Date(Date.UTC(2026, 0, 1)));
		assert.equal(signFromLongitude(lon), 'capricorn');
	});

	it('returns all ten planets with valid longitudes', () => {
		const positions = getPositions(new Date(Date.UTC(2026, 7, 4)));
		assert.equal(positions.length, 10);
		for (const p of positions) {
			assert.ok(p.lon >= 0);
			assert.ok(p.lon < 360);
			assert.equal(p.signIndex, signIndexFromLongitude(p.lon));
		}
	});

	it('agrees with itself between phase angle and illumination', () => {
		const info = moonInfo(new Date(Date.UTC(2026, 7, 4)));
		assert.ok(info.phaseAngle >= 0);
		assert.ok(info.phaseAngle < 360);
		assert.ok(info.illumination >= 0);
		assert.ok(info.illumination <= 1);
		// Illumination should roughly track the phase angle: high near 180°.
		const nearFull = Math.abs(info.phaseAngle - 180) < 30;
		if (nearFull) assert.ok(info.illumination > 0.8);
	});
});

describe('ascendant', () => {
	const melbourne = { lat: -37.81, lon: 144.96 };
	const london = { lat: 51.5, lon: -0.13 };

	it('finds a rising degree that is actually on the horizon (Melbourne)', () => {
		const when = new Date(Date.UTC(2026, 7, 4, 2, 0));
		const asc = ascendant(when, melbourne);
		assert.notEqual(asc, null);
		assert.ok(asc! >= 0);
		assert.ok(asc! < 360);
	});

	it('moves forward through the zodiac over a couple of hours', () => {
		const t0 = new Date(Date.UTC(2026, 7, 4, 2, 0));
		const t1 = new Date(Date.UTC(2026, 7, 4, 4, 0));
		const a0 = ascendant(t0, london)!;
		const a1 = ascendant(t1, london)!;
		const forward = arcBetween(a0, a1);
		assert.ok(forward > 10); // ~30°/2h on average
		assert.ok(forward < 90);
	});

	it('equals the Sun longitude at sunrise (independent cross-check)', () => {
		const observer = new Observer(melbourne.lat, melbourne.lon, 0);
		const sunrise = SearchRiseSet(Body.Sun, observer, +1, new Date(Date.UTC(2026, 7, 3)), 2);
		assert.notEqual(sunrise, null);
		const asc = ascendant(sunrise!.date, melbourne)!;
		const sunLon = eclipticLongitude('sun', sunrise!.date);
		// Refraction + solar disc radius put geometric sunrise ~0.85° off; allow 1.5°.
		assert.ok(Math.abs(arcBetween(asc, sunLon)) < 1.5);
	});

	it('advances roughly 360° per sidereal day', () => {
		const t0 = new Date(Date.UTC(2026, 7, 4, 2, 0));
		const t1 = new Date(t0.getTime() + 23.9345 * 3600 * 1000);
		const a0 = ascendant(t0, melbourne)!;
		const a1 = ascendant(t1, melbourne)!;
		assert.ok(Math.abs(arcBetween(a0, a1)) < 3);
	});
});

describe('whole-sign houses', () => {
	it('assigns houses from the rising sign', () => {
		const houses = wholeSignHouses(7); // Scorpio rising
		assert.equal(houses[0], 7);
		assert.equal(houses[11], 6);
		assert.equal(houseOf(7, 7), 1);
		assert.equal(houseOf(8, 7), 2);
		assert.equal(houseOf(6, 7), 12);
	});
});

describe('timezone conversion', () => {
	it('converts Melbourne local time to UTC (AEST, UTC+10)', () => {
		const utc = zonedTimeToUtc(1990, 7, 15, 10, 30, 'Australia/Melbourne');
		assert.equal(utc.toISOString(), '1990-07-15T00:30:00.000Z');
	});

	it('handles daylight saving (AEDT, UTC+11)', () => {
		const utc = zonedTimeToUtc(1990, 1, 15, 10, 30, 'Australia/Melbourne');
		assert.equal(utc.toISOString(), '1990-01-14T23:30:00.000Z');
	});

	it('handles northern-hemisphere DST (London BST)', () => {
		const utc = zonedTimeToUtc(1985, 6, 1, 12, 0, 'Europe/London');
		assert.equal(utc.toISOString(), '1985-06-01T11:00:00.000Z');
	});
});

describe('natal chart', () => {
	it('builds a solar chart without birth time', () => {
		const chart = natalChart({ birthDate: '1990-07-15', timeKnown: false });
		assert.equal(chart.solar, true);
		const sun = chart.positions.find((p) => p.id === 'sun')!;
		assert.equal(sun.sign, 'cancer');
		assert.equal(chart.risingSignIndex, sun.signIndex);
	});

	it('builds a timed chart with an ascendant', () => {
		const chart = natalChart(melbourneProfile);
		assert.equal(chart.solar, false);
		assert.notEqual(chart.ascendant, null);
	});

	it('uses the historically correct offset for the birth instant', () => {
		const instant = birthInstant({ ...melbourneProfile, birthDate: '1990-01-15' });
		assert.equal(instant.toISOString(), '1990-01-14T23:30:00.000Z');
	});
});

describe('transits', () => {
	it('finds aspects between two skies and sorts by strength', () => {
		const sky = getPositions(new Date(Date.UTC(2026, 7, 4)));
		const natal = getPositions(new Date(Date.UTC(1990, 6, 15)));
		const transits = findTransits(sky, natal);
		assert.ok(transits.length > 0);
		for (const t of transits) {
			assert.ok(t.orb <= t.aspect.orb);
			assert.notEqual(t.transiting, 'moon');
		}
		for (let i = 1; i < transits.length; i++) {
			assert.ok(transits[i - 1].strength >= transits[i].strength);
		}
	});

	it('detects an exact conjunction', () => {
		const sky = getPositions(new Date(Date.UTC(1990, 6, 15)));
		const transits = findTransits(sky, sky);
		const sunReturn = transits.find((t) => t.transiting === 'sun' && t.natal === 'sun');
		assert.ok(sunReturn);
		assert.equal(sunReturn!.aspect.id, 'conjunction');
		assert.ok(sunReturn!.orb < 0.01);
	});
});

// ---------------------------------------------------------------------------
// The pack surface.

describe('pack contract', () => {
	it('declares exactly the catalogue keys with their arities', () => {
		assert.deepEqual(Object.keys(astroPack).sort(), Object.keys(ASTRO_PACK_ARITIES).sort());
		assert.deepEqual(Object.keys(astroPack).sort(), [
			'astro.chart',
			'astro.cities',
			'astro.entry',
			'astro.entryId',
			'astro.meta',
			'astro.search',
			'astro.section',
			'astro.sky',
			'astro.today'
		]);
		for (const [name, arity] of Object.entries(ASTRO_PACK_ARITIES)) {
			assert.ok(arity.min >= 0 && arity.max >= arity.min, name);
		}
	});

	it('bundles all 418 school entries with unique ids, plus the city list', () => {
		assert.equal(ASTRO_SCHOOL_ENTRIES.length, 418);
		assert.equal(new Set(ASTRO_SCHOOL_ENTRIES.map((e) => e.id)).size, 418);
		for (const section of SECTIONS) {
			assert.equal(ASTRO_SCHOOL_ENTRIES.filter((e) => e.section === section.id).length, section.count, section.id);
		}
		assert.equal(indexJson.length, 418);
		assert.ok(indexJson.every((e) => !('deep' in e) && Array.isArray(e.short) && typeof e.section === 'string'));
		assert.ok(ASTRO_CITIES.length > 300);
		assert.ok(ASTRO_CITIES.every((c) => typeof c.tz === 'string' && Number.isFinite(c.lat) && Number.isFinite(c.lon)));
	});
});

describe('astro.sky', () => {
	it('returns ten planets and the moon phase for an ISO instant', () => {
		const sky = call('astro.sky', '2026-09-02T04:15:00Z');
		assertJsonSafe(sky);
		assert.equal(sky.iso, '2026-09-02T04:15:00.000Z');
		assert.equal(sky.planets.length, 10);
		assert.equal(sky.planets[0].id, 'sun');
		assert.equal(sky.planets[0].sign, 'virgo');
		assert.match(sky.planets[0].degree, /^\d{1,2}°\d{2}′$/);
		assert.equal(typeof sky.planets[0].retrograde, 'boolean');
		assert.ok(sky.moon.percent >= 0 && sky.moon.percent <= 100 && Number.isInteger(sky.moon.percent));
		assert.equal(sky.moon.percent, Math.round(sky.moon.illumination * 100));
		assert.equal(sky.moon.sign, sky.planets[1].sign);
	});

	it('refuses a non-ISO instant and falls back to now when blank', () => {
		assert.throws(() => call('astro.sky', 'yesterday'), /astro\.sky: iso must be an ISO-8601 date-time string/);
		assert.throws(() => call('astro.sky', 42), /astro\.sky: iso/);
		assert.equal(call('astro.sky', null).iso, NOW.toISOString());
	});
});

describe('astro.chart', () => {
	it('builds a timed chart from the nested profile shape', () => {
		const chart = call('astro.chart', melbourneProfile);
		assertJsonSafe(chart);
		assert.equal(chart.birthIso, '1990-07-15T00:30:00.000Z');
		assert.equal(chart.solar, false);
		assert.equal(typeof chart.ascendant, 'number');
		assert.equal(chart.sunSign, 'cancer');
		assert.equal(chart.risingSign, 'virgo');
		assert.equal(chart.risingSignName, 'Virgo');
		assert.equal(chart.houses.length, 12);
		assert.equal(chart.houses[0], chart.risingSign);
		assert.equal(chart.positions.length, 10);
		for (const p of chart.positions) assert.ok(p.house >= 1 && p.house <= 12);
	});

	it('accepts the flat form variant with string booleans and numeric strings', () => {
		const flat = call('astro.chart', {
			birthDate: '1990-07-15',
			birthTime: '10:30',
			timeKnown: 'true',
			placeName: 'Melbourne',
			placeCountry: 'Australia',
			lat: '-37.81',
			lon: '144.96',
			tz: 'Australia/Melbourne'
		});
		const nested = call('astro.chart', melbourneProfile);
		assert.deepEqual(flat, nested);
	});

	it('falls back to a solar chart when the time is unknown', () => {
		const chart = call('astro.chart', { birthDate: '1990-07-15', timeKnown: 'false' });
		assert.equal(chart.solar, true);
		assert.equal(chart.ascendant, null);
		assert.equal(chart.risingSign, chart.sunSign);
		assert.equal(chart.birthIso, '1990-07-15T12:00:00.000Z');
	});

	it('refuses malformed profiles with field-specific messages', () => {
		assert.throws(() => call('astro.chart', 'nope'), /astro\.chart: profile must be an object/);
		assert.throws(() => call('astro.chart', { birthDate: '15/07/1990' }), /profile\.birthDate must be YYYY-MM-DD/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-02-30' }), /profile\.birthDate must be a real calendar date/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-07-15', timeKnown: 'maybe' }), /profile\.timeKnown must be true or false/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-07-15', timeKnown: true, birthTime: '25:00' }), /profile\.birthTime must be HH:mm/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-07-15', place: { lat: 1, lon: 2, tz: 'Mars/Olympus' } }), /profile\.place\.tz/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-07-15', place: { lat: 100, lon: 2, tz: 'UTC' } }), /profile\.place\.lat/);
		assert.throws(() => call('astro.chart', { birthDate: '1990-07-15', lat: 1, lon: 2 }), /profile\.tz/);
	});
});

describe('astro.today', () => {
	it('precomputes the whole day model for a timed chart', () => {
		const model = call('astro.today', { ...melbourneProfile, displayName: 'Nik' });
		assertJsonSafe(model);
		assert.equal(model.tz, 'Australia/Melbourne');
		assert.equal(model.dateLabel, 'Wednesday, 2 September 2026');
		assert.equal(model.hour, 14);
		assert.equal(model.greeting, 'Good afternoon');
		assert.deepEqual(model.chips.sun, { sign: 'cancer', signName: 'Cancer', glyph: '☉', label: 'Cancer sun' });
		assert.equal(model.chips.moon.sign, 'aries');
		assert.equal(model.chips.rising.sign, 'virgo');
		assert.match(
			model.summary,
			/^Today the Moon drifts through \w+: .+\. The strongest current running through your chart: .+ Walk it like a Cancer, Nik — but let the day surprise you\.$/
		);
		assert.match(model.moon.line, /^\w+( \w+)? in \w+ — the mood is .+\.$/);
		assert.equal(model.moon.percent, Math.round(model.moon.illumination * 100));
		assert.equal(model.sky.length, 10);
		for (const row of model.sky) {
			assert.ok(row.house >= 1 && row.house <= 12);
			assert.match(row.houseOrdinal, /^\d{1,2}(st|nd|rd|th)$/);
			assert.equal(row.href, `/p/starsalign-entry?id=${row.id}-${row.sign}`);
		}
		assert.match(model.houseLine, /^Sun is moving through your \w+ house — attention gathers around .+\.$/);
		assert.equal(model.transitsSubtitle, 'The strongest aspects between today’s sky and the sky of 15 July 1990.');
		assert.ok(model.transits.length >= 1 && model.transits.length <= 5);
		for (const t of model.transits) {
			assert.equal(t.orb, Math.round(t.orb * 10) / 10);
			assert.equal(t.orbLabel, `${t.orb.toFixed(1)}° from exact`);
			assert.equal(t.transitHref, `/p/starsalign-entry?id=${t.transiting.id}`);
			assert.equal(t.natalHref, `/p/starsalign-entry?id=${t.natal.id}`);
			assert.match(t.title, /^\w+ \w+ your natal \w+$/);
		}
		assert.equal(model.transitsEmpty, false);
		assert.equal(model.housesSubtitle, 'Whole-sign houses from your Virgo ascendant.');
		assert.equal(model.houses.length, 12);
		assert.equal(model.houses[0].sign, 'virgo');
		assert.equal(model.houses[0].ordinal, '1st');
		assert.equal(model.houses[6].href, `/p/starsalign-entry?id=${model.houses[6].sign}-house-7`);
		assert.ok(model.houses.every((h: any) => typeof h.planetGlyphs === 'string' && h.planetGlyphs.length > 0));
		assert.deepEqual(model.natal, {
			solar: false,
			birthDateLabel: '15 July 1990',
			birthIso: '1990-07-15T00:30:00.000Z',
			ascendant: model.natal.ascendant,
			risingSign: 'virgo',
			risingSignName: 'Virgo',
			sunSign: 'cancer',
			moonSign: 'aries'
		});
	});

	it('caps transits at the strongest five', () => {
		// Birth at the very instant being read: every planet conjoins itself.
		const model = call('astro.today', {
			birthDate: '2026-09-02',
			birthTime: '14:15',
			timeKnown: true,
			place: { name: 'Melbourne', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' }
		});
		assert.equal(model.transits.length, 5);
		assert.equal(model.transits[0].aspectId, 'conjunction');
		assert.equal(model.transits[0].orb, 0);
	});

	it('uses the viewer time zone for the greeting, hour and date label', () => {
		const london = call('astro.today', melbourneProfile, '2026-09-02T04:15:00Z', 'Europe/London');
		assert.equal(london.hour, 5);
		assert.equal(london.greeting, 'Good morning');
		assert.equal(london.dateLabel, 'Wednesday, 2 September 2026');
		const honolulu = call('astro.today', melbourneProfile, '2026-09-02T04:15:00Z', 'Pacific/Honolulu');
		assert.equal(honolulu.hour, 18);
		assert.equal(honolulu.greeting, 'Good evening');
		assert.equal(honolulu.dateLabel, 'Tuesday, 1 September 2026');
		const late = call('astro.today', melbourneProfile, '2026-09-02T04:15:00Z', 'Europe/Paris');
		assert.equal(late.hour, 6);
		const small = call('astro.today', melbourneProfile, '2026-09-02T02:15:00Z', 'Europe/London');
		assert.equal(small.greeting, 'Up late or up early');
		// Default zone: the birth place, else UTC.
		assert.equal(call('astro.today', { birthDate: '1990-07-15', timeKnown: false }).tz, 'UTC');
	});

	it('reads a solar chart and a sky-only model without a profile', () => {
		const solar = call('astro.today', { birthDate: '1990-07-15', timeKnown: false });
		assert.equal(solar.chips.rising, null);
		assert.equal(solar.natal.solar, true);
		assert.match(solar.housesSubtitle, /^Solar houses — counted from your Sun sign\./);
		assert.equal(solar.houses[0].sign, 'cancer');
		assert.equal(solar.wheel.asc, null);
		assert.equal(solar.wheel.caption, 'SKY ✶ YOU');

		const none = call('astro.today', null);
		assertJsonSafe(none);
		assert.deepEqual(none.chips, { sun: null, moon: null, rising: null });
		assert.equal(none.natal, null);
		assert.deepEqual(none.houses, []);
		assert.deepEqual(none.transits, []);
		assert.equal(none.transitsEmpty, false);
		assert.equal(none.houseLine, null);
		assert.equal(none.housesSubtitle, null);
		assert.ok(none.sky.every((row: any) => row.house === null && row.houseOrdinal === null));
		assert.equal(none.wheel.caption, 'THE SKY');
		assert.equal(none.wheel.rHub, 99);
		assert.deepEqual(none.wheel.natal, []);
	});

	it('precomputes wheel geometry that stays inside the 340×340 viewBox', () => {
		const model = call('astro.today', melbourneProfile);
		const wheel = model.wheel;
		assert.deepEqual(
			[wheel.size, wheel.cx, wheel.cy, wheel.rOuter, wheel.rSignsInner, wheel.rSky, wheel.rNatal, wheel.rHub],
			[340, 170, 170, 166, 140, 123, 89, 69]
		);
		assert.equal(wheel.signs.length, 12);
		assert.equal(wheel.spokes.length, 12);
		assert.equal(wheel.natal.length, 10);
		assert.equal(wheel.sky.length, 10);
		assert.equal(wheel.caption, 'SKY ✶ YOU');
		const inside = (x: number, y: number) => x >= 0 && x <= 340 && y >= 0 && y <= 340;
		const oneDecimal = (n: number) => Math.round(n * 10) / 10 === n;
		const radiusOf = (x: number, y: number) => Math.hypot(x - 170, y - 170);
		for (const s of wheel.signs) {
			assert.ok(inside(s.x, s.y) && oneDecimal(s.x) && oneDecimal(s.y));
			closeTo(radiusOf(s.x, s.y), 153, 0.2);
		}
		for (const l of wheel.spokes) {
			assert.ok(inside(l.x1, l.y1) && inside(l.x2, l.y2));
			closeTo(radiusOf(l.x1, l.y1), 69, 0.2);
			closeTo(radiusOf(l.x2, l.y2), 166, 0.2);
		}
		for (const p of wheel.natal) {
			assert.ok(inside(p.x, p.y) && inside(p.tickX, p.tickY));
			closeTo(radiusOf(p.x, p.y), 89, 0.2);
		}
		for (const p of wheel.sky) {
			assert.ok(inside(p.x, p.y) && inside(p.tickX, p.tickY));
			closeTo(radiusOf(p.x, p.y), 123, 0.2);
			closeTo(radiusOf(p.tickX, p.tickY), 140, 0.2);
		}
		// The ascendant marker runs from the hub to the rim at 9 o'clock.
		assert.deepEqual(wheel.asc, { x1: 101, y1: 170, x2: 4, y2: 170, labelX: 8, labelY: 162 });
		// The rising sign's 0° spoke sits at the ascendant marker's rotation (180 - asc).
		const risingIndex = model.wheel.signs.findIndex((s: any) => s.glyph === '♍︎');
		const rotation = 180 - model.natal.ascendant;
		const expected = ((risingIndex * 30 + 15 + rotation) * Math.PI) / 180;
		closeTo(wheel.signs[risingIndex].x, 170 + 153 * Math.cos(expected), 0.1);
		closeTo(wheel.signs[risingIndex].y, 170 - 153 * Math.sin(expected), 0.1);
		// Glyphs never sit closer than 7° apart on a ring.
		const skyAngles = wheel.sky.map((p: any) => Math.atan2(170 - p.y, p.x - 170)).sort((a: number, b: number) => a - b);
		for (let i = 1; i < skyAngles.length; i++) assert.ok(((skyAngles[i] - skyAngles[i - 1]) * 180) / Math.PI >= 6.9);
	});

	it('refuses bad instants, zones and profiles', () => {
		assert.throws(() => call('astro.today', melbourneProfile, 'yesterday'), /astro\.today: iso must be an ISO-8601 date-time string/);
		assert.throws(() => call('astro.today', melbourneProfile, null, 'Nowhere/Town'), /astro\.today: tz must be an IANA time zone id/);
		assert.throws(() => call('astro.today', melbourneProfile, '1492-10-12T00:00:00Z'), /astro\.today: iso must fall between the years/);
		assert.throws(() => call('astro.today', { birthDate: 'soon' }), /astro\.today: profile\.birthDate must be YYYY-MM-DD/);
		assert.throws(() => call('astro.today', 'me'), /astro\.today: profile must be an object/);
	});
});

describe('astro.entryId', () => {
	it('follows the school id conventions for pairs and singles', () => {
		assert.deepEqual(call('astro.entryId', 'mars', 'libra', ''), { id: 'mars-libra', section: 'planet-sign', title: 'Mars in Libra' });
		assert.deepEqual(call('astro.entryId', 'mars', null, 'house-7'), {
			id: 'mars-house-7',
			section: 'planet-house',
			title: 'Mars in the Seventh House'
		});
		assert.deepEqual(call('astro.entryId', '', 'libra', 7), { id: 'libra-house-7', section: 'sign-house', title: 'Libra in the Seventh House' });
		assert.deepEqual(call('astro.entryId', 'mars', '', ''), { id: 'mars', section: 'planets', title: 'The Mars' });
		assert.deepEqual(call('astro.entryId', null, 'Libra', null), { id: 'libra', section: 'signs', title: 'Libra' });
		assert.deepEqual(call('astro.entryId', '', '', '7'), { id: 'house-7', section: 'houses', title: 'The Seventh House' });
		assert.equal(call('astro.entryId', '', null, undefined), null);
	});

	it('composes the triple heading with its three pairwise readings', () => {
		const triple = call('astro.entryId', 'mars', 'libra', 'house-7');
		assert.deepEqual(triple, {
			id: null,
			section: null,
			heading: 'Mars in Libra in the Seventh House',
			pairs: [
				{ id: 'mars-libra', section: 'planet-sign', title: 'Mars in Libra' },
				{ id: 'mars-house-7', section: 'planet-house', title: 'Mars in the Seventh House' },
				{ id: 'libra-house-7', section: 'sign-house', title: 'Libra in the Seventh House' }
			]
		});
		assert.ok(triple.pairs.every((p: any) => call('astro.entry', p.id)?.section === p.section));
	});

	it('refuses unknown ingredients', () => {
		assert.throws(() => call('astro.entryId', 'plutoo', '', ''), /astro\.entryId: planet must be one of/);
		assert.throws(() => call('astro.entryId', '', 'ophiuchus', ''), /astro\.entryId: sign must be one of/);
		assert.throws(() => call('astro.entryId', '', '', 13), /astro\.entryId: house must be/);
		assert.throws(() => call('astro.entryId', '', '', 'house-0'), /astro\.entryId: house must be/);
	});
});

describe('astro.meta', () => {
	it('returns the metadata tables as detached JSON', () => {
		const meta = call('astro.meta');
		assertJsonSafe(meta);
		assert.equal(meta.signs.length, 12);
		assert.equal(meta.planets.length, 10);
		assert.equal(meta.houses.length, 12);
		assert.equal(meta.aspects.length, 5);
		assert.deepEqual(
			meta.sections.map((s: any) => [s.id, s.count]),
			[
				['signs', 12],
				['houses', 12],
				['planets', 10],
				['sign-house', 144],
				['planet-sign', 120],
				['planet-house', 120]
			]
		);
		meta.signs[0].name = 'mutated';
		assert.equal(call('astro.meta').signs[0].name, 'Aries');
	});
});

describe('astro.cities', () => {
	it('matches by name or country, prefix first, capped at 8 by default', () => {
		const mel = call('astro.cities', 'mel');
		assert.equal(mel[0].name, 'Melbourne');
		assert.deepEqual(Object.keys(mel[0]), ['name', 'country', 'lat', 'lon', 'tz']);
		const australia = call('astro.cities', 'australia');
		assert.ok(australia.length > 1 && australia.every((c: any) => c.country === 'Australia'));
		const an = call('astro.cities', 'an');
		assert.equal(an.length, 8);
		const prefixes = an.map((c: any) => c.name.toLowerCase().startsWith('an'));
		assert.deepEqual(
			prefixes,
			[...prefixes].sort((a, b) => Number(b) - Number(a))
		);
		assert.equal(call('astro.cities', 'an', 100).length, 24);
		assert.equal(call('astro.cities', 'an', 3).length, 3);
	});

	it('needs at least two characters and a string query', () => {
		assert.deepEqual(call('astro.cities', 'm'), []);
		assert.deepEqual(call('astro.cities', '  '), []);
		assert.deepEqual(call('astro.cities', null), []);
		assert.throws(() => call('astro.cities', 42), /astro\.cities: q must be a string/);
		assert.throws(() => call('astro.cities', 'mel', 'lots'), /astro\.cities: limit must be a number/);
	});
});

describe('astro.search', () => {
	it('scores exact titles highest and returns compact hits', () => {
		const hits = call('astro.search', 'mars in libra');
		assert.equal(hits[0].id, 'mars-libra');
		assert.equal(hits[0].section, 'planet-sign');
		assert.equal(hits[0].title, 'Mars in Libra');
		assert.equal(typeof hits[0].essence, 'string');
		assert.equal(hits.length, 1); // every term must match, and only one title carries all three
		const libra = call('astro.search', 'libra');
		assert.equal(libra[0].id, 'libra');
		assert.ok(libra[0].score > libra[1].score);
		assert.ok(libra.length <= 30 && libra.length > 5);
		for (let i = 1; i < libra.length; i++) assert.ok(libra[i - 1].score >= libra[i].score);
		assert.equal(call('astro.search', 'seventh house')[0].id, 'house-7');
	});

	it('requires every term, caps the limit at 60 and needs two characters', () => {
		assert.deepEqual(call('astro.search', 'm'), []);
		assert.deepEqual(call('astro.search', ''), []);
		assert.deepEqual(call('astro.search', 'money zzzzqqq'), []);
		assert.ok(call('astro.search', 'money').length > 0);
		assert.equal(call('astro.search', 'the', 500).length, 60);
		assert.equal(call('astro.search', 'the', 2).length, 2);
		assert.throws(() => call('astro.search', { q: 'mars' }), /astro\.search: q must be a string/);
	});
});

describe('astro.section', () => {
	it('paginates a section with decor', () => {
		const first = call('astro.section', 'sign-house');
		assertJsonSafe(first);
		assert.equal(first.title, 'Signs × Houses');
		assert.equal(first.total, 144);
		assert.equal(first.page, 1);
		assert.equal(first.pages, 6);
		assert.equal(first.entries.length, 24);
		assert.equal(first.entries[0].id, 'aries-house-1');
		assert.equal(first.entries[0].glyph, '♈︎');
		assert.deepEqual(first.entries[0].chips, ['fire · cardinal', 'First house — the self']);
		assert.ok(!('deep' in first.entries[0]) && !('short' in first.entries[0]));
		const last = call('astro.section', 'sign-house', null, 6);
		assert.equal(last.entries.length, 24);
		assert.equal(last.entries[23].id, 'pisces-house-12');
		assert.equal(call('astro.section', 'sign-house', '', 99).page, 6);
		assert.equal(call('astro.section', 'sign-house', '', 0).page, 1);
		const wide = call('astro.section', 'sign-house', '', 1, 1000);
		assert.equal(wide.perPage, 48);
		assert.equal(wide.pages, 3);
	});

	it('filters by title, keywords or essence', () => {
		const mars = call('astro.section', 'planet-sign', 'mars', 1, 5);
		assert.equal(mars.total, 12);
		assert.equal(mars.pages, 3);
		assert.deepEqual(
			mars.entries.map((e: any) => e.id),
			['mars-aries', 'mars-taurus', 'mars-gemini', 'mars-cancer', 'mars-leo']
		);
		assert.equal(mars.entries[0].glyph, '♂︎♈︎');
		const signs = call('astro.section', 'signs');
		assert.equal(signs.entries[0].glyph, '♈︎');
		assert.deepEqual(signs.entries[0].chips, ['fire', 'cardinal', 'ruled by Mars', 'The Ram', 'Mar 21 – Apr 19']);
		const houses = call('astro.section', 'houses');
		assert.equal(houses.entries[6].glyph, '7');
		assert.deepEqual(houses.entries[6].chips, ['angular', 'natural sign Libra', 'partnership, marriage, one-to-one relationships']);
		const planets = call('astro.section', 'planets');
		assert.deepEqual(planets.entries[3].chips, ['personal', 'rules Taurus & Libra']);
		const ph = call('astro.section', 'planet-house', 'seventh house');
		assert.equal(ph.total, 10);
		assert.equal(ph.entries[0].glyph, '☉︎7');
		assert.equal(call('astro.section', 'signs', 'zzzz').total, 0);
		assert.equal(call('astro.section', 'signs', 'zzzz').pages, 1);
	});

	it('refuses unknown sections', () => {
		assert.throws(() => call('astro.section', 'combos'), /astro\.section: section must be one of/);
		assert.throws(() => call('astro.section', null), /astro\.section: section must be one of/);
	});
});

describe('astro.entry', () => {
	it('returns the full entry with decor, or null', () => {
		const entry = call('astro.entry', 'mars-libra');
		assertJsonSafe(entry);
		assert.equal(entry.section, 'planet-sign');
		assert.equal(entry.title, 'Mars in Libra');
		assert.ok(entry.short.length >= 1 && entry.deep.length >= 1);
		assert.ok(entry.keywords.length >= 1);
		assert.equal(entry.glyph, '♂︎♎︎');
		assert.deepEqual(entry.chips, ['personal', 'Libra: air · cardinal']);
		assert.equal(entry.href, '/p/starsalign-entry?id=mars-libra');
		assert.equal(call('astro.entry', 'house-12').section, 'houses');
		assert.deepEqual(call('astro.entry', ' Sun '), call('astro.entry', 'sun'));
		assert.equal(call('astro.entry', 'nope'), null);
		assert.equal(call('astro.entry', 'x'.repeat(500)), null);
		assert.throws(() => call('astro.entry', 42), /astro\.entry: id must be a school entry id/);
	});

	it('resolves every bundled entry, and its copies are detached', () => {
		for (const source of ASTRO_SCHOOL_ENTRIES) {
			const entry = call('astro.entry', source.id);
			assert.equal(entry.section, source.section, source.id);
			assert.equal(entry.deep.length, source.deep.length, source.id);
		}
		const entry = call('astro.entry', 'sun');
		entry.short.push('mutated');
		assert.equal(call('astro.entry', 'sun').short.length, entry.short.length - 1);
	});
});

it('a flat profile with a cleared place (empty name/tz, zero coordinates) reads as no place', () => {
	const profile = normaliseProfile('astro.today', { birthDate: '1990-07-15', birthTime: '10:30', timeKnown: true, placeName: '', placeCountry: '', lat: 0, lon: 0, tz: '', displayName: 'Ada' });
	assert.equal(profile.place, undefined);
	const model = astroPack['astro.today']([{ birthDate: '1990-07-15', birthTime: '', timeKnown: false, placeName: '', lat: 0, lon: 0, tz: '' }, '2026-09-02T00:00:00.000Z'], { random: () => 0.5, now: () => new Date('2026-09-02T00:00:00.000Z') }) as Record<string, any>;
	assert.equal(model.natal.solar, true);
	assert.equal(model.sky.length, 10);
});
