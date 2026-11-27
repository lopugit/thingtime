// Route table for the thingtime.com router Worker.
//
// Each group lists path prefixes and the backend that serves them:
//   vercel — pass the request through to the existing Vercel origin
//   worker — send it to the Cloudflare API Worker (service binding API_WORKER)
// The longest matching prefix wins; anything unmatched uses `default`.

export const TARGETS = Object.freeze(['vercel', 'worker']);
export const ROUTE_TABLE_VERSION = 1;

export const DEFAULT_ROUTE_TABLE = Object.freeze({
	version: ROUTE_TABLE_VERSION,
	default: 'vercel',
	groups: Object.freeze({
		auth: { prefixes: ['/api/v1/auth', '/api/v1/login'], target: 'vercel' },
		rootData: { prefixes: ['/api/root-data'], target: 'vercel' },
		things: { prefixes: ['/api/v1/things'], target: 'vercel' },
		notifications: { prefixes: ['/api/v1/notifications'], target: 'vercel' },
		timeline: { prefixes: ['/api/v1/timeline'], target: 'vercel' },
		devices: { prefixes: ['/api/v1/devices', '/api/v1/watch'], target: 'vercel' },
		integrations: { prefixes: ['/api/v1/integrations'], target: 'vercel' },
		api: { prefixes: ['/api'], target: 'vercel' }
	})
});

const GROUP_NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,39}$/;

/** Checks a stored table. Anything malformed is refused, so the router falls back to the default. */
export function validateRouteTable(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Route table must be an object.' };
	if (value.version !== ROUTE_TABLE_VERSION) return { ok: false, error: `Route table version must be ${ROUTE_TABLE_VERSION}.` };
	if (!TARGETS.includes(value.default)) return { ok: false, error: `default must be one of ${TARGETS.join(', ')}.` };
	if (!value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) return { ok: false, error: 'groups must be an object.' };
	const groups = {};
	for (const [name, group] of Object.entries(value.groups)) {
		if (!GROUP_NAME.test(name)) return { ok: false, error: `Invalid group name: ${name}` };
		if (!group || !Array.isArray(group.prefixes) || group.prefixes.length === 0) return { ok: false, error: `${name} needs at least one prefix.` };
		for (const prefix of group.prefixes) {
			if (typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.length > 200 || /[?#\s]/.test(prefix))
				return { ok: false, error: `${name} has an invalid prefix.` };
		}
		if (!TARGETS.includes(group.target)) return { ok: false, error: `${name} target must be one of ${TARGETS.join(', ')}.` };
		groups[name] = { prefixes: [...group.prefixes], target: group.target };
	}
	return { ok: true, table: { version: ROUTE_TABLE_VERSION, default: value.default, groups } };
}

// `/api/v1/things` matches itself and `/api/v1/things/…`, not `/api/v1/thingsX`.
const matches = (pathname, prefix) =>
	prefix === '/' || pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** Longest matching prefix wins; unmatched paths use the table default. */
export function resolveRoute(table, pathname) {
	let best = null;
	for (const [group, entry] of Object.entries(table.groups)) {
		for (const prefix of entry.prefixes) {
			if (matches(pathname, prefix) && (!best || prefix.length > best.length)) best = { group, target: entry.target, length: prefix.length };
		}
	}
	return best ? { group: best.group, target: best.target } : { group: 'default', target: table.default };
}

/** A copy of `table` with one group, or every group and the default, moved to `target`. */
export function withTarget(table, group, target) {
	if (!TARGETS.includes(target)) throw new TypeError(`Target must be one of ${TARGETS.join(', ')}.`);
	const next = { version: table.version, default: table.default, groups: {} };
	for (const [name, entry] of Object.entries(table.groups)) next.groups[name] = { prefixes: [...entry.prefixes], target: entry.target };
	if (group === '*') {
		next.default = target;
		for (const entry of Object.values(next.groups)) entry.target = target;
	} else if (group === 'default') {
		next.default = target;
	} else {
		if (!next.groups[group]) throw new TypeError(`Unknown group: ${group}`);
		next.groups[group].target = target;
	}
	return next;
}
