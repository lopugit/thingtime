import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
// Deliberately bypasses useApi's diagnostics/history and origin fallback. The
// current first-party session is the only credential; payloads stay in memory.
async function requestOnce(ownerId: string, body?: Record<string, unknown>, signal?: AbortSignal, cursor?: string, query?: string, previews = false, selectedOrigin?: string) {
  await requireThingtimeCapability('api.passwords', selectedOrigin ? '1.7.0' : previews ? '1.8.0' : '1.3.0');
  signal?.throwIfAborted();
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (query) params.set('q', query);
  if(previews)params.set('previews','1');
  const response = await fetch(`/api/v1/passwords${params.size ? `?${params}` : ''}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json', ...(selectedOrigin ? {
      'X-Thingtime-Expected-Api-Origin': selectedOrigin,
      'X-Thingtime-Expected-Actor': ownerId,
      'X-Thingtime-Expected-Data-Plane': 'home',
    } : {}) }, body: JSON.stringify({ ...body, expectedOwnerId: ownerId }) } : {})
  });
  if (selectedOrigin && selectedOrigin !== window.location.origin && response.headers.get('x-thingtime-api-fallback') !== selectedOrigin) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The selected Thingtime API changed.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || result.ownerId !== ownerId) {
    const error = new Error(result?.error || 'Password manager is unavailable.');
    Object.assign(error, { status: response.status, retryAfter: Math.min(120, Math.max(1, Number(response.headers.get('Retry-After')) || 60)) }); throw error;
  }
  return result;
}

export function nativePasswordVerificationRequest(ownerId: string, selectedOrigin: string, body: Record<string, unknown>, signal: AbortSignal) {
  if (body.operation !== 'catalog' && body.operation !== 'verification-status' && body.operation !== 'verify-passkey') throw new Error('Unsupported native approval operation.');
  return requestOnce(ownerId, body, signal, undefined, undefined, false, selectedOrigin);
}

// Backpressure applies to file and export requests too, not only entry imports.
export async function passwordRequest(ownerId: string, body?: Record<string, unknown>, signal?: AbortSignal, cursor?: string, query?: string, previews = false) {
  for (let attempt = 0; ; attempt++) {
    try { return await requestOnce(ownerId, body, signal, cursor, query, previews); }
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

/** Additive device-confirmation protocol; never fall back to a legacy origin. */
export async function passwordVerificationRequest(ownerId: string, body: Record<string, unknown>, signal: AbortSignal) {
  await requireThingtimeCapability('api.passwords', '1.5.0');
  signal.throwIfAborted();
  return passwordRequest(ownerId, body, signal);
}

/** Approval has a live website deadline. Return a rate limit to the chooser
 * immediately; bulk transfers still use backpressure. */
export async function passwordApprovalRequest(ownerId: string, body: Record<string, unknown>, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    await requireThingtimeCapability('api.passwords', '1.5.0');
    const result = await requestOnce(ownerId, body, signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}
