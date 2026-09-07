// Lopu usage pricing (design note "Lopu verified access, usage accounting and
// credits" §2). Pure: no Mongo, no env — the client may import it for the
// balance chip and the per-turn footer.
//
// Prices are USD per million tokens (the providers' list prices). Because
// 1 credit = 1 USD = 1,000,000 micros and a million tokens cost `pricePerM`
// USD, the cost of one token in micro-USD is exactly `pricePerM` — so a turn
// prices as Σ tokens × pricePerM, rounded half up to an integer micro.
//
// `estimated: true` marks a row whose list price is not known with
// confidence (the closest sibling's price is used, as the design note asks);
// the public catalog carries the flag so an admin can see which rows to
// double-check. Anthropic cache tokens follow the documented multiples
// (cache write ≈ 1.25× input, cache read ≈ 0.1× input); OpenAI cached input
// is the provider's cached-input rate where known, else 10% of input.

export type AiModelPrice = {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  estimated: boolean;
};

export type AiModelPricingPublic = { inputPerM: number; outputPerM: number; estimated: boolean };

export type PricedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} | null | undefined;

export type TurnPrice = { costMicros: number; priced: boolean; estimated: boolean };

// Fold provider-reported cache tokens into an accumulating usage record —
// only when the provider actually reported a positive count, so a provider
// (or a test fixture) that knows nothing of caches leaves the usage shape
// exactly { inputTokens, outputTokens }.
export const addCacheTokens = (usage: { cacheReadTokens?: number; cacheWriteTokens?: number }, cacheRead: unknown, cacheWrite: unknown): void => {
  const read = typeof cacheRead === 'number' && Number.isFinite(cacheRead) && cacheRead > 0 ? Math.floor(cacheRead) : 0;
  const write = typeof cacheWrite === 'number' && Number.isFinite(cacheWrite) && cacheWrite > 0 ? Math.floor(cacheWrite) : 0;
  if (read) usage.cacheReadTokens = (usage.cacheReadTokens || 0) + read;
  if (write) usage.cacheWriteTokens = (usage.cacheWriteTokens || 0) + write;
};

// 1 credit = 1 USD of list price = 1,000,000 micros.
export const MICROS_PER_CREDIT = 1_000_000;

// The scripted test provider (LOPU_CHAT_PROVIDER=test) reports synthetic usage
// (100 in / 50 out per hop) and prices against this entry, so accounting is
// observable end to end without a real provider: one hop = 100 × 1000 +
// 50 × 2000 = 200,000 micros = 0.2 credits.
export const LOPU_TEST_MODEL_ID = 'test-model' as const;

// integers only, half up, sign-symmetric (a refund of −0.5 micro is −1)
export const roundHalfUp = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
};

const money = (value: number): number => roundHalfUp(value * 1_000_000) / 1_000_000;

const anthropic = (inputPerM: number, outputPerM: number, estimated = false): AiModelPrice => ({
  inputPerM,
  outputPerM,
  cacheReadPerM: money(inputPerM * 0.1),
  cacheWritePerM: money(inputPerM * 1.25),
  estimated
});

const openai = (inputPerM: number, outputPerM: number, cacheReadPerM: number | null = null, estimated = false): AiModelPrice => ({
  inputPerM,
  outputPerM,
  cacheReadPerM: cacheReadPerM ?? money(inputPerM * 0.1),
  estimated
});

// Every catalog model in AI_WORKFLOW_BASE_MODELS (pricing.test.ts pins the
// coverage), plus the test provider's synthetic model.
export const AI_MODEL_PRICING: Readonly<Record<string, AiModelPrice>> = Object.freeze({
  // --- Anthropic (list prices) --------------------------------------------
  'claude-fable-5': anthropic(10, 50),
  'claude-opus-5': anthropic(5, 25),
  'claude-opus-4-8': anthropic(5, 25),
  'claude-opus-4-7': anthropic(5, 25),
  'claude-opus-4-6': anthropic(5, 25),
  'claude-sonnet-5': anthropic(2, 10),
  'claude-sonnet-4-6': anthropic(3, 15),
  'claude-haiku-4-5': anthropic(1, 5),

  // --- OpenAI ---------------------------------------------------------------
  // the 5.6 trio and 5.5 / 5.4 / 5.3 are priced from their closest sibling
  // (estimated); the GPT-5 / 5.1 / 5.2 / 4.1 / 4o / o-series rows are the
  // published list prices
  'gpt-5.6-sol': openai(2.5, 15, 0.25, true),
  'gpt-5.6-terra': openai(2.5, 15, 0.25, true),
  'gpt-5.6-luna': openai(1.25, 10, 0.125, true),
  'gpt-5.5': openai(2.5, 15, 0.25, true),
  'gpt-5.4': openai(2.5, 15, 0.25, true),
  'gpt-5.4-mini': openai(0.75, 4.5, 0.075, true),
  'gpt-5.3-codex': openai(1.75, 14, 0.175, true),
  'gpt-5.3-codex-spark': openai(1.75, 14, 0.175, true),
  'gpt-5.2': openai(1.75, 14, 0.175),
  'gpt-5.2-pro': openai(21, 168, null, true),
  'gpt-5.1': openai(1.25, 10, 0.125),
  'gpt-5.1-codex': openai(1.25, 10, 0.125),
  'gpt-5.1-codex-mini': openai(0.25, 2, 0.025),
  'gpt-5.1-codex-max': openai(1.25, 10, 0.125),
  'gpt-5': openai(1.25, 10, 0.125),
  'gpt-5-mini': openai(0.25, 2, 0.025),
  'gpt-5-nano': openai(0.05, 0.4, 0.005),
  o3: openai(2, 8, 0.5),
  'o3-pro': openai(20, 80, null, false),
  'o4-mini': openai(1.1, 4.4, 0.275),
  'gpt-4.1': openai(2, 8, 0.5),
  'gpt-4.1-mini': openai(0.4, 1.6, 0.1),
  'gpt-4.1-nano': openai(0.1, 0.4, 0.025),
  'gpt-4o': openai(2.5, 10, 1.25),
  'gpt-4o-mini': openai(0.15, 0.6, 0.075),

  // --- the scripted test provider ---------------------------------------
  [LOPU_TEST_MODEL_ID]: { inputPerM: 1000, outputPerM: 2000, cacheReadPerM: 100, cacheWritePerM: 1250, estimated: false }
});

export const getAiModelPricing = (modelId: unknown): AiModelPrice | null => {
  if (typeof modelId !== 'string') return null;
  const price = AI_MODEL_PRICING[modelId.trim()];
  return price ? { ...price } : null;
};

// What GET /api/v1/ai/models publishes per model (public, not secret).
export const publicAiModelPricing = (modelId: unknown): AiModelPricingPublic | null => {
  const price = getAiModelPricing(modelId);
  return price ? { inputPerM: price.inputPerM, outputPerM: price.outputPerM, estimated: price.estimated } : null;
};

const tokens = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

// Σ tokens × USD-per-million = micro-USD, rounded half up. Cache tokens bill
// only when the price knows a cache rate (else they are folded in as plain
// input, the conservative reading).
export const priceUsageMicros = (price: AiModelPrice, usage: PricedUsage): number => {
  if (!usage) return 0;
  const input = tokens(usage.inputTokens);
  const output = tokens(usage.outputTokens);
  const cacheRead = tokens(usage.cacheReadTokens);
  const cacheWrite = tokens(usage.cacheWriteTokens);
  const cacheReadRate = typeof price.cacheReadPerM === 'number' ? price.cacheReadPerM : price.inputPerM;
  const cacheWriteRate = typeof price.cacheWritePerM === 'number' ? price.cacheWritePerM : price.inputPerM;
  return roundHalfUp(input * price.inputPerM + output * price.outputPerM + cacheRead * cacheReadRate + cacheWrite * cacheWriteRate);
};

// The price of one turn. An unknown model (a vault connection's own model, a
// custom endpoint) is `priced: false` with cost 0 — never a guess.
export const priceTurn = (modelId: unknown, usage: PricedUsage): TurnPrice => {
  const price = getAiModelPricing(modelId);
  if (!price) return { costMicros: 0, priced: false, estimated: false };
  return { costMicros: priceUsageMicros(price, usage), priced: true, estimated: price.estimated };
};

export const creditsToMicros = (credits: number): number => roundHalfUp(credits * MICROS_PER_CREDIT);
export const microsToCredits = (micros: number): number => (Number.isFinite(micros) ? micros / MICROS_PER_CREDIT : 0);

// "4.97 credits" for a credit or more, cents below one ("1.32¢"), never
// scientific notation.
export const formatCredits = (micros: number): string => {
  const value = Number.isFinite(micros) ? micros : 0;
  const credits = value / MICROS_PER_CREDIT;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(credits);
  if (abs >= 1) return `${sign}${abs.toFixed(2)} credits`;
  if (value === 0) return '0 credits';
  const cents = abs * 100;
  if (cents < 0.01) return `${sign}<0.01¢`;
  return `${sign}${cents.toFixed(2)}¢`;
};
