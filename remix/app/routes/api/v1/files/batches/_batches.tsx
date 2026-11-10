import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { admitBatchControl } from '~/api/utils/files/batchAdmission';
import { fileBatches } from '~/api/utils/files/batches';
import { UPLOAD_BATCH_METADATA_BYTES } from '~/fileSync/uploadBatch';

export function createBatchHandler(deps = { user: getCurrentUser, service: fileBatches }) {
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
			if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin batch changes are not allowed' }, { status: 403 });
			if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
				return json({ ok: false, error: 'Use application/json' }, { status: 415 });
			const user = await deps.user(request);
			if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'A full user session is required' }, { status: 401 });
			const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
			try {
				return await admitBatchControl(user.id, signal, Date.now() + 30_000, async () => {
					// Cancel the body reader too: a slow sender cannot hold a metadata slot indefinitely.
					const reader = request.body?.getReader();
					let abort: (() => void) | undefined;
					const body = reader
						? new ReadableStream({
								start(controller) {
									abort = () => {
										void reader.cancel().catch(() => {});
										controller.error(Error('Batch deadline or cancellation'));
									};
									signal.addEventListener('abort', abort, { once: true });
								},
								async pull(controller) {
									try {
										signal.throwIfAborted();
										const frame = await reader.read();
										if (frame.done) {
											signal.removeEventListener('abort', abort!);
											controller.close();
										} else controller.enqueue(frame.value);
									} catch (error) {
										signal.removeEventListener('abort', abort!);
										controller.error(error);
									}
								},
								cancel() {
									signal.removeEventListener('abort', abort!);
									return reader.cancel();
								}
						  })
						: null;
					const bounded = new Request(request.url, {
						method: 'POST',
						headers: request.headers,
						body,
						signal,
						...(body ? { duplex: 'half' } : {})
					} as RequestInit);
					const raw = await readJsonBody(bounded, UPLOAD_BATCH_METADATA_BYTES);
					const result = await deps.service(user.id, new URL(request.url).origin, raw, signal);
					return json(result, { status: result.ok === false ? result.status : 200 });
				});
			} catch (error) {
				if (error instanceof Response) throw error;
				return json({ ok: false, error: 'Batch control capacity, cancellation or deadline; retry original operations' }, { status: 503 });
			}
		});
}
export const action = createBatchHandler();
