export const LOPU_USER_VAULT_SYSTEM_TYPE = 'tt.lopuUserVault';
export const LOPU_TRANSCRIPT_SYSTEM_TYPE = 'tt.lopuTranscriptPage';
export const LOPU_USER_VAULT_SCHEMA_VERSION = 1;

export type LopuProviderKind = 'anthropic' | 'openai' | 'google' | 'xai' | 'openrouter' | 'mistral' | 'deepseek' | 'groq' | 'cohere' | 'compatible';

export type LopuProviderEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type LopuProviderSpeed = 'normal' | 'fast';
export type LopuVoiceInputMode = 'native-transcript' | 'provider-audio';

export type LopuProviderModel = {
	id: string;
	label: string;
	efforts: readonly LopuProviderEffort[];
	speeds: readonly LopuProviderSpeed[];
	/** Realtime raw-audio transport implemented by Thingtime for this model. */
	audioInput?: 'realtime';
};

export type LopuProviderTemplate = {
	id: Exclude<LopuProviderKind, 'compatible'>;
	label: string;
	endpoint: string;
	tokenLabel: string;
	models: readonly LopuProviderModel[];
};

const NORMAL = ['normal'] as const;
const NORMAL_FAST = ['normal', 'fast'] as const;
const NO_EFFORT = [] as const;
const OPENAI_REASONING = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
const CLAUDE_REASONING = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const GOOGLE_REASONING = ['minimal', 'low', 'medium', 'high'] as const;
const XAI_REASONING = ['low', 'medium', 'high', 'xhigh'] as const;

export const LOPU_PROVIDER_TEMPLATES: readonly LopuProviderTemplate[] = [
	{
		id: 'openai',
		label: 'OpenAI / Codex',
		endpoint: 'https://api.openai.com/v1',
		tokenLabel: 'OpenAI API key',
		models: [
			{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], speeds: NORMAL_FAST },
			{ id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], speeds: NORMAL_FAST },
			{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], speeds: NORMAL_FAST },
			{ id: 'gpt-5.5', label: 'GPT-5.5', efforts: OPENAI_REASONING, speeds: NORMAL_FAST },
			{ id: 'gpt-5.4', label: 'GPT-5.4', efforts: OPENAI_REASONING, speeds: NORMAL_FAST },
			{ id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', efforts: OPENAI_REASONING, speeds: NORMAL_FAST },
			{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', efforts: ['low', 'medium', 'high', 'xhigh'], speeds: NORMAL },
			{ id: 'gpt-realtime', label: 'GPT Realtime', efforts: NO_EFFORT, speeds: NORMAL },
			{ id: 'gpt-realtime-mini', label: 'GPT Realtime Mini', efforts: NO_EFFORT, speeds: NORMAL }
		]
	},
	{
		id: 'anthropic',
		label: 'Anthropic / Claude',
		endpoint: 'https://api.anthropic.com',
		tokenLabel: 'Claude Code OAuth token',
		models: [
			{ id: 'claude-fable-5', label: 'Claude Fable 5', efforts: CLAUDE_REASONING, speeds: NORMAL },
			{ id: 'claude-opus-5', label: 'Claude Opus 5', efforts: CLAUDE_REASONING, speeds: NORMAL_FAST },
			{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', efforts: CLAUDE_REASONING, speeds: NORMAL },
			{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', efforts: CLAUDE_REASONING, speeds: NORMAL_FAST },
			{ id: 'claude-opus-4-7', label: 'Claude Opus 4.7', efforts: CLAUDE_REASONING, speeds: NORMAL },
			{ id: 'claude-opus-4-6', label: 'Claude Opus 4.6', efforts: ['low', 'medium', 'high', 'max'], speeds: NORMAL },
			{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', efforts: ['low', 'medium', 'high', 'max'], speeds: NORMAL },
			{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', efforts: NO_EFFORT, speeds: NORMAL }
		]
	},
	{
		id: 'google',
		label: 'Google Gemini',
		endpoint: 'https://generativelanguage.googleapis.com/v1beta',
		tokenLabel: 'Gemini API key',
		models: [
			{ id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', efforts: GOOGLE_REASONING, speeds: NORMAL },
			{ id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', efforts: GOOGLE_REASONING, speeds: NORMAL },
			{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', efforts: GOOGLE_REASONING, speeds: NORMAL },
			{ id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', efforts: GOOGLE_REASONING, speeds: NORMAL },
			{ id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', efforts: GOOGLE_REASONING, speeds: NORMAL },
			{ id: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live', efforts: GOOGLE_REASONING, speeds: NORMAL }
		]
	},
	{
		id: 'xai',
		label: 'xAI / Grok',
		endpoint: 'https://api.x.ai/v1',
		tokenLabel: 'xAI API key',
		models: [
			{ id: 'grok-4.3', label: 'Grok 4.3', efforts: XAI_REASONING, speeds: NORMAL },
			{ id: 'grok-build-0.1', label: 'Grok Build 0.1', efforts: XAI_REASONING, speeds: NORMAL },
			{ id: 'grok-voice-latest', label: 'Grok Voice', efforts: ['none', 'high'], speeds: NORMAL, audioInput: 'realtime' },
			{ id: 'grok-voice-think-fast-2.0', label: 'Grok Voice Think Fast 2.0', efforts: ['none', 'high'], speeds: NORMAL, audioInput: 'realtime' }
		]
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		endpoint: 'https://openrouter.ai/api/v1',
		tokenLabel: 'OpenRouter API key',
		models: [
			{ id: 'openai/gpt-5.6-sol', label: 'OpenAI GPT-5.6 Sol', efforts: OPENAI_REASONING, speeds: NORMAL },
			{ id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', efforts: CLAUDE_REASONING, speeds: NORMAL },
			{ id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', efforts: GOOGLE_REASONING, speeds: NORMAL }
		]
	},
	{
		id: 'mistral',
		label: 'Mistral AI',
		endpoint: 'https://api.mistral.ai/v1',
		tokenLabel: 'Mistral API key',
		models: [
			{ id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5', efforts: ['none', 'high'], speeds: NORMAL },
			{ id: 'mistral-small-2603', label: 'Mistral Small 4', efforts: ['none', 'high'], speeds: NORMAL },
			{ id: 'mistral-large-latest', label: 'Mistral Large', efforts: NO_EFFORT, speeds: NORMAL }
		]
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		endpoint: 'https://api.deepseek.com',
		tokenLabel: 'DeepSeek API key',
		models: [
			{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', efforts: ['none', 'low', 'high', 'max'], speeds: NORMAL },
			{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', efforts: ['none', 'low', 'high', 'max'], speeds: NORMAL }
		]
	},
	{
		id: 'groq',
		label: 'Groq',
		endpoint: 'https://api.groq.com/openai/v1',
		tokenLabel: 'Groq API key',
		models: [
			{ id: 'groq/compound', label: 'Groq Compound', efforts: NO_EFFORT, speeds: NORMAL },
			{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', efforts: ['low', 'medium', 'high'], speeds: NORMAL },
			{ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', efforts: ['low', 'medium', 'high'], speeds: NORMAL },
			{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', efforts: NO_EFFORT, speeds: NORMAL }
		]
	},
	{
		id: 'cohere',
		label: 'Cohere',
		endpoint: 'https://api.cohere.ai/compatibility/v1',
		tokenLabel: 'Cohere API key',
		models: [
			{ id: 'command-a-plus-05-2026', label: 'Command A+', efforts: ['none', 'high'], speeds: NORMAL },
			{ id: 'command-a-03-2025', label: 'Command A', efforts: ['none', 'high'], speeds: NORMAL },
			{ id: 'command-r-plus-08-2024', label: 'Command R+', efforts: ['none', 'high'], speeds: NORMAL },
			{ id: 'command-r-08-2024', label: 'Command R', efforts: ['none', 'high'], speeds: NORMAL }
		]
	}
] as const;

const SAFE_ID = /^[A-Za-z0-9_-]{8,120}$/;

export const boundedVaultText = (value: unknown, max: number): string | null => {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text && text.length <= max ? text : null;
};

export const safeVaultId = (value: unknown): string | null => {
	const text = boundedVaultText(value, 120);
	return text && SAFE_ID.test(text) ? text : null;
};

export const normalizeLopuProviderKind = (value: unknown): LopuProviderKind | null =>
	value === 'anthropic' ||
	value === 'openai' ||
	value === 'google' ||
	value === 'xai' ||
	value === 'openrouter' ||
	value === 'mistral' ||
	value === 'deepseek' ||
	value === 'groq' ||
	value === 'cohere' ||
	value === 'compatible'
		? value
		: null;

export const providerTemplateFor = (provider: LopuProviderKind): LopuProviderTemplate | null =>
	LOPU_PROVIDER_TEMPLATES.find((template) => template.id === provider) ?? null;

export const providerModelFor = (provider: LopuProviderKind, modelId: unknown): LopuProviderModel | null => {
	if (typeof modelId !== 'string') return null;
	return providerTemplateFor(provider)?.models.find((model) => model.id === modelId.trim()) ?? null;
};

// A provider-native model id as the vault or a voice request may carry it
// (`gpt-5.4`, `openai/gpt-oss-120b`, `grok-voice-latest`): bounded, no
// whitespace or shell-ish characters, else null.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;
export const safeVaultModelId = (value: unknown): string | null => {
	const text = boundedVaultText(value, 200);
	return text && MODEL_ID.test(text) ? text : null;
};

// The kind's first catalog model — what a connection saved without a model of
// its own runs on. A custom compatible host has no catalog (null): it must
// name its model in Settings → Secure Vault.
export const defaultVaultProviderModel = (provider: LopuProviderKind): string | null => providerTemplateFor(provider)?.models[0]?.id ?? null;

export type LopuRealtimeModelPublic = { id: string; label: string };

// The kind's models that speak the realtime speech-to-speech transport
// (`audioInput: 'realtime'` — the ephemeral client-secret + binary PCM
// WebSocket protocol xAI Grok Voice documents). Direct voice (design note
// §6.1) needs one; every other kind stays on device transcription.
export const realtimeVaultProviderModels = (provider: LopuProviderKind): LopuRealtimeModelPublic[] =>
	(providerTemplateFor(provider)?.models ?? []).filter((model) => model.audioInput === 'realtime').map((model) => ({ id: model.id, label: model.label }));

export const vaultProviderSupportsRealtime = (provider: LopuProviderKind): boolean => realtimeVaultProviderModels(provider).length > 0;

/** Syntax only: this does not authorize a request. Server execution additionally
 * applies the existing private-network/DNS and configured-host policies. */
export const normalizeLopuProviderEndpointSyntax = (value: unknown): string | null => {
 if (typeof value !== 'string' || value.length > 2048) return null;
 try {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
 } catch { return null; }
};
export const USER_VAULT_VALUE_MAX_BYTES = 32 * 1024;
export const validUserVaultValue = (value: unknown): string | null =>
 typeof value === 'string' && value.length > 0 && value.length <= USER_VAULT_VALUE_MAX_BYTES && new TextEncoder().encode(value).byteLength <= USER_VAULT_VALUE_MAX_BYTES ? value : null;
export const normalizeUserVaultGroupId = (value: unknown): string | null => {
 if (value === undefined || value === null || value === '') return null;
 const id = safeVaultId(value); if (!id) throw new Error('Vault environment was not found.'); return id;
};
export type PublicVaultGroup = { id: string; name: string; createdAt: string; updatedAt: string };
export type PublicVaultEntry = {
 id: string; kind: 'secret' | 'provider'; name: string; groupId: string | null;
 key?: string; provider?: LopuProviderKind; endpoint?: string; model?: string;
 hasValue: true; createdAt: string; updatedAt: string;
};
export type UserVaultGroupFields = { name: string };
export type UserVaultSecretFields = { name: string; key: string; value: string; groupId: string | null };
export type UserVaultProviderFields = { name: string; provider: LopuProviderKind; endpoint: string; model?: string; token: string | null; groupId: string | null };
export const normalizeUserVaultGroup = (input: { name?: unknown }): UserVaultGroupFields => {
 const name = boundedVaultText(input.name, 80); if (!name) throw new Error('Environment name is required.'); return { name };
};
export const normalizeUserVaultSecretMetadata = (input: { name?: unknown; key?: unknown; groupId?: unknown }): Omit<UserVaultSecretFields, 'value'> => {
 const name = boundedVaultText(input.name, 120), key = boundedVaultText(input.key, 120);
 if (!name || !key) throw new Error('Secret name and key are required.');
 return { name, key, groupId: normalizeUserVaultGroupId(input.groupId) };
};
export const normalizeUserVaultSecret = (input: { name?: unknown; key?: unknown; value?: unknown; groupId?: unknown }): UserVaultSecretFields => {
 const metadata = normalizeUserVaultSecretMetadata(input), value = validUserVaultValue(input.value);
 if (!value) throw new Error('Secret name, key, and a non-empty bounded value are required.');
 return { ...metadata, value };
};
export const normalizeUserVaultProvider = (
 input: { name?: unknown; provider?: unknown; endpoint?: unknown; model?: unknown; token?: unknown; groupId?: unknown },
 endpointValidator = normalizeLopuProviderEndpointSyntax
): UserVaultProviderFields => {
 const name = boundedVaultText(input.name, 120), provider = normalizeLopuProviderKind(input.provider), endpoint = endpointValidator(input.endpoint), token = validUserVaultValue(input.token);
 if (!name || !provider || !endpoint) throw new Error('Provider name, type, and HTTPS endpoint are required.');
 if (input.token !== undefined && input.token !== null && input.token !== '' && !token) throw new Error('Provider token must be a bounded string.');
 const modelGiven = typeof input.model === 'string' && input.model.trim() !== '', model = modelGiven ? safeVaultModelId(input.model) : null;
 if (modelGiven && !model) throw new Error('Model id must be at most 200 characters of letters, digits, . _ : / @ or -.');
 return { name, provider, endpoint, ...(model ? { model } : {}), token, groupId: normalizeUserVaultGroupId(input.groupId) };
};

// Public comparison syntax shared by server snapshots and the device adapter.
// A version is not an authorization grant or a caller-assigned revision.
export const USER_VAULT_VERSION_PREFIX = 'vault-state-v1:';
export const validUserVaultSnapshotVersion = (version: unknown): version is string =>
 typeof version === 'string' && /^vault-state-v1:[a-f0-9]{64}$/.test(version);
