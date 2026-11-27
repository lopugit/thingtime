import { ChatGPTPlanRuntimeError, getDesktopChatGPTPlanRuntime } from '../../app/api/utils/ai/chatgptPlanRuntime';
import { chatGPTPlanFailure } from '../../app/api/utils/ai/chatgptPlanScope';
import { json, readJsonBody, requireJsonContentType } from '../../app/api/http';
import { applyChatGPTPlanAction } from '../../app/routes/api/v1/ai/chatgpt-plan/_chatgpt-plan';
import { desktopAccountAuthority } from './desktopAccountAuthority';
import { selectedRuntimeSupportsFeature } from './apiFallback';

const PRIVATE = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
const unavailable = () => json({ ok: false, error: 'The desktop could not verify the selected Thingtime session.' }, { status: 503, headers: PRIVATE });

/** Keep remote self-hosted runtimes unchanged. An authoritative disabled
 * result can select the device's protected runtime, but any transport or
 * authentication failure stops work rather than changing the authority. */
export async function desktopChatGPTPlan(request: Request, origin: string): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'POST') return null;
  if (request.headers.get('X-Thingtime-Expected-Data-Plane') !== 'home') return null;
  const authority = desktopAccountAuthority(request, origin, true);
  if (!authority) return null;
  const remote = await authority.planStatus(request.signal);
  if (!remote) return unavailable();
  if (!remote.ok) {
    await remote.body?.cancel().catch(() => undefined);
    const retryAfter = remote.headers.get('Retry-After');
    return json({ ok: false, error: 'Thingtime could not verify this account for ChatGPT plan use.' }, {
      status: remote.status, headers: { ...PRIVATE, ...(retryAfter && /^\d+$/.test(retryAfter) ? { 'Retry-After': retryAfter } : {}) }
    });
  }
  const snapshot = await remote.json().catch(() => null);
  if (snapshot?.ok !== true || typeof snapshot.available !== 'boolean') return unavailable();
  if (snapshot.available) return request.method === 'GET' ? json(snapshot, { headers: PRIVATE }) : null;

  const runtime = getDesktopChatGPTPlanRuntime();
  if (!runtime) return unavailable();
  const revalidate = async () => {
    const response = await authority.planStatus();
    if (!response?.ok) return false;
    const data = await response.json().catch(() => null);
    return data?.ok === true && data.available === false && await authority.current();
  };
  try {
    if (request.method === 'GET') {
      const [status, deviceChatAvailable] = await Promise.all([runtime.status(authority.scope),
        selectedRuntimeSupportsFeature('api.lopu-chats-device-turns', '1.0.0', origin, request.signal)]);
      return await authority.current() ? json({ ok: true, available: true, deviceChatAvailable, ...status }, { headers: PRIVATE }) : unavailable();
    }
    const unsupported = requireJsonContentType(request);
    if (unsupported) return unsupported;
    const body = await readJsonBody(request, 128 * 1024);
    if (['prepare-import', 'move-account', 'import-account'].includes(body?.action))
      return json({ ok: false, error: 'This personal ChatGPT connection stays on this device.' }, { status: 409, headers: PRIVATE });
    if (!await authority.current()) return unavailable();
    const result = await applyChatGPTPlanAction(runtime, authority.scope, revalidate, body);
    return await authority.current() ? json({ ok: true, result }, { headers: PRIVATE }) : unavailable();
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ ok: false, ...chatGPTPlanFailure(error) }, { status: error instanceof ChatGPTPlanRuntimeError ? error.status : 400, headers: PRIVATE });
  }
}
