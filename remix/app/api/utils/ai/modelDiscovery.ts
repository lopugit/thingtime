import type { AiModelProviderId } from './modelsCore';
import { buildAiProviderProbeRequest } from './providerProbe';

export type DiscoveredAiModel = { id: string; label: string };
export type ModelDiscoveryRequest = { url: string; headers: Record<string, string> };
export const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_MODELS = 2_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// A complete, bounded list or an error. Never publish a partial page set, a
// redirect, an error body, or an empty/malformed success as a new catalogue.
export async function discoverProviderModels(
	provider: AiModelProviderId,
	request: ModelDiscoveryRequest,
	fetchImpl: typeof fetch = fetch
): Promise<DiscoveredAiModel[]> {
	const initial = new URL(request.url);
	if (!['https:', 'http:'].includes(initial.protocol) || initial.username || initial.password) throw new Error('Invalid model discovery endpoint');
	const signal = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS);
	const models = new Map<string, DiscoveredAiModel>();
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < 20; page++) {
		const url = new URL(initial);
		if (provider === 'anthropic') url.searchParams.set('limit', '1000');
		if (cursor) url.searchParams.set('after_id', cursor);
		const response = await fetchImpl(url, { headers: request.headers, signal, redirect: 'manual' });
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Model discovery returned HTTP ${response.status}`);
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error('Model discovery returned no body');
		let bytes = 0;
		const chunks: Uint8Array[] = [];
		try {
			for (;;) {
				const part = await reader.read();
				if (part.done) break;
				bytes += part.value.byteLength;
				if (bytes > MAX_BODY_BYTES) throw new Error('Model discovery exceeded its size limit');
				chunks.push(part.value);
			}
		} finally {
			await reader.cancel();
		}
		const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (!Array.isArray(body.data) || !body.data.length || ((provider === 'anthropic' || body.has_more !== undefined) && typeof body.has_more !== 'boolean'))
			throw new Error('Model discovery returned an incomplete catalogue');
		for (const row of body.data) {
			if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(row.id))
				throw new Error('Model discovery returned an invalid model');
			if (row.lifecycle === 'retired') continue;
			models.set(row.id, { id: row.id, label: typeof row.display_name === 'string' ? row.display_name.slice(0, 120) : row.id });
			if (models.size > MAX_MODELS) throw new Error('Model discovery exceeded its model limit');
		}
		if (body.has_more !== true) {
			if (!models.size) throw new Error('Model discovery returned no active models');
			return [...models.values()];
		}
		// OpenAI's documented /models is not paginated. An unexpected partial
		// response is not evidence that any previously available model disappeared.
		if (provider !== 'anthropic' || typeof body.last_id !== 'string' || !body.last_id || cursors.has(body.last_id))
			throw new Error('Model discovery returned invalid pagination');
		cursor = body.last_id;
		cursors.add(cursor);
	}
	throw new Error('Model discovery exceeded its page limit');
}

export async function discoverConfiguredProviderModels(provider: AiModelProviderId): Promise<DiscoveredAiModel[]> {
	if (provider === 'openai') {
		const request = buildAiProviderProbeRequest(provider, process.env);
		if (!request) throw new Error('OpenAI is not configured');
		// Match the actual SDK project's model visibility.
		if (process.env.OPENAI_ORG_ID) request.headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
		if (process.env.OPENAI_PROJECT_ID) request.headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;
		return discoverProviderModels(provider, request);
	}
	const { resolveClaudeOAuthTokens } = await import('./claudeOAuth');
	const tokens = await resolveClaudeOAuthTokens();
	if (!tokens.length || tokens.length > 8) throw new Error('Claude catalogue credentials unavailable');
	// Discovery only; inference remains in the isolated Claude Code runtime.
	// Every configured credential must finish before absence is authoritative.
	// A scope/plan denial retains the previous catalogue; never try an API key.
	const lists = await Promise.all(
		tokens.map((token) =>
			discoverProviderModels(provider, {
				url: 'https://api.anthropic.com/v1/models',
				headers: { authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' }
			})
		)
	);
	return [...new Map(lists.flat().map((model) => [model.id, model])).values()];
}

// Deliberately narrow: generic 404, invalid credentials, rate limits, tool
// errors and network outages do not mean a model was removed. No raw error
// text is persisted or returned by the sync.
export function isModelUnavailableError(error: unknown): boolean {
	const value = error as any;
	const code = value?.code ?? value?.error?.code;
	if (code === 'model_not_found' || code === 'model_not_available' || code === 'model_retired') return true;
	const status = value?.status;
	const message = typeof value?.message === 'string' ? value.message : '';
	return (
		[400, 404, 410].includes(status) &&
		/\bmodel\b/i.test(message) &&
		/not (?:found|available)|(?:does|may) not exist|no longer (?:available|supported)|retired|decommissioned/i.test(message)
	);
}
