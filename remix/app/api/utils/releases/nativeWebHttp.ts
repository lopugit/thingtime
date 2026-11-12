import { json } from '../../http';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';
import { nativeWebReleaseService, NativeWebReleaseError } from './nativeWeb';
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export function createNativeWebReleaseHandlers(service = nativeWebReleaseService, enforce = enforceRateLimit) {
  const handle = (content: boolean) => async ({ request }: { request: Request }) => {
    if (request.method !== 'GET') return json({ ok: false, code: 'method_not_allowed', error: 'Use GET for native release reads.' }, { status: 405, headers: { ...PRIVATE, Allow: 'GET' } });
    try {
      const limit = await enforce(request, 'releases.read', null, { failClosed: true });
      if (!limit.allowed) {
        if (limit.unavailable) return json({ ok: false, code: 'rate_limit_unavailable', error: 'Release read admission is temporarily unavailable.' }, { status: 503, headers: PRIVATE });
        const init = rateLimitedResponseInit(limit);
        return json({ ok: false, code: 'rate_limited', error: 'Too many release read requests.' }, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...PRIVATE } });
      }
      if (content) return await service.content(request);
      return json({ ok: true, release: await service.select(new URL(request.url), request.signal) }, { headers: PRIVATE });
    } catch (error) {
      if (request.signal.aborted) return json({ ok: false, code: 'cancelled', error: 'Release read was cancelled.' }, { status: 499, headers: PRIVATE });
      if (error instanceof NativeWebReleaseError) return json({ ok: false, code: error.code, error: error.message }, { status: error.status, headers: { ...PRIVATE, ...error.headers } });
      return json({ ok: false, code: 'release_unavailable', error: 'Native release publication is temporarily unavailable.' }, { status: 503, headers: PRIVATE });
    }
  };
  return { catalogue: handle(false), content: handle(true) };
}
