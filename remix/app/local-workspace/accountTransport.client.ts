import { accountRemoteWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { WorkspaceError, type WorkspaceLease, type WorkspaceScope } from './storage';
import type { AccountSyncTransport, AccountThing } from './accountSync';

export const readBoundedJson = async (response: Response) => {
	const reader = response.body?.getReader();
	if (!reader) throw new WorkspaceError('SYNC_RESPONSE', 'Missing account response', 503);
	const chunks: Uint8Array[] = []; let size = 0;
	try {
		for (;;) {
			const part = await reader.read(); if (part.done) break;
			size += part.value.length;
			if (size > 8 * 1024 * 1024) throw new WorkspaceError('SYNC_RESPONSE', 'Account response exceeds the local cache limit', 503);
			chunks.push(part.value);
		}
		const bytes = new Uint8Array(size); let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
		return JSON.parse(new TextDecoder().decode(bytes));
	} finally { await reader.cancel().catch(() => {}); }
};
export function accountThingTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): AccountSyncTransport & {
	read(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
	resolve(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
} {
	const request = async (method: string, args: Record<string, unknown>, signal?: AbortSignal, endpoint: 'things' | 'webpages/resolve' = 'things') => {
		lease.assertCurrent();
		const remoteLease = accountRemoteWorkspaceLease(scope); remoteLease.assertCurrent();
		const retired = new AbortController();
		const unsubscribe = remoteLease.onInvalidate(() => retired.abort());
		try {
		if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed', 409);
		await requireThingtimeCapability(endpoint === 'things' ? 'api.things' : 'api.webpages-resolve', endpoint === 'things' ? '1.33.0' : '1.3.0');
		if (method === 'PATCH') await requireThingtimeCapability('api.things-update', '1.10.0');
		await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
		lease.assertCurrent(); remoteLease.assertCurrent(); retired.signal.throwIfAborted(); signal?.throwIfAborted();
		const query = method === 'GET' ? `?${new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]))}` : '';
		const response = await fetch(`/api/v1/${endpoint}${query}`, { method, credentials: 'same-origin', redirect: 'error',
			signal: AbortSignal.any([retired.signal, AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
			headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane },
			...(method === 'GET' ? {} : { body: JSON.stringify(args) }) });
		// An edge/WAF refusal answers a 4xx with an HTML body. Letting that parse
		// error escape would drop the HTTP status, and the sync queue classifies
		// a status-less failure as retryable, so a refused or conflicting write
		// would retry forever instead of surfacing as error/conflict for review.
		let result: any = null;
		try { result = await readBoundedJson(response); } catch (error) { if (response.ok) throw error; }
		lease.assertCurrent(); remoteLease.assertCurrent(); retired.signal.throwIfAborted();
		if (response.status === 401 || (response.status === 409 && (['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(result?.code) || result?.error === 'The active account changed. Run the action again.'))) {
			rootIdentity.changed();
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Account session changed. Local edits remain in their original workspace.', 409);
		}
		if (!response.ok || result?.ok !== true) throw new WorkspaceError('SYNC_REFUSED', 'The account request could not be completed', response.status);
		return result;
		} finally { unsubscribe(); }
	};
	return {
		read: (args, signal) => request('GET', args, signal),
		resolve: (args, signal) => request('GET', args, signal, 'webpages/resolve'),
		get: async (id, signal) => (await request('GET', { id }, signal)).thing as AccountThing,
		write: async (operation, signal) => (await request(operation.method === 'create' ? 'POST' : 'PATCH', operation.body, signal)).thing as AccountThing
	};
}
