import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { parsePartialJson } from '~/utils/partialJson';
import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import {
  type AiModelEffort,
  type AiWorkflowModelChoice,
  resolveAiPreferredAnthropicChoice,
  resolveAiPreferredOpenAiChoice,
  toAnthropicEffort,
  toOpenAiReasoningEffort
} from '../settings/prConflictResolverModelWaterfallCore';
import type {
  LopuChatContext,
  LopuChatProvider,
  LopuChatStopReason,
  LopuChatStreamEvent,
  LopuChatTurnOutcome,
  LopuChatUsage,
  LopuProviderEvent,
  LopuProviderHopInput,
  LopuProviderStream,
  LopuProviderToolResult,
  LopuToolCallSummary
} from './chatEvents';
import { buildLopuSystemPrompt, type LopuToolProtocol } from './chatPrompt';
import { createLopuTestProvider } from './chatTestProvider';
import {
  LOPU_TOOL_NAMES,
  anthropicToolDefinitions,
  boundToolData,
  createLopuToolContext,
  openAiToolDefinitions,
  runLopuTool,
  type LopuToolCall,
  type LopuToolContext,
  type LopuToolEvent,
  type LopuToolResult,
  type LopuToolViewer
} from './chatTools';
import {
  createGuardedProviderFetch,
  LOPU_PROVIDER_TIMEOUT_MS,
  resolveVaultProviderClientConfig,
  type LopuVaultProviderClientConfig,
  type LopuVaultProviderRecord
} from './vaultProviderClient';
import { friendlyVaultProviderError, resolveVaultTurnModel, vaultProviderTransport } from './vaultProviders';

// 🦄 Lopu's chat brain — one streamed assistant turn with tool use.
//
// The viewer's own provider (design note §1.3): when the turn carries a
// Secure Vault connection (`vaultProvider`), it runs THERE — the Anthropic
// path with the vault key/base URL for the anthropic kind, the
// OpenAI-compatible path (native function tools for OpenAI / OpenRouter /
// xAI / Gemini's /openai surface, the fenced tt-tool text protocol for a
// custom compatible host) for every other kind — behind the same SSRF fence
// the voice turn uses (vaultProviderClient.ts). The server keys are never a
// fallback for a vault turn: a failure surfaces as a friendly error event
// followed by the canned vault line.
//
// Providers (set either or both env keys):
//   - ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) → Claude with native tools
//   - OPENAI_API_KEY → ChatGPT-compatible chat.completions; LOPU_OPENAI_TOOLS
//     = native (function calling) | text (fenced ```tt-tool blocks parsed
//     out of the streamed text, for endpoints without function calling such
//     as the local Codex proxy)
//   - LOPU_CHAT_PROVIDER = auto (default: the explicit choice's provider
//     first, then the other configured one) | claude | openai | test (the
//     deterministic scripted provider in chatTestProvider.ts)
//   - LOPU_CLAUDE_MODEL / LOPU_OPENAI_MODEL are only the provider-valid
//     fallbacks when the Admin waterfall resolves to `default`
//
// Every provider is an async generator speaking the provider protocol in
// chatEvents.ts; runToolLoop executes the tools it asks for AS THE VIEWER
// (chatTools.ts) and resumes it with the results. Whatever happens, the turn
// ends with text: a provider that fails before emitting anything falls
// through to the next configured one, and the last resort is an honest
// canned line — never a blank reply.

export const LOPU_CHAT_MAX_OUTPUT_TOKENS = 16000;
export const LOPU_CHAT_MAX_HOPS = 12;
export const LOPU_CHAT_MAX_TOOL_EXECUTIONS = 24;
export const LOPU_CHAT_MAX_TURN_MS = 240_000;
export const LOPU_CHAT_MAX_HISTORY_CHARS = 60_000;
export const LOPU_CHAT_MAX_TOOL_RESULT_CHARS = 16 * 1024;

export type LopuChatProviderMode = 'auto' | 'claude' | 'openai' | 'test';
export type LopuOpenAiToolMode = 'native' | 'text';

const getDefaultLopuClaudeModel = () => process.env.LOPU_CLAUDE_MODEL?.trim() || 'claude-opus-4-8';
const getDefaultLopuOpenAiModel = () => process.env.LOPU_OPENAI_MODEL?.trim() || 'gpt-4o-mini';

export const lopuChatProviderMode = (): LopuChatProviderMode => {
  const value = (process.env.LOPU_CHAT_PROVIDER || 'auto').trim().toLowerCase();
  return value === 'claude' || value === 'openai' || value === 'test' ? value : 'auto';
};

export const lopuOpenAiToolMode = (): LopuOpenAiToolMode => ((process.env.LOPU_OPENAI_TOOLS || '').trim().toLowerCase() === 'text' ? 'text' : 'native');

export const lopuChatProvidersConfigured = () => ({
  anthropic: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  openai: !!process.env.OPENAI_API_KEY
});

export const hasLopuChatProviderConfigured = (): boolean => {
  if (lopuChatProviderMode() === 'test') return true;
  const configured = lopuChatProvidersConfigured();
  return configured.anthropic || configured.openai;
};

export type LopuChatHistoryTurn = { role: 'user' | 'assistant'; text: string };

type AnthropicClientOptions = NonNullable<ConstructorParameters<typeof Anthropic>[0]>;
type OpenAiClientOptions = NonNullable<ConstructorParameters<typeof OpenAI>[0]>;

// A decrypted Secure Vault connection for one turn (route-resolved through
// getUserVaultProvider) plus the effort the chat asked for. `requestedModel`
// only matters for a connection saved without a model of its own.
export type LopuVaultTurnProvider = LopuVaultProviderRecord & {
  effort: AiModelEffort | null;
  requestedModel?: string | null;
};

export type LopuChatDependencies = {
  runTool: (call: LopuToolCall, ctx: LopuToolContext) => Promise<LopuToolResult>;
  getPreferredModelWaterfall: typeof getAiPreferredModelWaterfall;
  // options are passed only for a vault turn (the viewer's own key + base URL
  // + the redirect-refusing fetch); the server-key clients take none
  createAnthropic: (options?: AnthropicClientOptions) => Anthropic;
  createOpenAi: (options?: OpenAiClientOptions) => OpenAI;
  // the SSRF fence + kind → transport mapping for a vault turn
  resolveVaultProviderClient: typeof resolveVaultProviderClientConfig;
  now: () => number;
  // ms between canned-fallback word chunks (0 in tests)
  fallbackPaceMs: number;
  testPaceMs?: number;
};

export type LopuChatTurnInput = {
  viewer: LopuToolViewer;
  chatId: string;
  userMessageId: string;
  requestId: string;
  text: string;
  history?: LopuChatHistoryTurn[];
  // the resolved model choice for this turn (null = no provider configured)
  choice?: AiWorkflowModelChoice | null;
  // the viewer's own Secure Vault provider for this turn (design note §1.3):
  // when set the turn runs there instead of on the server keys, which are
  // never used as a fallback
  vaultProvider?: LopuVaultTurnProvider | null;
  context?: LopuChatContext | null;
  signal?: AbortSignal;
  deps?: Partial<LopuChatDependencies>;
};

const defaultDependencies = (): LopuChatDependencies => ({
  runTool: runLopuTool,
  getPreferredModelWaterfall: getAiPreferredModelWaterfall,
  createAnthropic: (options) => (options ? new Anthropic(options) : new Anthropic()),
  createOpenAi: (options) => (options ? new OpenAI(options) : new OpenAI()),
  resolveVaultProviderClient: resolveVaultProviderClientConfig,
  now: () => Date.now(),
  fallbackPaceMs: 30
});

// ---------------------------------------------------------------------------
// provider planning

type ProviderAttempt = { provider: 'claude' | 'openai'; choice: AiWorkflowModelChoice };

const openAiDefaultChoice = (): AiWorkflowModelChoice => {
  const model = getDefaultLopuOpenAiModel();
  return { id: model, model, label: model, provider: 'openai', effort: null, speed: 'normal' };
};

// One durable waterfall read serves every provider attempt of the turn:
// the explicit choice runs on its own provider; the OTHER provider (the
// fallback) runs its first Admin waterfall entry, stopping at `default`.
const planProviderAttempts = async (explicit: AiWorkflowModelChoice | null, deps: LopuChatDependencies): Promise<ProviderAttempt[]> => {
  const configured = lopuChatProvidersConfigured();
  if (!configured.anthropic && !configured.openai) return [];
  const waterfall = await deps.getPreferredModelWaterfall();
  const claudeDefault = resolveAiPreferredAnthropicChoice(waterfall, getDefaultLopuClaudeModel());
  const openAiDefault = resolveAiPreferredOpenAiChoice(waterfall) ?? openAiDefaultChoice();
  const explicitProvider: 'claude' | 'openai' | null =
    explicit?.provider === 'anthropic' ? 'claude' : explicit?.provider === 'openai' ? 'openai' : null;
  const mode = lopuChatProviderMode();
  const primary: 'claude' | 'openai' = mode === 'claude' || mode === 'openai' ? mode : (explicitProvider ?? 'claude');
  const order: Array<'claude' | 'openai'> = primary === 'claude' ? ['claude', 'openai'] : ['openai', 'claude'];
  return order
    .filter((provider) => (provider === 'claude' ? configured.anthropic : configured.openai))
    .map((provider) => ({
      provider,
      choice: explicit && explicitProvider === provider ? explicit : provider === 'claude' ? claudeDefault : openAiDefault
    }));
};

// ---------------------------------------------------------------------------
// helpers shared by the providers

// Anthropic wants strictly alternating user/assistant turns starting with a
// user turn; merge neighbours and drop a leading assistant line. Bounded by
// characters (oldest turns fall off first).
const normaliseHistory = (history: LopuChatHistoryTurn[] | undefined): LopuChatHistoryTurn[] => {
  const kept: LopuChatHistoryTurn[] = [];
  let chars = 0;
  for (let index = (history || []).length - 1; index >= 0; index--) {
    const turn = history![index];
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.text !== 'string' || !turn.text.trim()) continue;
    if (chars + turn.text.length > LOPU_CHAT_MAX_HISTORY_CHARS) break;
    chars += turn.text.length;
    kept.unshift({ role: turn.role, text: turn.text });
  }
  const merged: LopuChatHistoryTurn[] = [];
  for (const turn of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.text = `${last.text}\n\n${turn.text}`;
    else merged.push({ ...turn });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
};

const toolResultPayload = (result: LopuProviderToolResult): Record<string, unknown> =>
  result.ok
    ? { ok: true, summary: result.summary, ...(result.data !== undefined ? { data: result.data } : {}) }
    : { ok: false, error: result.error || result.summary };

const boundedJson = (value: unknown, fallback: unknown): string => {
  let json = '';
  try {
    json = JSON.stringify(value) || '';
  } catch {
    json = JSON.stringify(fallback);
  }
  return json.length > LOPU_CHAT_MAX_TOOL_RESULT_CHARS ? `${json.slice(0, LOPU_CHAT_MAX_TOOL_RESULT_CHARS)}…` : json;
};

const toolResultText = (result: LopuProviderToolResult): string =>
  boundedJson(toolResultPayload(result), { ok: result.ok, summary: result.summary });

const parseToolInput = (json: string): unknown => {
  const trimmed = json.trim();
  if (!trimmed) return {};
  const parsed = parsePartialJson(trimmed);
  return parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
};

const isAbortError = (error: unknown): boolean =>
  !!error && typeof error === 'object' && ((error as any).name === 'AbortError' || (error as any).name === 'APIUserAbortError' || /abort/i.test(String((error as any).message || '')));

// ---------------------------------------------------------------------------
// fenced-text tool protocol (LOPU_OPENAI_TOOLS=text)
//
// The model writes ```tt-tool fences holding { "name", "input" }; text
// outside fences streams to the user, fence bodies stream as tool input
// deltas (so live previews work exactly like native tool streaming), and a
// closed fence becomes a tool_use. `drop` mode swallows fences (the final
// text-only hop).

export type TtToolTextParser = {
  push: (chunk: string) => LopuProviderEvent[];
  finish: () => LopuProviderEvent[];
  calls: () => Array<{ id: string; name: string; input: unknown }>;
  rawText: () => string;
};

const FENCE_OPEN = /```[ \t]*tt-tool[ \t]*\r?\n?/;
const FENCE_MARKERS = ['```tt-tool', '``` tt-tool'];

const partialMarkerSuffix = (buffer: string): number => {
  let longest = 0;
  for (const marker of FENCE_MARKERS) {
    const max = Math.min(marker.length - 1, buffer.length);
    for (let length = max; length > 0; length--) {
      if (marker.startsWith(buffer.slice(buffer.length - length))) {
        longest = Math.max(longest, length);
        break;
      }
    }
  }
  return longest;
};

export const createTtToolTextParser = (options: { nextId: () => string; mode: 'execute' | 'drop' }): TtToolTextParser => {
  let buffer = '';
  let raw = '';
  let state: 'text' | 'fence' = 'text';
  let body = '';
  let current: { id: string; name: string | null; started: boolean; inputEmitted: number } | null = null;
  const calls: Array<{ id: string; name: string; input: unknown }> = [];

  const inputSlice = (text: string): string => {
    const key = text.indexOf('"input"');
    if (key === -1) return '';
    const colon = text.indexOf(':', key + 7);
    return colon === -1 ? '' : text.slice(colon + 1);
  };

  const progress = (): LopuProviderEvent[] => {
    if (!current || options.mode === 'drop') return [];
    const out: LopuProviderEvent[] = [];
    if (!current.started) {
      const parsed = parsePartialJson(body);
      const name = parsed.value && typeof parsed.value === 'object' ? (parsed.value as any).name : null;
      if (typeof name === 'string' && name.trim()) {
        current.name = name.trim();
        current.started = true;
        out.push({ type: 'tool_use_start', id: current.id, name: current.name });
      }
    }
    if (current.started) {
      const input = inputSlice(body);
      if (input.length > current.inputEmitted) {
        out.push({ type: 'tool_input_delta', id: current.id, name: current.name!, partial: input.slice(current.inputEmitted) });
        current.inputEmitted = input.length;
      }
    }
    return out;
  };

  const closeFence = (): LopuProviderEvent[] => {
    const out: LopuProviderEvent[] = [];
    const call = current;
    current = null;
    state = 'text';
    if (!call) return out;
    if (options.mode === 'drop') {
      out.push({ type: 'text', text: '(tool call skipped — the tool budget for this turn is spent)' });
      body = '';
      return out;
    }
    let parsed = parsePartialJson(body);
    // a fence body that arrived JSON-escaped ({\"name\":…} — the reply was a
    // JSON string literal on the wire) decodes to the real object
    if ((!parsed.value || typeof parsed.value !== 'object') && /\\"/.test(body)) {
      try {
        const decoded = JSON.parse(`"${body.replace(/\r?\n/g, '\\n')}"`);
        if (typeof decoded === 'string') parsed = parsePartialJson(decoded);
      } catch {
        // keep the original parse result
      }
    }
    const value = parsed.value && typeof parsed.value === 'object' ? (parsed.value as any) : {};
    // the documented shape is { name, input }; models on text-mode endpoints
    // also reach for OpenAI-ish spellings, so read those too
    const nameCandidate = [value.name, value.tool, value.tool_name, value.function?.name, value.function].find((entry) => typeof entry === 'string' && entry.trim());
    const name = typeof nameCandidate === 'string' ? nameCandidate.trim() : call.name || 'unknown_tool';
    const inputCandidate = [value.input, value.arguments, value.args, value.parameters, value.params, value.function?.arguments].find((entry) => entry !== undefined && entry !== null);
    const input =
      inputCandidate && typeof inputCandidate === 'object'
        ? inputCandidate
        : typeof inputCandidate === 'string'
          ? (() => {
              const inner = parsePartialJson(inputCandidate).value;
              return inner && typeof inner === 'object' ? inner : {};
            })()
          : {};
    if (!call.started) out.push({ type: 'tool_use_start', id: call.id, name });
    out.push({ type: 'tool_use', id: call.id, name, input });
    calls.push({ id: call.id, name, input });
    body = '';
    return out;
  };

  const push = (chunk: string): LopuProviderEvent[] => {
    raw += chunk;
    buffer += chunk;
    const out: LopuProviderEvent[] = [];
    for (;;) {
      if (state === 'text') {
        const match = FENCE_OPEN.exec(buffer);
        if (match) {
          const before = buffer.slice(0, match.index);
          if (before) out.push({ type: 'text', text: before });
          buffer = buffer.slice(match.index + match[0].length);
          state = 'fence';
          body = '';
          current = { id: options.nextId(), name: null, started: false, inputEmitted: 0 };
          continue;
        }
        const hold = partialMarkerSuffix(buffer);
        const emit = buffer.slice(0, buffer.length - hold);
        if (emit) out.push({ type: 'text', text: emit });
        buffer = buffer.slice(buffer.length - hold);
        return out;
      }
      const close = buffer.indexOf('```');
      if (close === -1) {
        // hold back a possible partial closing marker
        const hold = buffer.endsWith('``') ? 2 : buffer.endsWith('`') ? 1 : 0;
        body += buffer.slice(0, buffer.length - hold);
        buffer = buffer.slice(buffer.length - hold);
        out.push(...progress());
        return out;
      }
      body += buffer.slice(0, close);
      buffer = buffer.slice(close + 3);
      out.push(...progress());
      out.push(...closeFence());
    }
  };

  const finish = (): LopuProviderEvent[] => {
    const out: LopuProviderEvent[] = [];
    if (state === 'text') {
      if (buffer) out.push({ type: 'text', text: buffer });
      buffer = '';
      return out;
    }
    // the model was cut off inside a fence — close it with what we have
    body += buffer;
    buffer = '';
    out.push(...progress());
    out.push(...closeFence());
    return out;
  };

  return { push, finish, calls: () => [...calls], rawText: () => raw };
};

// ---------------------------------------------------------------------------
// Anthropic

type SystemBlocks = { stable: string; volatile: string };

type AnthropicProviderOptions = {
  client: Anthropic;
  choice: AiWorkflowModelChoice;
  system: SystemBlocks;
  history: LopuChatHistoryTurn[];
  text: string;
  signal?: AbortSignal;
};

async function* anthropicProvider(options: AnthropicProviderOptions): LopuProviderStream {
  const { client, choice, signal } = options;
  const tools = anthropicToolDefinitions();
  const system = [
    { type: 'text' as const, text: options.system.stable, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: options.system.volatile }
  ];
  const messages: Anthropic.Messages.MessageParam[] = [
    ...options.history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: options.text }
  ];
  const effort = toAnthropicEffort(choice.effort);
  const usage: LopuChatUsage = { inputTokens: 0, outputTokens: 0 };
  let degraded = false;
  let finalHop = false;

  for (;;) {
    const base = {
      model: choice.model,
      max_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools,
      tool_choice: finalHop ? { type: 'none' as const } : { type: 'auto' as const }
    };
    const requestOptions = signal ? { signal } : {};
    const decorated = !degraded && (choice.speed === 'fast' || !!effort);
    // Fast mode is beta-gated and needs the beta stream surface; a decorated
    // request that fails (or completes empty) before producing anything is
    // retried bare on the same model — and the turn stays bare afterwards.
    const attempts: Array<() => AsyncIterable<any> & { finalMessage: () => Promise<any> }> =
      !decorated
        ? [() => client.messages.stream(base, requestOptions)]
        : choice.speed === 'fast'
          ? [
              () =>
                client.beta.messages.stream(
                  { ...(base as any), ...(effort ? { output_config: { effort } } : {}), speed: 'fast', betas: ['fast-mode-2026-02-01'] },
                  requestOptions
                ),
              () => client.messages.stream(base, requestOptions)
            ]
          : [() => client.messages.stream({ ...base, output_config: { effort: effort! } }, requestOptions), () => client.messages.stream(base, requestOptions)];

    let finalMessage: any = null;
    for (let attempt = 0; attempt < attempts.length; attempt++) {
      let yielded = false;
      const blocks = new Map<number, { id: string; name: string; json: string }>();
      try {
        const stream = attempts[attempt]();
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'tool_use') {
              blocks.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
              yielded = true;
              yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              yielded = true;
              yield { type: 'text', text: event.delta.text };
            } else if (event.delta?.type === 'input_json_delta') {
              const block = blocks.get(event.index);
              if (block) {
                block.json += event.delta.partial_json || '';
                yielded = true;
                if (event.delta.partial_json) yield { type: 'tool_input_delta', id: block.id, name: block.name, partial: event.delta.partial_json };
              }
            } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
              yield { type: 'thinking', text: event.delta.thinking };
            }
          } else if (event.type === 'content_block_stop') {
            const block = blocks.get(event.index);
            if (block) {
              blocks.delete(event.index);
              yield { type: 'tool_use', id: block.id, name: block.name, input: parseToolInput(block.json) };
            }
          }
        }
        finalMessage = await stream.finalMessage();
        // A decorated attempt that completes WITHOUT any content starved its
        // output budget on reasoning — treat it like a failure and fall
        // through to the bare retry rather than ending the turn blank.
        const starved = !yielded && !(finalMessage?.content || []).length;
        if (!starved || attempt === attempts.length - 1) break;
        degraded = true;
      } catch (error) {
        // never retry after emitting (it would duplicate output), and never
        // swallow the last attempt's failure — the provider loop needs it
        if (yielded || attempt === attempts.length - 1 || isAbortError(error)) throw error;
        degraded = true;
      }
    }

    if (!finalMessage) throw new Error('Anthropic stream ended without a final message');
    usage.inputTokens += Number(finalMessage.usage?.input_tokens) || 0;
    usage.outputTokens += Number(finalMessage.usage?.output_tokens) || 0;
    messages.push({ role: 'assistant', content: finalMessage.content as Anthropic.Messages.ContentBlockParam[] });
    const toolUses = (finalMessage.content as any[]).filter((block) => block?.type === 'tool_use');

    if (finalMessage.stop_reason === 'tool_use' && toolUses.length && !finalHop) {
      const feed = yield { type: 'hop_end', stopReason: 'tool_use', usage: { ...usage } };
      if (!feed) return;
      messages.push({
        role: 'user',
        content: feed.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: toolResultText(result),
          ...(result.ok ? {} : { is_error: true })
        }))
      });
      finalHop = feed.finalHop;
      continue;
    }
    yield { type: 'hop_end', stopReason: finalMessage.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn', usage: { ...usage } };
    return;
  }
}

// ---------------------------------------------------------------------------
// OpenAI (chat.completions, native function tools or fenced text tools)

type OpenAiProviderOptions = {
  client: OpenAI;
  choice: AiWorkflowModelChoice;
  systemText: string;
  history: LopuChatHistoryTurn[];
  text: string;
  toolMode: LopuOpenAiToolMode;
  signal?: AbortSignal;
};

// Word-ish pieces so a non-streaming answer still paints progressively.
const splitForReplay = (text: string): string[] => text.match(/\S+\s*|\s+/g) || (text ? [text] : []);

// Replays a plain ChatCompletion as the chunk shapes a streamed completion
// produces (content deltas, indexed tool_calls, a final finish_reason chunk
// carrying usage), so the stream reader below handles both identically.
// Some OpenAI-compatible bridges (the local Codex proxy, for one) let the
// model's own text arrive wrapped in an envelope — a whole
// `{"choices":[{"message":{"content":…}}]}` or just `{"content":"…"}` —
// with the real reply (and any tt-tool fences) escaped inside it. Unwrap up
// to two layers so the user never reads raw JSON; a reply that merely
// contains JSON (in a code fence, mid-sentence) is left alone.
const ENVELOPE_KEYS = ['content', 'text', 'reply', 'output', 'message'] as const;
export const unwrapEnvelopeContent = (content: string): string => {
  let current = content;
  for (let depth = 0; depth < 2; depth++) {
    const trimmed = current.trim();
    // the whole reply as one JSON string literal ("Hello! …", or
    // "```tt-tool\n{\"name\"…" with escapes inside): the bridge's model
    // habitually JSON-encodes its answer, so a reply that is exactly one
    // string literal is decoded (a genuine one-line quotation loses only
    // its quote marks)
    if (trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const decoded = JSON.parse(trimmed);
        if (typeof decoded !== 'string') return current;
        current = decoded;
        continue;
      } catch {
        return current;
      }
    }
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return current;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return current;
    }
    if (!parsed || typeof parsed !== 'object') return current;
    const inner =
      parsed.choices?.[0]?.message?.content ??
      parsed.message?.content ??
      ENVELOPE_KEYS.map((key) => parsed[key]).find((entry) => typeof entry === 'string');
    if (typeof inner !== 'string') return current;
    current = inner;
  }
  return current;
};

// Text-mode endpoints sometimes answer with the tool call itself as the whole
// reply — a bare `{"name":"create_page","input":{…}}` (or a list of them)
// without the tt-tool fence. When every top-level object names a known tool,
// re-fence it so the text parser executes it like a fenced call.
export const wrapBareToolCalls = (content: string): string => {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return content;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const isCall = (value: any) =>
    !!value && typeof value === 'object' && (LOPU_TOOL_NAMES as readonly string[]).includes(typeof value.name === 'string' ? value.name : value.tool);
  if (!calls.length || !calls.every(isCall)) return content;
  return calls.map((call) => `\`\`\`tt-tool\n${JSON.stringify(call)}\n\`\`\``).join('\n');
};

async function* completionAsChunks(completion: unknown, normalize: (content: string) => string = unwrapEnvelopeContent): AsyncGenerator<any, void, unknown> {
  const first = (completion as any)?.choices?.[0];
  const message = first?.message || {};
  const content = typeof message.content === 'string' ? normalize(message.content) : '';
  for (const piece of splitForReplay(content)) yield { choices: [{ delta: { content: piece } }] };
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (let index = 0; index < toolCalls.length; index++) {
    const call = toolCalls[index] || {};
    yield {
      choices: [{ delta: { tool_calls: [{ index, id: call.id, function: { name: call.function?.name, arguments: '' } }] } }]
    };
    const args = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
    if (args) yield { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }] };
  }
  yield {
    choices: [{ delta: {}, finish_reason: first?.finish_reason || 'stop' }],
    ...((completion as any)?.usage ? { usage: (completion as any).usage } : {})
  };
}

async function* openAiProvider(options: OpenAiProviderOptions): LopuProviderStream {
  const { client, choice, signal, toolMode } = options;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.systemText },
    ...options.history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: options.text }
  ];
  const tools = toolMode === 'native' ? openAiToolDefinitions() : null;
  const effort = toOpenAiReasoningEffort(choice.effort);
  const usage: LopuChatUsage = { inputTokens: 0, outputTokens: 0 };
  let degraded = false;
  // set once the plain-completion rung served a hop after streaming was
  // refused, so later hops skip the doomed streaming attempts
  let streamingRefused = false;
  let finalHop = false;
  let callCounter = 0;
  const nextCallId = () => `call_tt_${++callCounter}`;

  for (;;) {
    const base = {
      model: choice.model,
      stream: true as const,
      stream_options: { include_usage: true },
      // Never `max_tokens`: deprecated and incompatible with the o-series /
      // GPT-5 reasoning models an admin can pin; reasoning bills here too.
      max_completion_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS,
      messages,
      ...(tools ? { tools, tool_choice: finalHop ? ('none' as const) : ('auto' as const) } : {})
    };
    const requestOptions = signal ? { signal } : {};
    const decorated = !degraded && (choice.speed === 'fast' || !!effort);
    // Last rung: a plain (non-streaming) completion for OpenAI-compatible
    // endpoints that refuse `stream: true` (the local Codex proxy answers
    // 400 "Streaming is not implemented"); its answer is replayed as chunks
    // so the rest of the loop — and the UI — sees one shape.
    const plainCompletion = () => {
      const { stream_options: _streamOptions, ...plain } = base;
      const normalize = (content: string) => (toolMode === 'text' ? wrapBareToolCalls(unwrapEnvelopeContent(content)) : unwrapEnvelopeContent(content));
      return client.chat.completions.create({ ...plain, stream: false } as any, requestOptions).then((completion) => completionAsChunks(completion, normalize));
    };
    const bareStream = () => client.chat.completions.create(base as any, requestOptions);
    const attempts = streamingRefused
      ? [plainCompletion]
      : decorated
        ? [
            () =>
              client.chat.completions.create(
                { ...base, ...(effort ? { reasoning_effort: effort } : {}), ...(choice.speed === 'fast' ? { service_tier: 'priority' as const } : {}) } as any,
                requestOptions
              ),
            bareStream,
            plainCompletion
          ]
        : [bareStream, plainCompletion];

    let text = '';
    let finish: string | null = null;
    let calls = new Map<number, { id: string; name: string; args: string; started: boolean }>();
    let parser: TtToolTextParser | null = null;

    for (let attempt = 0; attempt < attempts.length; attempt++) {
      let yielded = false;
      text = '';
      finish = null;
      calls = new Map();
      parser = toolMode === 'text' ? createTtToolTextParser({ nextId: nextCallId, mode: finalHop ? 'drop' : 'execute' }) : null;
      try {
        const stream = (await attempts[attempt]()) as unknown as AsyncIterable<any>;
        for await (const chunk of stream) {
          if (chunk?.usage) {
            usage.inputTokens += Number(chunk.usage.prompt_tokens) || 0;
            usage.outputTokens += Number(chunk.usage.completion_tokens) || 0;
          }
          const first = chunk?.choices?.[0];
          if (!first) continue;
          const delta = first.delta || {};
          if (typeof delta.content === 'string' && delta.content) {
            if (parser) {
              for (const event of parser.push(delta.content)) {
                yielded = true;
                yield event;
              }
            } else {
              text += delta.content;
              yielded = true;
              yield { type: 'text', text: delta.content };
            }
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              const index = Number.isInteger(toolCall?.index) ? toolCall.index : 0;
              let entry = calls.get(index);
              if (!entry) {
                entry = { id: toolCall?.id || nextCallId(), name: '', args: '', started: false };
                calls.set(index, entry);
              } else if (toolCall?.id && !entry.id) {
                entry.id = toolCall.id;
              }
              if (toolCall?.function?.name && !entry.name) entry.name = toolCall.function.name;
              if (entry.name && !entry.started) {
                entry.started = true;
                yielded = true;
                yield { type: 'tool_use_start', id: entry.id, name: entry.name };
              }
              if (typeof toolCall?.function?.arguments === 'string' && toolCall.function.arguments) {
                entry.args += toolCall.function.arguments;
                yielded = true;
                if (entry.started) yield { type: 'tool_input_delta', id: entry.id, name: entry.name, partial: toolCall.function.arguments };
              }
            }
          }
          if (first.finish_reason) finish = first.finish_reason;
        }
        if (parser) {
          for (const event of parser.finish()) {
            yielded = true;
            yield event;
          }
          text = parser.rawText();
        }
        // same starvation rule as Claude: an empty decorated completion falls
        // through to the bare retry before the provider is given up on
        if (yielded || attempt === attempts.length - 1) {
          // the plain rung answered after a streaming attempt failed: this
          // endpoint does not stream — go straight there on later hops
          if (attempts[attempt] === plainCompletion && attempt > 0) streamingRefused = true;
          break;
        }
        degraded = true;
      } catch (error) {
        if (yielded || attempt === attempts.length - 1 || isAbortError(error)) throw error;
        degraded = true;
      }
    }

    const nativeCalls = [...calls.values()].filter((entry) => entry.name);
    for (const entry of nativeCalls) {
      if (!entry.started) {
        entry.started = true;
        yield { type: 'tool_use_start', id: entry.id, name: entry.name };
      }
      yield { type: 'tool_use', id: entry.id, name: entry.name, input: parseToolInput(entry.args) };
    }
    const textCalls = parser ? parser.calls() : [];
    const requested = nativeCalls.length + textCalls.length;

    if (requested && !finalHop) {
      if (tools) {
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: nativeCalls.map((entry) => ({ id: entry.id, type: 'function' as const, function: { name: entry.name, arguments: entry.args || '{}' } }))
        });
      } else {
        messages.push({ role: 'assistant', content: text });
      }
      const feed = yield { type: 'hop_end', stopReason: 'tool_use', usage: { ...usage } };
      if (!feed) return;
      if (tools) {
        for (const result of feed.results) messages.push({ role: 'tool', tool_call_id: result.id, content: toolResultText(result) });
      } else {
        const blocks = feed.results.map(
          (result) => `\`\`\`tt-tool-result\n${boundedJson({ id: result.id, name: result.name, ...toolResultPayload(result) }, { id: result.id, name: result.name, ok: result.ok, summary: result.summary })}\n\`\`\``
        );
        messages.push({
          role: 'user',
          content: `Tool results:\n${blocks.join('\n')}\n${
            feed.finalHop
              ? 'The tool budget for this turn is spent — reply in plain text only, without tt-tool blocks.'
              : 'Continue. Text outside tt-tool fences is shown to the user.'
          }`
        });
      }
      finalHop = feed.finalHop;
      continue;
    }
    yield { type: 'hop_end', stopReason: finish === 'length' ? 'max_tokens' : 'end_turn', usage: { ...usage } };
    return;
  }
}

// ---------------------------------------------------------------------------
// the tool loop

type TurnState = {
  text: string;
  toolCalls: LopuToolCallSummary[];
  usage: LopuChatUsage;
  hops: number;
  toolExecutions: number;
  stopReason: LopuChatStopReason;
  error?: string;
};

const newTurnState = (): TurnState => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, hops: 0, toolExecutions: 0, stopReason: 'end_turn' });

// A tiny async channel: tool executors push events while the loop drains
// them in arrival order, so patches paint the moment a tool finishes even
// when several tools run in parallel.
const createChannel = <T>() => {
  const items: T[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const waitForWake = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  return {
    push(item: T) {
      items.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        while (items.length) yield items.shift() as T;
        if (closed) return;
        await waitForWake();
        wake = null;
      }
    }
  };
};

const thingIdOf = (result: LopuToolResult): string | undefined => {
  if (!result.ok || !result.data || typeof result.data !== 'object') return undefined;
  const data = result.data as any;
  if (typeof data.pageId === 'string') return data.pageId;
  if (data.thing && typeof data.thing.id === 'string') return data.thing.id;
  if (typeof data.entryPageId === 'string') return data.entryPageId;
  return undefined;
};

const summarise = (text: string, max = 240): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type LoopOptions = {
  provider: LopuProviderStream;
  ctx: LopuToolContext;
  deps: LopuChatDependencies;
  state: TurnState;
  startedAt: number;
  signal?: AbortSignal;
  toolsAllowed: boolean;
};

async function* runToolLoop(options: LoopOptions): AsyncGenerator<LopuChatStreamEvent, void> {
  const { provider, ctx, deps, state, startedAt, signal } = options;
  let pending: LopuToolCall[] = [];
  let feed: LopuProviderHopInput | undefined;
  let finalRequested = false;

  const budgetLeft = () => LOPU_CHAT_MAX_TOOL_EXECUTIONS - state.toolExecutions;
  const timeLeft = () => LOPU_CHAT_MAX_TURN_MS - (deps.now() - startedAt);

  for (;;) {
    if (signal?.aborted) {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    }
    const step = await provider.next(feed);
    feed = undefined;
    // `=== true`: with strictNullChecks off, a truthiness check on the optional
    // `done` discriminant does not narrow IteratorResult
    if (step.done === true) return;
    const event = step.value;
    switch (event.type) {
      case 'text':
        state.text += event.text;
        yield { type: 'delta', text: event.text };
        break;
      case 'thinking':
        yield { type: 'thinking', text: event.text };
        break;
      case 'tool_use_start':
        yield { type: 'tool_use_start', id: event.id, name: event.name };
        break;
      case 'tool_input_delta':
        yield { type: 'tool_input_delta', id: event.id, name: event.name, partial: event.partial };
        break;
      case 'tool_use':
        pending.push({ id: event.id, name: event.name, input: event.input });
        yield { type: 'tool_use', id: event.id, name: event.name, input: event.input };
        break;
      case 'hop_end': {
        state.hops += 1;
        if (event.usage) state.usage = { ...event.usage };
        if (event.stopReason === 'max_tokens') state.stopReason = 'max_tokens';
        if (event.stopReason !== 'tool_use' || !pending.length) {
          // the provider is done (it returns on the next resume)
          if (pending.length) {
            for (const call of pending) yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: 'Not run — this turn ended before the tool could execute' };
            pending = [];
          }
          break;
        }
        if (finalRequested || !options.toolsAllowed) {
          // the final text hop asked for tools anyway — refuse politely
          for (const call of pending) yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: 'Not run — the tool budget for this turn is spent' };
          pending = [];
          break;
        }

        const left = Math.max(0, budgetLeft());
        const toRun = pending.slice(0, left);
        const refused = pending.slice(left);
        pending = [];

        const channel = createChannel<LopuChatStreamEvent>();
        ctx.emit = (toolEvent: LopuToolEvent) => channel.push(toolEvent);
        const results: LopuProviderToolResult[] = [];
        const runs = Promise.all(
          toRun.map(async (call) => {
            const result = await deps.runTool(call, ctx);
            state.toolExecutions += 1;
            state.toolCalls.push({
              name: call.name,
              ok: result.ok,
              summary: summarise(result.ok === true ? result.summary : result.error),
              ...(thingIdOf(result) ? { thingId: thingIdOf(result) } : {})
            });
            const entry: LopuProviderToolResult = result.ok === true
              ? { id: call.id, name: call.name, ok: true, summary: result.summary, ...(result.data !== undefined ? { data: boundToolData(result.data) } : {}) }
              : { id: call.id, name: call.name, ok: false, summary: result.error, error: result.error };
            results.push(entry);
            channel.push({ type: 'tool_result', id: call.id, name: call.name, ok: entry.ok, summary: entry.summary, ...(entry.ok && entry.data !== undefined ? { data: entry.data } : {}) });
          })
        );
        runs.then(
          () => channel.close(),
          () => channel.close()
        );
        for await (const toolEvent of channel.drain()) yield toolEvent;
        await runs;
        for (const call of refused) {
          const error = `Not run — Lopu may run at most ${LOPU_CHAT_MAX_TOOL_EXECUTIONS} tools per reply. Summarise what is done and ask the user to continue in a new message.`;
          results.push({ id: call.id, name: call.name, ok: false, summary: error, error });
          state.toolCalls.push({ name: call.name, ok: false, summary: summarise(error) });
          yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: error };
        }
        // keep the provider's order so tool_result blocks line up with its tool_use ids
        const order = new Map([...toRun, ...refused].map((call, index) => [call.id, index]));
        results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

        const overBudget = refused.length > 0 || budgetLeft() <= 0;
        const outOfTime = timeLeft() <= 0;
        const outOfHops = state.hops >= LOPU_CHAT_MAX_HOPS - 1;
        if (overBudget) {
          state.stopReason = 'tool_limit';
          yield { type: 'error', message: `Lopu hit the ${LOPU_CHAT_MAX_TOOL_EXECUTIONS}-tool limit for one reply — wrapping up.`, retryable: true };
        } else if (outOfTime) {
          state.stopReason = 'time_limit';
          yield { type: 'error', message: 'Lopu ran out of time for this reply — wrapping up.', retryable: true };
        } else if (outOfHops) {
          state.stopReason = 'hop_limit';
        }
        finalRequested = overBudget || outOfTime || outOfHops;
        feed = { results, finalHop: finalRequested };
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// fallback

const chunkWords = (text: string): string[] => text.match(/\S+\s*/g) || [text];

export const LOPU_FALLBACK_UNCONFIGURED =
  'Lopu is resting her horn — no AI provider is configured yet. Ask an admin to add ANTHROPIC_API_KEY (or OPENAI_API_KEY) to this deployment and I will come alive 🦄';
export const LOPU_FALLBACK_FAILED = 'Lopu is daydreaming… every AI provider stumbled just now. Give it a moment and try again 🔮';
// A vault turn never falls back to the server keys — the user chose their own
// provider — so its canned line points at the connection instead.
export const LOPU_FALLBACK_VAULT = 'Lopu could not get a reply from your own provider just now. Check the connection in Settings → Secure Vault, or pick a Thingtime model to keep going 🔮';

async function* streamFallbackReply(kind: 'unconfigured' | 'failed' | 'vault', paceMs: number): AsyncGenerator<LopuChatStreamEvent, string> {
  const line = kind === 'unconfigured' ? LOPU_FALLBACK_UNCONFIGURED : kind === 'vault' ? LOPU_FALLBACK_VAULT : LOPU_FALLBACK_FAILED;
  for (const chunk of chunkWords(line)) {
    yield { type: 'delta', text: chunk };
    if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
  }
  return line;
}

// ---------------------------------------------------------------------------
// the turn

const labelFor = (provider: LopuChatProvider, choice: AiWorkflowModelChoice | null): string =>
  provider === 'fallback'
    ? 'Lopu (offline)'
    : provider === 'test'
      ? 'Lopu (test provider)'
      : provider === 'vault'
        ? choice?.label || 'Your provider'
        : choice?.label || choice?.model || provider;

const vaultClientOptions = (config: LopuVaultProviderClientConfig): AnthropicClientOptions & OpenAiClientOptions => ({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
  // never let the server's own credentials ride along on a user's endpoint:
  // the SDKs read ANTHROPIC_AUTH_TOKEN / OPENAI_ORG_ID / OPENAI_PROJECT_ID /
  // OPENAI_ADMIN_KEY from the env unless told not to
  authToken: null,
  organization: null,
  project: null,
  adminAPIKey: null,
  fetch: createGuardedProviderFetch(),
  maxRetries: 1,
  timeout: LOPU_PROVIDER_TIMEOUT_MS
});

export async function* streamLopuChatTurn(input: LopuChatTurnInput): AsyncGenerator<LopuChatStreamEvent, LopuChatTurnOutcome> {
  const deps: LopuChatDependencies = { ...defaultDependencies(), ...(input.deps || {}) };
  const startedAt = deps.now();
  const history = normaliseHistory(input.history);
  const explicit = input.choice ?? null;

  const meta = (provider: LopuChatProvider, choice: AiWorkflowModelChoice | null, model?: string, providerLabel?: string): LopuChatStreamEvent => ({
    type: 'meta',
    chatId: input.chatId,
    userMessageId: input.userMessageId,
    requestId: input.requestId,
    model: model ?? choice?.model ?? null,
    effort: choice?.effort ?? null,
    speed: choice?.speed ?? 'normal',
    provider,
    label: labelFor(provider, choice),
    ...(providerLabel ? { providerLabel } : {})
  });

  const outcome = (provider: LopuChatProvider, choice: AiWorkflowModelChoice | null, state: TurnState, model?: string): LopuChatTurnOutcome => ({
    text: state.text,
    provider,
    model: model ?? choice?.model ?? null,
    effort: choice?.effort ?? null,
    speed: choice?.speed ?? 'normal',
    usage: state.usage,
    toolCalls: state.toolCalls,
    stopReason: state.stopReason,
    ...(state.error ? { error: state.error } : {})
  });

  const makeContext = (): LopuToolContext => createLopuToolContext(input.viewer, input.context, () => {});

  // --- the viewer's own provider (Secure Vault, design note §1.3) --------
  // Takes precedence over every mode, LOPU_CHAT_PROVIDER=test included: the
  // user chose this connection for the turn. meta is emitted before dialing
  // (provider 'vault' + the connection's name) so the client can show "via
  // <name>" at once; a failure then surfaces as an error event and the
  // canned vault line — the server keys are never used as a fallback here.
  if (input.vaultProvider) {
    const entry = input.vaultProvider;
    const requestedModel = entry.requestedModel ?? explicit?.model ?? null;
    const vaultChoice = (model: string): AiWorkflowModelChoice => ({
      id: model,
      model,
      label: `${entry.name} · ${model}`,
      provider: vaultProviderTransport(entry.provider),
      effort: entry.effort ?? null,
      speed: 'normal'
    });
    const state = newTurnState();
    const vaultFailure = async function* (model: string | null, error: unknown): AsyncGenerator<LopuChatStreamEvent, LopuChatTurnOutcome> {
      const message = friendlyVaultProviderError(entry.name, model, error);
      console.error(`[lopu] vault provider "${entry.name}" failed before replying:`, (error as any)?.message || error);
      yield { type: 'error', message, retryable: true };
      state.text = yield* streamFallbackReply('vault', deps.fallbackPaceMs);
      state.stopReason = 'fallback';
      state.error = message.slice(0, 300);
      return outcome('fallback', model ? vaultChoice(model) : null, state, model ?? undefined);
    };

    let config: LopuVaultProviderClientConfig;
    try {
      config = await deps.resolveVaultProviderClient(entry, { model: requestedModel });
    } catch (error) {
      const model = resolveVaultTurnModel(entry.model, requestedModel);
      yield meta('vault', model ? vaultChoice(model) : null, undefined, entry.name);
      return yield* vaultFailure(model, error);
    }
    const choice = vaultChoice(config.model);
    yield meta('vault', choice, undefined, entry.name);

    const ctx = makeContext();
    const toolProtocol: LopuToolProtocol = config.transport === 'anthropic' ? 'native' : config.toolProtocol;
    const prompt = buildLopuSystemPrompt({ viewer: { username: input.viewer.username }, context: ctx.context, activePage: ctx.activePage, toolProtocol });
    const options = vaultClientOptions(config);
    const provider =
      config.transport === 'anthropic'
        ? anthropicProvider({ client: deps.createAnthropic(options), choice, system: { stable: prompt.stable, volatile: prompt.volatile }, history, text: input.text, signal: input.signal })
        : openAiProvider({ client: deps.createOpenAi(options), choice, systemText: prompt.text, history, text: input.text, toolMode: config.toolProtocol, signal: input.signal });
    const loop = runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true });

    let first: IteratorResult<LopuChatStreamEvent, void>;
    try {
      first = await loop.next();
    } catch (error) {
      if (isAbortError(error)) {
        state.stopReason = 'aborted';
        return outcome('vault', choice, state);
      }
      return yield* vaultFailure(config.model, error);
    }
    if (first.done === true) return yield* vaultFailure(config.model, new Error('The provider returned an empty reply.'));
    yield first.value;
    try {
      for (;;) {
        const step = await loop.next();
        if (step.done === true) break;
        yield step.value;
      }
    } catch (error) {
      if (isAbortError(error)) state.stopReason = 'aborted';
      else {
        console.error(`[lopu] vault provider "${entry.name}" failed mid-reply:`, (error as any)?.message || error);
        state.stopReason = 'error';
        state.error = friendlyVaultProviderError(entry.name, config.model, error).slice(0, 300);
        yield { type: 'error', message: `${friendlyVaultProviderError(entry.name, config.model, error)} What streamed so far is kept.`, retryable: true };
      }
    }
    return outcome('vault', choice, state);
  }

  // --- deterministic scripted provider ---------------------------------
  if (lopuChatProviderMode() === 'test') {
    const ctx = makeContext();
    const state = newTurnState();
    const provider = createLopuTestProvider({ userText: input.text, activePage: ctx.activePage, paceMs: deps.testPaceMs });
    yield meta('test', explicit, 'test');
    try {
      yield* runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true });
    } catch (error) {
      if (isAbortError(error)) state.stopReason = 'aborted';
      else {
        state.stopReason = 'error';
        state.error = String((error as any)?.message || error);
        yield { type: 'error', message: 'Lopu lost the thread mid-reply — try again.', retryable: true };
      }
    }
    return outcome('test', explicit, state, 'test');
  }

  // --- real providers ----------------------------------------------------
  let attempts: ProviderAttempt[] = [];
  try {
    attempts = await planProviderAttempts(explicit, deps);
  } catch {
    attempts = [];
  }

  if (!attempts.length) {
    const state = newTurnState();
    yield meta('fallback', null);
    state.text = yield* streamFallbackReply('unconfigured', deps.fallbackPaceMs);
    state.stopReason = 'fallback';
    return outcome('fallback', null, state);
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const ctx = makeContext();
    const state = newTurnState();
    const toolMode = lopuOpenAiToolMode();
    const toolProtocol: LopuToolProtocol = attempt.provider === 'openai' && toolMode === 'text' ? 'text' : 'native';
    const prompt = buildLopuSystemPrompt({ viewer: { username: input.viewer.username }, context: ctx.context, activePage: ctx.activePage, toolProtocol });
    const provider =
      attempt.provider === 'claude'
        ? anthropicProvider({ client: deps.createAnthropic(), choice: attempt.choice, system: { stable: prompt.stable, volatile: prompt.volatile }, history, text: input.text, signal: input.signal })
        : openAiProvider({ client: deps.createOpenAi(), choice: attempt.choice, systemText: prompt.text, history, text: input.text, toolMode, signal: input.signal });
    const loop = runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true });

    // Pull the first event inside the try so a provider failing before any
    // output (bad key, no credits, rejected model) falls through cleanly to
    // the next configured provider — exactly like the musing stream.
    let first: IteratorResult<LopuChatStreamEvent, void>;
    try {
      first = await loop.next();
    } catch (error) {
      if (isAbortError(error)) {
        state.stopReason = 'aborted';
        return outcome(attempt.provider, attempt.choice, state);
      }
      lastError = error;
      console.error(`[lopu] ${attempt.provider} failed before replying:`, (error as any)?.message || error);
      continue;
    }
    // a provider that ends without producing anything is a failed attempt,
    // not an empty reply — try the next one
    if (first.done === true) continue;

    yield meta(attempt.provider, attempt.choice);
    yield first.value;
    try {
      for (;;) {
        const step = await loop.next();
        if (step.done === true) break;
        yield step.value;
      }
    } catch (error) {
      if (isAbortError(error)) state.stopReason = 'aborted';
      else {
        console.error(`[lopu] ${attempt.provider} failed mid-reply:`, (error as any)?.message || error);
        state.stopReason = 'error';
        state.error = String((error as any)?.message || error).slice(0, 300);
        yield { type: 'error', message: 'Lopu lost the thread mid-reply — what streamed so far is kept. Try again.', retryable: true };
      }
    }
    return outcome(attempt.provider, attempt.choice, state);
  }

  // every provider failed before saying anything — never leave the user empty-handed
  const state = newTurnState();
  yield meta('fallback', null);
  state.text = yield* streamFallbackReply('failed', deps.fallbackPaceMs);
  state.stopReason = 'fallback';
  state.error = lastError ? String((lastError as any)?.message || lastError).slice(0, 300) : undefined;
  return outcome('fallback', null, state);
}
