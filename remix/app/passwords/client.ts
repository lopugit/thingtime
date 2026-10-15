import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
// Deliberately bypasses useApi's diagnostics/history and origin fallback. The
// current first-party session is the only credential; payloads stay in memory.
export async function passwordRequest(ownerId: string, body?: Record<string, unknown>, signal?: AbortSignal, cursor?: string) {
  await requireThingtimeCapability('api.passwords', '1.0.0');
  const response = await fetch(`/api/v1/passwords${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
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
