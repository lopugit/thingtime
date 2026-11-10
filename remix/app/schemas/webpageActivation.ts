import { civilClock, civilCutoffInstant, civilDateEpoch, isCivilTime, offsetCivilDate } from './civilDates';

/** A saved opt-in, distinct from display sources and ordinary click Actions. */
export const WEBPAGE_ACTIVATION_REQUIREMENTS = {
	'api.webpages-resolve': '1.15.0',
	'api.actions-run': '1.45.0'
} as const;

const activationWriteVersions = {
	'api.things': { basic: '1.56.0', scheduled: '1.58.0' },
	'api.things-update': { basic: '1.22.0', scheduled: '1.23.0' }
} as const;

const slug = /^[A-Za-z0-9_-]{1,128}$/;
const inputKey = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const queryKey = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const reservedQuery = new Set([...reserved, 'key', 'mode']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const scalar = (value: unknown): value is string | number | boolean =>
	typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';

export function actionActivationWriteMinimum(crystal: unknown, feature: keyof typeof activationWriteVersions): string | null {
	if (!record(crystal)) return null;
	const version = activationWriteVersions[feature];
	const activation = crystal.activationAction;
	if (record(activation) && activation.cutoffTime !== undefined) return version.scheduled;
	let needsBasic = activation !== undefined;
	if (Array.isArray(crystal.steps)) {
		const pending = [...crystal.steps];
		const seen = new WeakSet();
		while (pending.length) {
			const entry = pending.pop();
			if (entry === null || typeof entry !== 'object' || seen.has(entry)) continue;
			seen.add(entry);
			if (entry.op === 'things.ensure') {
				if (entry.each !== undefined || entry.matchFields !== undefined) return version.scheduled;
				needsBasic = true;
			}
			if (Array.isArray(entry.ttExpr) && entry.ttExpr[0] === 'civilDateRange') return version.scheduled;
			for (const child of Object.values(entry)) pending.push(child);
		}
	}
	return needsBasic ? version.basic : null;
}

export type WebpageActivation = {
	action: string;
	cadence: 'open' | 'day';
	timeZone?: string;
	cutoffTime?: string | { thingId: string; schemaId: string; field: string };
	dayInput?: string;
	inputs?: Record<string, string | number | boolean>;
	queryResult?: Record<string, string>;
};

export type ResolvedWebpageActivation = Omit<WebpageActivation, 'cutoffTime'> & { cutoffTime?: string };

export function parseWebpageActivation(value: unknown): WebpageActivation | null {
	if (!record(value) || Object.keys(value).some(key => !['action', 'cadence', 'timeZone', 'cutoffTime', 'dayInput', 'inputs', 'queryResult'].includes(key))) return null;
	if (typeof value.action !== 'string' || !slug.test(value.action) || (value.cadence !== 'open' && value.cadence !== 'day')) return null;
	const config: WebpageActivation = { action: value.action, cadence: value.cadence };
	if (value.cadence === 'day') {
		if (typeof value.timeZone !== 'string' || value.timeZone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value.timeZone)) return null;
		try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); } catch { return null; }
		config.timeZone = value.timeZone;
		if (value.cutoffTime !== undefined) {
			const cutoff = value.cutoffTime;
			if (isCivilTime(cutoff)) config.cutoffTime = cutoff;
			else if (record(cutoff) && Object.keys(cutoff).length === 3 &&
				typeof cutoff.thingId === 'string' && slug.test(cutoff.thingId) &&
				typeof cutoff.schemaId === 'string' && slug.test(cutoff.schemaId) &&
				typeof cutoff.field === 'string' && inputKey.test(cutoff.field) && !reserved.has(cutoff.field)) {
				config.cutoffTime = { thingId: cutoff.thingId, schemaId: cutoff.schemaId, field: cutoff.field };
			} else return null;
		}
		if (value.dayInput !== undefined) {
			if (typeof value.dayInput !== 'string' || !inputKey.test(value.dayInput) || reserved.has(value.dayInput)) return null;
			config.dayInput = value.dayInput;
		}
	} else if (value.timeZone !== undefined || value.cutoffTime !== undefined || value.dayInput !== undefined) return null;
	if (value.inputs !== undefined) {
		if (!record(value.inputs) || (config.dayInput && own(value.inputs, config.dayInput))) return null;
		const entries = Object.entries(value.inputs);
		if (entries.some(([key, item]) => !inputKey.test(key) || reserved.has(key) || !scalar(item))) return null;
		config.inputs = Object.fromEntries(entries) as WebpageActivation['inputs'];
	}
	if (value.queryResult !== undefined) {
		if (!record(value.queryResult)) return null;
		const entries = Object.entries(value.queryResult);
		if (entries.some(([key, path]) => !queryKey.test(key) || reservedQuery.has(key) || typeof path !== 'string' ||
			!path.split('.').every(segment => inputKey.test(segment) && !reserved.has(segment)))) return null;
		config.queryResult = Object.fromEntries(entries) as Record<string, string>;
	}
	return config;
}

export const isPrivateActivationPage = (acl: unknown) => Array.isArray(acl) && acl.length === 1 && acl[0] === 'tt:user';

export function webpageActivationKey(config: ResolvedWebpageActivation, time = Date.now()): string {
	if (config.cadence === 'open') return 'open';
	const clock = civilClock(config.timeZone);
	const { day } = clock(time);
	const cutoff = config.cutoffTime;
	return cutoff && cutoff !== '00:00' && time >= civilCutoffInstant(clock, day, cutoff)
		? offsetCivilDate(civilDateEpoch(day)!, 1) : day;
}

/** Find the actual civil-date boundary; a local day need not be 24 hours. */
export function nextWebpageActivationBoundary(config: ResolvedWebpageActivation, time: number): number | null {
	if (config.cadence === 'open') return null;
	const clock = civilClock(config.timeZone);
	const { day } = clock(time);
	const cutoff = config.cutoffTime ?? '00:00';
	const current = civilCutoffInstant(clock, day, cutoff);
	return time < current ? current : civilCutoffInstant(clock, offsetCivilDate(civilDateEpoch(day)!, 1), cutoff);
}

export function webpageActivationQuery(config: WebpageActivation, result: unknown): Record<string, string | number | boolean> {
	const entries = [];
	for (const [key, path] of Object.entries(config.queryResult || {})) {
		let value = result;
		for (const segment of path.split('.')) {
			if (!record(value) || !own(value, segment)) { value = undefined; break; }
			value = value[segment];
		}
		if (scalar(value) && value !== '') entries.push([key, value] as const);
	}
	return Object.fromEntries(entries);
}

/** Automatic retries must address the same identity. Literal keys and the
 * server-derived civil date are stable; arbitrary expressions and other
 * references can change between executions. */
export function stableActivationEnsureKey(value: unknown, dayInput?: string): boolean {
	return typeof value === 'string' && !!value.trim() && (
		!value.startsWith('$') || value.startsWith('$$') || (!!dayInput && value === '$input.' + dayInput)
	);
}

export function stableActivationEnsureBatch(key: unknown, each: unknown, dayInput?: string): boolean {
	return !!dayInput && key === '$item' && record(each) && Object.keys(each).length === 1 &&
		Array.isArray(each.ttExpr) && each.ttExpr.length === 3 && each.ttExpr[0] === 'civilDateRange' &&
		each.ttExpr[1] === '$input.' + dayInput;
}
