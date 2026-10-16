import type { AccountFileRetentionTransport, AccountFileTransport } from './accountFiles';
import type { PublicAttachment } from '../components/Attachments/attachmentTypes';
import { interactionState, type InteractionWrite } from '../utils/interactionState';
import type { InteractionTransport } from './accountInteractions';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { WorkspaceError, type WorkspaceLease, type WorkspaceScope } from './storage';
import type { AccountSyncTransport, AccountThing } from './accountSync';

export const readBoundedBytes = async (response: Response, expectedSize: number) => {
	if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 16 * 1024 * 1024) throw new WorkspaceError('INVALID_FILE_BYTES', 'Invalid file size.', 502);
	const reader = response.body?.getReader();
	if (!reader) throw new WorkspaceError('INVALID_FILE_BYTES', 'File bytes are missing.', 502);
	const chunks: Uint8Array[] = []; let size = 0;
	try {
		for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > expectedSize) throw new WorkspaceError('INVALID_FILE_BYTES', 'File exceeds its verified size.', 502); chunks.push(part.value); }
		if (size !== expectedSize) throw new WorkspaceError('INVALID_FILE_BYTES', 'File bytes are incomplete.', 502);
		const bytes = new Uint8Array(size); let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
	} finally { await reader.cancel().catch(() => {}); }
};
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
/** Attachment metadata is on the canonical post companion, not PublicThing.
 * Keep the two projections paired by ID; never infer binding from the request. */
const withPostAttachments = (result: any) => result?.thing && result.post?.id === result.thing.id && Array.isArray(result.post.attachments)
 ? { ...result, thing: { ...result.thing, attachments: result.post.attachments } } : result;

export function accountThingTransport(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): AccountSyncTransport & {
	interactions: InteractionTransport;
	files: AccountFileTransport & AccountFileRetentionTransport & {
		get(id: string, signal: AbortSignal): Promise<unknown>;
		annotate(input: { id: string; expectedUpdatedAt: string; filenamePreview?: string | null; title?: string | null; description?: string | null }, signal?: AbortSignal): Promise<{ attachment: PublicAttachment; updatedAt: string }>;
		move(id: string, folderId: string | null, expectedUpdatedAt: string, signal?: AbortSignal): Promise<void>;
	};
	browse(kind: 'schema' | 'component', args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
	read(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
	resolve(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
	export(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
	fork(args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
} {
	const request = async (method: string, args: Record<string, unknown>, signal?: AbortSignal, endpoint: 'things' | 'things/comment' | 'webpages/resolve' | 'things/export' | 'things/fork' | 'components/browse' | 'schemas/browse' | 'things/interactions' | 'attachments/uploads' | 'attachments/uploads/parts' | 'attachments/uploads/complete' | 'attachments/annotate' | 'attachments/uploads/abort' | 'attachments/delete' | 'attachments/content' | 'things/bulk' = 'things', binary?: { cacheKey: string; size: number }) => {
		lease.assertCurrent();
		const remoteLease = accountRemoteWorkspaceLease(scope); remoteLease.assertCurrent();
		const retired = new AbortController();
		const unsubscribe = remoteLease.onInvalidate(() => retired.abort());
		try {
		if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed', 409);
		const endpointCapability = ({ 'things/comment': ['api.things-comment', '1.8.0'], 'attachments/content': ['api.attachment-content', '1.14.0'], 'attachments/delete': ['api.attachment-delete', '1.5.0'], 'attachments/uploads/abort': ['api.attachment-upload-abort', '1.2.0'], 'attachments/uploads': ['api.attachment-uploads', '1.5.0'], 'attachments/uploads/parts': ['api.attachment-upload-parts', '1.1.0'], 'attachments/uploads/complete': ['api.attachment-upload-complete', '1.4.0'], 'attachments/annotate': ['api.attachment-annotate', '1.2.0'], 'things/bulk': ['api.things-bulk', '1.6.0'] } as Record<string, string[]>)[endpoint];
		const capability = endpointCapability || (endpoint === 'things/interactions' ? ['api.things-interactions', '1.0.0'] : endpoint === 'components/browse' ? ['api.components-browse', '1.0.0'] : endpoint === 'schemas/browse' ? ['api.schemas-browse', '1.0.0'] : endpoint === 'things/fork' ? ['api.things-fork', '1.6.0'] : endpoint === 'things/export' ? ['api.things-export', '1.15.0'] : endpoint === 'things' ? ['api.things', '1.33.0'] : ['api.webpages-resolve', '1.3.0']);
		await requireThingtimeCapability(capability[0], capability[1]);
		if (endpoint === 'things/export' && args.includeFiles !== false) await requireThingtimeCapability('api.attachment-content', '1.11.0');
		if (method === 'PATCH') await requireThingtimeCapability('api.things-update', args.attachmentIds !== undefined ? '1.11.0' : '1.10.0');
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
		try {
			if (response.ok && binary) {
				if (response.headers.get('ETag') !== `"${binary.cacheKey}:v1"` || Number(response.headers.get('Content-Length')) !== binary.size)
					throw new WorkspaceError('FILE_CHANGED', 'The file version changed before its bytes arrived.', 409);
				result = { ok: true, bytes: await readBoundedBytes(response, binary.size) };
			} else result = await readBoundedJson(response);
		} catch (error) { if (response.ok) { await response.body?.cancel().catch(() => {}); throw error; } }
		lease.assertCurrent(); remoteLease.assertCurrent(); retired.signal.throwIfAborted();
		if (response.status === 401 || (response.status === 409 && (['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(result?.code) || result?.error === 'The active account changed. Run the action again.'))) {
			rootIdentity.changed();
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Account session changed. Local edits remain in their original workspace.', 409);
		}
		if (!response.ok || result?.ok !== true) {
			const error = new WorkspaceError(endpointCapability && typeof result?.code === 'string' ? result.code : 'SYNC_REFUSED', 'The account request could not be completed', response.status);
			const seconds = Number(response.headers.get('Retry-After'));
			throw Object.assign(error, { retryable: result?.retryable === true, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(86400,seconds)*1000 : 0 });
		}
		return result;
		} finally { unsubscribe(); }
	};
	return {
		files: {
			retention: (id, signal) => request('GET', { id, cache: 'retain', download: 1 }, signal, 'attachments/content'),
			bytes: async (id, cacheKey, size, signal) => {
				if (!/^[a-f0-9]{64}:original$/.test(cacheKey) || !Number.isSafeInteger(size) || size < 1 || size > 16 * 1024 * 1024) throw new WorkspaceError('INVALID_FILE_BYTES', 'Invalid file descriptor.', 502);
				return (await request('GET', { id, cache: 'bytes', download: 1 }, signal, 'attachments/content', { cacheKey, size })).bytes;
			},
			remove: (input, signal) => request('POST', input, signal, 'attachments/delete'),
			cancel: (requestId, signal) => request('POST', { requestId }, signal, 'attachments/uploads/abort'),
			get: async (id, signal) => (await request('GET', { id }, signal)).thing,
			annotate: (input, signal) => request('POST', input, signal, 'attachments/annotate'),
			move: async (id, folderId, expectedUpdatedAt, signal) => {
				const result = await request('POST', { op: 'move', ids: [id], folderId, expectedUpdatedAt }, signal, 'things/bulk');
				if (!Array.isArray(result.results) || result.results.length !== 1 || result.results[0].id !== id) throw new WorkspaceError('INVALID_MOVE_RECEIPT', 'The account returned an invalid file move result.', 502);
				if (result.results[0].ok !== true) throw new WorkspaceError('FILE_MOVE_REFUSED', 'The account file could not be moved. Refresh and compare your changes.', result.results[0].status === 409 ? 409 : 400);
			},
			start: async (input, signal) => (await request('POST', input, signal, 'attachments/uploads')).upload,
			parts: async (uploadId, parts, signal) => (await request('POST', { uploadId, parts }, signal, 'attachments/uploads/parts')).parts,
			complete: async (uploadId, signal) => (await request('POST', { uploadId }, signal, 'attachments/uploads/complete')).attachment,
			put: async (part, bytes, signal) => {
				lease.assertCurrent(); const remote = accountRemoteWorkspaceLease(scope); remote.assertCurrent();
				const url = new URL(part.url, scope.origin), retired = new AbortController();
				if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new WorkspaceError('INVALID_UPLOAD_URL','The account returned an invalid storage URL.',502);
				const off = remote.onInvalidate(() => retired.abort());
				try {
					const response = await fetch(url, { method: 'PUT', body: Uint8Array.from(bytes), headers: part.headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, retired.signal, AbortSignal.timeout(20_000)]) });
					lease.assertCurrent(); remote.assertCurrent();
					if (!response.ok) throw new WorkspaceError('UPLOAD_PART_FAILED','File bytes could not reach storage.',response.status);
				} finally { off(); }
			}
		},
		interactions: { read: async (ids, signal) => { const result = await request('GET', { id: ids }, signal, 'things/interactions'); if (!Array.isArray(result.states) || result.states.length !== ids.length || new Set(result.states.map((s: any) => s.id)).size !== ids.length || result.states.some((s: any) => !ids.includes(s.id))) throw new WorkspaceError('INVALID_INTERACTIONS', 'Invalid account interaction response', 502); return result.states.map(interactionState); }, write: async (command: InteractionWrite, signal) => interactionState((await request('POST', command, signal, 'things/interactions')).state) },
		browse: (kind, args, signal) => request('GET', args, signal, kind === 'component' ? 'components/browse' : 'schemas/browse'),
		read: async (args, signal) => withPostAttachments(await request('GET', args, signal)),
		resolve: (args, signal) => request('GET', args, signal, 'webpages/resolve'),
		export: (args, signal) => request('POST', args, signal, 'things/export'),
		fork: (args, signal) => request('POST', args, signal, 'things/fork'),
		get: async (id, signal) => withPostAttachments(await request('GET', { id }, signal)).thing as AccountThing,
		remove: async (operation, signal) => { await request('DELETE', operation.body, signal); },
		write: async (operation, signal) => {
			if (operation.method === 'create' && Array.isArray(operation.body.thingtime) && operation.body.thingtime.includes('comment')) {
				const crystal = operation.body.crystal as Record<string, unknown>;
				await request('POST', { ...crystal, id: operation.body.targetId, shareId: operation.body.shareId, tags: operation.body.tags, ...(operation.body.attachmentIds ? { attachmentIds: operation.body.attachmentIds } : {}) }, signal, 'things/comment');
				return withPostAttachments(await request('GET', { id: operation.id }, signal)).thing as AccountThing;
			}
			const result = withPostAttachments(await request(operation.method === 'create' ? 'POST' : 'PATCH', operation.body, signal));
			// Unified creates may return only PublicThing. Read the actual binding
			// before acknowledging a request with files, including image-only posts.
			if (operation.body.attachmentIds !== undefined && !Array.isArray(result.thing?.attachments)) return withPostAttachments(await request('GET', { id: operation.id }, signal)).thing as AccountThing;
			return result.thing as AccountThing;
		}
	};
}
