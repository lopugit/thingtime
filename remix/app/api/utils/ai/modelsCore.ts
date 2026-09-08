// Pure, Mongo-free half of the Lopu model catalog (design note §1.1).
//
// Everything here is data or arithmetic over the Thingtime Admin base-model
// catalog (`AI_WORKFLOW_BASE_MODELS`): the `ai-model` Thing shape, the public
// projection, provider availability, the `Thingtime.LopuChatDefaults`
// singleton grammar, and the per-turn model-choice resolver. The client
// (model picker, admin editor) and the Lopu chat brain import this module for
// the shared types and rules; `./models.ts` adds the MongoDB-backed catalog on
// top. Keep this file free of node/mongo imports.
import type { LopuVaultProviderPublic } from '../lopu/vaultProviders';
import {
  AI_WORKFLOW_BASE_MODELS,
  parseAiWorkflowModelOptionId,
  type AiModelEffort,
  type AiModelSpeed,
  type AiWorkflowBaseModel,
  type AiWorkflowModelChoice
} from '../settings/prConflictResolverModelWaterfallCore';

export type { AiModelEffort, AiModelSpeed, AiWorkflowModelChoice } from '../settings/prConflictResolverModelWaterfallCore';

// The wire shape of GET /api/v1/ai/models: the catalog list plus, for a
// signed-in viewer, their own Secure Vault provider connections (design note
// §1.3 — redacted: id, name, kind, model, endpoint hostname, availability) and
// whether the vault is configured at all. Anonymous viewers get an empty
// list. Shared with the client picker, so it lives in the pure module.
export type AiModelsVaultStatus = { configured: boolean };
export type AiModelsResponseExtras = { vaultProviders: LopuVaultProviderPublic[]; vault: AiModelsVaultStatus };

// ── the `ai-model` Thing kind ───────────────────────────────────────────────

export const AI_MODEL_THINGTIME = 'ai-model' as const;
// Deterministic shareId per catalog model (`ai-model-claude-opus-5`).
export const AI_MODEL_SHARE_ID_PREFIX = 'ai-model-' as const;
// Root `uniqueKeys` namespace (`aiModel:<modelId>`) — server-only BinData, the
// lookup key every catalog read and write rides.
export const AI_MODEL_UNIQUE_KEY_FIELD = 'aiModel' as const;

export const aiModelShareId = (modelId: string): string => `${AI_MODEL_SHARE_ID_PREFIX}${modelId}`;

export type AiModelProviderId = 'anthropic' | 'openai';
export const AI_MODEL_PROVIDER_IDS: readonly AiModelProviderId[] = ['anthropic', 'openai'];

export type AiModelFamily = 'claude' | 'gpt' | 'o-series';
export const AI_MODEL_FAMILIES: readonly AiModelFamily[] = ['claude', 'gpt', 'o-series'];

// Which environment variable makes each provider available (surfaced in
// picker hints and admin errors — never the values themselves).
export const AI_PROVIDER_ENV_HINTS: Readonly<Record<AiModelProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY'
};

export const isAiModelProviderId = (value: unknown): value is AiModelProviderId =>
  value === 'anthropic' || value === 'openai';

// Family is derived, not stored authority: Anthropic models are all Claude,
// OpenAI's `o3`/`o4-mini` line is the o-series, everything else is GPT.
export const aiModelFamilyOf = (provider: AiModelProviderId, modelId: string): AiModelFamily => {
  if (provider === 'anthropic') return 'claude';
  return /^o\d/.test(modelId) ? 'o-series' : 'gpt';
};

// Context windows (tokens) where the provider catalog states them. Anthropic
// values are the published table as of 2026-06; OpenAI windows are left
// unknown rather than guessed — the field is optional on the Thing.
export const AI_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'claude-fable-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000
};

// One catalog row = the crystal of one `ai-model` Thing minus the admin toggle.
export type AiModelCatalogEntry = {
  modelId: string; // provider-native id == catalog id
  label: string;
  provider: AiModelProviderId;
  efforts: AiModelEffort[];
  speeds: AiModelSpeed[];
  family: AiModelFamily;
  sortOrder: number; // index in AI_WORKFLOW_BASE_MODELS
  contextWindow: number | null;
};

// The `default` sentinel is a routing instruction, not a model, so it never
// becomes a doc. Order is the catalog order (sortOrder = base index).
export const deriveAiModelCatalog = (
  baseModels: readonly AiWorkflowBaseModel[] = AI_WORKFLOW_BASE_MODELS
): AiModelCatalogEntry[] => {
  const entries: AiModelCatalogEntry[] = [];
  baseModels.forEach((base, index) => {
    if (!isAiModelProviderId(base.provider)) return;
    entries.push({
      modelId: base.id,
      label: base.label,
      provider: base.provider,
      efforts: [...base.efforts],
      speeds: [...base.speeds],
      family: aiModelFamilyOf(base.provider, base.id),
      sortOrder: index,
      contextWindow: AI_MODEL_CONTEXT_WINDOWS[base.id] ?? null
    });
  });
  return entries;
};

export const AI_MODEL_CATALOG: readonly AiModelCatalogEntry[] = deriveAiModelCatalog();
export const AI_MODEL_CATALOG_IDS: readonly string[] = AI_MODEL_CATALOG.map((entry) => entry.modelId);

const catalogById = new Map<string, AiModelCatalogEntry>(AI_MODEL_CATALOG.map((entry) => [entry.modelId, entry]));

export const getAiModelCatalogEntry = (modelId: unknown): AiModelCatalogEntry | null =>
  typeof modelId === 'string' ? (catalogById.get(modelId.trim()) ?? null) : null;

export const isAiModelCatalogId = (modelId: unknown): modelId is string => getAiModelCatalogEntry(modelId) !== null;

// ── provider availability ───────────────────────────────────────────────────

// One provider's server-side key status: `configured` is presence in the
// env; `verified` is the bounded key probe's verdict (./providerProbe.ts) —
// true = the provider accepted the key, false = it rejected it (401/403),
// null = not configured or not (yet) verifiable (unreachable, timeout,
// unexpected status); `checkedAt` is when the verdict was reached and
// `reason` explains a non-true verdict. Presence and verdicts only — values
// never leave the server.
export type AiProviderStatusEntry = {
  configured: boolean;
  verified: boolean | null;
  checkedAt: string | null;
  reason?: string;
};
export type AiProviderStatus = Record<AiModelProviderId, AiProviderStatusEntry>;

// What the probe reports for one provider (the server's providerProbe.ts
// result satisfies it) — declared here so the merge below stays pure.
export type AiProviderProbeOutcome = { verified: boolean | null; checkedAt: string; error?: string };

const hasEnvValue = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const unverified = (configured: boolean): AiProviderStatusEntry => ({ configured, verified: null, checkedAt: null });

// Availability is a server fact about credentials, never a client claim. The
// Anthropic SDK accepts either an API key or an auth token; only presence is
// reported, values never leave the server. The probe's verdict is layered on
// top by applyAiProviderProbe.
export const aiProviderStatusFromEnv = (env: Readonly<Record<string, string | undefined>>): AiProviderStatus => ({
  anthropic: unverified(hasEnvValue(env.ANTHROPIC_API_KEY) || hasEnvValue(env.ANTHROPIC_AUTH_TOKEN)),
  openai: unverified(hasEnvValue(env.OPENAI_API_KEY))
});

export const NO_AI_PROVIDER_STATUS: AiProviderStatus = { anthropic: unverified(false), openai: unverified(false) };

// Layer a probe verdict onto a provider entry. An unconfigured provider has
// nothing to verify (any verdict is ignored); a missing verdict leaves the
// entry unverified.
export const applyAiProviderProbe = (entry: AiProviderStatusEntry, probe: AiProviderProbeOutcome | null | undefined): AiProviderStatusEntry => {
  if (!entry.configured || !probe) return entry;
  const next: AiProviderStatusEntry = { configured: true, verified: probe.verified, checkedAt: probe.checkedAt };
  if (probe.verified !== true && probe.error) next.reason = probe.error;
  return next;
};

// A provider serves models while its key is configured and not known-bad: an
// unverifiable key (network trouble, no probe yet) still counts.
export const isAiProviderUsable = (entry: AiProviderStatusEntry): boolean => entry.configured && entry.verified !== false;

// ── public projection ───────────────────────────────────────────────────────

export type AiModelPublic = {
  id: string;
  label: string;
  provider: AiModelProviderId;
  efforts: AiModelEffort[];
  speeds: AiModelSpeed[];
  family: AiModelFamily;
  enabled: boolean; // admin toggle
  available: boolean; // enabled && provider key configured && not known-invalid
  // the provider key's probe verdict: true verified, false rejected by the
  // provider, null unknown (unconfigured, or the check could not conclude)
  verified: boolean | null;
  isDefault: boolean; // the resolved Lopu default model
};

export const publicAiModel = (entry: AiModelCatalogEntry, enabled: boolean, providers: AiProviderStatus): AiModelPublic => ({
  id: entry.modelId,
  label: entry.label,
  provider: entry.provider,
  efforts: [...entry.efforts],
  speeds: [...entry.speeds],
  family: entry.family,
  enabled,
  available: enabled && isAiProviderUsable(providers[entry.provider]),
  verified: providers[entry.provider].verified,
  isDefault: false
});

// ── Thingtime.LopuChatDefaults ──────────────────────────────────────────────

export const LOPU_CHAT_DEFAULTS_KEY = 'Thingtime.LopuChatDefaults' as const;

// What the admin stores: always a catalog model (the sentinel is refused).
export type StoredLopuChatDefaults = {
  model: string;
  effort: AiModelEffort | null; // null = provider-default effort
  speed: AiModelSpeed;
};

// What a chat starts from after availability is applied: `model` is null
// only when no provider is usable at all — none configured, or every
// configured key rejected by its provider (chat answers from the canned
// fallback in that case).
export type LopuChatDefaults = {
  model: string | null;
  effort: AiModelEffort | null;
  speed: AiModelSpeed;
};

export const DEFAULT_LOPU_CHAT_DEFAULTS: Readonly<StoredLopuChatDefaults> = { model: 'claude-opus-5', effort: 'high', speed: 'normal' };

const AI_MODEL_EFFORTS: readonly AiModelEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export const isAiModelEffort = (value: unknown): value is AiModelEffort =>
  typeof value === 'string' && (AI_MODEL_EFFORTS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

type EffortCarrier = { efforts: readonly AiModelEffort[] };
type SpeedCarrier = { speeds: readonly AiModelSpeed[] };

// Effort clamp: `null` (provider default) is always valid; an offered
// preference wins; otherwise the model's `high` tier, else its deepest tier,
// else provider default for models without selectable tiers.
export const clampLopuEffort = (model: EffortCarrier, preferred: AiModelEffort | null | undefined): AiModelEffort | null => {
  if (preferred === null) return null;
  if (preferred && model.efforts.includes(preferred)) return preferred;
  if (model.efforts.includes('high')) return 'high';
  return model.efforts.length ? model.efforts[model.efforts.length - 1] : null;
};

// Speed clamp: `fast` only where the model offers a fast lane.
export const clampLopuSpeed = (model: SpeedCarrier, preferred: unknown): AiModelSpeed =>
  preferred === 'fast' && model.speeds.includes('fast') ? 'fast' : 'normal';

// Reads are forgiving: an unknown model collapses to the hard default, an
// effort the model does not offer is clamped, and a fast lane the model does
// not sell drops to normal — so a stale or hand-edited settings doc can never
// make the catalog unreadable.
export const normalizeLopuChatDefaults = (value: unknown): StoredLopuChatDefaults => {
  const raw = isRecord(value) ? value : {};
  const entry = getAiModelCatalogEntry(raw.model) ?? getAiModelCatalogEntry(DEFAULT_LOPU_CHAT_DEFAULTS.model) ?? AI_MODEL_CATALOG[0];
  const effort =
    raw.effort === null ? null : clampLopuEffort(entry, isAiModelEffort(raw.effort) ? raw.effort : DEFAULT_LOPU_CHAT_DEFAULTS.effort);
  return { model: entry.modelId, effort, speed: clampLopuSpeed(entry, raw.speed) };
};

export type ValidateLopuChatDefaultsResult = { ok: true; defaults: StoredLopuChatDefaults } | { ok: false; error: string };

// Writes are strict so an admin sees the problem instead of a silently
// rewritten preference. `effort` omitted → the model's `high` tier (or its
// provider default when it has no tiers); explicit null/''/'default' → the
// provider default; anything else must be a tier the model offers.
export const validateLopuChatDefaults = (value: unknown): ValidateLopuChatDefaultsResult => {
  if (!isRecord(value)) return { ok: false, error: 'defaults must be an object with model, effort, and speed' };
  const entry = getAiModelCatalogEntry(value.model);
  if (!entry) return { ok: false, error: 'model must be a catalog model id (the default sentinel is not a model)' };

  let effort: AiModelEffort | null;
  if (value.effort === undefined) {
    effort = clampLopuEffort(entry, DEFAULT_LOPU_CHAT_DEFAULTS.effort);
  } else if (value.effort === null || value.effort === '' || value.effort === 'default') {
    effort = null;
  } else if (isAiModelEffort(value.effort) && entry.efforts.includes(value.effort)) {
    effort = value.effort;
  } else {
    return {
      ok: false,
      error: entry.efforts.length
        ? `effort for ${entry.label} must be one of ${entry.efforts.join(', ')} (or null for the provider default)`
        : `${entry.label} runs at its provider-default effort only (effort must be null)`
    };
  }

  let speed: AiModelSpeed;
  if (value.speed === undefined || value.speed === null || value.speed === '' || value.speed === 'normal') {
    speed = 'normal';
  } else if (value.speed === 'fast' && entry.speeds.includes('fast')) {
    speed = 'fast';
  } else if (value.speed === 'fast') {
    return { ok: false, error: `${entry.label} does not offer a fast lane` };
  } else {
    return { ok: false, error: 'speed must be normal or fast' };
  }

  return { ok: true, defaults: { model: entry.modelId, effort, speed } };
};

// The minimum a caller must know about a model to pick defaults or resolve a
// choice — AiModelPublic satisfies it, so do cached client copies.
export type LopuModelLike = Pick<AiModelPublic, 'id' | 'efforts' | 'speeds' | 'enabled' | 'available'>;

// Apply availability to the stored singleton: the stored model when it is
// available, else the first available model in catalog order (effort
// re-clamped, preferring `high`), else no model at all.
export const pickLopuChatDefaults = (
  models: readonly LopuModelLike[],
  stored: Readonly<StoredLopuChatDefaults> = DEFAULT_LOPU_CHAT_DEFAULTS
): LopuChatDefaults => {
  const available = models.filter((model) => model.enabled && model.available);
  if (!available.length) return { model: null, effort: null, speed: 'normal' };
  const chosen = available.find((model) => model.id === stored.model) ?? available[0];
  const effort =
    chosen.id === stored.model ? clampLopuEffort(chosen, stored.effort) : clampLopuEffort(chosen, stored.effort ?? 'high');
  return { model: chosen.id, effort, speed: clampLopuSpeed(chosen, stored.speed) };
};

// ── per-turn model choice ───────────────────────────────────────────────────

// Canonical composed choice for a catalog model — the same `<model>[:effort]
// [:fast]` id the Admin waterfall stores, so chat rows and workflow entries
// name the same thing the same way.
export const composeAiWorkflowModelChoice = (
  modelId: string,
  effort: AiModelEffort | null,
  speed: AiModelSpeed
): AiWorkflowModelChoice | null =>
  parseAiWorkflowModelOptionId([modelId, ...(effort ? [effort] : []), ...(speed === 'fast' ? ['fast'] : [])].join(':'));

export type LopuModelRequest = { model?: unknown; effort?: unknown; speed?: unknown };

export type ResolveLopuModelChoiceOptions = {
  // The resolved catalog defaults (from listAiModels); when absent the model
  // flagged isDefault, then the first available model, stands in.
  defaults?: LopuChatDefaults | null;
  // Lenient mode substitutes instead of rejecting: an unknown, disabled, or
  // unavailable model falls back to the default, an unoffered effort/speed is
  // clamped. Use it for stored chat settings; keep strict for user overrides.
  lenient?: boolean;
};

export type ResolveLopuModelChoiceResult =
  | {
      ok: true;
      choice: AiWorkflowModelChoice;
      model: AiModelPublic;
      // false when the provider behind the choice is not configured (or its
      // key was rejected by the provider) — the
      // caller answers from the canned fallback instead of dialing it
      available: boolean;
      // true when lenient mode replaced something the caller asked for
      substituted: boolean;
    }
  | { ok: false; status: 400; error: string };

const choiceFail = (error: string): ResolveLopuModelChoiceResult => ({ ok: false, status: 400, error });

// Validate a requested `{ model, effort, speed }` (or a composed option id
// such as `claude-opus-5:high:fast`) against the catalog and its current
// availability. Precedence: explicit effort/speed > segments of a composed
// id > the defaults (when the model IS the default model) > the model's
// `high` tier at normal speed.
export const resolveLopuModelChoice = (
  requested: LopuModelRequest | string | null | undefined,
  models: readonly AiModelPublic[],
  options: ResolveLopuModelChoiceOptions = {}
): ResolveLopuModelChoiceResult => {
  const request: LopuModelRequest = typeof requested === 'string' ? { model: requested } : isRecord(requested) ? requested : {};
  const lenient = options.lenient === true;
  const byId = new Map(models.map((model) => [model.id, model]));
  const defaultModelId =
    options.defaults?.model ?? models.find((model) => model.isDefault)?.id ?? pickLopuChatDefaults(models).model;

  let model: AiModelPublic | null = null;
  let explicitModel = false;
  let parsedEffort: AiModelEffort | null = null;
  let parsedSpeed: AiModelSpeed = 'normal';
  let substituted = false;

  const rawModel = typeof request.model === 'string' ? request.model.trim() : '';
  if (rawModel && rawModel !== 'default') {
    const parsed = parseAiWorkflowModelOptionId(rawModel);
    const candidate = parsed && parsed.provider !== 'default' ? (byId.get(parsed.model) ?? null) : null;
    if (!parsed || !candidate) {
      if (!lenient) return choiceFail(`Unknown model "${rawModel.slice(0, 80)}"`);
      substituted = true;
    } else if (!candidate.enabled) {
      if (!lenient) return choiceFail(`${candidate.label} is turned off by an admin`);
      substituted = true;
    } else if (!candidate.available) {
      if (!lenient) {
        return choiceFail(
          candidate.verified === false
            ? `${candidate.label} is unavailable — the provider rejected the server's ${AI_PROVIDER_ENV_HINTS[candidate.provider]} (key invalid)`
            : `${candidate.label} needs ${AI_PROVIDER_ENV_HINTS[candidate.provider]} configured on the server`
        );
      }
      substituted = true;
    } else {
      model = candidate;
      explicitModel = true;
      parsedEffort = parsed.effort;
      parsedSpeed = parsed.speed;
    }
  }

  if (!model) {
    model =
      (defaultModelId ? (byId.get(defaultModelId) ?? null) : null) ??
      models.find((entry) => entry.enabled && entry.available) ??
      models.find((entry) => entry.enabled) ??
      models[0] ??
      null;
    if (!model) return choiceFail('No AI models are registered in the catalog');
  }
  const isDefaultModel = model.id === defaultModelId;

  let effort: AiModelEffort | null;
  const rawEffort = request.effort === '' ? undefined : request.effort;
  if (rawEffort === undefined) {
    const inherited = explicitModel && parsedEffort ? parsedEffort : isDefaultModel ? (options.defaults?.effort ?? undefined) : undefined;
    effort = inherited === undefined ? clampLopuEffort(model, 'high') : clampLopuEffort(model, inherited);
  } else if (rawEffort === null || rawEffort === 'default') {
    effort = null;
  } else if (isAiModelEffort(rawEffort) && model.efforts.includes(rawEffort)) {
    effort = rawEffort;
  } else if (lenient) {
    effort = clampLopuEffort(model, isAiModelEffort(rawEffort) ? rawEffort : undefined);
    substituted = true;
  } else {
    return choiceFail(
      model.efforts.length
        ? `effort for ${model.label} must be one of ${model.efforts.join(', ')}`
        : `${model.label} runs at its provider-default effort only`
    );
  }

  let speed: AiModelSpeed;
  const rawSpeed = request.speed;
  if (rawSpeed === undefined || rawSpeed === null || rawSpeed === '') {
    speed =
      explicitModel && parsedSpeed === 'fast'
        ? 'fast'
        : clampLopuSpeed(model, isDefaultModel ? options.defaults?.speed : undefined);
  } else if (rawSpeed === 'normal') {
    speed = 'normal';
  } else if (rawSpeed === 'fast' && model.speeds.includes('fast')) {
    speed = 'fast';
  } else if (lenient) {
    speed = 'normal';
    substituted = true;
  } else {
    return choiceFail(rawSpeed === 'fast' ? `${model.label} does not offer a fast lane` : 'speed must be normal or fast');
  }

  const choice = composeAiWorkflowModelChoice(model.id, effort, speed) ?? {
    id: model.id,
    model: model.id,
    label: model.label,
    provider: model.provider,
    effort,
    speed
  };
  return { ok: true, choice, model, available: model.enabled && model.available, substituted };
};
