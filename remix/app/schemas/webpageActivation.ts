/** A saved opt-in, distinct from display sources and ordinary click Actions. */
export const WEBPAGE_ACTIVATION_REQUIREMENTS = {
	'api.webpages-resolve': '1.14.0',
	'api.actions-run': '1.44.0'
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

export type WebpageActivation = {
	action: string;
	cadence: 'open' | 'day';
	timeZone?: string;
	dayInput?: string;
	inputs?: Record<string, string | number | boolean>;
	queryResult?: Record<string, string>;
};

export function parseWebpageActivation(value: unknown): WebpageActivation | null {
	if (!record(value) || Object.keys(value).some(key => !['action', 'cadence', 'timeZone', 'dayInput', 'inputs', 'queryResult'].includes(key))) return null;
	if (typeof value.action !== 'string' || !slug.test(value.action) || (value.cadence !== 'open' && value.cadence !== 'day')) return null;
	const config: WebpageActivation = { action: value.action, cadence: value.cadence };
	if (value.cadence === 'day') {
		if (typeof value.timeZone !== 'string' || value.timeZone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value.timeZone)) return null;
		try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); } catch { return null; }
		config.timeZone = value.timeZone;
		if (value.dayInput !== undefined) {
			if (typeof value.dayInput !== 'string' || !inputKey.test(value.dayInput) || reserved.has(value.dayInput)) return null;
			config.dayInput = value.dayInput;
		}
	} else if (value.timeZone !== undefined || value.dayInput !== undefined) return null;
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

export function webpageActivationKey(config: WebpageActivation, time = Date.now()): string {
	if (config.cadence === 'open') return 'open';
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
	}).formatToParts(time);
	const part = (type: string) => parts.find(value => value.type === type)!.value;
	return [part('year'), part('month'), part('day')].join('-');
}

/** Find the actual civil-date boundary; a local day need not be 24 hours. */
export function nextWebpageActivationBoundary(config: WebpageActivation, time: number): number | null {
	if (config.cadence === 'open') return null;
	const key = webpageActivationKey(config, time);
	let start = time, end = time + 30 * 60 * 60 * 1000;
	while (end - start > 1000) {
		const mid = Math.floor((start + end) / 2);
		if (webpageActivationKey(config, mid) === key) start = mid;
		else end = mid;
	}
	return end;
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
