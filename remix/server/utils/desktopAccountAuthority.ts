import { createHash } from 'node:crypto';
import { getDesktopProtectedRuntime } from '../../app/api/utils/ai/chatgptPlanRuntime';
import { getApiFallbackOrigin, shouldProxyApiToFallback } from './apiFallback';

// This is a local authority check for the Electron main process only. A caller
// must possess the one currently selected browser session and prove it to the
// exact remote authority before any protected device capability is exercised.
export function desktopAccountAuthority(request: Request, origin: string, requireHome = false) {
  const host = getDesktopProtectedRuntime();
  const local = new URL(request.url);
  const expected = request.headers.get('X-Thingtime-Expected-User');
  const actor = request.headers.get('X-Thingtime-Expected-Actor');
  const suppliedCookies = request.headers.get('Cookie')?.split(';').map(part => part.trim()) ?? [];
  const cookies = suppliedCookies.filter(part => part.startsWith('tt_auth='));
  if (!host || local.hostname !== '127.0.0.1' || new URL(origin).protocol !== 'https:' || !shouldProxyApiToFallback(request) ||
      !expected || expected !== host.ownerId || actor !== expected || cookies?.length !== 1 || cookies[0].length <= 'tt_auth='.length ||
      request.headers.has('Authorization') || request.headers.has('X-Thingtime-Character') ||
      (requireHome && (suppliedCookies.some(part => part.startsWith('tt_mongo=') && part.length > 'tt_mongo='.length) || request.headers.has('x-tt-mongo-url'))) ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.method !== 'GET' && request.headers.get('Origin') !== local.origin)) return null;
  const cookie = cookies[0];
  const sessionSignal = host.sessionSignal();
  const current = async () => !sessionSignal.aborted && origin === getApiFallbackOrigin() && host.available() &&
    await host.isActiveSession(local.origin, cookie.slice('tt_auth='.length), requireHome).catch(() => false) && !sessionSignal.aborted && origin === getApiFallbackOrigin();
  const scope = { ownerId: expected, origin, sessionId: createHash('sha256').update(cookie).digest('hex') };
  const access = async (path: '/api/v1/ai/chatgpt-plan' | '/api/v1/lopu/chats/device-turns', signal?: AbortSignal, body?: Record<string, unknown>): Promise<Response | null> => {
    if (!await current()) return null;
    const headers = new Headers({
      Accept: 'application/json', Cookie: cookie, 'X-Thingtime-Expected-User': expected, 'X-Thingtime-Expected-Actor': expected
    });
    // For the initiating request, preserve the canonical selected data-plane
    // precondition too. A callback only revalidates account authority; the
    // content database cannot select the owner or credential store.
    if (signal) {
      const plane = request.headers.get('X-Thingtime-Expected-Data-Plane');
      if (plane) headers.set('X-Thingtime-Expected-Data-Plane', plane);
    }
    if (body) { headers.set('Content-Type', 'application/json'); headers.set('Origin', origin); }
    try {
      const timeout = AbortSignal.timeout(8000);
      const response = await fetch(new URL(path, origin), {
        headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([sessionSignal, timeout, ...(signal ? [signal] : [])]),
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {})
      });
      if (await current()) return response;
      await response.body?.cancel().catch(() => undefined);
      return null;
    } catch { return null; }
  };
  return { scope, current, sessionSignal,
    planStatus: (signal?: AbortSignal) => access('/api/v1/ai/chatgpt-plan', signal),
    deviceTurn: (body: Record<string, unknown>, signal: AbortSignal) => access('/api/v1/lopu/chats/device-turns', signal, body) };
}
