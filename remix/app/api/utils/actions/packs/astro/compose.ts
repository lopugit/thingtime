// Composes the day-at-a-glance prose from computed positions: transit lines,
// the moon mood line, and the opening summary. Deterministic composition in a
// consistent voice. Ported verbatim from StarsAlign (src/lib/astro/compose.ts).

import type { Transit } from './aspects';
import type { MoonInfo, PlanetPosition } from './engine';
import type { AspectId, PlanetId, SignId } from './meta';
import { HOUSE_BY_N, PLANET_BY_ID, SIGN_BY_ID } from './meta';

const ASPECT_CLAUSE: Record<AspectId, string> = {
	conjunction: 'The two run together today — hard to tell where one ends and the other begins.',
	sextile: 'The door is open, but it will not open itself — small deliberate moves pay off.',
	square: 'Expect friction. It is uncomfortable, and it is also exactly where the energy is.',
	trine: 'This is ease you did not have to earn. Spend it on something that matters.',
	opposition: 'You will feel pulled between the two. The answer is usually both, in turns.'
};

const MOON_MOOD: Record<SignId, string> = {
	aries: 'quick to spark — act on the honest impulse, skip the argument',
	taurus: 'slow and sensory — feed the body, let things take the time they take',
	gemini: 'talkative and restless — collect the conversations, decide later',
	cancer: 'tender underneath — stay close to what feels like home',
	leo: 'warm and dramatic — let yourself be seen a little',
	virgo: 'precise and useful — small acts of order calm the whole system',
	libra: 'tilted toward others — company helps, so does fairness',
	scorpio: 'intense and private — feelings run deeper than they look',
	sagittarius: 'hungry for elsewhere — give the day some room to roam',
	capricorn: 'sober and steady — work is strangely soothing',
	aquarius: 'cool and clear-eyed — a step back shows the pattern',
	pisces: 'porous and dreamy — boundaries help, so does music'
};

export const transitLine = (t: Transit): { title: string; body: string } => {
	const tp = PLANET_BY_ID.get(t.transiting)!;
	const np = PLANET_BY_ID.get(t.natal)!;
	const sameBody = t.transiting === t.natal;
	const title = `${tp.name} ${t.aspect.verb} your natal ${np.name}`;
	const opening = sameBody
		? t.aspect.id === 'conjunction'
			? `Your ${tp.name} return — the sky's ${tp.name} comes home to the degree it held when you were born, renewing ${np.domain}.`
			: `The sky's ${tp.name} checks in on its natal station — a waypoint in the cycle of ${np.domain}.`
		: `${tp.name} ${tp.action} ${np.domain}.`;
	return {
		title,
		body: `${opening} ${ASPECT_CLAUSE[t.aspect.id]}`
	};
};

export const moonLine = (moon: PlanetPosition, info: MoonInfo): string => {
	const sign = SIGN_BY_ID.get(moon.sign)!;
	return `${info.phaseName} in ${sign.name} — the mood is ${MOON_MOOD[moon.sign]}.`;
};

/** One-line reading of a transiting planet moving through a natal house. */
export const houseLine = (planet: PlanetId, houseN: number): string => {
	const p = PLANET_BY_ID.get(planet)!;
	const h = HOUSE_BY_N.get(houseN)!;
	return `${p.name} is moving through your ${h.name.replace('The ', '').toLowerCase()} — attention gathers around ${h.shortTheme}.`;
};

const PHASE_TONE: Record<string, string> = {
	'New Moon': 'a seed moment — begin quietly',
	'Waxing Crescent': 'early momentum — protect the new thing',
	'First Quarter': 'a push point — friction means it is working',
	'Waxing Gibbous': 'refinement — adjust rather than abandon',
	'Full Moon': 'full visibility — feelings and facts both peak',
	'Waning Gibbous': 'harvest — share what you learned',
	'Last Quarter': 'an honest edit — release what is finished',
	'Waning Crescent': 'the exhale — rest is productive now'
};

export const daySummary = (
	displayName: string | undefined,
	sunSign: SignId | undefined,
	moon: PlanetPosition,
	info: MoonInfo,
	top: Transit | undefined
): string => {
	const moonSign = SIGN_BY_ID.get(moon.sign)!;
	const tone = PHASE_TONE[info.phaseName] ?? 'a day that rewards attention';
	const opening = `Today the Moon drifts through ${moonSign.name}: ${tone}.`;
	const personal = top
		? ` The strongest current running through your chart: ${
				PLANET_BY_ID.get(top.transiting)!.name.toLowerCase() === 'sun' ? 'the Sun' : PLANET_BY_ID.get(top.transiting)!.name
		  } ${top.aspect.verb} your natal ${PLANET_BY_ID.get(top.natal)!.name}, touching ${PLANET_BY_ID.get(top.natal)!.domain}.`
		: '';
	const closing = sunSign && displayName ? ` Walk it like a ${SIGN_BY_ID.get(sunSign)!.name}, ${displayName} — but let the day surprise you.` : '';
	return opening + personal + closing;
};
