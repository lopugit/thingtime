import { createApiFailure, readApiResponsePayload } from '~/hooks/apiFailure';

/** Preserve HTTP status so polling can distinguish revocation from a network outage. */
export const getMessengerJson = async (url: string) => {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: 'application/json' }
  });
  const payload = await readApiResponsePayload(response, { action: 'load your conversations', method: 'GET' });
  if (!response.ok || payload?.ok === false) {
    throw createApiFailure({ payload, status: response.status, retryAfter: response.headers.get('Retry-After'), action: 'load your conversations', method: 'GET' });
  }
  return payload;
};
