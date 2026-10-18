import type { AiModelProviderId } from './modelsCore';
import { buildAiProviderProbeRequest } from './providerProbe';

export class ModelDiscoveryHttpError extends Error {
	constructor(readonly status: number) {
		super(`Model discovery returned HTTP ${status}`);
	}
}

export type DiscoveredAiModel = { id: string; label: string; source?: 'public-docs'; lifecycle?: 'active' | 'legacy' | 'deprecated' | 'retired' };
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
			throw new ModelDiscoveryHttpError(response.status);
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
		if (
			!Array.isArray(body.data) ||
			!body.data.length ||
			((provider === 'anthropic' || body.has_more !== undefined) && typeof body.has_more !== 'boolean')
		)
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

export async function discoverConfiguredProviderModels(
	provider: AiModelProviderId,
	options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<DiscoveredAiModel[]> {
	const env = options.env ?? process.env;
	const fetchImpl = options.fetchImpl ?? fetch;
	if (provider === 'openai') {
		const request = buildAiProviderProbeRequest(provider, env);
		if (!request) throw new Error('OpenAI is not configured');
		// Match the actual SDK project's model visibility.
		if (env.OPENAI_ORG_ID) request.headers['OpenAI-Organization'] = env.OPENAI_ORG_ID;
		if (env.OPENAI_PROJECT_ID) request.headers['OpenAI-Project'] = env.OPENAI_PROJECT_ID;
		return discoverProviderModels(provider, request, fetchImpl);
	}
	// Catalogue reads are independent of inference. Claude subscription OAuth
	// may not grant Models API access; a dedicated discovery key can do so.
	// This key is never passed into the Claude Code inference environment.
	const catalogueKey = env.ANTHROPIC_MODELS_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim();
	if (catalogueKey) {
		try {
			return await discoverProviderModels(provider, {
				url: 'https://api.anthropic.com/v1/models',
				headers: { 'x-api-key': catalogueKey, 'anthropic-version': '2023-06-01' }
			}, fetchImpl);
		} catch (error) {
			if (!(error instanceof ModelDiscoveryHttpError) || ![401, 403].includes(error.status)) throw error;
		}
	}
	// Public lifecycle data needs neither an API key nor a paid Claude account.
	// It is catalogue metadata, never evidence of this account's inference access.
	return discoverPublicClaudeModels(fetchImpl);
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

export const CLAUDE_PUBLIC_MODELS_URL = 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md';

export function parsePublicClaudeModels(markdown: string): DiscoveredAiModel[] {
	const section = markdown.split(/^## Model status\s*$/m)[1]?.split(/^## /m)[0];
	if (!section || !/\|\s*API model name\s*\|\s*Current state\s*\|/i.test(section))
		throw new Error('Public model status table unavailable');
	const models = new Map<string, DiscoveredAiModel>();
	for (const line of section.split('\n')) {
		if (!line.trim().startsWith('|')) continue;
		const cells = line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/`/g, ''));
		if (!cells[0]?.startsWith('claude-')) continue;
		const [id, state] = cells;
		const lifecycle = state.toLowerCase() as NonNullable<DiscoveredAiModel['lifecycle']>;
		if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !['active', 'legacy', 'deprecated', 'retired'].includes(lifecycle) || models.has(id))
			throw new Error('Invalid public model status row');
		const label = id.replace(/^claude-/, 'Claude ').replace(/^(Claude )([a-z]+)/, (_, prefix, family) => prefix + family[0].toUpperCase() + family.slice(1))
			.replace(/-(\d{8})$/, ' ($1)').replace(/-(\d+)/g, ' $1').replace(/ (\d+) (\d+)(?= |$)/, ' $1.$2');
		models.set(id, { id, label, source: 'public-docs', lifecycle });
	}
	if (!models.size || ![...models.values()].some((model) => model.lifecycle === 'active')) throw new Error('Empty public model catalogue');
	return [...models.values()];
}

export async function discoverPublicClaudeModels(fetchImpl: typeof fetch = fetch): Promise<DiscoveredAiModel[]> {
	const response = await fetchImpl(CLAUDE_PUBLIC_MODELS_URL, {
		signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS), redirect: 'error', headers: { accept: 'text/markdown, text/plain' }
	});
	if (!response.ok) { await response.body?.cancel(); throw new ModelDiscoveryHttpError(response.status); }
	const reader = response.body?.getReader();
	if (!reader) throw new Error('Public model catalogue body unavailable');
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > MAX_BODY_BYTES) throw new Error('Public model catalogue exceeded its response budget');
			chunks.push(part.value);
		}
	} finally { await reader.cancel(); }
	return parsePublicClaudeModels(Buffer.concat(chunks).toString('utf8'));
}
