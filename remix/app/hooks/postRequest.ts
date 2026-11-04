import { createApiFailure } from './apiFailure';

// A mobile transport may never settle even after cancellation. Release the
// composer after a deadline, but never interpret that as a rejected write.
export const withPostRequestDeadline = async <T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs = 30_000, parentSignal?: AbortSignal): Promise<T> => {
	parentSignal?.throwIfAborted();
	const controller = new AbortController();
	const abort = () => controller.abort(parentSignal?.reason);
	if (parentSignal?.aborted) abort();
	else parentSignal?.addEventListener('abort', abort, { once: true });
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = createApiFailure({ method: 'POST', action: 'confirm your post', outcome: 'unknown' });
			reject(error);
			controller.abort();
		}, timeoutMs);
	});
	try { return await Promise.race([request(controller.signal), deadline]); }
	finally { clearTimeout(timer!); parentSignal?.removeEventListener('abort', abort); }
};
