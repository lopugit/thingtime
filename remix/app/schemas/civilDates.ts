const DAY_MS = 86_400_000;

export const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CIVIL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isCivilTime(value: unknown): value is string {
	return typeof value === 'string' && value.length === 5 && CIVIL_TIME.test(value);
}

export function civilDateEpoch(value: unknown): number | null {
	if (typeof value !== 'string' || !CIVIL_DATE.test(value)) return null;
	const epoch = Date.parse(`${value}T00:00:00.000Z`);
	return Number.isFinite(epoch) && new Date(epoch).toISOString().startsWith(value) ? epoch : null;
}

export function offsetCivilDate(epoch: number, days: number): string {
	return new Date(epoch + days * DAY_MS).toISOString().split('T')[0];
}

export function civilClock(timeZone: string | undefined) {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
		year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
	});
	return (instant: number) => {
		const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
		const day = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
		return { day, wallTime: Date.parse(`${day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`) };
	};
}

/** The earliest occurrence of a wall time. A gap advances to the first
 * real instant after the jump, and a fold crosses the cutoff only once. */
export function civilCutoffInstant(clock: ReturnType<typeof civilClock>, date: string, cutoff: string): number {
	const target = Date.parse(`${date}T${cutoff}:00.000Z`);
	const candidates = [...new Set([-DAY_MS, 0, DAY_MS].map(delta => {
		const sample = target + delta;
		return target - (clock(sample).wallTime - sample);
	}))].sort((a, b) => a - b);
	const exact = candidates.find(instant => clock(instant).wallTime === target);
	if (exact !== undefined) return exact;
	let start = candidates[0], end = candidates[candidates.length - 1];
	// In a clock gap the neighboring offsets bracket the transition. Work
	// in whole seconds because Intl reports local wall times to that precision.
	while (end - start > 1000) {
		const mid = Math.floor((start + end) / 2000) * 1000;
		if (clock(mid).wallTime < target) start = mid;
		else end = mid;
	}
	return end;
}
