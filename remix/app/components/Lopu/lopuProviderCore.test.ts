import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import {
	DIRECT_VOICE_NO_PROVIDER_REASON,
	DIRECT_VOICE_TRANSCRIBE_REASON,
	directVoiceUnavailableReason,
	resolveDirectVoiceModel,
	vaultProviderSupportsDirectVoice,
	buildLopuProviderGroups,
	describeCheckedAt,
	describeLopuChoice,
	findLopuProviderOption,
	lopuProviderChoiceKey,
	modelUnavailableReason,
	normalizeLopuVaultInfo,
	normalizeLopuVaultProvider,
	normalizeLopuVaultProviders,
	parseLopuProviderChoiceKey,
	PROVIDER_KEY_STATE_LABELS,
	providerKeyState,
	vaultProviderHint,
	type AiModelPublic,
	type LopuVaultProvider
} from './lopuProviderCore.ts';

const model = (id: string, provider: 'anthropic' | 'openai', extra: Partial<AiModelPublic> = {}): AiModelPublic => ({
	id,
	label: id.toUpperCase(),
	provider,
	efforts: ['low', 'high'],
	speeds: ['normal'],
	family: 'x',
	enabled: true,
	available: true,
	isDefault: false,
	...extra
});

const MODELS = [model('gpt-5', 'openai', { isDefault: true }), model('claude-opus-5', 'anthropic', { available: false }), model('claude-sonnet-5', 'anthropic', { enabled: false, available: false })];
const VAULT: LopuVaultProvider[] = [
	{ id: 'vp-1', name: 'Acme proxy', kind: 'compatible', model: 'gpt-4o', endpointHost: 'llm.acme.test', available: true, reason: null, realtimeModels: [] },
	{ id: 'vp-2', name: 'Old key', kind: 'anthropic', model: null, endpointHost: null, available: false, reason: 'vault key not configured', realtimeModels: [] }
];

test('vault providers normalise defensively and never carry a credential', () => {
	assert.equal(normalizeLopuVaultProvider(null), null);
	assert.equal(normalizeLopuVaultProvider({ name: 'no id' }), null);
	const normalized = normalizeLopuVaultProvider({ id: ' vp-9 ', name: '', kind: 'openrouter', model: 'x', endpointHost: 'h', available: 'yes', secret: 'sk-live' });
	assert.deepEqual(normalized, { id: 'vp-9', name: 'vp-9', kind: 'openrouter', model: 'x', endpointHost: 'h', available: true, reason: null, realtimeModels: [] });
	// the kind's realtime models ride along (id + label, junk dropped)
	const voice = normalizeLopuVaultProvider({ id: 'vp-x', kind: 'xai', realtimeModels: [{ id: 'grok-voice-latest', label: 'Grok Voice' }, { id: '' }, 'nope', { id: 'grok-voice-think-fast-2.0' }] })!;
	assert.deepEqual(voice.realtimeModels, [
		{ id: 'grok-voice-latest', label: 'Grok Voice' },
		{ id: 'grok-voice-think-fast-2.0', label: 'grok-voice-think-fast-2.0' }
	]);
	assert.ok(!('secret' in (normalized as object)));
	assert.equal(normalizeLopuVaultProviders('nope').length, 0);
	assert.equal(normalizeLopuVaultProviders([{ id: 'a' }, 7, { id: 'b', available: false, reason: 'blocked host' }]).length, 2);
	assert.deepEqual(normalizeLopuVaultInfo({ configured: true }), { configured: true });
	assert.deepEqual(normalizeLopuVaultInfo({ configured: 'yes' }), { configured: false });
	assert.equal(normalizeLopuVaultInfo(undefined), null);
});

test('composite keys round-trip a model or a vault provider', () => {
	assert.equal(lopuProviderChoiceKey({ model: 'gpt-5', providerId: null }), 'model:gpt-5');
	assert.equal(lopuProviderChoiceKey({ model: 'gpt-5', providerId: 'vp-1' }), 'vault:vp-1');
	assert.equal(lopuProviderChoiceKey(null), '');
	assert.deepEqual(parseLopuProviderChoiceKey('vault:vp-1'), { model: null, providerId: 'vp-1' });
	assert.deepEqual(parseLopuProviderChoiceKey('model:gpt-5'), { model: 'gpt-5', providerId: null });
	assert.deepEqual(parseLopuProviderChoiceKey('gpt-5'), { model: 'gpt-5', providerId: null });
	assert.equal(parseLopuProviderChoiceKey(''), null);
	assert.equal(parseLopuProviderChoiceKey('vault:'), null);
});

test('groups list Claude first, then OpenAI, then the viewer’s providers, disabling what cannot be used', () => {
	const groups = buildLopuProviderGroups(MODELS, VAULT);
	assert.deepEqual(
		groups.map((group) => group.label),
		['Claude', 'OpenAI', 'Your providers']
	);
	const claude = groups[0].options;
	assert.equal(claude[0].disabled, true);
	assert.equal(claude[0].reason, 'needs Anthropic key');
	assert.equal(claude[1].reason, 'disabled by an admin');
	const openai = groups[1].options[0];
	assert.equal(openai.disabled, false);
	assert.equal(openai.isDefault, true);
	assert.equal(openai.key, 'model:gpt-5');
	assert.equal(openai.catalog?.id, 'gpt-5');
	const vault = groups[2].options;
	assert.deepEqual(vault.map((option) => option.key), ['vault:vp-1', 'vault:vp-2']);
	assert.equal(vault[0].hint, 'gpt-4o · llm.acme.test');
	assert.equal(vault[0].model, 'gpt-4o');
	assert.equal(vault[1].disabled, true);
	assert.equal(vault[1].reason, 'vault key not configured');
	assert.equal(findLopuProviderOption(groups, 'vault:vp-2')?.label, 'Old key');
	assert.equal(findLopuProviderOption(groups, 'nope'), null);
	// no vault → no "Your providers" group; no models → only the vault group
	assert.equal(buildLopuProviderGroups(MODELS, []).length, 2);
	assert.deepEqual(buildLopuProviderGroups([], VAULT).map((group) => group.id), ['vault']);
});

test('a rejected server key reads "key invalid" and disables the model; the key-state helpers name every provider state', () => {
	assert.equal(modelUnavailableReason({ enabled: true, available: false, provider: 'openai', verified: false }), 'OpenAI key invalid');
	assert.equal(modelUnavailableReason({ enabled: true, available: false, provider: 'anthropic', verified: null }), 'needs Anthropic key');
	assert.equal(modelUnavailableReason({ enabled: true, available: false, provider: 'anthropic' }), 'needs Anthropic key');
	assert.equal(modelUnavailableReason({ enabled: false, available: false, provider: 'openai', verified: false }), 'disabled by an admin');
	assert.equal(modelUnavailableReason({ enabled: true, available: true, provider: 'openai', verified: true }), null);
	const [group] = buildLopuProviderGroups([model('gpt-5', 'openai', { available: false, verified: false })], null);
	assert.equal(group.options[0].disabled, true);
	assert.equal(group.options[0].reason, 'OpenAI key invalid');

	assert.equal(providerKeyState(undefined), 'missing');
	assert.equal(providerKeyState({ configured: false }), 'missing');
	assert.equal(providerKeyState({ configured: false, verified: true }), 'missing');
	assert.equal(providerKeyState({ configured: true }), 'unverified');
	assert.equal(providerKeyState({ configured: true, verified: null }), 'unverified');
	assert.equal(providerKeyState({ configured: true, verified: true }), 'verified');
	assert.equal(providerKeyState({ configured: true, verified: false }), 'invalid');
	assert.deepEqual(PROVIDER_KEY_STATE_LABELS, { verified: 'key verified', invalid: 'key invalid', unverified: 'key unverified', missing: 'no key' });

	const now = Date.parse('2026-09-04T12:00:00.000Z');
	assert.equal(describeCheckedAt('2026-09-04T11:59:50.000Z', now), 'checked just now');
	assert.equal(describeCheckedAt('2026-09-04T11:57:00.000Z', now), 'checked 3 min ago');
	assert.equal(describeCheckedAt('2026-09-04T10:00:00.000Z', now), 'checked 2 h ago');
	assert.match(describeCheckedAt('2026-09-01T10:00:00.000Z', now) ?? '', /^checked 1 Sep \d\d:\d\d$/);
	assert.equal(describeCheckedAt('2026-09-04T12:30:00.000Z', now), 'checked just now', 'a clock ahead of the server never reads negative');
	assert.equal(describeCheckedAt(null), null);
	assert.equal(describeCheckedAt('garbage'), null);
});

test('chip copy names the vault provider, else the model with effort and speed', () => {
	assert.equal(describeLopuChoice(MODELS, VAULT, { model: 'gpt-5', effort: 'high', speed: 'fast', providerId: null }), 'GPT-5 · High · Fast');
	assert.equal(describeLopuChoice(MODELS, VAULT, { model: 'gpt-5', effort: 'high', speed: 'normal', providerId: 'vp-1' }), 'Acme proxy');
	assert.equal(describeLopuChoice(MODELS, VAULT, { model: null, providerId: 'missing' }), 'Your provider');
	assert.equal(describeLopuChoice(MODELS, null, { model: null }), 'No model');
	assert.equal(describeLopuChoice([], null, { model: null }), 'Auto');
	assert.equal(modelUnavailableReason({ enabled: true, available: true, provider: 'openai' }), null);
	assert.equal(vaultProviderHint({ model: null, endpointHost: null, kind: 'anthropic' }), 'Anthropic');
});

test('direct voice needs a usable provider whose kind lists a realtime model; the reason reads in one line', () => {
	const grok: LopuVaultProvider = { id: 'vp-x', name: 'My Grok', kind: 'xai', model: null, endpointHost: 'api.x.ai', available: true, reason: null, realtimeModels: [{ id: 'grok-voice-latest', label: 'Grok Voice' }, { id: 'grok-voice-think-fast-2.0', label: 'Think Fast' }] };
	assert.equal(vaultProviderSupportsDirectVoice(grok), true);
	assert.equal(vaultProviderSupportsDirectVoice(VAULT[0]), false);
	assert.equal(vaultProviderSupportsDirectVoice({ ...grok, available: false }), false);
	assert.equal(vaultProviderSupportsDirectVoice(null), false);
	assert.equal(directVoiceUnavailableReason(grok, false), null);
	assert.equal(directVoiceUnavailableReason(grok, true), DIRECT_VOICE_TRANSCRIBE_REASON);
	assert.equal(directVoiceUnavailableReason(null, false), DIRECT_VOICE_NO_PROVIDER_REASON);
	assert.equal(directVoiceUnavailableReason(VAULT[0], false), 'Acme proxy needs a provider with realtime voice (xAI Grok Voice)');
	assert.equal(directVoiceUnavailableReason(VAULT[1], false), 'vault key not configured');
	// the chosen realtime model when the provider still lists it, else the first
	assert.equal(resolveDirectVoiceModel(grok, 'grok-voice-think-fast-2.0')?.id, 'grok-voice-think-fast-2.0');
	assert.equal(resolveDirectVoiceModel(grok, 'retired-model')?.id, 'grok-voice-latest');
	assert.equal(resolveDirectVoiceModel(grok, null)?.id, 'grok-voice-latest');
	assert.equal(resolveDirectVoiceModel(VAULT[0], 'grok-voice-latest'), null);
});
