/** Bound metadata preparation, not the subsequent potentially large file transfer.
 * The race also fences clients that fail to observe cancellation promptly. */
export const withExportDeadline = async <T>(
  prepare: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> => {
  parent?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort(parent?.reason);
      reject(parent?.reason ?? new DOMException('Export cancelled', 'AbortError'));
    };
    parent?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error('Preparing the export timed out. Please try again.');
      // Reject with the recoverable error before aborting the underlying fetch.
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return prepare(controller.signal);
    }), stopped]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
};
