import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { searchWorkspaceAddresses, workspacePlace, configureWorkspaceMaps } from '~/api/utils/serviceWorkspaces/maps';
import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import {
	archiveWorkspaceRecord,
	bindWorkspacePage,
	initializeWorkspace,
	moveWorkspaceVisit,
	readWorkspace,
	saveWorkspaceRecord,
	WorkspaceError
} from '~/api/utils/serviceWorkspaces/workspaces';

export async function loader({ request }: { request: Request }) {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in with Thingtime to open this workspace' }, { status: 401 });
	const url = new URL(request.url);
	try {
		return json(await readWorkspace(user, url.searchParams.get('rootId'), Number(url.searchParams.get('cursor') || 0)), {
			headers: { 'Cache-Control': 'private, no-store' }
		});
	} catch (error) {
		if (error instanceof WorkspaceError) return json({ ok: false, error: error.message }, { status: error.status });
		throw error;
	}
}
export async function action({ request }: { request: Request }) {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Sign in with Thingtime first' }, { status: 401 });
	if (request.method !== 'POST') return json({ ok: false, error: 'Use POST' }, { status: 405 });
	if (user.temporary) return json({ ok: false, error: 'Create an account to manage a workspace' }, { status: 403 });
	if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin workspace mutations are not allowed' }, { status: 403 });
	if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
		return json({ ok: false, error: 'Use application/json' }, { status: 415 });
	const limit = await enforceRateLimit(request, 'things.write', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) return json({ ok: false, error: 'Please wait before saving again' }, rateLimitedResponseInit(limit));
	const input: any = await readJsonBody(request, 64 * 1024);
	try {
		const operations: Record<string, (user: any, input: any) => Promise<any>> = {
			initialize: initializeWorkspace,
			save: saveWorkspaceRecord,
			archive: archiveWorkspaceRecord,
			move: moveWorkspaceVisit,
			bindPage: bindWorkspacePage,
			searchAddresses: searchWorkspaceAddresses,
			place: workspacePlace,
			configureMaps: configureWorkspaceMaps
		};
		const operation = Object.prototype.hasOwnProperty.call(operations, input?.operation) ? operations[input.operation] : null;
		if (!operation) return json({ ok: false, error: 'Unknown workspace operation' }, { status: 400 });
		return json(await operation(user, input), { headers: { 'Cache-Control': 'private, no-store' } });
	} catch (error) {
		if (error instanceof WorkspaceError) return json({ ok: false, error: error.message }, { status: error.status });
		throw error;
	}
}
