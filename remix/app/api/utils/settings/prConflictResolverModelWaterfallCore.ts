export const PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY =
  'Thingtime.PRConflictAutoResolverModelWaterfall' as const;

export type PRConflictResolverModelId = 'default' | 'claude-fable-5' | 'claude-opus-5';
export type PRConflictAutoResolverModelId = PRConflictResolverModelId;
// The persisted key and endpoint retain their historical conflict-resolver
// names for compatibility, but this is now Thingtime's canonical preference
// type for every Claude-capable AI entrypoint.
export type AiPreferredModelId = PRConflictResolverModelId;

export type PRConflictResolverModel = {
  id: PRConflictResolverModelId;
  label: string;
  effort: 'max';
};

export const PR_CONFLICT_RESOLVER_MODEL_OPTIONS = [
  { id: 'default', label: 'Default model', effort: 'max' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', effort: 'max' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', effort: 'max' }
] as const satisfies readonly PRConflictResolverModel[];

export const DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL: PRConflictResolverModelId[] = ['default'];

const modelIds = new Set<PRConflictResolverModelId>(
  PR_CONFLICT_RESOLVER_MODEL_OPTIONS.map((model) => model.id)
);

export const isPrConflictResolverModelId = (value: unknown): value is PRConflictResolverModelId =>
  typeof value === 'string' && modelIds.has(value as PRConflictResolverModelId);

const readKnownUniqueWaterfall = (value: unknown): PRConflictResolverModelId[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > PR_CONFLICT_RESOLVER_MODEL_OPTIONS.length) {
    return null;
  }

  const seen = new Set<PRConflictResolverModelId>();
  const waterfall: PRConflictResolverModelId[] = [];
  for (const entry of value) {
    if (!isPrConflictResolverModelId(entry) || seen.has(entry)) return null;
    seen.add(entry);
    waterfall.push(entry);
  }

  return waterfall;
};

// Reads are deliberately forgiving: missing or malformed storage collapses to
// exactly the safe default. A valid older value that predates the mandatory
// fallback is upgraded in memory by appending `default` as the final attempt.
export const normalizePrConflictResolverModelWaterfall = (value: unknown): PRConflictResolverModelId[] => {
  const waterfall = readKnownUniqueWaterfall(value);
  if (!waterfall) return [...DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL];
  if (!waterfall.includes('default')) waterfall.push('default');
  return waterfall;
};

// Direct Anthropic API clients cannot pass the Claude Code `default` sentinel
// as a model id. Named Admin choices always win; `default` delegates to that
// client's provider-valid default instead.
export const resolveAiPreferredClaudeModel = (value: unknown, providerDefault: string): string => {
  const primary = normalizePrConflictResolverModelWaterfall(value)[0];
  return primary === 'default' ? providerDefault : primary;
};

export type ValidatePrConflictResolverModelWaterfallResult =
  | { ok: true; waterfall: PRConflictResolverModelId[] }
  | { ok: false; error: string };

// Writes are strict so an admin always sees validation errors instead of a
// silently rewritten preference order.
export const validatePrConflictResolverModelWaterfall = (
  value: unknown
): ValidatePrConflictResolverModelWaterfallResult => {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'waterfall must be an array of model ids' };
  }
  if (value.length < 1 || value.length > PR_CONFLICT_RESOLVER_MODEL_OPTIONS.length) {
    return { ok: false, error: 'waterfall must contain 1 to 3 model ids' };
  }

  const waterfall = readKnownUniqueWaterfall(value);
  if (!waterfall) {
    if (value.some((entry) => !isPrConflictResolverModelId(entry))) {
      return { ok: false, error: 'waterfall contains an unknown model id' };
    }
    return { ok: false, error: 'waterfall model ids must be unique' };
  }
  if (!waterfall.includes('default')) {
    return { ok: false, error: 'waterfall must include default as a hard fallback' };
  }

  return { ok: true, waterfall };
};
