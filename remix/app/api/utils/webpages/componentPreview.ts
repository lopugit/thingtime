import { json, readJsonBody } from '../../http';
import { getCurrentUser } from '../auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { withFriendIds } from '../things/things';
import { MAX_WEBPAGE_BLOCKS_BYTES, sanitizeWebpageBlocks } from '../../../schemas/registry';
import { resolveBlockComponents } from './webpages';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, x-tt-mongo-url' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const defaults = { user: getCurrentUser, limit: enforceRateLimit, plane: mongoDataPlane, viewer: withFriendIds, resolve: resolveBlockComponents };
export function createDraftComponentsAction(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) => {
		if (request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed' }, 405);
		const user = await deps.user(request);
		if (!user) return reply({ ok: false, error: 'Unauthorized' }, 401);
		const params = new URL(request.url).searchParams;
		if (
			['ownerId', 'dataPlane'].some((key) => params.getAll(key).length !== 1) ||
			[...params.keys()].some((key) => !['ownerId', 'dataPlane'].includes(key))
		)
			return reply({ ok: false, error: 'Draft account and database are required' }, 400);
		if (params.get('ownerId') !== user.id || params.get('dataPlane') !== deps.plane())
			return reply({ ok: false, error: 'Account or database changed. Reopen this branch.' }, 409);
		const limit = await deps.limit(request, 'webpages.resolve', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed)
			return json(
				{ ok: false, error: 'Component preview is busy. Retry shortly.' },
				{ ...rateLimitedResponseInit(limit), headers: { ...rateLimitHeaders(limit), ...headers } }
			);
		let body: any;
		try {
			body = await readJsonBody(request, MAX_WEBPAGE_BLOCKS_BYTES * 4);
		} catch (error) {
			return reply({ ok: false, error: 'Invalid or oversized block draft' }, error instanceof Response ? error.status : 400);
		}
		if (
			!body ||
			typeof body !== 'object' ||
			Array.isArray(body) ||
			Object.keys(body).length !== 1 ||
			!Object.prototype.hasOwnProperty.call(body, 'blocks')
		)
			return reply({ ok: false, error: 'Expected only blocks' }, 400);
		const checked = sanitizeWebpageBlocks(body.blocks);
		if (checked.ok === false) return reply({ ok: false, error: checked.error }, checked.status);
		// No stored page/root is supplied. Caller-authored refs cannot mint another
		// owner's inherited audience or run any action while rendering a draft.
		const result = { ok: true, ...(await deps.resolve(await deps.viewer({ id: user.id, username: user.username }), checked.blocks)) };
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4 * 1024 * 1024)
			return reply({ ok: false, error: 'These component previews are too large to load together.' }, 413);
		return reply(result);
	};
}
const rateLimitHeaders = (limit: Parameters<typeof rateLimitedResponseInit>[0]) =>
	Object.fromEntries(new Headers(rateLimitedResponseInit(limit).headers));
export const resolveDraftComponentsAction = createDraftComponentsAction();
