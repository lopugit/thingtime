import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { FALLBACK_MUSINGS } from './fallbacks';

// 🦄 Lopu's musings — a little message generated from the user's real-world
// context (approximate location + current weather + local time of day).
//
// Providers (set either or both env keys):
//   - ANTHROPIC_API_KEY → Claude (model: LOPU_CLAUDE_MODEL, default claude-opus-4-8)
//   - OPENAI_API_KEY    → ChatGPT (model: LOPU_OPENAI_MODEL, default gpt-4o-mini)
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
const pickFallback = () => FALLBACK_MUSINGS[Date.now() % FALLBACK_MUSINGS.length];

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

async function* streamClaude(system: string, user: string): AsyncGenerator<string> {
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: process.env.LOPU_CLAUDE_MODEL || 'claude-opus-4-8',
    max_tokens: 200, // intentionally short — a musing is one or two sentences
    system,
    messages: [{ role: 'user', content: user }]
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

async function* streamOpenAI(system: string, user: string): AsyncGenerator<string> {
  const client = new OpenAI();
  const stream = await client.chat.completions.create({
    model: process.env.LOPU_OPENAI_MODEL || 'gpt-4o-mini',
    max_tokens: 200,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  for await (const chunk of stream) {
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

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

  for (const provider of providerOrder()) {
    const key = provider === 'claude' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
    if (!key) continue;
    try {
      const gen = provider === 'claude' ? streamClaude(SYSTEM_PROMPT, user) : streamOpenAI(SYSTEM_PROMPT, user);
      // Pull the first chunk inside the try so a failing provider (bad key, no
      // credits) is caught here and we move to the next one cleanly.
      const first = await gen.next();
      yield { type: 'meta', source: provider, mode };
      // "commented" prepends the chosen library line before the AI's comment.
      if (base) {
        for (const chunk of chunkWords(base + ' — ')) {
          yield { type: 'delta', text: chunk };
          await tick();
        }
      }
      if (!first.done && first.value) yield { type: 'delta', text: first.value };
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
