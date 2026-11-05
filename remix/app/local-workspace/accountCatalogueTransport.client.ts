import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { rootIdentity } from '../utils/rootIdentity';
import { CATALOGUE_FRAME_BYTES, readCatalogueStream, type CatalogueSink, type CatalogueCompletion, type CatalogueIdentity } from '../catalogue/catalogueStream';
import { accountRemoteWorkspaceLease } from './runtime.client';
import { WorkspaceError, type WorkspaceScope, type WorkspaceLease } from './storage';


// Error diagnostics are never catalogue data. Bound both their bytes and waits;
// a hostile cancel promise must not retain the task after cancellation.
async function refusalCode(response: Response, signal: AbortSignal): Promise<unknown> {
 const reader = response.body?.getReader();
 if (!reader) return undefined;
 let bytes = 0, text = ''; const decoder = new TextDecoder();
 try {
  for (;;) {
   signal.throwIfAborted();
   let abort: (() => void) | undefined;
   const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
   });
   let part: ReadableStreamReadResult<Uint8Array>;
   try { part = await Promise.race([reader.read(), interrupted]); }
   finally { if (abort) signal.removeEventListener('abort', abort); }
   if (part.done) break;
   bytes += part.value.byteLength;
   if (bytes > CATALOGUE_FRAME_BYTES) return undefined;
   text += decoder.decode(part.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode())?.code;
 } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Reads only an explicitly admitted account catalogue. Entries remain provisional
 * until the reader validates the complete receipt and clean EOF. */
export function accountCatalogueTransport(domain: CatalogueIdentity['domain'], scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease) {
	return async (sink: CatalogueSink, signal: AbortSignal): Promise<CatalogueCompletion> => {
		lease.assertCurrent();
		const remote = accountRemoteWorkspaceLease(scope);
		remote.assertCurrent();
		const controller = new AbortController();
		const off = remote.onInvalidate(() => controller.abort()), offLocal = lease.onInvalidate(() => controller.abort());
		const combined = AbortSignal.any([signal, controller.signal]);
		let headerTimer: ReturnType<typeof setTimeout> | undefined;
		const check = () => { lease.assertCurrent(); remote.assertCurrent(); combined.throwIfAborted(); };
		const changed = (): never => {
			rootIdentity.changed();
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Account confirmation changed. Device profiles remain in their original workspace.', 409);
		};
		try {
			if (window.location.origin !== scope.origin) throw new WorkspaceError('WORKSPACE_CHANGED', 'Account origin changed.', 409);
			if (scope.delegatedBy !== undefined) await requireThingtimeCapability('api.auth-characters', '1.0.0');
			await requireThingtimeCapability(`api.${domain}-sync`, domain === 'themes' ? '1.7.0' : '1.5.0');
			await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
			check();
			// Only response headers have this budget. The stream uses bounded inactivity,
			// including staging backpressure, rather than a whole-catalogue deadline.
			headerTimer = setTimeout(() => controller.abort(new DOMException('Catalogue headers stalled', 'TimeoutError')), 20_000);
			const response = await fetch(`/api/v1/${domain}/sync`, {
				method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: combined,
				headers: { 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: scope.ownerId,
					[EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane,
					...(scope.delegatedBy !== undefined ? { 'X-Thingtime-Character': scope.ownerId } : {}) },
				body: JSON.stringify({ operation: 'catalogue', expectedOwnerId: scope.ownerId })
			});
			clearTimeout(headerTimer); check();
			if (!response.ok) {
				headerTimer = setTimeout(() => controller.abort(new DOMException('Catalogue refusal stalled', 'TimeoutError')), 20_000);
				let code: unknown;
				try { code = await refusalCode(response, combined); } catch { /* Never expose private provider diagnostics. */ }
				check();
				if (response.status === 401 || (response.status === 409 && ['ACTOR_CHANGED', 'DATA_PLANE_CHANGED'].includes(String(code)))) changed();
				throw Object.assign(new WorkspaceError('CATALOGUE_REFUSED', 'The account catalogue request could not be completed.', response.status),
					{ retryAfterMs: Math.min(86_400_000, Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000) });
			}
			if (!response.body || !/^application\/x-ndjson(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? ''))
				throw new WorkspaceError('INVALID_CATALOGUE_RESPONSE', 'Account catalogue framing is missing.', 502);
			// Observe the bounded start frame for the existing root-identity invalidation
			// behavior. The shared reader owns all framing, identity and digest validation.
			let first = true; const prefix: number[] = [];
			const observed = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
				transform(bytes, output) {
					check();
					if (first) for (const byte of bytes) {
						if (byte === 10) {
							first = false;
							const start = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(prefix)));
							if (start?.type === 'start' && (start.origin !== scope.origin || start.ownerId !== scope.ownerId || start.dataPlane !== scope.dataPlane)) changed();
							prefix.length = 0; break;
						}
						prefix.push(byte);
						if (prefix.length > CATALOGUE_FRAME_BYTES) throw new WorkspaceError('INVALID_CATALOGUE_RESPONSE', 'Account catalogue framing is invalid.', 502);
					}
					output.enqueue(bytes);
				}
			}), { signal: combined });
			return await readCatalogueStream(observed, { domain, origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home' }, sink, { signal: combined, check });
		} finally {
			clearTimeout(headerTimer); off(); offLocal(); controller.abort();
		}
	};
}
