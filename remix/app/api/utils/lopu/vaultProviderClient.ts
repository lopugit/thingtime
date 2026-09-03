// The one place Thingtime dials a user's own AI provider (design note §1.3):
// the SSRF guard (server allowlist → fresh public DNS → private-range check),
// the redirect-refusing fetch every call goes through, the SDK client
// options the chat brain constructs its Anthropic / OpenAI clients from, the
// bounded plain (non-streaming) completion the voice turn uses, and the
// ephemeral realtime credential direct voice (§6.1) mints. Both
// /api/v1/lopu/chats/reply (chat.ts) and /api/v1/lopu/voice/reply +
// /voice/session (voice.ts) route through here, so a guard fix lands in all
// of them at once.
//
// Nothing here logs, stores, or returns a token beyond handing it to the
// request that needs it — the realtime session hands back only the
// provider-minted short-lived credential, never the stored key.

import { lookup } from 'node:dns/promises';

import {
	defaultVaultProviderModel,
	isBlockedLopuProviderHostname,
	LOPU_PROVIDER_TEMPLATES,
	type LopuProviderEffort,
	vaultProviderSupportsRealtime,
	type LopuProviderKind,
	type LopuProviderSpeed
} from './userVaultCore';
import {
	applyProviderDevRewrite,
	parseProviderDevRewrites,
	resolveVaultTurnModel,
	vaultGuardError,
	vaultProviderBaseUrl,
	vaultProviderToolProtocol,
	vaultProviderTransport,
	LOPU_VAULT_HOST_NOT_ALLOWED_REASON,
	LOPU_VAULT_NO_MODEL_REASON,
	LOPU_VAULT_REALTIME_UNSUPPORTED_REASON,
	type LopuVaultProviderTransport,
	type LopuVaultToolProtocol
} from './vaultProviders';

export const LOPU_PROVIDER_TIMEOUT_MS = 90_000;
export const LOPU_PROVIDER_MAX_RESPONSE_BYTES = 512 * 1024;

// A decrypted vault provider connection — what userVault.ts getUserVaultProvider
// returns. Lives in server memory for one turn only. `model` is the row's own
// provider-native model, or null for a connection that runs on its kind's
// first catalog model (resolveVaultTurnModel).
export type LopuVaultProviderRecord = {
	id: string;
	name: string;
	provider: LopuProviderKind;
	endpoint: string;
	model: string | null;
	token: string;
};

export type LopuVaultHistoryMessage = { role: 'user' | 'assistant'; content: string };

const devRewrites = () => parseProviderDevRewrites(process.env);

const configuredProviderHosts = (): Set<string> => {
	const known = LOPU_PROVIDER_TEMPLATES.map((item) => new URL(item.endpoint).hostname.toLowerCase());
	const extra = (process.env.THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS || '')
		.split(',')
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
	const rewritten = [...devRewrites().keys()].map((origin) => new URL(origin).hostname.toLowerCase());
	return new Set([...known, ...extra, ...rewritten]);
};

// Built-in template hosts, THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS, and (outside
// production) any dev-rewritten origin.
export const isVaultProviderHostAllowed = (hostname: string): boolean => configuredProviderHosts().has(hostname.trim().toLowerCase());

export type SafeProviderEndpoint = { endpoint: string; rewritten: boolean };

// The SSRF fence: the host must be admitted by the server allowlist and must
// resolve, right now, to public addresses only. A dev-rewritten origin is
// swapped for its local target and skips the checks (the operator pointed it
// at their own machine, and the table is inert in production builds).
export const assertSafeProviderEndpoint = async (endpoint: string): Promise<SafeProviderEndpoint> => {
	const rewritten = applyProviderDevRewrite(endpoint, devRewrites());
	if (rewritten) return { endpoint: rewritten, rewritten: true };
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw vaultGuardError('This AI provider endpoint is not a valid URL.');
	}
	if (url.protocol !== 'https:') throw vaultGuardError('AI provider endpoints must use HTTPS.');
	if (!configuredProviderHosts().has(url.hostname.toLowerCase())) throw vaultGuardError(LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
	const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
	if (!addresses.length || addresses.some((entry) => isBlockedLopuProviderHostname(entry.address))) {
		throw vaultGuardError('The AI provider endpoint did not resolve to a public address.');
	}
	return { endpoint, rewritten: false };
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// Every provider request refuses redirects (a 3xx could otherwise walk the
// call to an internal host after the DNS check passed).
export const createGuardedProviderFetch = (base: FetchLike = (input, init) => globalThis.fetch(input, init)): FetchLike =>
	(input, init) => base(input, { ...(init || {}), redirect: 'error' });

export type LopuVaultProviderClientConfig = {
	transport: LopuVaultProviderTransport;
	toolProtocol: LopuVaultToolProtocol;
	baseURL: string;
	apiKey: string;
	model: string;
	rewritten: boolean;
};

// What chat.ts builds its SDK client from: guard first, then the base URL
// for the kind (Gemini's OpenAI surface hangs off /openai) and the protocol
// tools travel by. `model` is the connection's own model, else its kind's
// first catalog model, else (a custom host saved without one) the model the
// caller passed.
export const resolveVaultProviderClientConfig = async (
	provider: LopuVaultProviderRecord,
	options: { model?: string | null } = {}
): Promise<LopuVaultProviderClientConfig> => {
	const model = resolveVaultTurnModel(provider.model, options.model, defaultVaultProviderModel(provider.provider));
	if (!model) throw vaultGuardError(LOPU_VAULT_NO_MODEL_REASON);
	const safe = await assertSafeProviderEndpoint(provider.endpoint);
	return {
		transport: vaultProviderTransport(provider.provider),
		toolProtocol: vaultProviderToolProtocol(provider.provider),
		baseURL: vaultProviderBaseUrl(provider.provider, safe.endpoint),
		apiKey: provider.token,
		model,
		rewritten: safe.rewritten
	};
};

const joinEndpoint = (base: string, suffix: string) => `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;

const readBoundedJson = async (response: Response): Promise<any> => {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > LOPU_PROVIDER_MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Error('AI provider response exceeded the safe size limit.');
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(merged));
	} catch {
		throw new Error('AI provider returned an unreadable response.');
	}
};

export type PlainCompletionInput = {
	system: string;
	history: LopuVaultHistoryMessage[];
	prompt: string;
	maxTokens?: number;
	// per-request tuning (the voice turn's { model, effort, speed }); the model
	// resolves like a chat turn (own → kind default → requested)
	model?: string | null;
	effort?: LopuProviderEffort | null;
	speed?: LopuProviderSpeed | null;
	signal?: AbortSignal;
	// test seams — production callers leave both unset
	fetchImpl?: FetchLike;
	assertEndpoint?: typeof assertSafeProviderEndpoint;
};

const OPENAI_STYLE_EFFORT_KINDS: readonly LopuProviderKind[] = ['openai', 'xai', 'mistral', 'deepseek', 'groq', 'cohere'];

// The request body a kind's native API wants for one plain completion, with
// the effort / speed controls each vendor documents (Anthropic
// output_config + fast mode, Gemini thinkingLevel, the OpenAI-style
// reasoning_effort family, DeepSeek's thinking switch, OpenRouter's
// reasoning block, OpenAI's priority tier). Exported for the unit tests.
export const buildPlainCompletionRequest = (
	provider: Pick<LopuVaultProviderRecord, 'provider' | 'token'>,
	endpoint: string,
	input: { system: string; messages: LopuVaultHistoryMessage[]; model: string; maxTokens: number; effort: LopuProviderEffort | null; speed: LopuProviderSpeed }
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } => {
	const { effort, speed } = input;
	const active = effort && effort !== 'none' ? effort : null;
	if (provider.provider === 'anthropic') {
		return {
			url: joinEndpoint(endpoint, 'v1/messages'),
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': provider.token,
				'anthropic-version': '2023-06-01',
				...(speed === 'fast' ? { 'anthropic-beta': 'fast-mode-2026-02-01' } : {})
			},
			body: {
				model: input.model,
				max_tokens: input.maxTokens,
				system: input.system,
				messages: input.messages,
				...(active ? { output_config: { effort: active } } : {}),
				...(speed === 'fast' ? { speed: 'fast' } : {})
			}
		};
	}
	if (provider.provider === 'google') {
		return {
			url: joinEndpoint(endpoint, `models/${encodeURIComponent(input.model)}:generateContent`),
			headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.token },
			body: {
				systemInstruction: { parts: [{ text: input.system }] },
				contents: input.messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
				generationConfig: { maxOutputTokens: input.maxTokens, ...(active ? { thinkingConfig: { thinkingLevel: active } } : {}) }
			}
		};
	}
	return {
		url: joinEndpoint(endpoint, 'chat/completions'),
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.token}` },
		body: {
			model: input.model,
			...(provider.provider === 'openai' ? { max_completion_tokens: input.maxTokens } : { max_tokens: input.maxTokens }),
			messages: [{ role: 'system', content: input.system }, ...input.messages],
			...(OPENAI_STYLE_EFFORT_KINDS.includes(provider.provider) && effort ? { reasoning_effort: effort } : {}),
			...(provider.provider === 'deepseek' && effort ? { thinking: { type: effort === 'none' ? 'disabled' : 'enabled' } } : {}),
			...(provider.provider === 'openrouter' && effort ? { reasoning: { effort } } : {}),
			...(provider.provider === 'openai' && speed === 'fast' ? { service_tier: 'priority' } : {})
		}
	};
};

// The reply text out of a kind's native response. OpenAI-compatible hosts
// may answer with a content array (Mistral's thinking chunks ride beside the
// text) — only the text parts count.
export const extractPlainCompletionText = (kind: LopuProviderKind, result: any): string | null => {
	if (kind === 'anthropic') {
		const text = result?.content?.find((item: any) => item?.type === 'text')?.text;
		return typeof text === 'string' ? text : null;
	}
	if (kind === 'google') {
		const parts = result?.candidates?.[0]?.content?.parts;
		return Array.isArray(parts) ? parts.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('') : null;
	}
	const content = result?.choices?.[0]?.message?.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
			.map((item: any) => item.text)
			.join('');
	}
	return null;
};

// One bounded, non-streaming completion on the connection's native API
// (Messages for Anthropic, generateContent for Gemini, chat.completions for
// everything else) — the voice turn's model call. Throws user-facing errors.
export const callVaultProviderPlainCompletion = async (provider: LopuVaultProviderRecord, input: PlainCompletionInput): Promise<string> => {
	const model = resolveVaultTurnModel(provider.model, input.model, defaultVaultProviderModel(provider.provider));
	if (!model) throw vaultGuardError(LOPU_VAULT_NO_MODEL_REASON);
	const safe = await (input.assertEndpoint ?? assertSafeProviderEndpoint)(provider.endpoint);
	const request = buildPlainCompletionRequest(provider, safe.endpoint, {
		system: input.system,
		messages: [...input.history, { role: 'user' as const, content: input.prompt }],
		model,
		maxTokens: input.maxTokens ?? 4096,
		effort: input.effort ?? null,
		speed: input.speed ?? 'normal'
	});
	const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(LOPU_PROVIDER_TIMEOUT_MS)]) : AbortSignal.timeout(LOPU_PROVIDER_TIMEOUT_MS);
	let response: Response;
	try {
		response = await createGuardedProviderFetch(input.fetchImpl)(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal });
	} catch {
		throw new Error('The selected AI provider could not be reached.');
	}
	const result = await readBoundedJson(response);
	if (!response.ok) throw new Error(`The selected AI provider rejected the request (${response.status}).`);
	const text = extractPlainCompletionText(provider.provider, result);
	if (typeof text !== 'string' || !text.trim()) throw new Error('The selected AI provider returned no text.');
	return text.trim();
};

// ── direct voice: the ephemeral realtime credential ─────────────────────────

export const LOPU_REALTIME_SECRET_TTL_SECONDS = 300;
const MAX_REALTIME_TOKEN_CHARS = 8_192;

// What /api/v1/lopu/voice/session hands the client: the provider-minted
// short-lived credential and the fixed realtime WebSocket URL for the model.
// The stored key is exchanged server-side and never travels.
export type VaultProviderRealtimeSession = {
	provider: LopuProviderKind;
	model: string;
	token: string;
	expiresAt: number | null;
	webSocketUrl: string;
};

export type RealtimeSessionInput = {
	model: string;
	// test seams — production callers leave both unset
	fetchImpl?: FetchLike;
	assertEndpoint?: typeof assertSafeProviderEndpoint;
};

// Exchange the stored key for a five-minute client secret on the kind's
// realtime surface (`POST <endpoint>/realtime/client_secrets`, the protocol
// xAI Grok Voice documents; only kinds whose template lists a realtime
// model qualify — voice.ts checks the model). Same fence as every other
// call: allowlist + fresh public DNS, redirects refused, bounded timeout and
// response. The credential that comes back must differ from the key it was
// minted with, so a misbehaving endpoint can never echo the key downstream.
export const mintVaultProviderRealtimeSession = async (provider: LopuVaultProviderRecord, input: RealtimeSessionInput): Promise<VaultProviderRealtimeSession> => {
	if (!vaultProviderSupportsRealtime(provider.provider)) throw vaultGuardError(LOPU_VAULT_REALTIME_UNSUPPORTED_REASON);
	const model = input.model.trim();
	if (!model) throw vaultGuardError(LOPU_VAULT_NO_MODEL_REASON);
	const safe = await (input.assertEndpoint ?? assertSafeProviderEndpoint)(provider.endpoint);
	let response: Response;
	try {
		response = await createGuardedProviderFetch(input.fetchImpl)(joinEndpoint(safe.endpoint, 'realtime/client_secrets'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.token}` },
			body: JSON.stringify({ expires_after: { seconds: LOPU_REALTIME_SECRET_TTL_SECONDS } }),
			signal: AbortSignal.timeout(LOPU_PROVIDER_TIMEOUT_MS)
		});
	} catch {
		throw new Error('The selected realtime AI provider could not be reached.');
	}
	const result = await readBoundedJson(response);
	if (!response.ok) throw new Error(`The realtime AI provider rejected the session request (${response.status}).`);
	const token = typeof result?.value === 'string' ? result.value.trim() : '';
	if (!token || token.length > MAX_REALTIME_TOKEN_CHARS || token === provider.token || token.includes(provider.token)) {
		throw new Error('The realtime AI provider returned an invalid session credential.');
	}
	const webSocket = new URL(joinEndpoint(safe.endpoint, 'realtime'));
	// a dev-rewritten http origin speaks ws:; every real endpoint is https → wss:
	webSocket.protocol = webSocket.protocol === 'http:' ? 'ws:' : 'wss:';
	webSocket.searchParams.set('model', model);
	return {
		provider: provider.provider,
		model,
		token,
		expiresAt: typeof result?.expires_at === 'number' && Number.isFinite(result.expires_at) ? result.expires_at : null,
		webSocketUrl: webSocket.toString()
	};
};
