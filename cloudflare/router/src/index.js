// thingtime.com router Worker.
//
// Sends each request to the backend its route group names in the route table
// (KV key `route-table`). Every failure falls back to passing the request
// through to the Vercel origin unchanged, so the router can only ever add a
// path, never remove one.
//
// Test paths, served on thingtime.com/__cf/* while that is the only route:
//   /__cf/health            router status and the active table (no secrets)
//   /__cf/route?path=/x     which group and backend /x resolves to
//   /__cf/via/<path>        route <path> exactly as live traffic would be

import { DEFAULT_ROUTE_TABLE, resolveRoute, validateRouteTable } from './routeTable.js';

export const ROUTE_TABLE_KEY = 'route-table';
const TABLE_CACHE_MS = 30_000;
const TEST_PREFIX = '/__cf';
const VIA_PREFIX = `${TEST_PREFIX}/via`;

// KV values are plain data, so caching them across requests in one isolate is
// allowed (sockets are not).
let cachedTable = null;

export function resetRouteTableCache() {
	cachedTable = null;
}

export async function loadRouteTable(env, now = Date.now()) {
	if (cachedTable && cachedTable.expires > now) return cachedTable;
	let table = DEFAULT_ROUTE_TABLE;
	let source = 'default';
	try {
		const stored = env.ROUTES ? await env.ROUTES.get(ROUTE_TABLE_KEY, 'json') : null;
		if (stored) {
			const checked = validateRouteTable(stored);
			if (checked.ok) {
				table = checked.table;
				source = 'kv';
			} else source = 'default (stored table invalid)';
		}
	} catch {
		source = 'default (KV unavailable)';
	}
	cachedTable = { table, source, expires: now + TABLE_CACHE_MS };
	return cachedTable;
}

const json = (body, status = 200) =>
	new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
	});

const annotate = (response, group, target) => {
	// Upgrades and opaque responses pass through untouched.
	if (response.status === 101 || response.webSocket) return response;
	const annotated = new Response(response.body, response);
	annotated.headers.set('x-thingtime-route', `${group}; ${target}`);
	return annotated;
};

async function dispatch(request, env, group, target) {
	if (target === 'worker' && env.API_WORKER) {
		return annotate(await env.API_WORKER.fetch(request), group, 'worker');
	}
	// `worker` without a deployed API Worker falls back to Vercel.
	const served = target === 'worker' ? 'vercel (worker unavailable)' : 'vercel';
	return annotate(await fetch(request), group, served);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		try {
			if (url.pathname === `${TEST_PREFIX}/health`) {
				const { table, source } = await loadRouteTable(env);
				return json({
					ok: true,
					service: 'thingtime-router',
					version: env.ROUTER_VERSION || 'unknown',
					apiWorker: Boolean(env.API_WORKER),
					table: {
						source,
						default: table.default,
						groups: Object.fromEntries(Object.entries(table.groups).map(([name, entry]) => [name, entry.target]))
					}
				});
			}
			if (url.pathname === `${TEST_PREFIX}/route`) {
				const path = url.searchParams.get('path') || '/';
				if (!path.startsWith('/')) return json({ ok: false, error: 'path must start with /' }, 400);
				const { table } = await loadRouteTable(env);
				return json({ ok: true, path, ...resolveRoute(table, path) });
			}
			let forward = request;
			let path = url.pathname;
			if (path === VIA_PREFIX || path.startsWith(`${VIA_PREFIX}/`)) {
				path = path.slice(VIA_PREFIX.length) || '/';
				const target = new URL(url);
				target.pathname = path;
				forward = new Request(target, request);
			} else if (path === TEST_PREFIX || path.startsWith(`${TEST_PREFIX}/`)) {
				return json({ ok: false, error: 'Unknown router test path' }, 404);
			}
			const { table } = await loadRouteTable(env);
			const { group, target } = resolveRoute(table, path);
			return await dispatch(forward, env, group, target);
		} catch {
			// Fail open: the origin keeps serving even if the router breaks.
			return fetch(request);
		}
	}
};
