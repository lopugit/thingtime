import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import {
  type AiWorkflowModelChoice,
  resolveAiPreferredAnthropicChoice,
  resolveAiPreferredOpenAiChoice,
  toAnthropicEffort,
  toOpenAiReasoningEffort
} from '../settings/prConflictResolverModelWaterfallCore';
import { pickFallbackMusing } from './fallbacks';

// 🦄 Lopu's musings — a little message generated from the user's real-world
// context (approximate location + current weather + local time of day).
//
// Providers (set either or both env keys):
//   - ANTHROPIC_API_KEY → Claude (first Anthropic-capable Thingtime Admin
//     waterfall entry, with its effort/fast knobs; LOPU_CLAUDE_MODEL is the
//     provider-valid fallback when the Admin preference resolves to `default`)
//   - OPENAI_API_KEY    → ChatGPT (first OpenAI Admin waterfall entry with its
//     knobs; LOPU_OPENAI_MODEL, default gpt-4o-mini, when none is configured)
// Preference order via LOPU_PROVIDER = "claude" | "openai" (default: claude first).
//
// For variety, each request picks a "mode": a weather/place musing, a fresh
// musing, a little quote, a hand-written fallback line, or a fallback line with
// a short comment from the AI. If no key is set (or a call fails), we fall back
// to the 370-strong canned library, so the feature always works. Weather is
// keyless (Open-Meteo).

export type LopuContext = {
  city?: string;
  country?: string;
  tempC?: number;
  weather?: string;
  localTime?: string;
};

export type LopuSource = 'claude' | 'openai' | 'fallback';
export type LopuMode = 'weather' | 'musing' | 'quote' | 'commented' | 'surprise' | 'fallback';
export type LopuMusing = { message: string; source: LopuSource; mode: LopuMode };

// Streaming protocol (NDJSON over the wire — one JSON object per line).
export type LopuStreamEvent =
  | { type: 'meta'; source: LopuSource; mode: LopuMode }
  | { type: 'delta'; text: string }
  | { type: 'done' };

// Rotate through the big fallback library by time (no RNG — not security-
// sensitive, and CodeQL flags any range-reduction of a secure RNG). With ~370
// lines this gives plenty of variety while the endpoint stays live with no keys.
// The picker itself lives in fallbacks.ts (shared with the waitlist fortune).
const pickFallback = pickFallbackMusing;

// Same time-based rotation for the mode, so each click feels a little different.
const ALL_MODES: LopuMode[] = ['weather', 'musing', 'quote', 'commented', 'surprise', 'fallback'];
const pickMode = (): LopuMode => ALL_MODES[Date.now() % ALL_MODES.length];

const SYSTEM_PROMPT =
  'You are Lopu, the whimsical unicorn AI living inside Thingtime. Reply with ONE short, delightful musing ' +
  "(max two sentences) — warm, a touch magical, and weave in the user's weather, city, or time of day when given. " +
  'Use at most one emoji. Output ONLY the musing text: no preamble, no quotes, no meta-commentary, no reasoning.';

const buildContextLine = (ctx: LopuContext): string => {
  const bits: string[] = [];
  if (ctx.city) bits.push(`city: ${ctx.city}${ctx.country ? ', ' + ctx.country : ''}`);
  if (typeof ctx.tempC === 'number') bits.push(`weather: ${ctx.weather ?? ''} ${ctx.tempC}°C`.trim());
  if (ctx.localTime) bits.push(`local time: ${ctx.localTime}`);
  return bits.length ? `Context — ${bits.join('; ')}.` : 'No location context available.';
};

// The user-turn prompt for each mode. System prompt is shared.
const buildUserPrompt = (mode: LopuMode, ctx: LopuContext, base: string): string => {
  switch (mode) {
    case 'weather':
      return `${buildContextLine(ctx)}\nGive me today's little musing, woven around that real-world context.`;
    case 'quote':
      return `${buildContextLine(ctx)}\nShare a tiny uplifting quote-style line — one sentence, the kind worth pinning to a wall.`;
    case 'commented':
      return `Here is one of your past musings: "${base}". Add a brief, warm one-sentence comment riffing on it. Output ONLY your comment — do not repeat the musing itself.`;
    case 'surprise':
      return `${buildContextLine(ctx)}\nDealer's choice — total creative freedom. Blend the weather, a quote, and a musing, or invent something entirely your own. Whatever delights you most right now. Still keep it short and in your voice.`;
    case 'musing':
    default:
      return 'Give me a tiny delightful musing — something warm and a touch magical, no location needed.';
  }
};

// Minimal WMO weather-code → words mapping (Open-Meteo `weather_code`).
const weatherCodeToText = (code: number): string => {
  if (code === 0) return 'clear sky';
  if ([1, 2].includes(code)) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if ([45, 48].includes(code)) return 'foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzly';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rainy';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snowy';
  if ([95, 96, 99].includes(code)) return 'stormy';
  return 'mild';
};

// Fetch current weather from Open-Meteo (no API key required).
export const fetchWeather = async (lat: string, lon: string): Promise<{ tempC?: number; weather?: string } | null> => {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const tempC = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    return {
      tempC: typeof tempC === 'number' ? tempC : undefined,
      weather: typeof code === 'number' ? weatherCodeToText(code) : undefined
    };
  } catch {
    return null;
  }
};

// --- Streaming providers (each yields text chunks, or throws to fall through) -

const getDefaultLopuClaudeModel = () => process.env.LOPU_CLAUDE_MODEL?.trim() || 'claude-opus-4-8';

export type LopuModelChoices = {
  claude: AiWorkflowModelChoice;
  openai: AiWorkflowModelChoice | null; // null = keep LOPU_OPENAI_MODEL
};

type LopuModelChoicesResolverDependencies = {
  getPreferredModelWaterfall: typeof getAiPreferredModelWaterfall;
  getProviderDefaultModel: () => string;
};

// One durable waterfall read resolves both provider preferences: the first
// Anthropic-capable entry for Claude calls and the first OpenAI entry for
// ChatGPT calls, each stopping at the `default` sentinel.
export const createLopuModelChoicesResolver =
  (dependencies: LopuModelChoicesResolverDependencies) => async (): Promise<LopuModelChoices> => {
    const waterfall = await dependencies.getPreferredModelWaterfall();
    return {
      claude: resolveAiPreferredAnthropicChoice(waterfall, dependencies.getProviderDefaultModel()),
      openai: resolveAiPreferredOpenAiChoice(waterfall)
    };
  };

const getLopuModelChoices = createLopuModelChoicesResolver({
  getPreferredModelWaterfall: getAiPreferredModelWaterfall,
  getProviderDefaultModel: getDefaultLopuClaudeModel
});

// Output ceiling for one musing. The visible answer is one or two sentences,
// but both providers bill internal reasoning against this same budget —
// Anthropic counts thinking tokens inside `max_tokens`, OpenAI counts
// reasoning tokens inside `max_completion_tokens`. Now that an Admin entry can
// pin any catalog model, including reasoning models and explicit effort tiers,
// a text-sized cap is spent thinking and the musing streams back empty. Keep a
// hard ceiling for cost, with headroom for the text to survive the reasoning.
const MUSING_MAX_OUTPUT_TOKENS = 4096;

// Yield the text deltas of one Claude attempt. The Admin-selected effort and
// fast-mode knobs are applied when present; if the decorated request fails
// before producing any text (e.g. a knob the model rejects), one bare retry
// with just the model keeps the admin's model preference alive.
async function* streamClaude(system: string, user: string, choice: AiWorkflowModelChoice): AsyncGenerator<string> {
  const client = new Anthropic();
  const base = {
    model: choice.model,
    max_tokens: MUSING_MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user' as const, content: user }]
  };

  const effort = toAnthropicEffort(choice.effort);
  const decorated = choice.speed === 'fast' || effort;
  const attempts =
    choice.speed === 'fast'
      ? [
          // Fast mode is beta-gated and needs the beta stream surface.
          () =>
            client.beta.messages.stream({
              ...base,
              ...(effort ? { output_config: { effort } } : {}),
              speed: 'fast',
              betas: ['fast-mode-2026-02-01']
            }),
          () => client.messages.stream(base)
        ]
      : effort
        ? [() => client.messages.stream({ ...base, output_config: { effort } }), () => client.messages.stream(base)]
        : [() => client.messages.stream(base)];

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    let yielded = false;
    try {
      for await (const event of attempts[attempt]()) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yielded = true;
          yield event.delta.text;
        }
      }
      // A decorated attempt that completes WITHOUT a single text delta starved
      // its output budget on reasoning — treat it like a failure and fall
      // through to the bare retry, so the admin's Claude preference is not
      // silently skipped in favor of the next provider.
      if (yielded || attempt === attempts.length - 1) return;
    } catch (err) {
      // Never retry after emitting text (it would duplicate the musing), and
      // never swallow the final attempt's failure — the provider loop needs it.
      if (yielded || !decorated || attempt === attempts.length - 1) throw err;
    }
  }
}

async function* streamOpenAI(
  system: string,
  user: string,
  choice: AiWorkflowModelChoice | null
): AsyncGenerator<string> {
  const client = new OpenAI();
  const base = {
    model: choice?.model || process.env.LOPU_OPENAI_MODEL || 'gpt-4o-mini',
    // Never `max_tokens`: it is deprecated and outright incompatible with the
    // o-series/GPT-5 reasoning models an admin can now put first, which would
    // reject both the decorated call and its bare retry.
    max_completion_tokens: MUSING_MAX_OUTPUT_TOKENS,
    stream: true as const,
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user }
    ]
  };

  const effort = toOpenAiReasoningEffort(choice?.effort ?? null);
  const decorated = choice && (choice.speed === 'fast' || effort);
  const attempts = decorated
    ? [
        () =>
          client.chat.completions.create({
            ...base,
            ...(effort ? { reasoning_effort: effort } : {}),
            // 'fast' maps to OpenAI priority processing.
            ...(choice.speed === 'fast' ? { service_tier: 'priority' as const } : {})
          }),
        () => client.chat.completions.create(base)
      ]
    : [() => client.chat.completions.create(base)];

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    let yielded = false;
    try {
      for await (const chunk of await attempts[attempt]()) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) {
          yielded = true;
          yield text;
        }
      }
      // Same starvation rule as the Claude side: an empty decorated completion
      // falls through to the bare retry before the provider is given up on.
      if (yielded || attempt === attempts.length - 1) return;
    } catch (err) {
      if (yielded || attempt === attempts.length - 1) throw err;
    }
  }
}

// Drain a provider stream, giving up if `deadlineAt` passes mid-stream.
//
// A caller-side "have I run out of time?" check can only ever gate STARTING a
// call: once `for await` is waiting on the provider, nothing short of the SDK's
// own (10-minute) default timeout ends it. That is the whole gap this closes —
// a request-scoped deadline has to be enforced where the stream is consumed.
//
// The abandoned generator is returned but NOT awaited: `.return()` on an async
// generator with a pending `next()` queues BEHIND that next, so awaiting it
// would block for exactly as long as the stall we are escaping. Firing it
// un-awaited closes the underlying SDK stream whenever the read settles, while
// the caller returns now. `Promise.race` keeps a handler attached to the losing
// `next()`, so a late provider rejection is never an unhandled rejection.
const drainWithin = async (gen: AsyncGenerator<string>, deadlineAt: number | null): Promise<string | null> => {
  if (deadlineAt === null) {
    let all = '';
    for await (const chunk of gen) all += chunk;
    return all;
  }
  const abandon = () => void Promise.resolve(gen.return(undefined as never)).catch(() => {});
  let text = '';
  for (;;) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      abandon();
      return null;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = await Promise.race([
      gen.next(),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), remaining);
      })
    ]).finally(() => clearTimeout(timer));
    if (step === 'timeout') {
      abandon();
      return null;
    }
    if (step.done) return text;
    text += step.value;
  }
};

// Generic non-streaming completion for other Thingtime features (e.g. the
// connections feed filters). Same provider waterfall + admin model routing as
// the musing, same graceful degradation: null when no provider is configured
// or every provider fails — callers must have a non-AI fallback. AI clients
// are constructed ONLY in this module (scripts/ai-model-routing-contract.mjs).
// `maxTokens` is the caller's MINIMUM viable budget, not a per-call cap: an
// admin entry can pin a reasoning model, and both providers bill that thinking
// against the one shared MUSING_MAX_OUTPUT_TOKENS ceiling, so a per-caller
// allowance would only starve the visible answer. A caller needing more than
// the ceiling would silently receive a truncated completion — for the feed
// classifier that loses the closing bracket and the whole batch — so degrade to
// its non-AI fallback instead of answering with something unparseable.
// `timeoutMs` bounds the WHOLE call — every provider attempt in the waterfall
// shares the one deadline, so a caller that must answer inside a request budget
// gets that budget, not a multiple of it. Omitted = drain to completion (the
// musing's own behaviour, where the response IS the stream).
export const generateAiCompletion = async (opts: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; source: 'claude' | 'openai' } | null> => {
  if (!hasAnyKey()) return null;
  if ((opts.maxTokens ?? 0) > MUSING_MAX_OUTPUT_TOKENS) return null;
  const deadlineAt = opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : null;
  // One durable waterfall read serves every provider attempt, as in the musing.
  const choices = await getLopuModelChoices();
  for (const provider of providerOrder()) {
    const key = provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) continue;
    // A provider that burned the whole deadline must not hand the NEXT one a
    // fresh start — that is how a two-provider waterfall doubles its own bound.
    if (deadlineAt !== null && Date.now() >= deadlineAt) return null;
    try {
      const gen =
        provider === 'claude'
          ? streamClaude(opts.system, opts.user, choices.claude)
          : streamOpenAI(opts.system, opts.user, choices.openai);
      const text = await drainWithin(gen, deadlineAt);
      // null = the deadline passed mid-stream. Falling through to the next
      // provider would spend a bound that is already gone, so stop here and let
      // the caller take its non-AI fallback.
      if (text === null) return null;
      if (text.trim()) return { text: text.trim(), source: provider };
    } catch {
      // try the next provider
    }
  }
  return null;
};

// Provider preference: LOPU_PROVIDER picks who goes first; the other is the
// automatic fallback. Default is Claude first.
const providerOrder = (): Array<'claude' | 'openai'> => {
  const pref = (process.env.LOPU_PROVIDER || '').toLowerCase();
  return pref === 'openai' ? ['openai', 'claude'] : ['claude', 'openai'];
};

const hasAnyKey = () => !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY;
export const hasLopuAiProviderConfigured = hasAnyKey;

// Split a string into word-sized chunks (keeping trailing spaces) so a canned
// line can be "typed in" with the same streaming feel as the AI.
const chunkWords = (s: string): string[] => s.match(/\S+\s*/g) || [s];
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));

async function* streamFallback(mode: LopuMode): AsyncGenerator<LopuStreamEvent> {
  yield { type: 'meta', source: 'fallback', mode };
  for (const chunk of chunkWords(pickFallback())) {
    yield { type: 'delta', text: chunk };
    await tick();
  }
  yield { type: 'done' };
}

// The streaming heart of the feature: pick a mode, try each provider, and on any
// failure (no key / no credits / network) fall back to the canned library.
export async function* streamLopuMusing(
  ctx: LopuContext,
  opts: { forceFallback?: boolean } = {}
): AsyncGenerator<LopuStreamEvent> {
  const mode = opts.forceFallback ? 'fallback' : pickMode();

  // Pure-fallback mode, or no AI configured at all: serve a canned line.
  if (opts.forceFallback || mode === 'fallback' || !hasAnyKey()) {
    yield* streamFallback(mode);
    return;
  }

  // For "commented" mode we show a real library line, then the AI riff.
  const base = mode === 'commented' ? pickFallback() : '';
  const user = buildUserPrompt(mode, ctx, base);

  // One durable read serves every provider attempt in this musing;
  // getWaterfall catches internally and never throws.
  const choices = await getLopuModelChoices();

  for (const provider of providerOrder()) {
    const key = provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) continue;
    try {
      const gen =
        provider === 'claude'
          ? streamClaude(SYSTEM_PROMPT, user, choices.claude)
          : streamOpenAI(SYSTEM_PROMPT, user, choices.openai);
      // Pull the first chunk inside the try so a failing provider (bad key, no
      // credits) is caught here and we move to the next one cleanly.
      const first = await gen.next();
      // A provider that finishes without a single text delta is a failed
      // attempt, not an empty musing — a reasoning entry can burn its whole
      // output budget thinking. Fall through to the next provider (and
      // ultimately the canned library) instead of committing to a blank
      // message the user can never see.
      if (first.done) continue;
      yield { type: 'meta', source: provider, mode };
      // "commented" prepends the chosen library line before the AI's comment.
      if (base) {
        for (const chunk of chunkWords(base + ' — ')) {
          yield { type: 'delta', text: chunk };
          await tick();
        }
      }
      if (first.value) yield { type: 'delta', text: first.value };
      for await (const text of gen) yield { type: 'delta', text };
      yield { type: 'done' };
      return;
    } catch {
      // try the next provider
    }
  }

  // Every provider failed — never leave the user empty-handed.
  yield* streamFallback(mode);
}

// Non-streaming convenience wrapper (collects the stream into a final string).
export const generateLopuMusing = async (ctx: LopuContext): Promise<LopuMusing> => {
  let message = '';
  let source: LopuSource = 'fallback';
  let mode: LopuMode = 'fallback';
  for await (const ev of streamLopuMusing(ctx)) {
    if (ev.type === 'meta') {
      source = ev.source;
      mode = ev.mode;
    } else if (ev.type === 'delta') {
      message += ev.text;
    }
  }
  return { message: message.trim() || pickFallback(), source, mode };
};
