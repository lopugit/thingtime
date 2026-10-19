import { StorageMutationError } from '../storage/storageCore';
import { CLOUD_INVENTORY_TIMEOUT_MS } from '../../../fileSync/cloudInventoryPages';
import { streamCloudInventoryPages } from './inventoryPages';

/** A successful HTTP response starts an observation, not a completed scan.
 * Only a terminal page followed by clean EOF proves transport completion. */
export function cloudInventoryResponse(ownerId: string, rootId: unknown, request: Request, service = streamCloudInventoryPages) {
	const stream = new TransformStream<Uint8Array, Uint8Array>(), writer = stream.writable.getWriter();
	const encoder = new TextEncoder(), controller = new AbortController();
	const abort = () => controller.abort(request.signal.reason);
	const abortWriter = () => { void writer.abort(controller.signal.reason).catch(() => {}); };
	// Reader cancellation must cancel an in-flight database query too.
	void writer.closed.catch(error => controller.abort(error));
	const timer = setTimeout(() => controller.abort(new DOMException('Cloud inventory timed out', 'TimeoutError')), CLOUD_INVENTORY_TIMEOUT_MS);
	controller.signal.addEventListener('abort', abortWriter, { once: true });
	if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
	void service(ownerId, rootId, page => writer.write(encoder.encode(JSON.stringify(page) + '\n')), controller.signal)
		.then(() => writer.close(), async error => {
			try {
				if (!controller.signal.aborted) await writer.write(encoder.encode(JSON.stringify({ ok: false,
					status: error instanceof StorageMutationError ? error.status : 503,
					error: 'Cloud inventory is incomplete; keep the last complete scan.' }) + '\n'));
				await writer.close();
			} catch { /* Reader cancellation already propagates through write(). */ }
		}).catch(() => {}).finally(() => {
			clearTimeout(timer); request.signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', abortWriter);
			writer.releaseLock();
		});
	return new Response(stream.readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
}
