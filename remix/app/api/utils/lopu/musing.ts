import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { FALLBACK_MUSINGS } from './fallbacks';

// 🦄 Lopu's musings — a little message generated from the user's real-world
// context (approximate location + current weather + time of day).
//
// Providers (set either or both env keys):
//   - ANTHROPIC_API_KEY → Claude (model: LOPU_CLAUDE_MODEL, default claude-opus-4-8)
//   - OPENAI_API_KEY    → ChatGPT (model: LOPU_OPENAI_MODEL, default gpt-4o-mini)
// Preference order via LOPU_PROVIDER = "claude" | "openai" (default: claude first).
// If neither key is set (or both calls fail), a canned fallback is returned, so
// the feature always works. Weather is keyless (Open-Meteo).

export type LopuContext = {
  city?: string;
  country?: string;
  tempC?: number;
  weather?: string;
  localTime?: string;
};

export type LopuSource = 'claude' | 'openai' | 'fallback';
export type LopuMusing = { message: string; source: LopuSource };

// Rotate through the big fallback library by time (no RNG — not security-
// sensitive, and CodeQL flags any range-reduction of a secure RNG). With ~370
// lines this gives plenty of variety while the endpoint stays live with no keys.
const pickFallback = () => FALLBACK_MUSINGS[Date.now() % FALLBACK_MUSINGS.length];

const SYSTEM_PROMPT =
  'You are Lopu, the whimsical unicorn AI living inside Thingtime. Reply with ONE short, delightful musing ' +
  "(max two sentences) — warm, a touch magical, and weave in the user's weather, city, or time of day when given. " +
  'Use at most one emoji. Output ONLY the musing text: no preamble, no quotes, no meta-commentary, no reasoning.';

const buildUserPrompt = (ctx: LopuContext): string => {
  const bits: string[] = [];
  if (ctx.city) bits.push(`city: ${ctx.city}${ctx.country ? ', ' + ctx.country : ''}`);
  if (typeof ctx.tempC === 'number') bits.push(`weather: ${ctx.weather ?? ''} ${ctx.tempC}°C`.trim());
  if (ctx.localTime) bits.push(`local time: ${ctx.localTime}`);
  const contextLine = bits.length ? `Context — ${bits.join('; ')}.` : 'No location context available.';
  return `${contextLine}\nGive me today's little musing.`;
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

// --- Providers (each returns the musing text, or null to fall through) -------

const tryClaude = async (user: string): Promise<string | null> => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.LOPU_CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: 120,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }]
    });
    const block = response.content.find((b) => b.type === 'text');
    const text = block && 'text' in block ? block.text.trim() : '';
    return text || null;
  } catch {
    return null;
  }
};

const tryOpenAI = async (user: string): Promise<string | null> => {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAI();
    const resp = await client.chat.completions.create({
      model: process.env.LOPU_OPENAI_MODEL || 'gpt-4o-mini',
      max_tokens: 120,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user }
      ]
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
};

export const generateLopuMusing = async (ctx: LopuContext): Promise<LopuMusing> => {
  const user = buildUserPrompt(ctx);

  // Preference order: LOPU_PROVIDER picks who goes first; the other is the
  // automatic fallback. Default is Claude first.
  const pref = (process.env.LOPU_PROVIDER || '').toLowerCase();
  const order: Array<'claude' | 'openai'> = pref === 'openai' ? ['openai', 'claude'] : ['claude', 'openai'];

  for (const provider of order) {
    const text = provider === 'claude' ? await tryClaude(user) : await tryOpenAI(user);
    if (text) return { message: text, source: provider };
  }

  return { message: pickFallback(), source: 'fallback' };
};
