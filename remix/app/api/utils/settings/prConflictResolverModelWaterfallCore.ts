export const PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY =
  'Thingtime.PRConflictAutoResolverModelWaterfall' as const;

// A waterfall entry id is a composed option id: `<model>[:<effort>][:fast]`.
// `<model>` alone runs the provider's default reasoning effort at normal
// speed; the optional segments pin an explicit effort tier and the provider's
// faster processing mode. Ids are open strings (the catalog below is data, not
// a closed union), so this remains a plain string alias for compatibility.
export type PRConflictResolverModelId = string;
export type PRConflictAutoResolverModelId = PRConflictResolverModelId;
// The persisted key and endpoint retain their historical conflict-resolver
// names for compatibility, but this is now Thingtime's canonical preference
// type for every AI entrypoint.
export type AiPreferredModelId = PRConflictResolverModelId;

export type AiModelProvider = 'default' | 'anthropic' | 'openai';
export type AiModelEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type AiModelSpeed = 'normal' | 'fast';

export type AiWorkflowBaseModel = {
  id: string; // base option id — equals the provider-native model id
  label: string;
  provider: AiModelProvider;
  // Explicitly selectable reasoning-effort tiers for this model. An empty
  // list means the model only runs at its provider-default effort.
  efforts: readonly AiModelEffort[];
  // 'fast' is offered only where the provider sells a faster lane: Anthropic
  // fast mode (Claude Opus 5 / 4.8) and OpenAI priority processing.
  speeds: readonly AiModelSpeed[];
};

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const CLAUDE_EFFORTS_46 = ['low', 'medium', 'high', 'max'] as const; // xhigh arrived with Opus 4.7
const OPENAI_EFFORTS_56 = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
const OPENAI_EFFORTS_5X = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
const OPENAI_EFFORTS_CODEX = ['low', 'medium', 'high', 'xhigh'] as const;
const OPENAI_EFFORTS_GPT5 = ['minimal', 'low', 'medium', 'high'] as const;
const OPENAI_EFFORTS_OSERIES = ['low', 'medium', 'high'] as const;
const NORMAL_ONLY = ['normal'] as const;
const NORMAL_AND_FAST = ['normal', 'fast'] as const;

// The base-model catalog. Every entry is data: adding a model here is the
// whole registration (ids, validation, the public endpoint's catalog
// projection, and the Admin picker all derive from this list).
export const AI_WORKFLOW_BASE_MODELS: readonly AiWorkflowBaseModel[] = [
  // The provider-selected default: Claude Code's own default in workflow
  // automation, LOPU_CLAUDE_MODEL / TT_MODERATION_MODEL / LOPU_OPENAI_MODEL
  // for the direct application clients. Always kept as the hard fallback.
  { id: 'default', label: 'Default model', provider: 'default', efforts: [], speeds: NORMAL_ONLY },

  // Anthropic — reasoning-effort tiers per model capability; fast mode is an
  // Anthropic research preview limited to Claude Opus 5 and Claude Opus 4.8.
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic', efforts: CLAUDE_EFFORTS, speeds: NORMAL_ONLY },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', efforts: CLAUDE_EFFORTS, speeds: NORMAL_AND_FAST },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', efforts: CLAUDE_EFFORTS, speeds: NORMAL_AND_FAST },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', efforts: CLAUDE_EFFORTS, speeds: NORMAL_ONLY },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', efforts: CLAUDE_EFFORTS_46, speeds: NORMAL_ONLY },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', efforts: CLAUDE_EFFORTS, speeds: NORMAL_ONLY },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', efforts: CLAUDE_EFFORTS_46, speeds: NORMAL_ONLY },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', efforts: [], speeds: NORMAL_ONLY },

  // OpenAI — 'fast' maps to priority processing (service tier) on the models
  // OpenAI sells it for; codex/o-series/pro models stay normal-only.
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', efforts: OPENAI_EFFORTS_56, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai', efforts: OPENAI_EFFORTS_56, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai', efforts: OPENAI_EFFORTS_56, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', efforts: OPENAI_EFFORTS_5X, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', efforts: OPENAI_EFFORTS_5X, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', efforts: OPENAI_EFFORTS_5X, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai', efforts: OPENAI_EFFORTS_CODEX, speeds: NORMAL_ONLY },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', provider: 'openai', efforts: [], speeds: NORMAL_ONLY },
  { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai', efforts: OPENAI_EFFORTS_5X, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', provider: 'openai', efforts: [], speeds: NORMAL_ONLY },
  { id: 'gpt-5.1', label: 'GPT-5.1', provider: 'openai', efforts: OPENAI_EFFORTS_5X, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', provider: 'openai', efforts: OPENAI_EFFORTS_CODEX, speeds: NORMAL_ONLY },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', provider: 'openai', efforts: OPENAI_EFFORTS_OSERIES, speeds: NORMAL_ONLY },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', provider: 'openai', efforts: OPENAI_EFFORTS_CODEX, speeds: NORMAL_ONLY },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai', efforts: OPENAI_EFFORTS_GPT5, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai', efforts: OPENAI_EFFORTS_GPT5, speeds: NORMAL_AND_FAST },
  { id: 'gpt-5-nano', label: 'GPT-5 Nano', provider: 'openai', efforts: OPENAI_EFFORTS_GPT5, speeds: NORMAL_ONLY },
  { id: 'o3', label: 'OpenAI o3', provider: 'openai', efforts: OPENAI_EFFORTS_OSERIES, speeds: NORMAL_ONLY },
  { id: 'o3-pro', label: 'OpenAI o3 Pro', provider: 'openai', efforts: [], speeds: NORMAL_ONLY },
  { id: 'o4-mini', label: 'OpenAI o4-mini', provider: 'openai', efforts: OPENAI_EFFORTS_OSERIES, speeds: NORMAL_ONLY },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai', efforts: [], speeds: NORMAL_AND_FAST },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', efforts: [], speeds: NORMAL_AND_FAST },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', provider: 'openai', efforts: [], speeds: NORMAL_ONLY },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', efforts: [], speeds: NORMAL_AND_FAST },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', efforts: [], speeds: NORMAL_AND_FAST }
];

export const AI_MODEL_EFFORT_LABELS: Record<AiModelEffort, string> = {
  none: 'No reasoning',
  minimal: 'Minimal effort',
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  xhigh: 'Extra-high effort',
  max: 'Max effort',
  ultra: 'Ultra effort'
};

export const AI_MODEL_PROVIDER_LABELS: Record<AiModelProvider, string> = {
  default: 'Default',
  anthropic: 'Anthropic',
  openai: 'OpenAI'
};

const baseModelById = new Map<string, AiWorkflowBaseModel>(
  AI_WORKFLOW_BASE_MODELS.map((model) => [model.id, model])
);

export type AiWorkflowModelChoice = {
  id: PRConflictResolverModelId; // canonical composed option id
  model: string; // provider-native model id ('default' is the sentinel)
  label: string;
  provider: AiModelProvider;
  effort: AiModelEffort | null; // null = provider-default effort
  speed: AiModelSpeed;
};

const composeOptionId = (base: AiWorkflowBaseModel, effort: AiModelEffort | null, speed: AiModelSpeed) =>
  [base.id, ...(effort ? [effort] : []), ...(speed === 'fast' ? ['fast'] : [])].join(':');

const choiceFor = (base: AiWorkflowBaseModel, effort: AiModelEffort | null, speed: AiModelSpeed): AiWorkflowModelChoice => ({
  id: composeOptionId(base, effort, speed),
  model: base.id,
  label: base.label,
  provider: base.provider,
  effort,
  speed
});

// Parse a composed option id. Segment order is tolerated (`model:fast:high`
// parses), but the returned choice always carries the canonical id
// (`model:high:fast`) so storage and dedup stay deterministic.
export const parseAiWorkflowModelOptionId = (value: unknown): AiWorkflowModelChoice | null => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) return null;

  const [baseId, ...segments] = value.split(':');
  const base = baseModelById.get(baseId);
  if (!base) return null;

  let effort: AiModelEffort | null = null;
  let speed: AiModelSpeed = 'normal';
  for (const segment of segments) {
    if (segment === 'fast') {
      if (speed === 'fast' || !base.speeds.includes('fast')) return null;
      speed = 'fast';
    } else if ((base.efforts as readonly string[]).includes(segment)) {
      if (effort !== null) return null;
      effort = segment as AiModelEffort;
    } else {
      return null;
    }
  }

  return choiceFor(base, effort, speed);
};

export const isPrConflictResolverModelId = (value: unknown): value is PRConflictResolverModelId =>
  parseAiWorkflowModelOptionId(value) !== null;

export const DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL: PRConflictResolverModelId[] = ['default'];

// Reads are deliberately forgiving, entry by entry: unknown or malformed
// entries are dropped (an older deploy reading a newer catalog keeps the rest
// of the order instead of losing it), duplicates keep their first position,
// and a value with nothing usable collapses to exactly the safe default. A
// valid order that predates the mandatory fallback is upgraded in memory by
// appending `default` as the final attempt.
export const normalizePrConflictResolverModelWaterfall = (value: unknown): PRConflictResolverModelId[] => {
  if (!Array.isArray(value)) return [...DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL];

  const seen = new Set<PRConflictResolverModelId>();
  const waterfall: PRConflictResolverModelId[] = [];
  for (const entry of value) {
    const choice = parseAiWorkflowModelOptionId(entry);
    if (!choice || seen.has(choice.id)) continue;
    seen.add(choice.id);
    waterfall.push(choice.id);
  }

  if (waterfall.length < 1) return [...DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL];
  if (!waterfall.includes('default')) waterfall.push('default');
  return waterfall;
};

// Anthropic API effort values are the Claude tiers only; catalog parsing
// already restricts anthropic entries to these, this narrows the type.
export const toAnthropicEffort = (
  effort: AiModelEffort | null
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null =>
  effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max'
    ? effort
    : null;

// OpenAI's API reasoning_effort accepts none|minimal|low|medium|high|xhigh|max;
// `ultra` is a Codex-surface tier, so direct API calls clamp it to max.
export const toOpenAiReasoningEffort = (
  effort: AiModelEffort | null
): Exclude<AiModelEffort, 'ultra'> | null => (effort === 'ultra' ? 'max' : effort);

const resolvePreferredProviderChoice = (
  value: unknown,
  provider: Exclude<AiModelProvider, 'default'>
): AiWorkflowModelChoice | null => {
  for (const id of normalizePrConflictResolverModelWaterfall(value)) {
    const choice = parseAiWorkflowModelOptionId(id);
    if (!choice) continue;
    if (choice.provider === provider) return choice;
    // `default` means "this client's own provider-valid default": stop
    // scanning so an entry BELOW the default sentinel never outranks it.
    if (choice.provider === 'default') return null;
  }
  return null;
};

// Direct Anthropic API clients cannot pass the Claude Code `default` sentinel
// as a model id, and cannot run OpenAI entries at all. The first
// Anthropic-capable entry wins; OpenAI entries are skipped; hitting `default`
// first delegates to that client's provider-valid default model.
export const resolveAiPreferredAnthropicChoice = (
  value: unknown,
  providerDefault: string
): AiWorkflowModelChoice => {
  const preferred = resolvePreferredProviderChoice(value, 'anthropic');
  if (preferred) return preferred;
  const fallback = baseModelById.get(providerDefault);
  return {
    id: providerDefault,
    model: providerDefault,
    label: fallback?.label || providerDefault,
    provider: 'anthropic',
    effort: null,
    speed: 'normal'
  };
};

// Compatibility accessor for consumers that only need the model id.
export const resolveAiPreferredClaudeModel = (value: unknown, providerDefault: string): string =>
  resolveAiPreferredAnthropicChoice(value, providerDefault).model;

// Direct OpenAI clients mirror the Anthropic rule: first OpenAI entry wins,
// Anthropic entries are skipped, and `default` (or no OpenAI entry at all)
// returns null so the client keeps its own provider-default model.
export const resolveAiPreferredOpenAiChoice = (value: unknown): AiWorkflowModelChoice | null =>
  resolvePreferredProviderChoice(value, 'openai');

export type ValidatePrConflictResolverModelWaterfallResult =
  | { ok: true; waterfall: PRConflictResolverModelId[] }
  | { ok: false; error: string };

// Writes are strict so an admin always sees validation errors instead of a
// silently rewritten preference order. Entries are stored in canonical form;
// uniqueness is judged on the canonical id (so `model:fast:high` and
// `model:high:fast` are the same entry). Length is unlimited — uniqueness
// against the finite catalog is the only bound.
export const validatePrConflictResolverModelWaterfall = (
  value: unknown
): ValidatePrConflictResolverModelWaterfallResult => {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'waterfall must be an array of model ids' };
  }
  if (value.length < 1) {
    return { ok: false, error: 'waterfall must contain at least 1 model id' };
  }

  const seen = new Set<PRConflictResolverModelId>();
  const waterfall: PRConflictResolverModelId[] = [];
  for (const entry of value) {
    const choice = parseAiWorkflowModelOptionId(entry);
    if (!choice) {
      return { ok: false, error: 'waterfall contains an unknown model id' };
    }
    if (seen.has(choice.id)) {
      return { ok: false, error: 'waterfall model ids must be unique' };
    }
    seen.add(choice.id);
    waterfall.push(choice.id);
  }

  if (!waterfall.includes('default')) {
    return { ok: false, error: 'waterfall must include default as a hard fallback' };
  }

  return { ok: true, waterfall };
};

// Human subtitle for an entry, shared by the Admin editor rows and
// accessibility announcements.
export const describeAiWorkflowModelChoice = (choice: AiWorkflowModelChoice): string => {
  if (choice.provider === 'default') {
    return 'Provider-selected model · always included';
  }
  const bits = [
    AI_MODEL_PROVIDER_LABELS[choice.provider],
    choice.effort ? AI_MODEL_EFFORT_LABELS[choice.effort] : 'Default effort'
  ];
  if (choice.speed === 'fast') bits.push('Fast mode');
  return bits.join(' · ');
};
