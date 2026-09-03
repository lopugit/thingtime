import { BlockList, isIP } from 'node:net';

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
		tokenLabel: 'Anthropic API key',
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

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4]
] as const)
	blockedIpv4.addSubnet(network, prefix, 'ipv4');

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
	['::', 128],
	['::1', 128],
	['::ffff:0:0', 96],
	// NAT64 (RFC 6052 well-known prefix + RFC 8215 local-use): an IPv6 literal
	// that a translator would hand to a private IPv4 host
	['64:ff9b::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const)
	blockedIpv6.addSubnet(network, prefix, 'ipv6');

export const isBlockedLopuProviderHostname = (hostname: string): boolean => {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	)
		return true;
	const kind = isIP(host);
	if (kind === 4) return blockedIpv4.check(host, 'ipv4');
	if (kind === 6) return blockedIpv6.check(host, 'ipv6');
	return false;
};

export const normalizeLopuProviderEndpoint = (value: unknown): string | null => {
	if (typeof value !== 'string' || value.length > 2048) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || isBlockedLopuProviderHostname(url.hostname))
			return null;
		url.pathname = url.pathname.replace(/\/+$/, '');
		return url.toString().replace(/\/$/, '');
	} catch {
		return null;
	}
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
