import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
// Deliberately bypasses useApi's diagnostics/history and origin fallback. The
// current first-party session is the only credential; payloads stay in memory.
async function requestOnce(ownerId: string, body?: Record<string, unknown>, signal?: AbortSignal, cursor?: string, query?: string) {
  await requireThingtimeCapability('api.passwords', query === undefined ? '1.1.0' : '1.2.0');
  signal?.throwIfAborted();
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (query) params.set('q', query);
  const response = await fetch(`/api/v1/passwords${params.size ? `?${params}` : ''}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: ownerId }) } : {})
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || result.ownerId !== ownerId) {
    const error = new Error(result?.error || 'Password manager is unavailable.');
    Object.assign(error, { status: response.status, retryAfter: Math.min(120, Math.max(1, Number(response.headers.get('Retry-After')) || 60)) }); throw error;
  }
  return result;
}

// Backpressure applies to file and export requests too, not only entry imports.
export async function passwordRequest(ownerId: string, body?: Record<string, unknown>, signal?: AbortSignal, cursor?: string, query?: string) {
  for (let attempt = 0; ; attempt++) {
    try { return await requestOnce(ownerId, body, signal, cursor, query); }
    catch (error: any) {
      if (error?.status !== 429 || attempt >= 3 || signal?.aborted) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, error.retryAfter * 1000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
