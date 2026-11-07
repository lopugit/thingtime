import { getCurrentUser } from '../auth/getCurrentUser';
import { EXPECTED_ACTOR_HEADER } from '../auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../../../utils/dataPlane';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { BACKUP_CHUNK_BYTES } from '../../../backups/manifest';
import type { CloudBackupRuntime } from './cloudFolderBackup';
import type { BackupEngineContext } from './backupJobs';
import type { TimelineScope } from '../../../timeline/contract';
import { loader as me } from '../../../routes/api/v1/auth/me/_me';
import { loader as contentGet, action as contentPost } from '../../../routes/api/v1/attachments/content/_content';
import { action as uploads } from '../../../routes/api/v1/attachments/uploads/_uploads';
import { action as parts } from '../../../routes/api/v1/attachments/uploads/parts/_parts';
import { action as complete } from '../../../routes/api/v1/attachments/uploads/complete/_complete';
import { loader as filesGet, action as filesPost } from '../../../routes/api/v1/files/_files';
import { handleLocalAttachmentStorageRequest } from '../attachments/localAttachmentStorage';

export type BackupEngineManifest = { schemaVersion: number; origin: string; features: Record<string, { version: string }> };
type Handler = (args: { request: Request }) => Promise<Response>;

/** Reject promptly, consume late rejections and discard late response bodies.
 * Rejection is not a rollback of an operation already accepted by its service. */
export function awaitBackupAbort<T>(pending: Promise<T>, signal: AbortSignal, discardLate?: (value: T) => void): Promise<T> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const abort = () => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Backup request cancelled', 'AbortError')); };
		if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
		pending.then(value => {
			if (settled) { try { discardLate?.(value); } catch { /* late cleanup cannot revive the request */ } return; }
			settled = true; signal.removeEventListener('abort', abort); resolve(value);
		}, error => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); reject(error); });
	});
}

export async function runBoundedBackupRequest(context: Pick<BackupEngineContext, 'request' | 'guard' | 'withRequest'>,
	input: Request, handler: Handler, deadlineMs = 30_000) {
	if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000) return fail();
	const deadline = new AbortController(), until = performance.now() + deadlineMs;
	const expire = () => deadline.abort(new DOMException('Backup API unit timed out', 'TimeoutError'));
	const timer = setTimeout(expire, deadlineMs), signal = AbortSignal.any([input.signal, context.request.signal, deadline.signal]);
	const request = new Request(input, { signal });
	const check = () => { if (performance.now() >= until && !deadline.signal.aborted) expire(); signal.throwIfAborted(); };
	try {
		check(); await awaitBackupAbort(context.guard(), signal);
		return await context.withRequest(request, async () => {
			check();
			const response = await awaitBackupAbort(Promise.resolve().then(() => { check(); return handler({ request }); }), signal,
				late => { if (late.body) void late.body.cancel(signal.reason).catch(() => {}); });
			let buffer = Buffer.alloc(64 * 1024), size = 0;
			if (response.body) {
				const reader = response.body.getReader();
				try { for (;;) {
					check(); const next = await awaitBackupAbort(reader.read(), signal); if (next.done) break;
					const nextSize = size + next.value.length; if (nextSize > 2 * BACKUP_CHUNK_BYTES) return fail();
					if (nextSize > buffer.length) { const grown = Buffer.alloc(Math.min(2 * BACKUP_CHUNK_BYTES, Math.max(nextSize, 2 * buffer.length))); buffer.copy(grown, 0, 0, size); buffer = grown; }
					buffer.set(next.value, size); size = nextSize;
				} } finally {
					// A provider's cancel() may itself stall. Initiate cancellation,
					// release the binding promptly, and consume its late rejection.
					void reader.cancel(signal.reason).catch(() => {});
					try { reader.releaseLock(); } catch { /* pending read is already observed */ }
				}
			}
			check(); await awaitBackupAbort(context.guard(), signal); check();
			return new Response([204, 205, 304].includes(response.status) ? null : buffer.subarray(0, size), { status: response.status, statusText: response.statusText, headers: response.headers });
		});
	} finally { clearTimeout(timer); }
}
// A fixed internal transport reuses the actual API handlers and their upload,
// quota, retention, version and publication rules. No caller-selected dispatch
// target, session token or unrestricted API execution is admitted by a job.
const handlers: Record<string, Record<string, Handler>> = {
	'/api/v1/auth/me': { GET: me }, '/api/v1/attachments/content': { GET: contentGet, POST: contentPost },
	'/api/v1/attachments/uploads': { POST: uploads }, '/api/v1/attachments/uploads/parts': { POST: parts },
	'/api/v1/attachments/uploads/complete': { POST: complete }, '/api/v1/files': { GET: filesGet, POST: filesPost },
	'/api/v1/attachments/local-object': { GET: ({ request }) => handleLocalAttachmentStorageRequest(request), PUT: ({ request }) => handleLocalAttachmentStorageRequest(request) }
};
const fail = (): never => { throw Error('The bounded backup API transport is unavailable or changed'); };

export async function createBackupEngineTransport(context: BackupEngineContext,
	manifestReader: (origin: string) => Promise<BackupEngineManifest> = async origin => thingtimeCapabilityManifest(origin)
) {
	const openingSignal = AbortSignal.any([context.request.signal, AbortSignal.timeout(30_000)]);
	await awaitBackupAbort(context.guard(), openingSignal);
	const user = await awaitBackupAbort(getCurrentUser(context.request), openingSignal);
	if (!user || user.isCharacter || user.temporary || user.accountKind !== 'user') return fail();
	const scope: TimelineScope = Object.freeze({ apiOrigin: new URL(context.request.url).origin, ownerId: user.id, dataPlane: 'home' });
	let manifest: Promise<BackupEngineManifest> | null = null;
	const requireCapability = async (feature: string, minimum: string) => {
		const signal = AbortSignal.any([context.request.signal, AbortSignal.timeout(30_000)]);
		await awaitBackupAbort(context.guard(), signal);
		const current = await awaitBackupAbort(manifest ??= manifestReader(scope.apiOrigin), signal);
		if (current.schemaVersion !== 1 || current.origin !== scope.apiOrigin || !capabilitySatisfies(current.features?.[feature]?.version ?? '', minimum)) return fail();
		await awaitBackupAbort(context.guard(), signal);
	};
	const transport: typeof fetch = async (input, init) => {
		const supplied = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), scope.apiOrigin), init);
		const prepared = new Request(supplied, { signal: AbortSignal.any([supplied.signal, context.request.signal, AbortSignal.timeout(30_000)]) });
		await awaitBackupAbort(context.guard(), prepared.signal); prepared.signal.throwIfAborted();
		const url = new URL(prepared.url), method = prepared.method.toUpperCase(), headers = new Headers(prepared.headers);
		if (url.origin !== scope.apiOrigin) {
			// Only normal presigned AWS object requests returned by the canonical
			// upload API reach the provider. Account credentials never follow them.
			if (url.protocol !== 'https:' || url.username || url.password || !/^(?:[a-z0-9-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname) ||
				!url.searchParams.has('X-Amz-Signature') || url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
				!['PUT', 'GET'].includes(method) || headers.has('authorization') || headers.has('cookie')) return fail();
			const result = await awaitBackupAbort(fetch(prepared, { redirect: 'error', credentials: 'omit' }), prepared.signal, late => { void late.body?.cancel().catch(() => {}); });
			try { await awaitBackupAbort(context.guard(), prepared.signal); prepared.signal.throwIfAborted(); return result; }
			catch (error) { void result.body?.cancel().catch(() => {}); throw error; }
		}
		const handler = handlers[url.pathname]?.[method];
		if (!handler || headers.has('authorization') || headers.has('cookie')) return fail();
		if ((headers.has(EXPECTED_ACTOR_HEADER) && headers.get(EXPECTED_ACTOR_HEADER) !== scope.ownerId) ||
			(headers.has(EXPECTED_DATA_PLANE_HEADER) && headers.get(EXPECTED_DATA_PLANE_HEADER) !== 'home')) return fail();
		headers.set('Origin', scope.apiOrigin); headers.set(EXPECTED_ACTOR_HEADER, scope.ownerId); headers.set(EXPECTED_DATA_PLANE_HEADER, 'home');
		const request = new Request(prepared, { headers });
		return runBoundedBackupRequest(context, request, handler);
	};
	const runtime: CloudBackupRuntime = { scope, currentScope: () => scope, fetch: transport, requireCapability };
	return { scope, runtime, fetch: transport, requireCapability, user };
}
