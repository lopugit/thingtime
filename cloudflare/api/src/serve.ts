// Request handling for the Cloudflare API Worker, kept out of the entry module:
// a Worker entry may only export handlers and Durable Object classes.

import { executeApiRoute, jsonResponse } from '../../../remix/app/api/utils/http/routeExecution';
import { cloudflareRoutes, type CloudflareRoute } from './routes.generated';

export const MANIFEST_PATH = '/__cf/api/manifest';
export const FALLBACK_HEADER = 'x-thingtime-fallback';
export const IDLE_CLOSE_MS = 60_000;
export const MAX_SHARDS = 16;

/** Capability manifest for this runtime: only what it actually serves. */
export const cloudflareManifest = (version = 'unknown') => ({
	schemaVersion: 1,
	runtime: 'cloudflare',
	version,
	features: Object.fromEntries(Object.values(cloudflareRoutes).map((route) => [route.feature, { version: route.version }])),
	operations: Object.entries(cloudflareRoutes).map(([key, route]) => ({ feature: route.feature, path: `/api/${key}`, methods: [...route.methods] }))
});

/** Not served here: the router sends the same request to Vercel. */
export const notOnThisRuntime = (reason = 'not-served-here') =>
	jsonResponse(
		{ ok: false, error: 'This endpoint is served by another Thingtime runtime.' },
		{ status: 421, headers: { [FALLBACK_HEADER]: 'vercel', 'x-thingtime-fallback-reason': reason, 'Cache-Control': 'no-store' } }
	);

/**
 * Whether this Worker has what `route` needs to behave exactly like Vercel.
 * Production mode is required always: in any other mode the shared auth code
 * falls back to a public development signing secret. Routes that read a
 * session also need the JWT key material. Anything not ready goes back to Vercel.
 */
export const runtimeReadyFor = (route: CloudflareRoute, env: Record<string, string | undefined> = process.env) =>
	env.NODE_ENV === 'production' &&
	Boolean(env.MONGODB_CONNECTION_STRING) &&
	(route.sessionFree || Boolean(env.JWT_PUBLIC_KEY || env.JWT_PRIVATE_KEY || env.JWT_SECRET));

export async function serveApiRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
	const method = request.method.toUpperCase();
	const route = cloudflareRoutes[path];
	if (!url.pathname.startsWith('/api/') || !route || !route.methods.includes(method === 'HEAD' ? 'GET' : method)) return notOnThisRuntime();
	if (!runtimeReadyFor(route)) return notOnThisRuntime('runtime-not-configured');
	return executeApiRoute({ request, path, method, loadModule: route.load, signal: request.signal });
}

export const shardIndex = (shards: number, random = Math.random) => Math.floor(random() * shards);

