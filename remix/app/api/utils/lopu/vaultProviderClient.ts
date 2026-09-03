// The one place Thingtime dials a user's own AI provider (design note §1.3):
// the SSRF guard (server allowlist → fresh public DNS → private-range check),
// the redirect-refusing fetch every call goes through, the SDK client
// options the chat brain constructs its Anthropic / OpenAI clients from, and
// the bounded plain (non-streaming) completion the voice turn uses. Both
// /api/v1/lopu/chats/reply (chat.ts) and /api/v1/lopu/voice/reply (voice.ts)
// route through here, so a guard fix lands in both at once.
//
// Nothing here logs, stores, or returns a token beyond handing it to the
// request that needs it.

import { lookup } from 'node:dns/promises';

import { isBlockedLopuProviderHostname, LOPU_PROVIDER_TEMPLATES, type LopuProviderKind } from './userVaultCore';
import {
	applyProviderDevRewrite,
	parseProviderDevRewrites,
	vaultGuardError,
	vaultProviderBaseUrl,
	vaultProviderToolProtocol,
	vaultProviderTransport,
	LOPU_VAULT_HOST_NOT_ALLOWED_REASON,
	LOPU_VAULT_NO_MODEL_REASON,
	type LopuVaultProviderTransport,
	type LopuVaultToolProtocol
} from './vaultProviders';

export const LOPU_PROVIDER_TIMEOUT_MS = 90_000;
export const LOPU_PROVIDER_MAX_RESPONSE_BYTES = 512 * 1024;

// A decrypted vault provider connection — what userVault.ts getUserVaultProvider
// returns. Lives in server memory for one turn only.
export type LopuVaultProviderRecord = {
	id: string;
	name: string;
	provider: LopuProviderKind;
	endpoint: string;
	model: string;
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
// tools travel by. `model` is the connection's own model or, for a row saved
// without one, the model the caller passed.
export const resolveVaultProviderClientConfig = async (
	provider: LopuVaultProviderRecord,
	options: { model?: string | null } = {}
): Promise<LopuVaultProviderClientConfig> => {
	const model = (provider.model || options.model || '').trim();
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
	signal?: AbortSignal;
};

// One bounded, non-streaming completion on the connection's native API
// (Messages for Anthropic, generateContent for Gemini, chat.completions for
// everything else) — the voice turn's model call. Throws user-facing errors.
export const callVaultProviderPlainCompletion = async (provider: LopuVaultProviderRecord, input: PlainCompletionInput): Promise<string> => {
	const safe = await assertSafeProviderEndpoint(provider.endpoint);
	const maxTokens = input.maxTokens ?? 4096;
	const messages = [...input.history, { role: 'user' as const, content: input.prompt }];
	let url: string;
	let headers: Record<string, string>;
	let body: unknown;
	if (provider.provider === 'anthropic') {
		url = joinEndpoint(safe.endpoint, 'v1/messages');
		headers = { 'Content-Type': 'application/json', 'x-api-key': provider.token, 'anthropic-version': '2023-06-01' };
		body = { model: provider.model, max_tokens: maxTokens, system: input.system, messages };
	} else if (provider.provider === 'google') {
		url = joinEndpoint(safe.endpoint, `models/${encodeURIComponent(provider.model)}:generateContent`);
		headers = { 'Content-Type': 'application/json', 'x-goog-api-key': provider.token };
		body = {
			systemInstruction: { parts: [{ text: input.system }] },
			contents: messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
			generationConfig: { maxOutputTokens: maxTokens }
		};
	} else {
		url = joinEndpoint(safe.endpoint, 'chat/completions');
		headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.token}` };
		body = { model: provider.model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: input.system }, ...messages] };
	}
	const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(LOPU_PROVIDER_TIMEOUT_MS)]) : AbortSignal.timeout(LOPU_PROVIDER_TIMEOUT_MS);
	let response: Response;
	try {
		response = await createGuardedProviderFetch()(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
	} catch {
		throw new Error('The selected AI provider could not be reached.');
	}
	const result = await readBoundedJson(response);
	if (!response.ok) throw new Error(`The selected AI provider rejected the request (${response.status}).`);
	const text =
		provider.provider === 'anthropic'
			? result?.content?.find((item: any) => item?.type === 'text')?.text
			: provider.provider === 'google'
				? result?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('')
				: result?.choices?.[0]?.message?.content;
	if (typeof text !== 'string' || !text.trim()) throw new Error('The selected AI provider returned no text.');
	return text.trim();
};
