import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { AI_WORKFLOW_BASE_MODELS } from '../settings/prConflictResolverModelWaterfallCore.ts';
import {
  AI_MODEL_CATALOG,
  aiModelFamilyOf,
  aiProviderStatusFromEnv,
  applyAiProviderProbe,
  isAiProviderUsable,
  clampLopuEffort,
  composeAiWorkflowModelChoice,
  DEFAULT_LOPU_CHAT_DEFAULTS,
  deriveAiModelCatalog,
  getAiModelCatalogEntry,
  normalizeLopuChatDefaults,
  pickLopuChatDefaults,
  publicAiModel,
  resolveLopuModelChoice,
  validateLopuChatDefaults,
  type AiModelPublic,
  type AiProviderStatus,
  type AiProviderStatusEntry
  // @ts-ignore Node executes TypeScript through the repo's tsx test loader.
} from './modelsCore.ts';

const CHECKED_AT = '2026-09-04T00:00:00.000Z';
const status = (configured: boolean, verified: boolean | null = null, reason?: string): AiProviderStatusEntry => ({
  configured,
  verified,
  checkedAt: verified === null ? null : CHECKED_AT,
  ...(reason ? { reason } : {})
});

// configured-but-unverified is exactly what the env alone reports
const BOTH_CONFIGURED: AiProviderStatus = { anthropic: status(true), openai: status(true) };
const ANTHROPIC_ONLY: AiProviderStatus = { anthropic: status(true), openai: status(false) };
const NONE: AiProviderStatus = { anthropic: status(false), openai: status(false) };
// both keys set, the probe accepted Anthropic's and the provider rejected OpenAI's
const OPENAI_REJECTED: AiProviderStatus = { anthropic: status(true, true), openai: status(true, false, 'the provider rejected the key (HTTP 401)') };

// A public list the way listAiModels builds it: every catalog entry, optional
// disabled ids, provider availability applied, isDefault flagged.
const publicList = (providers: AiProviderStatus, disabled: string[] = [], stored = DEFAULT_LOPU_CHAT_DEFAULTS): AiModelPublic[] => {
  const models = AI_MODEL_CATALOG.map((entry) => publicAiModel(entry, !disabled.includes(entry.modelId), providers));
  const defaults = pickLopuChatDefaults(models, stored);
  for (const model of models) model.isDefault = model.id === defaults.model;
  return models;
};

test('the catalog derives one row per real base model, in catalog order, with the sentinel dropped', () => {
  const real = AI_WORKFLOW_BASE_MODELS.filter((model) => model.provider !== 'default');
  assert.equal(AI_MODEL_CATALOG.length, real.length);
  assert.deepEqual(
    AI_MODEL_CATALOG.map((entry) => entry.modelId),
    real.map((model) => model.id)
  );
  assert.equal(AI_MODEL_CATALOG.some((entry) => entry.modelId === 'default'), false);
  assert.equal(new Set(AI_MODEL_CATALOG.map((entry) => entry.modelId)).size, AI_MODEL_CATALOG.length);

  // sortOrder is the base-catalog index, so `default` at 0 leaves 1 for the first real model
  assert.equal(AI_MODEL_CATALOG[0].sortOrder, AI_WORKFLOW_BASE_MODELS.findIndex((model) => model.id === AI_MODEL_CATALOG[0].modelId));
  for (let i = 1; i < AI_MODEL_CATALOG.length; i += 1) {
    assert.ok(AI_MODEL_CATALOG[i].sortOrder > AI_MODEL_CATALOG[i - 1].sortOrder);
  }

  const opus = getAiModelCatalogEntry('claude-opus-5')!;
  assert.deepEqual(opus.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(opus.speeds, ['normal', 'fast']);
  assert.equal(opus.family, 'claude');
  assert.equal(opus.contextWindow, 1_000_000);
  assert.equal(getAiModelCatalogEntry('gpt-5.5')!.contextWindow, null);
  assert.equal(getAiModelCatalogEntry(' claude-opus-5 ')?.modelId, 'claude-opus-5');
  assert.equal(getAiModelCatalogEntry('default'), null);
  assert.equal(getAiModelCatalogEntry(42), null);
});

test('family is derived from provider and id', () => {
  assert.equal(aiModelFamilyOf('anthropic', 'claude-haiku-4-5'), 'claude');
  assert.equal(aiModelFamilyOf('openai', 'gpt-5.6-sol'), 'gpt');
  assert.equal(aiModelFamilyOf('openai', 'o3-pro'), 'o-series');
  assert.equal(aiModelFamilyOf('openai', 'o4-mini'), 'o-series');
  assert.equal(getAiModelCatalogEntry('gpt-4o')!.family, 'gpt');

  const custom = deriveAiModelCatalog([
    { id: 'default', label: 'Default model', provider: 'default', efforts: [], speeds: ['normal'] },
    { id: 'o9', label: 'o9', provider: 'openai', efforts: ['low'], speeds: ['normal'] }
  ]);
  assert.deepEqual(custom.map((entry) => [entry.modelId, entry.family, entry.sortOrder]), [['o9', 'o-series', 1]]);
});

test('provider availability is key presence only, honouring the Anthropic auth-token alias', () => {
  assert.deepEqual(aiProviderStatusFromEnv({}), NONE);
  assert.deepEqual(aiProviderStatusFromEnv({ ANTHROPIC_API_KEY: '   ' }), NONE);
  assert.deepEqual(aiProviderStatusFromEnv({ ANTHROPIC_AUTH_TOKEN: 'tok' }), ANTHROPIC_ONLY);
  assert.deepEqual(aiProviderStatusFromEnv({ ANTHROPIC_API_KEY: 'sk', OPENAI_API_KEY: 'sk' }), BOTH_CONFIGURED);
});

test('a probe verdict layers onto the env status; a rejected key makes the provider unusable, an unknown verdict does not', () => {
  const unverified = status(true);
  assert.deepEqual(applyAiProviderProbe(unverified, { verified: true, checkedAt: CHECKED_AT }), status(true, true));
  assert.deepEqual(applyAiProviderProbe(unverified, { verified: false, checkedAt: CHECKED_AT, error: 'the provider rejected the key (HTTP 401)' }), OPENAI_REJECTED.openai);
  assert.deepEqual(applyAiProviderProbe(unverified, { verified: null, checkedAt: CHECKED_AT, error: 'could not reach the provider' }), {
    configured: true,
    verified: null,
    checkedAt: CHECKED_AT,
    reason: 'could not reach the provider'
  });
  // a success never carries a reason, an unconfigured provider ignores any verdict, no verdict = unverified
  assert.equal('reason' in applyAiProviderProbe(unverified, { verified: true, checkedAt: CHECKED_AT, error: 'stale' }), false);
  assert.deepEqual(applyAiProviderProbe(status(false), { verified: true, checkedAt: CHECKED_AT }), status(false));
  assert.deepEqual(applyAiProviderProbe(unverified, null), unverified);

  assert.equal(isAiProviderUsable(status(true, true)), true);
  assert.equal(isAiProviderUsable(status(true)), true, 'unverifiable keeps the models offered');
  assert.equal(isAiProviderUsable(status(true, false)), false);
  assert.equal(isAiProviderUsable(status(false)), false);
});

test('the public projection gates availability on the admin toggle AND the provider key (configured and not rejected)', () => {
  const opus = getAiModelCatalogEntry('claude-opus-5')!;
  const sol = getAiModelCatalogEntry('gpt-5.6-sol')!;
  assert.equal(publicAiModel(opus, true, BOTH_CONFIGURED).available, true);
  assert.equal(publicAiModel(opus, false, BOTH_CONFIGURED).available, false);
  assert.equal(publicAiModel(opus, true, NONE).available, false);
  // the verdict rides on every model of the provider
  assert.equal(publicAiModel(opus, true, BOTH_CONFIGURED).verified, null);
  assert.equal(publicAiModel(opus, true, OPENAI_REJECTED).verified, true);
  assert.equal(publicAiModel(opus, true, OPENAI_REJECTED).available, true);
  assert.equal(publicAiModel(sol, true, OPENAI_REJECTED).verified, false);
  assert.equal(publicAiModel(sol, true, OPENAI_REJECTED).available, false, 'a rejected key hides its models even when enabled');
  assert.equal(publicAiModel(sol, true, NONE).verified, null);
  const projected = publicAiModel(opus, true, ANTHROPIC_ONLY);
  assert.deepEqual(Object.keys(projected).sort(), ['available', 'efforts', 'enabled', 'family', 'id', 'isDefault', 'label', 'provider', 'speeds', 'verified']);
  assert.equal(projected.isDefault, false);
  // copies, never the catalog's own arrays
  projected.efforts.push('ultra');
  assert.equal(opus.efforts.includes('ultra'), false);
});

test('effort clamp: null stays provider-default, offered tiers win, else high, else the deepest tier', () => {
  const opus = getAiModelCatalogEntry('claude-opus-5')!;
  const haiku = getAiModelCatalogEntry('claude-haiku-4-5')!;
  const oseries = getAiModelCatalogEntry('o3')!;
  assert.equal(clampLopuEffort(opus, null), null);
  assert.equal(clampLopuEffort(opus, 'max'), 'max');
  assert.equal(clampLopuEffort(opus, 'ultra'), 'high');
  assert.equal(clampLopuEffort(opus, undefined), 'high');
  assert.equal(clampLopuEffort(haiku, 'high'), null);
  assert.equal(clampLopuEffort({ efforts: ['low', 'medium'] }, 'xhigh'), 'medium');
  assert.equal(clampLopuEffort(oseries, 'high'), 'high');
});

test('pickLopuChatDefaults applies availability: stored model when available, else first available, else nothing', () => {
  assert.deepEqual(pickLopuChatDefaults(publicList(BOTH_CONFIGURED)), { model: 'claude-opus-5', effort: 'high', speed: 'normal' });
  assert.deepEqual(pickLopuChatDefaults(publicList(NONE)), { model: null, effort: null, speed: 'normal' });

  // stored model needs OpenAI, only Anthropic is configured → first available in catalog order, effort re-clamped
  const stored = { model: 'gpt-5.6-sol', effort: 'ultra' as const, speed: 'fast' as const };
  assert.deepEqual(pickLopuChatDefaults(publicList(ANTHROPIC_ONLY), stored), { model: 'claude-fable-5', effort: 'high', speed: 'normal' });
  // …and when the stored model IS available, its own knobs survive
  assert.deepEqual(pickLopuChatDefaults(publicList(BOTH_CONFIGURED), stored), { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });

  // an admin-disabled stored model falls through exactly like a missing key
  assert.deepEqual(pickLopuChatDefaults(publicList(BOTH_CONFIGURED, ['claude-opus-5'])).model, 'claude-fable-5');

  // provider-default effort is a legitimate stored preference
  assert.equal(pickLopuChatDefaults(publicList(BOTH_CONFIGURED), { model: 'claude-opus-5', effort: null, speed: 'normal' }).effort, null);
  // a model without tiers resolves to provider-default effort even from a `high` preference
  assert.deepEqual(pickLopuChatDefaults(publicList(BOTH_CONFIGURED), { model: 'claude-haiku-4-5', effort: 'high', speed: 'fast' }), {
    model: 'claude-haiku-4-5',
    effort: null,
    speed: 'normal'
  });
});

test('stored defaults normalize forgivingly and validate strictly', () => {
  assert.deepEqual(normalizeLopuChatDefaults(undefined), DEFAULT_LOPU_CHAT_DEFAULTS);
  assert.deepEqual(normalizeLopuChatDefaults('junk'), DEFAULT_LOPU_CHAT_DEFAULTS);
  assert.deepEqual(normalizeLopuChatDefaults({ model: 'no-such-model', effort: 'ultra', speed: 'fast' }), {
    model: 'claude-opus-5',
    effort: 'high',
    speed: 'fast'
  });
  assert.deepEqual(normalizeLopuChatDefaults({ model: 'claude-fable-5', effort: null, speed: 'fast' }), {
    model: 'claude-fable-5',
    effort: null,
    speed: 'normal'
  });
  assert.deepEqual(normalizeLopuChatDefaults({ model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' }), {
    model: 'gpt-5.6-sol',
    effort: 'ultra',
    speed: 'fast'
  });

  assert.equal(validateLopuChatDefaults(null).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'default' }).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'no-such-model' }).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'claude-opus-5', effort: 'ultra' }).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'claude-haiku-4-5', effort: 'high' }).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'claude-fable-5', speed: 'fast' }).ok, false);
  assert.equal(validateLopuChatDefaults({ model: 'claude-opus-5', speed: 'warp' }).ok, false);

  assert.deepEqual(validateLopuChatDefaults({ model: ' claude-opus-5 ' }), {
    ok: true,
    defaults: { model: 'claude-opus-5', effort: 'high', speed: 'normal' }
  });
  assert.deepEqual(validateLopuChatDefaults({ model: 'claude-opus-5', effort: null, speed: 'fast' }), {
    ok: true,
    defaults: { model: 'claude-opus-5', effort: null, speed: 'fast' }
  });
  assert.deepEqual(validateLopuChatDefaults({ model: 'claude-haiku-4-5', effort: 'default' }), {
    ok: true,
    defaults: { model: 'claude-haiku-4-5', effort: null, speed: 'normal' }
  });
  assert.deepEqual(validateLopuChatDefaults({ model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' }), {
    ok: true,
    defaults: { model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' }
  });
});

test('composed choices carry the canonical waterfall id', () => {
  assert.equal(composeAiWorkflowModelChoice('claude-opus-5', 'high', 'fast')?.id, 'claude-opus-5:high:fast');
  assert.equal(composeAiWorkflowModelChoice('claude-opus-5', null, 'normal')?.id, 'claude-opus-5');
  assert.equal(composeAiWorkflowModelChoice('claude-haiku-4-5', 'high', 'normal'), null);
});

test('resolveLopuModelChoice accepts composed ids and plain fields, with explicit knobs winning', () => {
  const models = publicList(BOTH_CONFIGURED);

  const composed = resolveLopuModelChoice('claude-opus-5:high:fast', models);
  assert.equal(composed.ok, true);
  if (composed.ok !== true) return;
  assert.equal(composed.choice.id, 'claude-opus-5:high:fast');
  assert.equal(composed.choice.provider, 'anthropic');
  assert.equal(composed.choice.effort, 'high');
  assert.equal(composed.choice.speed, 'fast');
  assert.equal(composed.available, true);
  assert.equal(composed.substituted, false);
  assert.equal(composed.model.id, 'claude-opus-5');

  const plain = resolveLopuModelChoice({ model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' }, models);
  assert.equal(plain.ok && plain.choice.id, 'gpt-5.5:xhigh:fast');

  const overridden = resolveLopuModelChoice({ model: 'claude-opus-5:low:fast', effort: 'max', speed: 'normal' }, models);
  assert.equal(overridden.ok && overridden.choice.id, 'claude-opus-5:max');

  // a composed id without an effort segment inherits the Lopu default tier, not the provider default
  const bare = resolveLopuModelChoice({ model: 'claude-fable-5' }, models);
  assert.equal(bare.ok && bare.choice.id, 'claude-fable-5:high');

  // provider-default effort is spelled null (or 'default')
  const nullEffort = resolveLopuModelChoice({ model: 'claude-fable-5', effort: null }, models);
  assert.equal(nullEffort.ok && nullEffort.choice.effort, null);
  const tierless = resolveLopuModelChoice({ model: 'claude-haiku-4-5' }, models);
  assert.equal(tierless.ok && tierless.choice.effort, null);
});

test('resolveLopuModelChoice falls back to the defaults when no model is requested', () => {
  const models = publicList(BOTH_CONFIGURED, [], { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });
  const defaults = pickLopuChatDefaults(models, { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });

  const withDefaults = resolveLopuModelChoice({}, models, { defaults });
  assert.equal(withDefaults.ok && withDefaults.choice.id, 'gpt-5.6-sol:ultra:fast');

  // without explicit defaults the isDefault flag stands in (effort/speed re-derived)
  const flagged = resolveLopuModelChoice(undefined, models);
  assert.equal(flagged.ok && flagged.choice.model, 'gpt-5.6-sol');
  assert.equal(flagged.ok && flagged.choice.effort, 'high');
  assert.equal(flagged.ok && flagged.choice.speed, 'normal');

  // 'default' is the sentinel, not a model — same as unset
  assert.equal(resolveLopuModelChoice('default', models, { defaults }).ok, true);

  // explicit knobs on the default model still apply
  const knobs = resolveLopuModelChoice({ effort: 'low', speed: 'normal' }, models, { defaults });
  assert.equal(knobs.ok && knobs.choice.id, 'gpt-5.6-sol:low');
});

test('resolveLopuModelChoice rejects unknown, disabled, unavailable, and unoffered knobs in strict mode', () => {
  const models = publicList(ANTHROPIC_ONLY, ['claude-opus-4-6']);

  const unknown = resolveLopuModelChoice({ model: 'claude-opus-9' }, models);
  assert.deepEqual(unknown, { ok: false, status: 400, error: 'Unknown model "claude-opus-9"' });
  assert.equal(resolveLopuModelChoice({ model: 'claude-opus-5:ultra' }, models).ok, false);

  const disabled = resolveLopuModelChoice({ model: 'claude-opus-4-6' }, models);
  assert.equal(disabled.ok, false);
  assert.match(disabled.ok === false ? disabled.error : '', /turned off by an admin/);

  const unavailable = resolveLopuModelChoice({ model: 'gpt-5.5' }, models);
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.ok === false ? unavailable.error : '', /OPENAI_API_KEY/);

  const badEffort = resolveLopuModelChoice({ model: 'claude-opus-5', effort: 'ultra' }, models);
  assert.equal(badEffort.ok, false);
  assert.match(badEffort.ok === false ? badEffort.error : '', /low, medium, high, xhigh, max/);
  const tierless = resolveLopuModelChoice({ model: 'claude-haiku-4-5', effort: 'high' }, models);
  assert.match(tierless.ok === false ? tierless.error : '', /provider-default effort only/);

  const noFastLane = resolveLopuModelChoice({ model: 'claude-fable-5', speed: 'fast' }, models);
  assert.match(noFastLane.ok === false ? noFastLane.error : '', /does not offer a fast lane/);
  assert.equal(resolveLopuModelChoice({ model: 'claude-opus-5', speed: 'warp' }, models).ok, false);
  // never a throw on junk input
  assert.equal(resolveLopuModelChoice(['nope'] as any, models).ok, true);
});

test('lenient mode substitutes and clamps instead of rejecting (stored chat settings path)', () => {
  const models = publicList(ANTHROPIC_ONLY, ['claude-opus-4-6']);
  const defaults = pickLopuChatDefaults(models);

  const substituted = resolveLopuModelChoice({ model: 'gpt-5.5', effort: 'xhigh', speed: 'fast' }, models, { defaults, lenient: true });
  assert.equal(substituted.ok, true);
  if (substituted.ok !== true) return;
  assert.equal(substituted.substituted, true);
  assert.equal(substituted.choice.model, 'claude-opus-5');
  assert.equal(substituted.choice.effort, 'xhigh');
  assert.equal(substituted.choice.speed, 'fast');

  const clamped = resolveLopuModelChoice({ model: 'claude-fable-5', effort: 'ultra', speed: 'fast' }, models, { lenient: true });
  assert.equal(clamped.ok && clamped.choice.id, 'claude-fable-5:high');
  assert.equal(clamped.ok && clamped.substituted, true);

  const disabled = resolveLopuModelChoice({ model: 'claude-opus-4-6' }, models, { defaults, lenient: true });
  assert.equal(disabled.ok && disabled.choice.model, 'claude-opus-5');
});

test('a rejected key behaves like a missing one for defaults and lenient turns, and names itself on a strict pick', () => {
  const models = publicList(OPENAI_REJECTED, [], { model: 'gpt-5.6-sol', effort: 'high', speed: 'normal' });
  // the stored OpenAI default yields to the first verified Anthropic model
  assert.deepEqual(pickLopuChatDefaults(models, { model: 'gpt-5.6-sol', effort: 'high', speed: 'normal' }), { model: 'claude-fable-5', effort: 'high', speed: 'normal' });
  const strict = resolveLopuModelChoice({ model: 'gpt-5.6-sol' }, models);
  assert.equal(strict.ok, false);
  assert.match(strict.ok === false ? strict.error : '', /key invalid/);
  assert.match(strict.ok === false ? strict.error : '', /OPENAI_API_KEY/);
  const lenient = resolveLopuModelChoice({ model: 'gpt-5.6-sol' }, models, { lenient: true });
  assert.equal(lenient.ok && lenient.substituted, true);
  assert.equal(lenient.ok && lenient.choice.provider, 'anthropic');
  // an unconfigured key keeps the old wording
  const missing = resolveLopuModelChoice({ model: 'gpt-5.6-sol' }, publicList(ANTHROPIC_ONLY));
  assert.match(missing.ok === false ? missing.error : '', /needs OPENAI_API_KEY configured/);
});

test('with no provider configured the choice still resolves, flagged unavailable, so chat can answer from the canned fallback', () => {
  const models = publicList(NONE);
  const resolved = resolveLopuModelChoice({}, models);
  assert.equal(resolved.ok, true);
  if (resolved.ok !== true) return;
  assert.equal(resolved.available, false);
  assert.equal(resolved.choice.model, models[0].id);
  assert.equal(models.some((model) => model.isDefault), false);

  // an explicit pick of an unconfigured model is still refused (the picker shows it disabled)
  assert.equal(resolveLopuModelChoice({ model: 'claude-opus-5' }, models).ok, false);
  assert.equal(resolveLopuModelChoice({ model: 'claude-opus-5' }, models, { lenient: true }).ok, true);
  assert.equal(resolveLopuModelChoice({}, []).ok, false);
});
