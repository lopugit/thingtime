// The Lopu chat wire protocol — one JSON object per NDJSON line, streamed by
// POST /api/v1/lopu/chats/reply. Types only (no runtime imports beyond other
// type modules), so the client reducer imports this file directly and the
// server generator and the browser agree on one union.
//
// Ordering guarantees: `meta` is always first; for one tool call the events
// arrive as tool_use_start → tool_input_delta* → tool_use → (patch | thing |
// navigate)* → tool_result; `done` is always last (it is emitted by the route
// after the assistant turn is persisted, never by the provider loop).
//
// `id` on every tool-scoped event (tool_use_start, tool_input_delta,
// tool_use, tool_result, patch, thing, navigate) is the TOOL CALL id, so a
// client can attach patches and created things to the tool card that made
// them. A created/updated thing's own id is `thing.id`.

import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { PublicChatMessage } from '../messenger/messenger';
import type { PageOp, PatchTarget } from './pageOps';

export type LopuChatProvider =
  | 'claude'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'openrouter'
  | 'mistral'
  | 'deepseek'
  | 'groq'
  | 'cohere'
  | 'compatible'
  | 'test'
  | 'fallback';

export type LopuChatUsage = { inputTokens: number; outputTokens: number };

export type LopuChatStopReason = 'end_turn' | 'max_tokens' | 'tool_limit' | 'hop_limit' | 'time_limit' | 'aborted' | 'error' | 'fallback';

// What the client knows about the builder draft it has open (request
// context.page). `blocks` is the LIVE draft (≤ 48KB), so patch_page can
// operate on what the user actually sees; `source: 'user'` means the viewer
// owns the doc and a patch may be persisted (with expectedUpdatedAt).
export type LopuChatPageContext = {
  id?: string;
  source?: 'user' | 'system';
  pageKey?: string;
  siteRoute?: string;
  name?: string;
  updatedAt?: string;
  blocks?: WebpageBlock[];
};

export type LopuChatContext = {
  route?: string;
  page?: LopuChatPageContext | null;
  selectedBlockId?: string;
  viewport?: 'mobile' | 'desktop';
};

// Persisted on the assistant message (crystal.lopu.toolCalls) — bounded there
// to 20 entries / 240-char summaries by the messenger util.
export type LopuToolCallSummary = { name: string; ok: boolean; summary: string; thingId?: string };

export type LopuChatEvent =
  | {
      type: 'meta';
      chatId: string;
      userMessageId: string;
      requestId: string;
      model: string | null;
      effort: string | null;
      speed: string;
      provider: LopuChatProvider;
      label: string;
    }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; name: string; partial: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string; data?: unknown }
  | { type: 'patch'; id: string; target: PatchTarget; ops: PageOp[]; pageId?: string; persisted: boolean }
  | { type: 'thing'; id: string; kind: string; thing: unknown }
  | { type: 'navigate'; id: string; path: string }
  | { type: 'error'; message: string; retryable: boolean }
  | {
      type: 'done';
      assistantMessageId: string;
      messages: PublicChatMessage[];
      usage?: LopuChatUsage;
      stopReason: LopuChatStopReason;
    };

// Everything the provider/tool loop streams; `done` is the route's.
export type LopuChatStreamEvent = Exclude<LopuChatEvent, { type: 'done' }>;

// The generator's return value: what the route persists as the assistant turn.
export type LopuChatTurnOutcome = {
  text: string;
  provider: LopuChatProvider;
  model: string | null;
  effort: string | null;
  speed: string;
  usage?: LopuChatUsage;
  toolCalls: LopuToolCallSummary[];
  stopReason: LopuChatStopReason;
  error?: string;
};

// ---------------------------------------------------------------------------
// Provider protocol (server-internal). Every provider — Anthropic, OpenAI
// (native or fenced-text tools), the scripted test provider — is an async
// generator speaking this one vocabulary, and chat.ts runs the tool loop
// around it: a provider streams one "hop" (text / tool calls) and ends it
// with `hop_end`; the loop executes the requested tools and resumes the
// generator with their results via next({ results, finalHop }). A provider
// returns (generator done) when its last hop asked for no tools, or after
// the hop it was told was final.

export type LopuProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; name: string; partial: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'hop_end'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens'; usage?: LopuChatUsage };

export type LopuProviderToolResult = {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
};

export type LopuProviderHopInput = { results: LopuProviderToolResult[]; finalHop: boolean };

export type LopuProviderStream = AsyncGenerator<LopuProviderEvent, void, LopuProviderHopInput | undefined>;
