import OpenAI from 'openai';
import { adaptChatGPTResponsesRequest, ChatGPTPlanError, normaliseChatGPTPlanError, RESOURCE } from '../../app/api/utils/ai/chatgptPlanProtocol';
import { getDesktopChatGPTPlanRuntime, type DevicePlanTurn } from '../../app/api/utils/ai/chatgptPlanRuntime';
import { createGuardedProviderFetch } from '../../app/api/utils/lopu/vaultProviderClient';
import { LOPU_USER_TURN_MAX_CHARS } from '../../app/api/utils/messenger/lopuChats';
import { json, readJsonBody, requireJsonContentType } from '../../app/api/http';
import { isDeviceAiProvider } from '../../app/utils/deviceAiProvider';
import { desktopAccountAuthority } from './desktopAccountAuthority';
import { selectedRuntimeSupportsFeature } from './apiFallback';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const fail = (status: number, error: string, code?: string) => json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers: PRIVATE });
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/u.test(value);
const validReceipt = (receipt: any) => receipt && validId(receipt.chatId) && validId(receipt.userMessageId) && Array.isArray(receipt.messages);
const completedReply = (receipt: any, requestId: string, answer: string, model: string | null) => {
  const label = model ? 'ChatGPT plan · this device' : 'Unverified device transcript';
  const events = [
    { type: 'meta', chatId: receipt.chatId, requestId, userMessageId: receipt.userMessageId, model, provider: 'vault', label, providerLabel: label,
      ...(model ? { billing: 'byo' } : {}) },
    { type: 'delta', text: answer },
    { type: 'done', assistantMessageId: receipt.messages[0]?.id ?? null, messages: receipt.messages,
      ...(model ? { billing: 'byo' } : {}), stopReason: 'end_turn' }
  ];
  return new Response(events.map(event => JSON.stringify(event) + '\n').join(''), { headers: { ...PRIVATE, 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
};

export async function desktopChatGPTReply(request: Request, origin: string) {
  if (request.method !== 'POST') return fail(405, 'Use POST to send a Lopu message.');
  const invalidType = requireJsonContentType(request);
  if (invalidType) return invalidType;
  if (request.headers.get('X-Thingtime-Expected-Data-Plane') !== 'home') return fail(409, 'Use your home Thingtime storage for desktop chat.');
  const authority = desktopAccountAuthority(request, origin, true);
  const runtime = getDesktopChatGPTPlanRuntime();
  if (!authority || !runtime || !await authority.current()) return fail(409, 'Open this chat in the signed-in Thingtime desktop app that owns its connection.');
  if (!await selectedRuntimeSupportsFeature('api.lopu-chats-device-turns', '1.0.0', origin, request.signal))
    return fail(409, 'The selected Thingtime API cannot save device replies yet.');
  let input: any;
  try { input = await readJsonBody(request, 128 * 1024); }
  catch (error) {
    if (error instanceof Response) return fail(error.status, 'The message exceeds the desktop reply transport limit.');
    return fail(400, 'Could not read the desktop message.');
  }
  const { chatId, requestId, providerId } = input ?? {};
  if (!isDeviceAiProvider(providerId) || !validId(requestId) || (chatId != null && !validId(chatId)) ||
      typeof input.text !== 'string' || !input.text.trim()) return fail(400, 'Send a valid device chat message.');
  if (Array.from(input.text.trim()).length > LOPU_USER_TURN_MAX_CHARS) return fail(400, `Messages to Lopu cap at ${LOPU_USER_TURN_MAX_CHARS} characters.`);
  if (input.continueFromRequestId || input.attachmentIds?.length || input.thingIds?.length || input.confirmations?.length || input.context?.pages?.length)
    return fail(400, 'This desktop ChatGPT connection supports text messages only.');

  const ownerSignal = AbortSignal.any([request.signal, authority.sessionSignal]);
  const save = async (turn: DevicePlanTurn, signal: AbortSignal, model: string | null) => {
    const receiptInput = { action: 'save', ...turn };
    const firstSave = await authority.deviceTurn(receiptInput, signal);
    // An uncertain save is reconciled only with the same request and bytes.
    const saved = firstSave === null ? await authority.deviceTurn(receiptInput, signal) : firstSave;
    const receipt = await saved?.json().catch(() => null);
    if (!saved?.ok || receipt?.ok !== true || !validReceipt(receipt))
      return fail(saved?.status && !saved.ok ? saved.status : 503, 'The completed reply is protected on this device. Retry this request to finish saving it.');
    await runtime.settleDeviceTurn(authority.scope, providerId, requestId, null).catch(() => undefined);
    if (!await authority.current()) return fail(409, 'The active account changed.');
    return completedReply(receipt, requestId, turn.answer, model);
  };
  try {
    const pending = await runtime.pendingDeviceTurn(authority.scope, providerId, requestId);
    if (pending) {
      if (pending.providerId !== providerId || pending.chatId !== (chatId ?? null) || pending.text !== input.text)
        return fail(409, 'That request belongs to a different message.');
      return await save(pending, ownerSignal, null);
    }
  } catch (error) {
    const failure = normaliseChatGPTPlanError(error);
    return fail(failure.status, failure.message);
  }

  const historyResponse = await authority.deviceTurn({ action: 'history', chatId, providerId, requestId, text: input.text }, ownerSignal);
  if (!historyResponse?.ok) {
    await historyResponse?.body?.cancel().catch(() => undefined);
    return fail(historyResponse?.status || 503, historyResponse?.status === 409 ? 'Choose this device connection in a new Lopu chat.' : 'Could not verify this conversation with Thingtime.');
  }
  const admission = await historyResponse.json().catch(() => null);
  const history = admission?.history;
  if (validReceipt(admission?.receipt) && typeof admission.receipt.answer === 'string' && await authority.current())
    return completedReply(admission.receipt, requestId, admission.receipt.answer, null);
  if (!Array.isArray(history) || history.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string'))
    return fail(503, 'Could not read this conversation from Thingtime.');
  try {
    if (!await authority.current()) return fail(409, 'The active account changed.');
    const provider = await runtime.resolveProvider(authority.scope, providerId);
    const signal = AbortSignal.any([ownerSignal, provider.authSignal, AbortSignal.timeout(120_000)]);
    if (!await runtime.reserveDeviceTurn(authority.scope, providerId, requestId))
      return fail(409, 'This request already started. Reopen the conversation to check for the reply before sending again.', 'DEVICE_TURN_ALREADY_STARTED');
    if (!await authority.current()) return fail(409, 'The active account changed.');
    signal.throwIfAborted();
    const client = new OpenAI({ baseURL: RESOURCE, apiKey: provider.token, organization: null, project: null,
      adminAPIKey: null, fetch: createGuardedProviderFetch(), maxRetries: 0, timeout: 120_000 });
    const stream = await client.responses.create(adaptChatGPTResponsesRequest({
      model: provider.model, instructions: 'You are Lopu, the assistant in Thingtime. Reply to the user clearly and directly. You have no tools in this chat.',
      input: [...history.map(turn => ({ role: turn.role, content: turn.text })), { role: 'user', content: input.text }],
      store: false, stream: true
    }) as unknown as OpenAI.Responses.ResponseCreateParamsStreaming, { signal });
    let answer = '', completed = false;
    for await (const event of stream) {
      signal.throwIfAborted();
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') answer += event.delta;
      else if (event.type === 'response.completed') completed = event.response.status === 'completed';
      else if (event.type === 'response.failed' || event.type === 'error') throw normaliseChatGPTPlanError(event);
    }
    if (!completed || !answer.trim()) throw new ChatGPTPlanError('response_incomplete', 502);
    signal.throwIfAborted();
    const turn = { chatId: chatId ?? null, providerId, requestId, text: input.text, answer };
    await runtime.settleDeviceTurn(authority.scope, providerId, requestId, turn);
    return await save(turn, signal, provider.model);
  } catch (error) {
    const failure = normaliseChatGPTPlanError(error);
    return fail(failure.status, failure.message);
  }
}
