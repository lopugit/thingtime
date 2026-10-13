import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import { getTimelinePage, getTimelineEntry, getTimelineComponentBindings, pushClientTimelineEvent, timelineDiscovery, validateClientTimelineEvent } from '~/api/utils/timeline/service';
import { TIMELINE_EVENT_MAX_BYTES, TIMELINE_PAGE_SIZE } from '~/timeline/contract';
import { handleVersionRequest, parseVersionRequest } from '~/api/utils/timeline/versions';
import { handleBranchRequest, getTimelineBranches, getTimelineBranch } from '~/api/utils/timeline/branches';
import { parseTimelineBranchCommand, parseTimelineBranchLookup } from '~/timeline/branches';
import { runWithHomeMongoEndpoint } from '~/api/utils/mongodb/endpoint';
import { parseBranchMergeRequest } from '~/timeline/branchMerge';
import { parseBranchCheckoutRequest } from '~/timeline/branchCheckout';
import { checkoutTimelineBranch } from '~/api/utils/timeline/branchCheckout';
import { previewBranchMerge } from '~/api/utils/timeline/branchMerge';
import { getRelatedTimelinePage } from '~/api/utils/timeline/relatedHistory';
import { timelineRelatedId, timelineRelatedRevision } from '~/timeline/relatedHistory';
import { parseActionOutcomeRecoveryCommand } from '~/timeline/actionRecovery';
import { actionOutcomeRecovery } from '~/api/utils/timeline/actionRecovery';

const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization, x-tt-mongo-url' };
const response = (body: unknown, status = 200) => json(body, { status, headers: privateHeaders });
const defaults = { recoverOutcome: actionOutcomeRecovery.recover, user: getCurrentUser, limit: enforceRateLimit, discovery: timelineDiscovery, page: getTimelinePage, relatedPage: getRelatedTimelinePage, entry: getTimelineEntry, componentBindings: getTimelineComponentBindings, push: pushClientTimelineEvent, version: handleVersionRequest, branch: handleBranchRequest, branchHead: getTimelineBranch, branches: getTimelineBranches, branchMerge: previewBranchMerge, branchCheckout: checkoutTimelineBranch };

export function createTimelineHandlers(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	const authorize = async (request: Request) => {
		const user = await deps.user(request);
		if (!user) return response({ ok: false, error: 'Unauthorized' }, 401);
		const url = new URL(request.url);
		if (url.searchParams.get('ownerId') !== user.id) return response({ ok: false, error: 'Account changed; reconnect Timeline' }, 409);
		const scope = deps.discovery(user.id);
		const expectedPlane = url.searchParams.get('dataPlane');
		if (expectedPlane !== null && expectedPlane !== scope.dataPlane) return response({ ok: false, error: 'Data source changed; reconnect Timeline' }, 409);
		const limit = await deps.limit(request, request.method === 'GET' ? 'timeline.read' : 'timeline.write', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) return json({ ok: false, error: 'Timeline is busy; retry shortly' }, { ...rateLimitedResponseInit(limit), headers: { ...privateHeaders, ...Object.fromEntries(new Headers(rateLimitedResponseInit(limit).headers)) } });
		return { user, scope, url };
	};
	const loader = async ({ request }: { request: Request }) => {
		const auth = await authorize(request);
		if (auth instanceof Response) return auth;
		const thingId = auth.url.searchParams.get('thingId');
		if (auth.url.searchParams.has('related') || auth.url.searchParams.has('relatedRevision')) {
			const params = auth.url.searchParams;
			const allowed = ['ownerId', 'dataPlane', 'storage', 'thingId', 'related', 'relatedRevision', 'before', 'after', 'limit'];
			const before = params.has('before') ? Number(params.get('before')) : null;
			const after = params.has('after') ? Number(params.get('after')) : null;
			const limit = params.has('limit') ? Number(params.get('limit')) : TIMELINE_PAGE_SIZE;
			const revision = params.get('relatedRevision');
			if (params.get('related') !== '1' || !timelineRelatedId(thingId) || !params.has('dataPlane') ||
				[...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1) ||
				(revision !== null && !timelineRelatedRevision(revision)) || ((before !== null || after !== null) && !revision) ||
				(before !== null && after !== null) || [before, after].some(value => value !== null && (!Number.isSafeInteger(value) || value < 1 || !Number.isFinite(new Date(value).getTime()))) ||
				!Number.isSafeInteger(limit) || limit < 1 || limit > TIMELINE_PAGE_SIZE)
				return response({ ok: false, error: 'Invalid related history request' }, 400);
			try {
				return response({ ok: true, ...await deps.relatedPage(auth.user.id, { thingId, before, after, limit, related: true, ...(revision ? { relatedRevision: revision } : {}) }) });
			} catch (error) {
				if (error instanceof StorageMutationError) return response({ ok: false, error: error.message, code: error.code }, error.status);
				throw error;
			}
		}
		if (auth.url.searchParams.has('components')) {
			const params = auth.url.searchParams;
			const allowed = ['ownerId', 'dataPlane', 'storage', 'eventId', 'components'];
			const eventId = params.get('eventId') ?? '';
			if (params.get('components') !== '1' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(eventId) || ['ownerId', 'dataPlane', 'eventId', 'components'].some(key => params.getAll(key).length !== 1) || [...params.keys()].some(key => !allowed.includes(key))) return response({ ok: false, error: 'Invalid component history request' }, 400);
			try {
				const result = await deps.componentBindings(auth.user.id, eventId);
				if (!result) return response({ ok: false, error: 'Version not found' }, 404);
				if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) return response({ ok: false, error: 'These recorded components are too large to preview together.' }, 413);
				return response({ ok: true, ...result });
			} catch (error) {
				if (error instanceof StorageMutationError) return response({ ok: false, error: error.message, code: error.code }, error.status);
				throw error;
			}
		}
		if (auth.url.searchParams.has('branchId')) {
			const params = auth.url.searchParams;
			let lookup;
			try {
				const allowed = ['ownerId', 'dataPlane', 'storage', 'branchId', 'thingId'];
				if (['ownerId', 'dataPlane', 'branchId', 'thingId'].some(key => params.getAll(key).length !== 1) || [...params.keys()].some(key => !allowed.includes(key))) throw new Error('Ambiguous branch lookup');
				lookup = parseTimelineBranchLookup({ branchId: params.get('branchId'), thingId });
			} catch { return response({ ok: false, error: 'Invalid Timeline branch lookup' }, 400); }
			const entry = await deps.branchHead(auth.user.id, lookup.branchId, lookup.thingId);
			return entry ? response({ ok: true, ...entry }) : response({ ok: false, error: 'Branch not found' }, 404);
		}
		if (auth.url.searchParams.has('eventId')) {
			const eventId = auth.url.searchParams.get('eventId')!;
			const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
			if (!auth.url.searchParams.has('dataPlane') || !validId(eventId) || (thingId !== null && !validId(thingId)) || ['branches', 'history', 'before', 'after', 'limit'].some(key => auth.url.searchParams.has(key))) return response({ ok: false, error: 'Invalid Timeline version request' }, 400);
			const entry = await deps.entry(auth.user.id, eventId);
			return entry && (!thingId || entry.event.thingId === thingId) ? response({ ok: true, entry }) : response({ ok: false, error: 'Version not found' }, 404);
		}
		if (auth.url.searchParams.get('branches') === '1') {
			const before = auth.url.searchParams.has('before') ? Number(auth.url.searchParams.get('before')) : null;
			const limit = auth.url.searchParams.has('limit') ? Number(auth.url.searchParams.get('limit')) : 40;
			if (!auth.url.searchParams.has('dataPlane') || !thingId || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(thingId) || auth.url.searchParams.has('after') || (before !== null && (!Number.isSafeInteger(before) || before < 1 || !Number.isFinite(new Date(before).getTime()))) || !Number.isInteger(limit) || limit < 1 || limit > 40) return response({ ok: false, error: 'Invalid branch page request' }, 400);
			return response({ ok: true, ...await deps.branches(auth.user.id, thingId, before, limit) });
		}
		if (!thingId && auth.url.searchParams.get('history') !== '1') return response({ ok: true, ...auth.scope });
		if (!auth.url.searchParams.has('dataPlane')) return response({ ok: false, error: 'Timeline data source is required' }, 400);
		const number = (key: string) => auth.url.searchParams.has(key) ? Number(auth.url.searchParams.get(key)) : null;
		const before = number('before'); const after = number('after'); const limit = number('limit') ?? TIMELINE_PAGE_SIZE;
		if ((thingId?.length ?? 0) > 200 || before !== null && after !== null || [before, after].some(value => value !== null && (!Number.isSafeInteger(value) || value < 1 || !Number.isFinite(new Date(value).getTime()))) || !Number.isInteger(limit) || limit < 1 || limit > TIMELINE_PAGE_SIZE)
			return response({ ok: false, error: 'Invalid Timeline page request' }, 400);
		return response({ ok: true, ...await deps.page(auth.user.id, { thingId, before, after, limit }) });
	};
	const action = async ({ request }: { request: Request }) => {
		if (request.method !== 'POST') return response({ ok: false, error: 'Method not allowed' }, 405);
		const auth = await authorize(request);
		if (auth instanceof Response) return auth;
		if (!auth.url.searchParams.has('dataPlane')) return response({ ok: false, error: 'Timeline data source is required' }, 400);
		let recovery; let event; let version; let branch; let branchMerge; let branchCheckout;
		try {
			const input = await readJsonBody(request, TIMELINE_EVENT_MAX_BYTES);
			if (input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'command')) {
				if ((input as any).command === 'recover-action-outcome') recovery = parseActionOutcomeRecoveryCommand(input);
				else if ((input as any).command === 'checkout-branch') branchCheckout = parseBranchCheckoutRequest(input);
				else if ((input as any).command === 'preview-branch-merge') branchMerge = parseBranchMergeRequest(input);
				else if (['create-branch', 'advance-branch'].includes((input as any).command)) branch = parseTimelineBranchCommand(input);
				else version = parseVersionRequest(input);
			}
			else event = validateClientTimelineEvent(auth.user.id, input);
		}
		catch (error) {
			if (error instanceof Response) return response({ ok: false, error: 'Timeline event is too large' }, error.status);
			return response({ ok: false, error: 'Invalid Timeline event, version or branch request' }, 400);
		}
		try {
			if (recovery) return response({ ok: true, entry: await deps.recoverOutcome(auth.user.id, recovery) });
			if (branchCheckout) {
				const result = await deps.branchCheckout(auth.user.id, branchCheckout);
				if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) return response({ ok: false, error: 'This branch is too large to edit in one request.' }, 413);
				return response(result);
			}
			if (branchMerge) {
				const result = await deps.branchMerge(auth.user.id, branchMerge);
				if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) return response({ ok: false, error: 'This branch comparison is too large to display in one request.' }, 413);
				return response(result);
			}
			if (branch) return response(await deps.branch(auth.user.id, branch));
			if (!version) return response({ ok: true, entry: await deps.push(auth.user.id, event!) });
			const result = await deps.version(auth.user.id, version);
			if (version.command === 'preview-version' && new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) return response({ ok: false, error: 'This comparison is too large to display in one request. Open the version data separately.' }, 413);
			return response(result);
		}
		catch (error) {
			if (error instanceof StorageMutationError) return response({ ok: false, error: error.message, code: error.code }, error.status);
			throw error;
		}
	};
	// storage selects the location explicitly; dataPlane remains an independent
	// expected-identity fence. A stale selected-plane request never opts into home.
	const scoped = (handler: typeof loader) => (args: { request: Request }) => {
		const choices = new URL(args.request.url).searchParams.getAll('storage');
		if (choices.length > 1 || choices.some(value => !['home', 'selected'].includes(value))) return Promise.resolve(response({ ok: false, error: 'Invalid Timeline storage' }, 400));
		return choices[0] === 'home' ? runWithHomeMongoEndpoint(() => handler(args)) : handler(args);
	};
	return { loader: scoped(loader), action: scoped(action) };
}

export const { loader, action } = createTimelineHandlers();
