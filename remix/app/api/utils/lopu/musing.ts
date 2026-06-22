import Anthropic from '@anthropic-ai/sdk';

// 🦄 Lopu's musings — a little message generated from the user's real-world
// context (approximate location + current weather + time of day). Weather is
// keyless (Open-Meteo). The Claude call needs ANTHROPIC_API_KEY; without it we
// fall back to a canned musing so the feature always works.

export type LopuContext = {
  city?: string;
  country?: string;
  tempC?: number;
  weather?: string;
  localTime?: string;
};

export type LopuMusing = { message: string; source: 'claude' | 'fallback' };

const FALLBACKS = [
  'The best ideas, like unicorns, show up when you stop chasing them. 🦄',
  'Somewhere a rainbow is forming just because you showed up today. 🌈',
  'Tiny things become big things. Keep tending the little ones. ✨',
  'You are allowed to make something just because it delights you. 🎈',
  "Progress hides in the boring parts — you're closer than it feels. 🌱"
];

// Rotate the fallback line by time of day. Deliberately NOT a crypto RNG:
// CodeQL flags any range-reduction of a secure RNG as "biased", and this isn't
// security-sensitive — it just varies a whimsical line when Claude is offline.
const pickFallback = () => FALLBACKS[Date.now() % FALLBACKS.length];

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
    return { tempC: typeof tempC === 'number' ? tempC : undefined, weather: typeof code === 'number' ? weatherCodeToText(code) : undefined };
  } catch {
    return null;
  }
};

export const generateLopuMusing = async (ctx: LopuContext): Promise<LopuMusing> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { message: pickFallback(), source: 'fallback' };
  }

  try {
    const client = new Anthropic();

    const bits: string[] = [];
    if (ctx.city) bits.push(`city: ${ctx.city}${ctx.country ? ', ' + ctx.country : ''}`);
    if (typeof ctx.tempC === 'number') bits.push(`weather: ${ctx.weather ?? ''} ${ctx.tempC}°C`.trim());
    if (ctx.localTime) bits.push(`local time: ${ctx.localTime}`);
    const contextLine = bits.length ? `Context — ${bits.join('; ')}.` : 'No location context available.';

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 120,
      system:
        'You are Lopu, the whimsical unicorn AI living inside Thingtime. Reply with ONE short, delightful musing ' +
        '(max two sentences) — warm, a touch magical, and weave in the user\'s weather, city, or time of day when given. ' +
        'Use at most one emoji. Output ONLY the musing text: no preamble, no quotes, no meta-commentary, no reasoning.',
      messages: [{ role: 'user', content: `${contextLine}\nGive me today's little musing.` }]
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const message = textBlock && 'text' in textBlock ? textBlock.text.trim() : '';

    return message ? { message, source: 'claude' } : { message: pickFallback(), source: 'fallback' };
  } catch {
    return { message: pickFallback(), source: 'fallback' };
  }
};
