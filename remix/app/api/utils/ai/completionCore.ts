import { parseAiConnectionIds } from './providerWaterfall';
export const AI_COMPLETION_REQUIREMENTS = { 'api.ai-complete': '1.1.0' } as const;

export type AiCompletionInput = { connectionIds: string[]; system: string; prompt: string };

export const parseAiCompletionInput = (body: unknown): AiCompletionInput => {
	if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Expected a completion request.');
	const value = body as Record<string, unknown>;
	// No inline endpoints, credentials, tools, owner IDs or provider-specific
	// request overrides. Connections come exclusively from the caller's vault.
	if (Object.keys(value).some((key) => !['connectionIds', 'system', 'prompt'].includes(key)))
		throw new TypeError('Unsupported completion option.');
	if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 40_000 ||
		(value.system !== undefined && (typeof value.system !== 'string' || value.system.length > 8_000)))
		throw new TypeError('Provide bounded text for the completion.');
	return { connectionIds: parseAiConnectionIds(value.connectionIds), system: (value.system as string | undefined) || '', prompt: value.prompt };
};
