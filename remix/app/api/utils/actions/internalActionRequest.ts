import { withInternalRequestActor } from '../auth/internalRequestActor';
import type { ResolveActionActor } from './firstPartyActionHost';
import { StorageMutationError } from '../storage/storageCore';

// Browser Action data APIs. Identity, credentials, admin/control-plane and
// chat permission APIs are not delegable to authored programs. In particular
// a program cannot grant itself Full access or launch recursive chat turns.
const DATA_FAMILIES = new Set(['things', 'components', 'schemas', 'webpages', 'builder', 'library']);
export const isLopuActionPath = (path: string) => /^\/api\/v1\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)
	&& DATA_FAMILIES.has(path.split('/')[3]) && !path.endsWith('/reveal');

export async function dispatchActionRequest(request: Request, actor: ResolveActionActor): Promise<Response> {
	const path = new URL(request.url).pathname;
	if (!isLopuActionPath(path)) throw new Error('This API is not available to Lopu Actions. Account security, credentials and chat permissions must be managed directly.');
	const { actionDataRoutes } = await import('../../../../server/utils/actionDataRoutes');
	const load = actionDataRoutes[path.slice('/api/'.length)];
	if (!load) throw new Error('Unknown Action API destination');
	const route = await load();
	const handler = request.method === 'GET' ? route.loader : route.action;
	if (!handler) throw new Error('Unsupported Action API method');
	return withInternalRequestActor(request, actor, async () => {
		request.signal.throwIfAborted();
		try {
			const result = await handler({ request });
			if (!(result instanceof Response)) throw new Error('Action API did not return a response');
			return result;
		} catch (error) {
			if (error instanceof Response) return error;
			if (error instanceof StorageMutationError) return Response.json({ ok: false, error: error.message }, { status: error.status });
			throw error;
		}
	});
}
