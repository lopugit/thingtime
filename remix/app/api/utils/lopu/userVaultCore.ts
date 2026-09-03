import { BlockList, isIP } from 'node:net';

export const LOPU_USER_VAULT_SYSTEM_TYPE = 'tt.lopuUserVault';
export const LOPU_TRANSCRIPT_SYSTEM_TYPE = 'tt.lopuTranscriptPage';
export const LOPU_USER_VAULT_SCHEMA_VERSION = 1;

export type LopuProviderKind = 'anthropic' | 'openai' | 'google' | 'xai' | 'openrouter' | 'compatible';

export type LopuProviderTemplate = {
	id: Exclude<LopuProviderKind, 'compatible'>;
	label: string;
	endpoint: string;
	model: string;
	tokenLabel: string;
};

export const LOPU_PROVIDER_TEMPLATES: readonly LopuProviderTemplate[] = [
	{ id: 'openai', label: 'OpenAI / Codex', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.4', tokenLabel: 'OpenAI API key' },
	{ id: 'anthropic', label: 'Anthropic / Claude', endpoint: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', tokenLabel: 'Anthropic API key' },
	{ id: 'google', label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', tokenLabel: 'Gemini API key' },
	{ id: 'xai', label: 'xAI / Grok', endpoint: 'https://api.x.ai/v1', model: 'grok-4.6', tokenLabel: 'xAI API key' },
	{ id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.4', tokenLabel: 'OpenRouter API key' }
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
] as const) blockedIpv4.addSubnet(network, prefix, 'ipv4');

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
] as const) blockedIpv6.addSubnet(network, prefix, 'ipv6');

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
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || isBlockedLopuProviderHostname(url.hostname)) return null;
		url.pathname = url.pathname.replace(/\/+$/, '');
		return url.toString().replace(/\/$/, '');
	} catch {
		return null;
	}
};

export const normalizeLopuProviderKind = (value: unknown): LopuProviderKind | null =>
	value === 'anthropic' || value === 'openai' || value === 'google' || value === 'xai' || value === 'openrouter' || value === 'compatible'
		? value
		: null;
