import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '../auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';
import { MapsError } from './mapbox';

const headers = { 'Cache-Control': 'private, no-store' };
const defaults = { getCurrentUser, enforceRateLimit };
export async function mapRoute(request: Request, operation: (ownerId: string, input: any, signal: AbortSignal) => Promise<unknown>, dependencies: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...dependencies };
	if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers });
	const user = await deps.getCurrentUser(request);
	if (!user || user.temporary) return json({ ok: false, error: 'Sign in with a full account to use Maps.' }, { status: 401, headers });
	const contentType = requireJsonContentType(request);
	if (contentType) { contentType.headers.set('Cache-Control', 'private, no-store'); return contentType; }
	try {
		const input = await readJsonBody(request, 96 * 1024);
		const bucket = input?.operation === 'suggest' || input?.operation === 'optimize' || input?.operation === 'browser-config' ? `maps.${input.operation}` : 'maps.request';
		const limit = await deps.enforceRateLimit(request, bucket, `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) {
			const init = rateLimitedResponseInit(limit);
			const limitedHeaders = new Headers(init.headers);
			limitedHeaders.set('Cache-Control', 'private, no-store');
			return json({ ok: false, error: 'Map requests are running too quickly. Try again shortly.' }, { ...init, headers: limitedHeaders });
		}
		return json(await operation(user.id, input, request.signal), { headers });
	} catch (error) {
		if (error instanceof Response) { error.headers.set('Cache-Control', 'private, no-store'); return error; }
		if (error instanceof MapsError) return json({ ok: false, error: error.message }, { status: error.status, headers });
		return json({ ok: false, error: 'Map request could not be completed.' }, { status: 502, headers });
	}
}
