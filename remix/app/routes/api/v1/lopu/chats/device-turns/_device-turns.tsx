import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isLopuAccessActor } from '~/api/utils/lopu/accessMode';
import { createLopuChat, getLopuChat, loadLopuHistory, persistLopuAssistantTurn, persistLopuUserTurn, readLopuDeviceTurn, stableLopuChatId } from '~/api/utils/messenger/lopuChats';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { JSON_BODY_WITHOUT_APPLICATION_LIMIT, json, readJsonBody, requireJsonContentType } from '~/api/http';
import { isDeviceAiProvider } from '~/utils/deviceAiProvider';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';

const headers = { 'Cache-Control': 'private, no-store' };
const fail = (status: number, error: string) => json({ ok: false, error }, { status, headers });
const chatIdShape = /^[\w-]{1,128}$/u;
const dependencies = { getCurrentUser, enforceRateLimit, createLopuChat, getLopuChat, loadLopuHistory,
  persistLopuAssistantTurn, persistLopuUserTurn, readLopuDeviceTurn };

// An account may save text from its own device. This route never executes
// a provider, action, tool, continuation, or billing event, and never admits
// an opaque device provider ID to the hosted inference path.
export const createDeviceTurnAction = (deps = dependencies) => async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') return fail(405, 'Use POST to save a device turn.');
  if (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      request.headers.has('Authorization') || request.headers.has('X-Thingtime-Character')) return fail(403, 'Use a first-party Thingtime account session.');
  if (request.headers.get(EXPECTED_DATA_PLANE_HEADER) !== 'home') return fail(409, 'Use your home Thingtime storage for desktop chat.');
  const invalidType = requireJsonContentType(request);
  if (invalidType) return invalidType;
  const user = await deps.getCurrentUser(request);
  if (!user || !isLopuAccessActor(user, user.id)) return fail(401, 'Sign in to save your device conversation.');
  if (request.headers.get('X-Thingtime-Expected-Actor') !== user.id) return fail(409, 'The active account changed.');
  const limit = await deps.enforceRateLimit(request, 'lopu.chats.write', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Try saving again shortly.' }, { ...rateLimitedResponseInit(limit), headers });
  const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);
  if (!isDeviceAiProvider(body?.providerId) || !['history', 'save'].includes(body?.action) ||
      (body.chatId != null && (typeof body.chatId !== 'string' || !chatIdShape.test(body.chatId)))) return fail(400, 'Invalid device conversation.');
  if (typeof body.requestId !== 'string' || !chatIdShape.test(body.requestId) || typeof body.text !== 'string' || !body.text.trim())
    return fail(400, 'Invalid device turn.');

  const creationKey = `device-turn:${body.requestId}`;
  const read = await deps.getLopuChat(user.id, body.chatId ?? stableLopuChatId(user.id, creationKey));
  if (read.ok === false && (body.chatId || read.status !== 404)) return fail(read.status, read.error);
  const existing = read.ok ? read : null;
  if (existing && (existing.chat.createdBy !== user.id || existing.settings.archived)) return fail(403, 'Open one of your active Lopu chats.');
  if (existing && existing.settings.providerId !== body.providerId) return fail(409, 'Choose this device connection in a new Lopu chat.');
  if (body.action === 'history') {
    if (existing) {
      const prior = await deps.readLopuDeviceTurn(user.id, existing.chat.id, body.providerId, body.requestId, body.text);
      if (prior.ok === false) return fail(prior.status, prior.error);
      if (prior.receipt) return json({ ok: true, receipt: prior.receipt }, { headers });
    }
    const history = existing ? await deps.loadLopuHistory(user.id, existing.chat.id) : null;
    if (history?.ok === false) return fail(history.status, history.error);
    return json({ ok: true, history: history?.history ?? [] }, { headers });
  }

  if (typeof body.answer !== 'string' || !body.answer.trim())
    return fail(400, 'Invalid completed device turn.');
  const chat = existing ?? await deps.createLopuChat(user.id, { providerId: body.providerId, title: Array.from(body.text.trim()).slice(0, 70).join(''), management: 'client' }, {
    creationKey, transcriptProviderId: body.providerId
  });
  if (chat.ok === false) return fail(chat.status, chat.error);
  // Reconcile the deterministic new-chat ID too: a conflicting re-use cannot
  // turn a previously admitted local transcript into a different provider pin.
  if (chat.chat.lopu?.providerId !== body.providerId) return fail(409, 'The device conversation changed.');
  const userTurn = await deps.persistLopuUserTurn(user.id, { chatId: chat.chat.id, requestId: body.requestId, text: body.text, expectedProviderId: body.providerId });
  if (userTurn.ok === false) return fail(userTurn.status, userTurn.error);
  const assistantTurn = await deps.persistLopuAssistantTurn(user.id, { chatId: chat.chat.id, requestId: body.requestId, text: body.answer,
    requireExactReplay: true, expectedProviderId: body.providerId, lopu: { deviceTranscript: true } });
  if (assistantTurn.ok === false) return fail(assistantTurn.status, assistantTurn.error);
  return json({ ok: true, chatId: chat.chat.id, userMessageId: userTurn.message.id, messages: assistantTurn.messages }, { headers });
};
export const action = createDeviceTurnAction();
