import { anthropicMediaContent, isLopuImage, openAiMediaContent, type LopuMedia } from './chatMedia';
import { recordErrorLog } from '../errors/errorLogs';
import { lopuResultLinks } from '~/utils/lopuLinks';
import { createClaudeOAuthClient, claudeOAuthConfigured } from '../ai/claudeOAuth';
import { createTtToolTextParser, type TtToolTextParser } from './toolTextParser';
import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { parsePartialJson } from '~/utils/partialJson';
import { addCacheTokens } from '../ai/pricing';
import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import { billingForProvider } from './accessCore';
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
  type LopuApprovedAction,
  type LopuConfirmationAction,
  type LopuConfirmationGrant,
  type LopuToolCall,
  type LopuToolContext,
  type LopuToolEvent,
  type LopuToolResult,
  type LopuToolViewer
} from './chatTools';
import { mintLopuConfirmation } from './confirmations';
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
//   - Claude OAuth credentials → Claude with native tools
//   - OPENAI_API_KEY → Responses for native GPT-5.6 Sol tools, otherwise
//     ChatGPT-compatible chat.completions; LOPU_OPENAI_TOOLS
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
// A serverless request is an execution window, never a deadline for the task.
// Yield only BETWEEN completed tool batches so no in-flight mutation is cut off.
// The client resumes saved checkpoints without a continuation-count limit.
export const LOPU_HOSTED_CHECKPOINT_MS = 60_000;
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
  anthropic: claudeOAuthConfigured(),
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
  // the server-signed grant behind a destructive tool's Confirm card
  mintConfirmation: (input: { userId: string; chatId: string; action: LopuConfirmationAction }) => Promise<LopuConfirmationGrant>;
  now: () => number;
  // ms between canned-fallback word chunks (0 in tests)
  fallbackPaceMs: number;
  testPaceMs?: number;
};

export type LopuChatTurnInput = {
  readNotes?: () => Promise<string[]>;
  readOnly?: boolean;
  viewer: LopuToolViewer;
  chatId: string;
  userMessageId: string;
  requestId: string;
  text: string;
  media?: LopuMedia[];
  history?: LopuChatHistoryTurn[];
  // the resolved model choice for this turn (null = no provider configured)
  choice?: AiWorkflowModelChoice | null;
  // the viewer's own Secure Vault provider for this turn (design note §1.3):
  // when set the turn runs there instead of on the server keys, which are
  // never used as a fallback
  vaultProvider?: LopuVaultTurnProvider | null;
  context?: LopuChatContext | null;
  // destructive actions the user approved for this reply — the route
  // verified their grants (confirmations.ts) before handing them over
  approvedConfirmations?: LopuApprovedAction[] | null;
  signal?: AbortSignal;
  deps?: Partial<LopuChatDependencies>;
};

const defaultDependencies = (): LopuChatDependencies => ({
  runTool: runLopuTool,
  getPreferredModelWaterfall: getAiPreferredModelWaterfall,
  createAnthropic: (options) => createClaudeOAuthClient(typeof options?.apiKey === 'string' ? { token: options.apiKey } : {}),
  createOpenAi: (options) => (options ? new OpenAI(options) : new OpenAI()),
  resolveVaultProviderClient: resolveVaultProviderClientConfig,
  mintConfirmation: mintLopuConfirmation,
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
  const primary: 'claude' | 'openai' = explicitProvider ?? (mode === 'openai' ? 'openai' : 'claude');
  const order: Array<'claude' | 'openai'> = explicitProvider ? [explicitProvider] : primary === 'claude' ? ['claude', 'openai'] : ['openai', 'claude'];
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

export { createTtToolTextParser } from './toolTextParser';

// ---------------------------------------------------------------------------
// Anthropic

type SystemBlocks = { stable: string; volatile: string };

type AnthropicProviderOptions = {
  client: Anthropic;
  choice: AiWorkflowModelChoice;
  system: SystemBlocks;
  history: LopuChatHistoryTurn[];
  text: string;
  media?: LopuMedia[];
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
    { role: 'user', content: anthropicMediaContent(options.text, options.media) }
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
    // Preserve the chosen effort and speed. Credential retries happen inside
    // the OAuth runtime; a failure must not silently downgrade the model knobs.
    const attempts: Array<() => AsyncIterable<any> & { finalMessage: () => Promise<any> }> = [() =>
      choice.speed === 'fast'
        ? client.beta.messages.stream({ ...(base as any), ...(effort ? { output_config: { effort } } : {}), speed: 'fast', betas: ['fast-mode-2026-02-01'] }, requestOptions)
        : client.messages.stream({ ...base, ...(effort ? { output_config: { effort } } : {}) }, requestOptions)
    ];

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
    // Anthropic reports cache tokens beside (not inside) input_tokens
    addCacheTokens(usage, (finalMessage.usage as any)?.cache_read_input_tokens, (finalMessage.usage as any)?.cache_creation_input_tokens);
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
      for (const note of feed.notes ?? []) messages.push({ role: 'user', content: note });
      finalHop = feed.finalHop;
      continue;
    }
    if (finalMessage.stop_reason === 'pause_turn') {
      // The provider has saved its server-tool state in this assistant content.
      // Resume that exact message; a pause is not a completed user request.
      yield { type: 'hop_end', stopReason: 'pause_turn', usage: { ...usage } };
      continue;
    }
    const next = yield { type: 'hop_end', stopReason: ['max_tokens', 'model_context_window_exceeded'].includes(finalMessage.stop_reason) ? 'max_tokens' : 'end_turn', usage: { ...usage } };
    if (!next?.notes?.length) return;
    for (const note of next.notes) messages.push({ role: 'user', content: note });
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
  media?: LopuMedia[];
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

// GPT-5.6 Sol rejects native tools plus reasoning on Chat Completions. Keep
// this explicit: compatible custom/text endpoints and other model contracts
// retain their existing transport. Never repair it by dropping chosen effort.
async function* openAiResponsesProvider(options: OpenAiProviderOptions): LopuProviderStream {
  const { client, choice, signal } = options;
  const input: OpenAI.Responses.ResponseInput = [
    ...options.history.map((turn) => ({ role: turn.role, content: turn.text })),
    {
      role: 'user',
      content: [
        { type: 'input_text', text: options.text || 'Please inspect the attached files.' },
        ...(options.media || []).map((file): OpenAI.Responses.ResponseInputContent => isLopuImage(file.contentType)
          ? { type: 'input_image', image_url: `data:${file.contentType};base64,${file.data}`, detail: 'auto' }
          : { type: 'input_file', filename: file.name, file_data: `data:application/pdf;base64,${file.data}` })
      ]
    }
  ];
  const tools: OpenAI.Responses.FunctionTool[] = openAiToolDefinitions().map((tool) => ({
    type: 'function', ...tool.function, strict: false
  }));
  const effort = toOpenAiReasoningEffort(choice.effort);
  const usage: LopuChatUsage = { inputTokens: 0, outputTokens: 0 };
  const acceptedCallIds = new Set<string>();
  const acceptedItemIds = new Set<string>();
  let finalHop = false;

  for (;;) {
    signal?.throwIfAborted();
    const stream = await client.responses.create({
      model: choice.model,
      instructions: options.systemText,
      input,
      tools,
      tool_choice: finalHop ? 'none' : 'auto',
      max_output_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS,
      stream: true,
      // Do not create stored provider conversations. Carry encrypted reasoning
      // between tool hops in this generator only, never in client events/history.
      store: false,
      include: ['reasoning.encrypted_content'],
      ...(effort ? { reasoning: { effort } } : {}),
      ...(choice.speed === 'fast' ? { service_tier: 'priority' as const } : {})
    }, signal ? { signal } : {});
    let completed: OpenAI.Responses.Response | null = null;
    const started = new Map<string, { id: string; name: string }>();
    const startedCallItems = new Map<string, string>();
    for await (const event of stream) {
      signal?.throwIfAborted();
      if (event.type === 'response.output_text.delta' && event.delta) {
        yield { type: 'text', text: event.delta };
      } else if (event.type === 'response.refusal.delta' && event.delta) {
        yield { type: 'text', text: event.delta };
      } else if (event.type === 'response.output_item.added' && event.item.type === 'function_call') {
        const call = event.item;
        const prior = call.id ? started.get(call.id) : undefined;
        if (!call.id || !call.call_id || !call.name ||
          acceptedCallIds.has(call.call_id) || acceptedItemIds.has(call.id) ||
          (prior && (prior.id !== call.call_id || prior.name !== call.name)) ||
          (startedCallItems.has(call.call_id) && startedCallItems.get(call.call_id) !== call.id)) {
          throw new Error('The selected model returned inconsistent tool call identifiers.');
        }
        if (!prior) {
          started.set(call.id, { id: call.call_id, name: call.name });
          startedCallItems.set(call.call_id, call.id);
          yield { type: 'tool_use_start', id: call.call_id, name: call.name };
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const call = started.get(event.item_id);
        if (call && event.delta) yield { type: 'tool_input_delta', ...call, partial: event.delta };
      } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        completed = event.response;
      } else if (event.type === 'response.failed' || event.type === 'error') {
        throw new Error('The selected model could not finish its response.');
      }
    }
    signal?.throwIfAborted();
    // A dropped stream or unfinished function argument is never permission to
    // execute a tool or to repeat a possibly accepted provider request.
    if (!completed || !['completed', 'incomplete'].includes(completed.status)) {
      throw new Error('The selected model response ended before completion.');
    }
    if (completed.usage) {
      const cached = Math.max(0, Number(completed.usage.input_tokens_details?.cached_tokens) || 0);
      usage.inputTokens += Math.max(0, (Number(completed.usage.input_tokens) || 0) - cached);
      usage.outputTokens += Number(completed.usage.output_tokens) || 0;
      addCacheTokens(usage, cached, undefined);
    }
    if (completed.status === 'incomplete') {
      if (completed.incomplete_details?.reason !== 'max_output_tokens') {
        throw new Error('The selected model could not finish its response.');
      }
      yield { type: 'hop_end', stopReason: 'max_tokens', usage: { ...usage } };
      return;
    }
    const calls = completed.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call');
    if (calls.some((call) => !call.id || !call.call_id || !call.name || (call.status && call.status !== 'completed'))) {
      throw new Error('The selected model returned an unfinished tool call.');
    }
    if (new Set(calls.map((call) => call.call_id)).size !== calls.length || new Set(calls.map((call) => call.id)).size !== calls.length) {
      throw new Error('The selected model returned duplicate tool call identifiers.');
    }
    for (const call of calls) {
      const prior = started.get(call.id);
      if ((prior && (prior.id !== call.call_id || prior.name !== call.name)) ||
        (startedCallItems.has(call.call_id) && startedCallItems.get(call.call_id) !== call.id) ||
        acceptedCallIds.has(call.call_id) || acceptedItemIds.has(call.id)) {
        throw new Error('The selected model returned inconsistent tool call identifiers.');
      }
    }
    const parsedCalls = calls.map((call) => {
      // Validate the entire batch before handing any call to the executor.
      // Keep provider argument fragments out of persisted error diagnostics.
      try {
        return { call, input: JSON.parse(call.arguments) as unknown };
      } catch {
        throw new Error('The selected model returned invalid tool arguments.');
      }
    });
    for (const item of completed.output) {
      // Only custom function tools are offered. Refuse an unexpected hosted
      // tool surface rather than silently discarding its continuation state.
      if (item.type !== 'message' && item.type !== 'reasoning' && item.type !== 'function_call') {
        throw new Error('The selected model returned an unsupported response item.');
      }
      input.push(item);
    }
    if (calls.length && !finalHop) {
      for (const { call, input: toolInput } of parsedCalls) {
        acceptedCallIds.add(call.call_id);
        acceptedItemIds.add(call.id);
        if (!call.id || !started.has(call.id)) yield { type: 'tool_use_start', id: call.call_id, name: call.name };
        yield { type: 'tool_use', id: call.call_id, name: call.name, input: toolInput };
      }
      const feed = yield { type: 'hop_end', stopReason: 'tool_use', usage: { ...usage } };
      if (!feed) return;
      for (const result of feed.results) input.push({ type: 'function_call_output', call_id: result.id, output: toolResultText(result) });
      for (const note of feed.notes ?? []) input.push({ role: 'user', content: note });
      finalHop = feed.finalHop;
      continue;
    }
    const next = yield { type: 'hop_end', stopReason: 'end_turn', usage: { ...usage } };
    if (!next?.notes?.length) return;
    for (const note of next.notes) input.push({ role: 'user', content: note });
  }
}

async function* openAiProvider(options: OpenAiProviderOptions): LopuProviderStream {
  if (options.toolMode === 'native' && options.choice.model === 'gpt-5.6-sol') {
    return yield* openAiResponsesProvider(options);
  }
  const { client, choice, signal, toolMode } = options;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.systemText },
    ...options.history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: openAiMediaContent(options.text, options.media) }
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
            // OpenAI counts cached prompt tokens INSIDE prompt_tokens; keep
            // inputTokens as the uncached share so pricing never bills twice
            const cached = Math.max(0, Number(chunk.usage.prompt_tokens_details?.cached_tokens) || 0);
            usage.inputTokens += Math.max(0, (Number(chunk.usage.prompt_tokens) || 0) - cached);
            usage.outputTokens += Number(chunk.usage.completion_tokens) || 0;
            addCacheTokens(usage, cached, undefined);
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
      for (const note of feed.notes ?? []) messages.push({ role: 'user', content: note });
      finalHop = feed.finalHop;
      continue;
    }
    const next = yield { type: 'hop_end', stopReason: finish === 'length' ? 'max_tokens' : 'end_turn', usage: { ...usage } };
    if (!next?.notes?.length) return;
    messages.push({ role: 'assistant', content: text });
    for (const note of next.notes) messages.push({ role: 'user', content: note });
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
  readNotes?: () => Promise<string[]>;
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
  let wireChars = 0;

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
    wireChars += JSON.stringify(event).length;
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
          const notes = event.stopReason === 'end_turn' ? await options.readNotes?.() : undefined;
          if (notes?.length) feed = { results: [], finalHop: false, notes };
          // Resume with notes only after the current provider request finishes.
          if (pending.length) {
            for (const call of pending) yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: 'Not run — this turn ended before the tool could execute' };
            pending = [];
          }
          break;
        }
        if (!options.toolsAllowed) {
          // tools are disabled for this request
          for (const call of pending) yield { type: 'tool_result', id: call.id, name: call.name, ok: false, summary: 'Not run — tools are disabled for this request' };
          pending = [];
          break;
        }

        const toRun = pending;
        pending = [];

        const channel = createChannel<LopuChatStreamEvent>();
        ctx.emit = (toolEvent: LopuToolEvent) => channel.push(toolEvent);
        const results: LopuProviderToolResult[] = [];
        const runs = Promise.allSettled(
          toRun.map(async (call) => {
            const result = await deps.runTool(call, ctx);
            state.toolExecutions += 1;
            state.toolCalls.push({
              name: call.name,
              ok: result.ok,
              summary: summarise(result.ok === true ? result.summary : result.error),
              ...(thingIdOf(result) ? { thingId: thingIdOf(result) } : {}),
              ...(result.ok ? { links: lopuResultLinks(result.data) } : {})
            });
            const entry: LopuProviderToolResult = result.ok === true
              ? { id: call.id, name: call.name, ok: true, summary: result.summary, ...(result.data !== undefined ? { data: boundToolData(result.data) } : {}) }
              : { id: call.id, name: call.name, ok: false, summary: result.error, error: result.error };
            results.push(entry);
            channel.push({
              type: 'tool_result',
              id: call.id,
              name: call.name,
              ok: entry.ok,
              summary: entry.summary,
              ...(entry.ok && entry.data !== undefined ? { data: entry.data } : {}),
              ...(result.ok === false && result.needsConfirmation ? { needsConfirmation: true } : {})
            });
          })
        );
        runs.then(
          () => channel.close(),
          () => channel.close()
        );
        for await (const toolEvent of channel.drain()) yield toolEvent;
        const settled = await runs;
        const failed = settled.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        // keep the provider's order so tool_result blocks line up with its tool_use ids
        const order = new Map(toRun.map((call, index) => [call.id, index]));
        results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

        // Checkpoint before another provider request on finite-lifetime hosts,
        // and rotate large streams on every host. Neither limits total work.
        // Account/persistence completes before the client sees done.
        const hostedCheckpoint = process.env.VERCEL === '1' && deps.now() - startedAt >= LOPU_HOSTED_CHECKPOINT_MS;
        if (hostedCheckpoint || wireChars >= 256 * 1024) {
          state.stopReason = 'checkpoint';
          await provider.return();
          return;
        }
        feed = { results, finalHop: false, notes: await options.readNotes?.() };
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
  'Lopu is resting its horn — no AI provider is configured yet. Ask an admin to add Claude OAuth credentials (or OPENAI_API_KEY) to this deployment and I will come alive 🦄';
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
  // OpenAI SDKs read OPENAI_ORG_ID / OPENAI_PROJECT_ID /
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
    ...(providerLabel ? { providerLabel } : {}),
    billing: billingForProvider(provider)
  });

  const outcome = (provider: LopuChatProvider, choice: AiWorkflowModelChoice | null, state: TurnState, model?: string, providerLabel?: string): LopuChatTurnOutcome => ({
    text: state.text,
    provider,
    model: model ?? choice?.model ?? null,
    effort: choice?.effort ?? null,
    speed: choice?.speed ?? 'normal',
    ...(providerLabel ? { providerLabel } : {}),
    usage: state.usage,
    hops: state.hops,
    toolCalls: state.toolCalls,
    stopReason: state.stopReason,
    ...(state.error ? { error: state.error } : {})
  });

  const approved = input.approvedConfirmations || [];
  const makeContext = (): LopuToolContext =>
    createLopuToolContext(input.viewer, input.context, () => {}, {
      requestScope: `${input.chatId}:${input.requestId}`,
      readOnly: input.readOnly,
      chatId: input.chatId,
      approved,
      mint: (action) => deps.mintConfirmation({ userId: input.viewer.id, chatId: input.chatId, action })
    });

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
    const prompt = buildLopuSystemPrompt({ viewer: { username: input.viewer.username }, context: ctx.context, activePage: ctx.activePage, toolProtocol, approved });
    const options = vaultClientOptions(config);
    const provider =
      config.transport === 'anthropic'
        ? anthropicProvider({ client: deps.createAnthropic(options), choice, system: { stable: prompt.stable, volatile: prompt.volatile }, history, text: input.text, media: input.media, signal: input.signal })
        : openAiProvider({ client: deps.createOpenAi(options), choice, systemText: prompt.text, history, text: input.text, media: input.media, toolMode: config.toolProtocol, signal: input.signal });
    const loop = runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true, readNotes: input.readNotes });

    let first: IteratorResult<LopuChatStreamEvent, void>;
    try {
      first = await loop.next();
    } catch (error) {
      if (isAbortError(error)) {
        state.stopReason = 'aborted';
        return outcome('vault', choice, state, undefined, entry.name);
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
    return outcome('vault', choice, state, undefined, entry.name);
  }

  // --- deterministic scripted provider ---------------------------------
  if (lopuChatProviderMode() === 'test') {
    const ctx = makeContext();
    const state = newTurnState();
    const provider = createLopuTestProvider({ userText: input.text, activePage: ctx.activePage, paceMs: deps.testPaceMs });
    yield meta('test', explicit, 'test');
    try {
      yield* runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true, readNotes: input.readNotes });
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
    const prompt = buildLopuSystemPrompt({ viewer: { username: input.viewer.username }, context: ctx.context, activePage: ctx.activePage, toolProtocol, approved });
    const provider =
      attempt.provider === 'claude'
        ? anthropicProvider({ client: deps.createAnthropic(), choice: attempt.choice, system: { stable: prompt.stable, volatile: prompt.volatile }, history, text: input.text, media: input.media, signal: input.signal })
        : openAiProvider({ client: deps.createOpenAi(), choice: attempt.choice, systemText: prompt.text, history, text: input.text, media: input.media, toolMode, signal: input.signal });
    const loop = runToolLoop({ provider, ctx, deps, state, startedAt, signal: input.signal, toolsAllowed: true, readNotes: input.readNotes });

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
        await recordErrorLog(error, { source: 'lopu-chat-stream', provider: attempt.provider });
        state.stopReason = 'error';
        state.error = String((error as any)?.message || error).slice(0, 300);
        yield { type: 'error', message: 'The AI connection was interrupted. Your saved progress is kept — use Retry / Continue to pick up from here.', retryable: true };
      }
    }
    return outcome(attempt.provider, attempt.choice, state);
  }

  // every provider failed before saying anything — never leave the user empty-handed
  const state = newTurnState();
  yield meta('fallback', null);
  if (explicit) {
    state.text = 'The selected model could not complete this reply. The provider could not process the request; please try again. Your model selection has been kept.';
    yield { type: 'delta', text: state.text };
  } else state.text = yield* streamFallbackReply('failed', deps.fallbackPaceMs);
  state.stopReason = 'fallback';
  state.error = lastError ? String((lastError as any)?.message || lastError).slice(0, 300) : undefined;
  return outcome('fallback', null, state);
}
