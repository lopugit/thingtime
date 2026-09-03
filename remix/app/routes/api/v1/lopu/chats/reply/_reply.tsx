import { json, readJsonBody } from '~/api/http';
import { listAiModels, resolveLopuModelChoice } from '~/api/utils/ai/models';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { streamLopuChatTurn } from '~/api/utils/lopu/chat';
import type { LopuChatContext, LopuChatEvent, LopuChatTurnOutcome } from '~/api/utils/lopu/chatEvents';
import { createLopuChat, getLopuChat, loadLopuHistory, persistLopuAssistantTurn, persistLopuUserTurn, updateLopuChat } from '~/api/utils/messenger/lopuChats';
import type { PublicChatMessage } from '~/api/utils/messenger/messenger';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import type { AiWorkflowModelChoice } from '~/api/utils/settings/prConflictResolverModelWaterfallCore';

// POST /api/v1/lopu/chats/reply — one streamed Lopu turn.
//
// Flow: session → fail-closed rate limit → validate the body → resolve the
// model choice against the catalog → find/create the conversation → load the
// history → persist the user turn → stream events as NDJSON → persist the
// assistant turn (ALWAYS, in a finally — a client that disconnects mid-reply
// still gets the transcript) → `done`. Tools run as the viewer inside
// streamLopuChatTurn; request/stream cancellation aborts the provider call.

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEXT_CHARS = 8000;
const MAX_REQUEST_ID_CHARS = 128;
const MAX_ROUTE_CHARS = 300;
const MAX_CONTEXT_BLOCKS_BYTES = 48 * 1024;
const MAX_CONTEXT_ID_CHARS = 128;
const HISTORY_TURNS = 40;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

type ReplyBody = {
  chatId: string | null;
  text: string;
  requestId: string;
  model: string | null;
  effort: string | null;
  speed: string | null;
  context: LopuChatContext | null;
};

type Validation = { ok: true; value: ReplyBody } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const optionalToken = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max && !/[\s$]/.test(trimmed) ? trimmed : null;
};

const parseContext = (raw: unknown): { ok: true; context: LopuChatContext | null } | { ok: false; error: string } => {
  if (raw === undefined || raw === null) return { ok: true, context: null };
  if (!isRecord(raw)) return { ok: false, error: 'context must be an object' };
  const context: LopuChatContext = {};
  if (raw.route !== undefined && raw.route !== null) {
    if (typeof raw.route !== 'string' || raw.route.length > MAX_ROUTE_CHARS) return { ok: false, error: 'context.route must be a short path' };
    context.route = raw.route;
  }
  if (raw.viewport === 'mobile' || raw.viewport === 'desktop') context.viewport = raw.viewport;
  if (raw.selectedBlockId !== undefined && raw.selectedBlockId !== null) {
    const id = optionalToken(raw.selectedBlockId, 64);
    if (!id) return { ok: false, error: 'context.selectedBlockId must be a block id' };
    context.selectedBlockId = id;
  }
  if (raw.page !== undefined && raw.page !== null) {
    if (!isRecord(raw.page)) return { ok: false, error: 'context.page must be an object' };
    const page: NonNullable<LopuChatContext['page']> = {};
    if (raw.page.id !== undefined && raw.page.id !== null) {
      const id = optionalToken(raw.page.id, MAX_CONTEXT_ID_CHARS);
      if (!id) return { ok: false, error: 'context.page.id must be a webpage id' };
      page.id = id;
    }
    if (raw.page.source === 'user' || raw.page.source === 'system') page.source = raw.page.source;
    if (typeof raw.page.pageKey === 'string' && raw.page.pageKey.length <= MAX_CONTEXT_ID_CHARS) page.pageKey = raw.page.pageKey;
    if (typeof raw.page.siteRoute === 'string' && raw.page.siteRoute.length <= MAX_ROUTE_CHARS) page.siteRoute = raw.page.siteRoute;
    if (typeof raw.page.name === 'string' && raw.page.name.length <= 120) page.name = raw.page.name;
    if (typeof raw.page.updatedAt === 'string' && !Number.isNaN(new Date(raw.page.updatedAt).getTime())) page.updatedAt = raw.page.updatedAt;
    if (raw.page.blocks !== undefined && raw.page.blocks !== null) {
      if (!Array.isArray(raw.page.blocks)) return { ok: false, error: 'context.page.blocks must be a list of blocks' };
      let serialized = '';
      try {
        serialized = JSON.stringify(raw.page.blocks) || '';
      } catch {
        return { ok: false, error: 'context.page.blocks must be JSON-serialisable' };
      }
      if (serialized.length > MAX_CONTEXT_BLOCKS_BYTES) return { ok: false, error: `context.page.blocks is too large (max ${MAX_CONTEXT_BLOCKS_BYTES} bytes)` };
      page.blocks = raw.page.blocks as NonNullable<LopuChatContext['page']>['blocks'];
    }
    context.page = page;
  }
  return { ok: true, context };
};

const parseBody = (body: unknown): Validation => {
  if (!isRecord(body)) return { ok: false, error: 'Send a JSON body with text and requestId' };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, error: 'Say something first' };
  if (Array.from(text).length > MAX_TEXT_CHARS) return { ok: false, error: `Messages to Lopu cap at ${MAX_TEXT_CHARS} characters` };
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!requestId || requestId.length > MAX_REQUEST_ID_CHARS || !REQUEST_ID_PATTERN.test(requestId)) {
    return { ok: false, error: 'requestId must be a client-generated id (letters, digits, - _ . :)' };
  }
  const chatId = body.chatId === undefined || body.chatId === null || body.chatId === '' ? null : optionalToken(body.chatId, MAX_CONTEXT_ID_CHARS);
  if (body.chatId !== undefined && body.chatId !== null && body.chatId !== '' && !chatId) return { ok: false, error: 'chatId must be a chat id' };
  for (const key of ['model', 'effort', 'speed'] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || value.length > 128)) {
      return { ok: false, error: `${key} must be a string` };
    }
  }
  const context = parseContext(body.context);
  if (context.ok === false) return context;
  return {
    ok: true,
    value: {
      chatId,
      text,
      requestId,
      model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null,
      effort: typeof body.effort === 'string' && body.effort.trim() ? body.effort.trim() : null,
      speed: typeof body.speed === 'string' && body.speed.trim() ? body.speed.trim() : null,
      context: context.context
    }
  };
};

// A conversation title from the first message: first line, tidy, ≤ 60 chars.
export const titleFromMessage = (text: string): string => {
  const line = text.split(/\r?\n/).find((entry) => entry.trim()) || '';
  const tidy = line.replace(/\s+/g, ' ').replace(/[`*_#>]+/g, '').trim();
  if (!tidy) return 'Lopu';
  if (tidy.length <= 60) return tidy.replace(/[.,;:!?]+$/, '') || 'Lopu';
  const cut = tidy.slice(0, 60);
  const atSpace = cut.lastIndexOf(' ');
  return `${(atSpace > 24 ? cut.slice(0, atSpace) : cut).replace(/[.,;:!?]+$/, '')}…`;
};

const interruptedNote = (outcome: LopuChatTurnOutcome | null): string => {
  if (!outcome) return 'Lopu’s reply was interrupted before it started — ask again in a moment.';
  const text = outcome.text.trim();
  if (outcome.stopReason === 'aborted') return text ? `${text}\n\n_(reply stopped)_` : 'Lopu’s reply was stopped before it started.';
  if (outcome.stopReason === 'error') return text ? `${text}\n\n_(reply interrupted — try again)_` : 'Lopu lost the thread before replying — try again.';
  return text || 'Lopu went quiet for a moment — ask again in a little while.';
};

export const action = async ({ request }: { request: Request }) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Sign in to talk to Lopu' }, { status: 401 });
  if (user.temporary) return json({ ok: false, error: 'Create an account to chat with Lopu — conversations are saved to your account' }, { status: 403 });

  const limit = await enforceRateLimit(request, 'lopu.chat', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return json(
      { ok: false, error: limit.unavailable ? 'Lopu cannot check her rate limit right now — try again shortly' : 'Lopu needs a breather — try again in a few minutes 🦄' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const parsed = parseBody(body);
  if (parsed.ok === false) return json({ ok: false, error: parsed.error }, { status: 400 });
  const input = parsed.value;
  const viewer = { id: user.id, username: user.username };

  // --- conversation -----------------------------------------------------
  let chatId = input.chatId;
  let settings: { model: string | null; effort: string | null; speed: string | null } = { model: null, effort: null, speed: null };
  if (chatId) {
    const existing = await getLopuChat(user.id, chatId);
    if (existing.ok === false) return json({ ok: false, error: existing.error }, { status: existing.status });
    settings = { model: existing.settings.model, effort: existing.settings.effort, speed: existing.settings.speed };
  }

  // --- model choice -------------------------------------------------------
  const catalog = await listAiModels({ id: user.id });
  const overrides = !!(input.model || input.effort || input.speed);
  const requested = { model: input.model ?? settings.model, effort: input.effort ?? settings.effort, speed: input.speed ?? settings.speed };
  let choice: AiWorkflowModelChoice | null = null;
  if (catalog.models.length) {
    // explicit overrides are strict (a bad model is a 400); stored settings
    // are lenient (an admin may have disabled the chat's model since)
    const resolved = resolveLopuModelChoice(requested, catalog.models, { defaults: catalog.defaults, lenient: !overrides });
    if (resolved.ok === false) {
      if (overrides) return json({ ok: false, error: resolved.error }, { status: 400 });
    } else if (catalog.defaults.model || resolved.available) {
      choice = resolved.choice;
    }
  }

  if (!chatId) {
    const created = await createLopuChat(user.id, {
      title: titleFromMessage(input.text),
      ...(choice ? { model: choice.model, effort: choice.effort, speed: choice.speed } : {})
    });
    if (created.ok === false) return json({ ok: false, error: created.error }, { status: created.status });
    chatId = created.chat.id;
  } else if (overrides && choice) {
    // a per-turn override becomes the conversation's setting (best effort —
    // the turn itself already carries the resolved choice)
    await updateLopuChat(user.id, chatId, { model: choice.model, effort: choice.effort, speed: choice.speed }).catch(() => null);
  }

  // --- history + the user turn ------------------------------------------
  const loaded = await loadLopuHistory(user.id, chatId, { limit: HISTORY_TURNS });
  const history = loaded.ok === false ? [] : loaded.history;

  const userTurn = await persistLopuUserTurn(user.id, { chatId, requestId: input.requestId, text: input.text });
  if (userTurn.ok === false) return json({ ok: false, error: userTurn.error }, { status: userTurn.status });
  if (userTurn.existing) return json({ ok: false, error: 'A message with this requestId already exists — send a fresh message' }, { status: 409 });
  const userMessageId = userTurn.message.id;

  // --- the stream -----------------------------------------------------------
  const abort = new AbortController();
  const requestSignal = (request as Request & { signal?: AbortSignal }).signal;
  if (requestSignal) {
    if (requestSignal.aborted) abort.abort();
    else requestSignal.addEventListener('abort', () => abort.abort(), { once: true });
  }
  const encoder = new TextEncoder();
  const persistedChatId = chatId;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: LopuChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true;
        }
      };

      let outcome: LopuChatTurnOutcome | null = null;
      const generator = streamLopuChatTurn({
        viewer,
        chatId: persistedChatId,
        userMessageId,
        requestId: input.requestId,
        text: input.text,
        history,
        choice,
        context: input.context,
        signal: abort.signal
      });
      try {
        for (;;) {
          const step = await generator.next();
          if (step.done === true) {
            outcome = step.value;
            break;
          }
          send(step.value);
        }
      } catch (error: any) {
        console.error('[lopu] reply stream failed:', error?.message || error);
        send({ type: 'error', message: 'Lopu lost the thread mid-reply — what streamed so far is kept.', retryable: true });
      } finally {
        // persist whatever streamed, even after an error or a disconnect
        const finished = outcome?.stopReason === 'end_turn' || outcome?.stopReason === 'fallback' || outcome?.stopReason === 'tool_limit' || outcome?.stopReason === 'hop_limit' || outcome?.stopReason === 'time_limit' || outcome?.stopReason === 'max_tokens';
        const text = finished && outcome?.text.trim() ? outcome.text : interruptedNote(outcome);
        const stopReason = outcome?.stopReason || 'error';
        let assistantMessageId = '';
        let messages: PublicChatMessage[] = [];
        try {
          const persisted = await persistLopuAssistantTurn(user.id, {
            chatId: persistedChatId,
            requestId: input.requestId,
            text,
            lopu: {
              model: outcome?.model ?? choice?.model ?? null,
              effort: outcome?.effort ?? choice?.effort ?? null,
              speed: outcome?.speed ?? choice?.speed ?? 'normal',
              provider: outcome?.provider ?? 'fallback',
              usage: outcome?.usage,
              toolCalls: outcome?.toolCalls ?? [],
              stopReason
            }
          });
          if (persisted.ok !== false) {
            messages = persisted.messages;
            assistantMessageId = persisted.messages[0]?.id || '';
          } else {
            console.error('[lopu] assistant turn not persisted:', persisted.error);
          }
        } catch (error: any) {
          console.error('[lopu] assistant turn persist threw:', error?.message || error);
        }
        send({ type: 'done', assistantMessageId, messages, ...(outcome?.usage ? { usage: outcome.usage } : {}), stopReason });
        try {
          controller.close();
        } catch {
          // already closed by a cancel
        }
      }
    },
    cancel() {
      abort.abort();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Thingtime-Lopu-RateLimit-Remaining': String(limit.remaining)
    }
  });
};
