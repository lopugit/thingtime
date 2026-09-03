// "Your own providers" — the pure half of running a Lopu turn through one of
// the viewer's Secure Vault AI connections (design note §1.3).
//
// Everything here is data or arithmetic: the public projection that
// GET /api/v1/ai/models publishes (never a token, never an endpoint beyond
// its hostname), the kind → transport / tool-protocol mapping the chat brain
// dials with, the friendly error text a failed BYO turn surfaces, and the
// parser for the dev-only endpoint rewrite table. Keep this file free of
// node/mongo imports so the client and the unit tests can import it; the
// node-bound half (allowlist + DNS guard, guarded fetch, the plain
// completion voice uses) lives in ./vaultProviderClient.ts.

import type { LopuProviderKind, LopuRealtimeModelPublic } from './userVaultCore';

// The SDK surface a vault kind speaks: Anthropic's Messages API, or an
// OpenAI-compatible chat.completions endpoint (OpenAI, OpenRouter, xAI,
// Gemini's /openai compatibility surface, and any custom compatible host).
export type LopuVaultProviderTransport = 'anthropic' | 'openai';

// How tools reach the model: native function calling where the vendor
// documents it, otherwise the fenced ```tt-tool text protocol that needs
// nothing from the endpoint.
export type LopuVaultToolProtocol = 'native' | 'text';

// What GET /api/v1/ai/models returns for a signed-in viewer (the contract in
// PRs/592 §1.3). `endpointHost` is the hostname only; `reason` explains an
// `available: false`.
export type LopuVaultProviderPublic = {
	id: string;
	name: string;
	kind: LopuProviderKind;
	// the model a turn on this connection runs: the row's own, else the kind's
	// first catalog model; null only for a custom host saved without one
	model: string | null;
	endpointHost: string | null;
	available: boolean;
	reason?: string;
	// the kind's realtime speech-to-speech models (direct voice, §6.1) — empty
	// for every kind that has none
	realtimeModels: LopuRealtimeModelPublic[];
};

// Every key the projection may carry — pinned so a test can prove nothing
// else (a token, an endpoint, a group id) ever rides along.
export const LOPU_VAULT_PROVIDER_PUBLIC_KEYS: readonly (keyof LopuVaultProviderPublic)[] = ['id', 'name', 'kind', 'model', 'endpointHost', 'available', 'reason', 'realtimeModels'];

// The vault entry shape the projection reads: the redacted PublicVaultEntry
// from userVault.ts (no encrypted fields are ever loaded for a list).
export type LopuVaultProviderEntryLike = {
	id: string;
	kind?: string;
	name: string;
	provider?: string;
	endpoint?: string;
	model?: string;
};

export type LopuVaultProviderAvailability = {
	vaultConfigured: boolean;
	// the server allowlist (built-in template hosts + THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS,
	// plus any dev rewrite origin) — resolved by vaultProviderClient.ts
	hostAllowed: (hostname: string) => boolean;
	// the kind's catalog (userVaultCore templates): the model a row without one
	// runs on, and the realtime models direct voice may pick — both optional so
	// the pure tests can run without the catalog
	defaultModel?: (kind: LopuProviderKind) => string | null;
	realtimeModels?: (kind: LopuProviderKind) => LopuRealtimeModelPublic[];
};

export const LOPU_VAULT_PROVIDER_KINDS: readonly LopuProviderKind[] = ['anthropic', 'openai', 'google', 'xai', 'openrouter', 'mistral', 'deepseek', 'groq', 'cohere', 'compatible'];

export const isLopuVaultProviderKind = (value: unknown): value is LopuProviderKind =>
	typeof value === 'string' && (LOPU_VAULT_PROVIDER_KINDS as readonly string[]).includes(value);

export const vaultProviderTransport = (kind: LopuProviderKind): LopuVaultProviderTransport => (kind === 'anthropic' ? 'anthropic' : 'openai');

// Function calling is documented on every named vendor's surface (Anthropic
// natively; OpenAI, OpenRouter, xAI and Gemini's OpenAI-compatible endpoint
// through `tools`). A custom "compatible" host is unknown, so it gets the
// fenced-text protocol, which works on anything that returns text.
export const vaultProviderToolProtocol = (kind: LopuProviderKind): LopuVaultToolProtocol => (kind === 'compatible' ? 'text' : 'native');

const trimSlashes = (value: string): string => value.replace(/\/+$/, '');

// The base URL the SDK client is pointed at. Gemini exposes its OpenAI
// compatibility surface under `<v1beta>/openai`; every other kind stores the
// base itself (`https://api.openai.com/v1`, `https://api.anthropic.com`).
export const vaultProviderBaseUrl = (kind: LopuProviderKind, endpoint: string): string => {
	const base = trimSlashes(endpoint.trim());
	if (kind === 'google') return /\/openai$/.test(base) ? base : `${base}/openai`;
	return base;
};

export const endpointHostOf = (endpoint: unknown): string | null => {
	if (typeof endpoint !== 'string' || !endpoint.trim()) return null;
	try {
		return new URL(endpoint.trim()).hostname.toLowerCase() || null;
	} catch {
		return null;
	}
};

export const LOPU_VAULT_UNCONFIGURED_REASON = 'Secure Vault is not configured on this server.';
export const LOPU_VAULT_HOST_NOT_ALLOWED_REASON = 'This endpoint host is not enabled by the Thingtime administrator.';
export const LOPU_VAULT_NO_MODEL_REASON = 'Add a model to this connection in Settings → Secure Vault.';
export const LOPU_VAULT_NO_ENDPOINT_REASON = 'This connection has no usable HTTPS endpoint.';
export const LOPU_VAULT_UNSUPPORTED_KIND_REASON = 'This connection type is not supported for chat.';
// direct voice (§6.1) — the connection's kind offers no realtime model, or
// the model asked for is not one of them
export const LOPU_VAULT_REALTIME_UNSUPPORTED_REASON = 'Direct voice needs a provider with realtime speech (xAI Grok Voice) — this connection has none.';
export const LOPU_VAULT_REALTIME_MODEL_REASON = 'Choose a realtime voice model (Grok Voice) for direct voice.';

// One vault entry → its public projection (null for non-provider records).
export const publicVaultProvider = (entry: LopuVaultProviderEntryLike, availability: LopuVaultProviderAvailability): LopuVaultProviderPublic | null => {
	if (!entry || typeof entry !== 'object' || entry.kind !== 'provider' || typeof entry.id !== 'string' || !entry.id) return null;
	const kind = isLopuVaultProviderKind(entry.provider) ? entry.provider : null;
	const endpointHost = endpointHostOf(entry.endpoint);
	const own = typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim().slice(0, 200) : null;
	const model = own ?? (kind ? availability.defaultModel?.(kind) ?? null : null);
	const realtimeModels = kind ? availability.realtimeModels?.(kind) ?? [] : [];
	const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 120) : 'Untitled provider';
	let reason: string | undefined;
	if (!availability.vaultConfigured) reason = LOPU_VAULT_UNCONFIGURED_REASON;
	else if (!kind) reason = LOPU_VAULT_UNSUPPORTED_KIND_REASON;
	else if (!endpointHost) reason = LOPU_VAULT_NO_ENDPOINT_REASON;
	else if (!availability.hostAllowed(endpointHost)) reason = LOPU_VAULT_HOST_NOT_ALLOWED_REASON;
	else if (!model) reason = LOPU_VAULT_NO_MODEL_REASON;
	return {
		id: entry.id,
		name,
		kind: kind ?? 'compatible',
		model,
		endpointHost,
		available: !reason,
		...(reason ? { reason } : {}),
		realtimeModels
	};
};

export const publicVaultProviders = (entries: readonly LopuVaultProviderEntryLike[], availability: LopuVaultProviderAvailability): LopuVaultProviderPublic[] =>
	entries.map((entry) => publicVaultProvider(entry, availability)).filter((entry): entry is LopuVaultProviderPublic => entry !== null);

// ── the model a BYO turn runs ────────────────────────────────────────────────

// The connection's own model wins; a connection saved without one runs on
// its kind's first catalog model (`fallbackModel`, userVaultCore's
// defaultVaultProviderModel); only a custom host with neither borrows the
// model the request asked for (older rows).
export const resolveVaultTurnModel = (entryModel: unknown, requestedModel: unknown, fallbackModel?: string | null): string | null => {
	const own = typeof entryModel === 'string' ? entryModel.trim() : '';
	if (own) return own.slice(0, 200);
	const fallback = typeof fallbackModel === 'string' ? fallbackModel.trim() : '';
	if (fallback) return fallback.slice(0, 200);
	const requested = typeof requestedModel === 'string' ? requestedModel.trim() : '';
	return requested && requested !== 'default' ? requested.slice(0, 200) : null;
};

// ── friendly errors ──────────────────────────────────────────────────────────

const MAX_ERROR_DETAIL_CHARS = 160;

// Providers never echo credentials, but a bounded detail string is scrubbed
// of anything key-shaped before it reaches the user regardless.
const scrubSecrets = (value: string): string => value.replace(/\b(?:sk|xai|gsk|or|anthropic)-[A-Za-z0-9_-]{8,}/gi, '[key]').replace(/Bearer\s+\S+/gi, 'Bearer [key]');

const statusOf = (error: unknown): number | null => {
	if (!error || typeof error !== 'object') return null;
	const candidates = [(error as any).status, (error as any).statusCode, (error as any).response?.status];
	for (const candidate of candidates) {
		const status = Number(candidate);
		if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
	}
	return null;
};

const detailOf = (error: unknown): string => {
	const message = error && typeof error === 'object' ? String((error as any).error?.message || (error as any).error?.error?.message || (error as any).message || '') : String(error || '');
	const line = message.replace(/\s+/g, ' ').trim();
	if (!line) return '';
	const cut = line.length > MAX_ERROR_DETAIL_CHARS ? `${line.slice(0, MAX_ERROR_DETAIL_CHARS - 1)}…` : line;
	return scrubSecrets(cut);
};

const isConnectionError = (error: unknown): boolean => {
	if (!error || typeof error !== 'object') return false;
	const name = String((error as any).name || '');
	const code = String((error as any).code || (error as any).cause?.code || '');
	const message = String((error as any).message || '');
	return (
		name === 'APIConnectionError' ||
		name === 'APIConnectionTimeoutError' ||
		/^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|UND_ERR)/.test(code) ||
		/fetch failed|Connection error|could not be reached|network/i.test(message)
	);
};

export const LOPU_VAULT_GUARD_ERROR_MARK = '[lopu-vault-guard]';

// A guard refusal (allowlist, DNS, missing model) is already user-facing; it
// is tagged so the mapper passes it through verbatim.
export const vaultGuardError = (message: string): Error => {
	const error = new Error(message);
	error.name = 'LopuVaultGuardError';
	return error;
};

export const isVaultGuardError = (error: unknown): boolean => !!error && typeof error === 'object' && (error as any).name === 'LopuVaultGuardError';

// One line the user can act on — never the URL, never the token.
export const friendlyVaultProviderError = (providerName: string, model: string | null, error: unknown): string => {
	const name = providerName.trim() || 'Your provider';
	if (isVaultGuardError(error)) return String((error as Error).message);
	const status = statusOf(error);
	if (status === 401 || status === 403) return `${name} rejected the saved key (HTTP ${status}). Check the token in Settings → Secure Vault.`;
	if (status === 404) return `${name} does not know the model${model ? ` "${model}"` : ''} (HTTP 404). Check the model name in Settings → Secure Vault.`;
	if (status === 429) return `${name} is rate-limiting requests (HTTP 429) — try again in a moment.`;
	if (status === 402) return `${name} reports no remaining credit (HTTP 402).`;
	if (status !== null && status >= 500) return `${name} is having trouble right now (HTTP ${status}) — try again shortly.`;
	if (status !== null && status >= 400) {
		const detail = detailOf(error);
		return `${name} rejected the request (HTTP ${status})${detail ? `: ${detail}` : '.'}`;
	}
	if (isConnectionError(error)) return `${name} could not be reached. Check the endpoint in Settings → Secure Vault.`;
	const detail = detailOf(error);
	return `${name} did not answer${detail ? `: ${detail}` : '.'}`;
};

// ── dev-only endpoint rewrites ───────────────────────────────────────────────
//
// Vault endpoints must be public HTTPS hosts (userVaultCore refuses anything
// else at save time), which leaves no honest way to run a BYO turn against a
// local fake in development or in scripts/verify-lopu.mjs. The rewrite table
// maps a saved origin to a local one — `https://lopu-fake-provider.invalid=
// http://127.0.0.1:18170` — and is honoured ONLY outside production builds
// (never on Vercel). A rewritten origin skips the allowlist/DNS guard, since
// the operator pointed it at their own machine on purpose.

export const LOPU_PROVIDER_DEV_REWRITES_ENV = 'THINGTIME_LOPU_PROVIDER_DEV_REWRITES';

export type ProviderDevRewriteEnv = Readonly<Record<string, string | undefined>>;

export const providerDevRewritesAllowed = (env: ProviderDevRewriteEnv): boolean =>
	env.NODE_ENV !== 'production' && !env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_TARGET_ENV;

const originOf = (value: string): string | null => {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		if (url.username || url.password || url.search || url.hash) return null;
		return url.origin.toLowerCase();
	} catch {
		return null;
	}
};

// `origin=origin[,origin=origin]` → Map<savedOrigin, localOrigin>; malformed
// pairs are dropped, and nothing is parsed at all in production.
export const parseProviderDevRewrites = (env: ProviderDevRewriteEnv): Map<string, string> => {
	const table = new Map<string, string>();
	const raw = env[LOPU_PROVIDER_DEV_REWRITES_ENV];
	if (!raw || !providerDevRewritesAllowed(env)) return table;
	for (const pair of raw.split(',')) {
		const separator = pair.indexOf('=');
		if (separator === -1) continue;
		const from = originOf(pair.slice(0, separator));
		const to = originOf(pair.slice(separator + 1));
		if (from && to && from !== to) table.set(from, to);
	}
	return table;
};

// The endpoint after the table is applied (path preserved), or null when the
// origin is not mapped.
export const applyProviderDevRewrite = (endpoint: string, table: ReadonlyMap<string, string>): string | null => {
	if (!table.size) return null;
	let url: URL;
	try {
		url = new URL(endpoint.trim());
	} catch {
		return null;
	}
	const target = table.get(url.origin.toLowerCase());
	if (!target) return null;
	return `${target}${trimSlashes(url.pathname) === '' ? '' : url.pathname.replace(/\/+$/, '')}`;
};
