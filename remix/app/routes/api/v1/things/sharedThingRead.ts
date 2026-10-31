import { json } from '~/api/http';
import { getSharedCompositionThing } from '~/api/utils/actions/sharedComposition';
import { withFriendIds, type Viewer } from '~/api/utils/things/things';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const createSharedThingRead = (overrides: Partial<{
	read: typeof getSharedCompositionThing;
	enrich: typeof withFriendIds;
	limit: typeof enforceRateLimit;
}> = {}) => {
	const deps = { read: getSharedCompositionThing, enrich: withFriendIds, limit: enforceRateLimit, ...overrides };
	return async (request: Request, context: { viewer: Viewer; app: boolean; cors: Record<string, string> }) => {
		const headers = { ...context.cors, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
		if (context.app) return json({ ok: false, error: 'Shared composition reads are first-party only' }, { status: 403, headers });
		const params = new URL(request.url).searchParams;
		const id = (params.get('id') || '').trim();
		const root = (params.get('sharedRoot') || '').trim();
		if (!id || !root || id.length > 128 || root.length > 128) return json({ ok: false, error: 'Pass id and sharedRoot Thing ids' }, { status: 400, headers });
		const limit = await deps.limit(request, 'webpages.resolve', context.viewer?.id ? `user:${context.viewer.id}` : null, { failClosed: true });
		if (!limit.allowed) {
			const init = rateLimitedResponseInit(limit);
			return json({ ok: false, error: 'Shared resolving is temporarily unavailable or rate-limited' }, { ...init, headers: { ...init.headers, ...headers } });
		}
		const result = await deps.read(await deps.enrich(context.viewer), id, root);
		if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status, headers });
		return json({ ok: true, thing: result.thing, post: null, parent: null, root: null, commentSort: null }, { headers });
	};
};

export const sharedThingRead = createSharedThingRead();
