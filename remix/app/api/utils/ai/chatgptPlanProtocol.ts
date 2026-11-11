import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

// Official public OSS registration; never borrow a Codex client identity.
export const AUTH = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN = 'https://auth.openai.com/api/accounts/oauth/token';
export const JWKS = 'https://auth.openai.com/.well-known/jwks.json';
export const DISCOVERY = 'https://auth.openai.com/.well-known/openid-configuration';
export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE] as const;

export interface ChatGPTAuthorizationAttempt {
	hostId: string;
	redirectUri: string;
	state: string;
	nonce: string;
	codeVerifier: string;
	clientId?: string;
	idTokenHint?: string;
	loginHint?: string;
	forceConsent?: boolean;
	expectedSubject?: string;
	expiresAt?: number;
}
export interface ChatGPTCredentials {
	clientId: string;
	hostId: string;
	issuer: string;
	subject: string;
	email?: string;
	idToken: string;
	accessToken: string;
	refreshToken: string;
	tokenType: 'Bearer';
	scopes: string[];
	expiresAt: number;
	earliestRefreshAt?: number;
}
export interface ChatGPTModel {
	slug: string;
	displayName: string;
}
export interface ChatGPTVerificationOptions {
	key?: JWTVerifyGetKey | KeyLike | Uint8Array;
	now?: number;
}

const failures: Record<string, { message: string; retryable?: boolean; reauthenticate?: boolean }> = {
	response_incomplete: { message: 'ChatGPT did not complete this response. Try again.', retryable: true },
	response_interrupted: { message: 'The ChatGPT response was interrupted. Try again.', retryable: true },
	access_denied: { message: 'ChatGPT sign-in was cancelled.' },
	invalid_callback: { message: 'ChatGPT sign-in could not be verified. Start sign-in again.' },
	invalid_identity: { message: 'ChatGPT account verification failed. Start sign-in again.' },
	invalid_token_response: { message: 'OpenAI returned an incomplete sign-in response.' },
	invalid_client: { message: 'The ChatGPT client registration was not accepted.' },
	invalid_grant: { message: 'ChatGPT authorization expired. Sign in again.', reauthenticate: true },
	invalid_refresh_token: { message: 'ChatGPT authorization expired. Sign in again.', reauthenticate: true },
	token_expired: { message: 'ChatGPT authorization expired. Sign in again.', reauthenticate: true },
	refresh_token_expired: { message: 'ChatGPT authorization expired. Sign in again.', reauthenticate: true },
	refresh_token_invalidated: { message: 'ChatGPT authorization was disconnected. Sign in again.', reauthenticate: true },
	refresh_token_reused: { message: 'ChatGPT authorization must be renewed. Sign in again.', reauthenticate: true },
	plan_permission_missing: { message: 'Enable ChatGPT plan usage before making this request.' },
	invalid_model_catalog: { message: 'OpenAI returned an unavailable ChatGPT model catalog.' },
	invalid_request: { message: 'This request cannot be sent through ChatGPT plan usage.' },
	invalid_discovery: { message: 'The OpenAI session revocation endpoint could not be verified.' },
	network_error: { message: 'OpenAI could not be reached. Try again later.', retryable: true },
	subscription_sharing_user_not_eligible: { message: 'ChatGPT plan usage is unavailable for this account or workspace.' },
	subscription_sharing_usage_limit_exceeded: { message: 'ChatGPT plan or app usage limit reached. Manage usage in ChatGPT settings.' },
	subscription_sharing_usage_unavailable: { message: 'ChatGPT usage availability is temporarily unavailable.', retryable: true },
	subscription_sharing_user_unavailable: { message: 'ChatGPT account availability is temporarily unavailable.', retryable: true },
	subscription_sharing_unsupported_capability: { message: 'This capability is unavailable through ChatGPT plan usage.' },
	subscription_sharing_route_not_supported: { message: 'This operation is unavailable through ChatGPT plan usage.' },
	subscription_sharing_invalid_user: { message: 'ChatGPT could not verify the selected account.' },
	chatpass_v2_scope_not_authorized: { message: 'ChatGPT plan permission does not authorize this operation.' },
	chatpass_v2_invalid_authorization_context: { message: 'ChatGPT plan permission does not authorize this operation.' }
};
export class ChatGPTPlanError extends Error {
	readonly retryable: boolean;
	readonly reauthenticate: boolean;
	constructor(readonly code: string, readonly status = 400, readonly requestId?: string, readonly param?: string) {
		const failure = failures[code];
		super(failure?.message ?? (status >= 500 ? 'OpenAI is temporarily unavailable.' : 'OpenAI did not accept the ChatGPT request.'));
		this.name = 'ChatGPTPlanError';
		this.retryable = failure?.retryable ?? status >= 500;
		this.reauthenticate = failure?.reauthenticate ?? false;
	}
}
const object = (value: unknown): Record<string, unknown> | null =>
	value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);
const remoteKeys = createRemoteJWKSet(new URL(JWKS));
const same = (left: string, right: string) => {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
};
const issuedClient = (value: string) => /^oaiapp_[A-Za-z0-9_-]+$/.test(value);

export function buildAuthorizationUrl(attempt: ChatGPTAuthorizationAttempt): string {
	let redirect: URL;
	try {
		redirect = new URL(attempt.redirectUri);
	} catch {
		throw new ChatGPTPlanError('invalid_callback');
	}
	if (
		redirect.protocol !== 'http:' ||
		redirect.hostname !== '127.0.0.1' ||
		redirect.username ||
		redirect.password ||
		redirect.search ||
		redirect.hash ||
		!attempt.state ||
		!attempt.nonce ||
		!/^[A-Za-z0-9._~-]{43,128}$/.test(attempt.codeVerifier) ||
		!/^(urn:uuid:[0-9a-f-]+|urn:ietf:params:oauth:jwk-thumbprint:[A-Za-z0-9:_-]+|did:key:[A-Za-z0-9]+)$/i.test(attempt.hostId) ||
		(attempt.clientId !== undefined && !issuedClient(attempt.clientId))
	)
		throw new ChatGPTPlanError('invalid_callback');
	const url = new URL(AUTH);
	url.search = new URLSearchParams({
		client_id: attempt.clientId ?? 'dynamic_agent_client',
		ext_agent_host_id: attempt.hostId,
		response_type: 'code',
		redirect_uri: attempt.redirectUri,
		scope: SCOPES.join(' '),
		resource: RESOURCE,
		state: attempt.state,
		nonce: attempt.nonce,
		code_challenge_method: 'S256',
		code_challenge: createHash('sha256').update(attempt.codeVerifier).digest('base64url')
	}).toString();
	if (!attempt.clientId) url.searchParams.set('agent_name_hint', 'Thingtime');
	else {
		if (attempt.idTokenHint) url.searchParams.set('id_token_hint', attempt.idTokenHint);
		if (attempt.loginHint) url.searchParams.set('login_hint', attempt.loginHint);
	}
	if (attempt.forceConsent) url.searchParams.set('prompt', 'consent');
	return url.toString();
}

// Provider error_description/detail can echo secrets; only known diagnostics escape.
export function mapChatGPTError(status: number, body: unknown, requestId?: string): ChatGPTPlanError {
	const root = object(body);
	const error = object(root?.error);
	const candidate = text(error?.code) ?? text(root?.error);
	const code = candidate && Object.prototype.hasOwnProperty.call(failures, candidate) ? candidate : 'provider_error';
	const parameter = text(error?.param)?.split(/[.[]/, 1)[0];
	const param =
		parameter && ['input', 'tools', 'model', 'service_tier', 'instructions', 'reasoning', 'text', 'stream', 'store'].includes(parameter)
			? parameter
			: undefined;
	const id = requestId && /^[A-Za-z0-9_-]{1,160}$/.test(requestId) ? requestId : undefined;
	return new ChatGPTPlanError(code, status, id, param);
}
/** Normalize SDK failures and SSE response.failed events without copying provider text. */
export function normaliseChatGPTPlanError(value: unknown): ChatGPTPlanError {
	if (value instanceof ChatGPTPlanError) return value;
	const root = object(value);
	const response = object(root?.response);
	const providerError = object(root?.error) ?? object(response?.error) ?? root;
	const candidate = text(providerError?.code);
	const inferredStatus =
		candidate === 'subscription_sharing_usage_limit_exceeded'
			? 429
			: candidate === 'subscription_sharing_unsupported_capability'
			? 400
			: candidate === 'subscription_sharing_invalid_user'
			? 401
			: candidate === 'subscription_sharing_user_not_eligible' ||
			  candidate === 'subscription_sharing_route_not_supported' ||
			  candidate?.startsWith('chatpass_v2_')
			? 403
			: 502;
	const status =
		typeof root?.status === 'number' && Number.isInteger(root.status) && root.status >= 400 && root.status <= 599 ? root.status : inferredStatus;
	return mapChatGPTError(status, { error: providerError }, text(root?.request_id) ?? text(root?.requestId));
}

async function requestJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000) });
	} catch {
		throw new ChatGPTPlanError('network_error', 503);
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	if (!response.ok)
		throw mapChatGPTError(response.status, body, response.headers.get('x-request-id') ?? response.headers.get('openai-request-id') ?? undefined);
	return body;
}
export async function validateChatGPTIdentity(
	idToken: string,
	clientId: string,
	expected: { nonce?: string; subject?: string } = {},
	options: ChatGPTVerificationOptions = {}
) {
	try {
		const { payload } = await jwtVerify(idToken, (options.key ?? remoteKeys) as JWTVerifyGetKey, {
			issuer: ISSUER,
			audience: clientId,
			algorithms: ['RS256', 'ES256'],
			requiredClaims: ['sub', 'exp', 'iat'],
			clockTolerance: 5,
			...(options.now !== undefined ? { currentDate: new Date(options.now) } : {})
		});
		if (
			!text(payload.sub) ||
			(payload.azp !== undefined && payload.azp !== clientId) ||
			(Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
			(expected.nonce !== undefined && payload.nonce !== expected.nonce) ||
			(expected.subject !== undefined && payload.sub !== expected.subject)
		)
			throw new Error('identity');
		return { issuer: ISSUER, subject: payload.sub as string, email: text(payload.email) };
	} catch {
		throw new ChatGPTPlanError('invalid_identity', 401);
	}
}
async function credentialsFromResponse(
	body: unknown,
	identity: { clientId: string; hostId: string; nonce?: string; subject?: string },
	previous: ChatGPTCredentials | undefined,
	options: ChatGPTVerificationOptions
): Promise<ChatGPTCredentials> {
	const data = object(body);
	const accessToken = text(data?.access_token);
	const refreshToken = text(data?.refresh_token);
	const idToken = text(data?.id_token) ?? previous?.idToken;
	const expiresIn = data?.expires_in;
	if (
		!accessToken ||
		!refreshToken ||
		!idToken ||
		typeof data?.token_type !== 'string' ||
		data.token_type.toLowerCase() !== 'bearer' ||
		typeof expiresIn !== 'number' ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0 ||
		(data.scope !== undefined && typeof data.scope !== 'string') ||
		(!previous && typeof data.scope !== 'string')
	)
		throw new ChatGPTPlanError('invalid_token_response', 502);
	const verified =
		previous && !data.id_token
			? { issuer: previous.issuer, subject: previous.subject, email: previous.email }
			: await validateChatGPTIdentity(idToken, identity.clientId, { nonce: identity.nonce, subject: identity.subject }, options);
	const now = options.now ?? Date.now();
	const earliest =
		typeof data.earliest_refresh_at === 'number' && Number.isFinite(data.earliest_refresh_at) ? data.earliest_refresh_at * 1000 : undefined;
	return {
		clientId: identity.clientId,
		hostId: identity.hostId,
		...verified,
		idToken,
		accessToken,
		refreshToken,
		tokenType: 'Bearer',
		scopes: typeof data.scope === 'string' ? [...new Set(data.scope.split(/\s+/).filter(Boolean))] : previous!.scopes,
		expiresAt: now + expiresIn * 1000,
		...(earliest !== undefined ? { earliestRefreshAt: earliest } : {})
	};
}
export async function exchangeAuthorization(
	attempt: ChatGPTAuthorizationAttempt,
	callback: URLSearchParams,
	fetcher: typeof fetch = fetch,
	options: ChatGPTVerificationOptions = {}
): Promise<ChatGPTCredentials> {
	// Runtime owns atomic one-use consumption of the pending transaction.
	buildAuthorizationUrl(attempt);
	for (const name of ['state', 'code', 'client_id', 'error']) if (callback.getAll(name).length > 1) throw new ChatGPTPlanError('invalid_callback');
	if (!same(callback.get('state') ?? '', attempt.state) || (attempt.expiresAt !== undefined && attempt.expiresAt <= (options.now ?? Date.now())))
		throw new ChatGPTPlanError('invalid_callback');
	if (callback.has('error')) throw mapChatGPTError(400, { error: callback.get('error') });
	const code = callback.get('code');
	const callbackClient = callback.get('client_id');
	const clientId = attempt.clientId ?? callbackClient;
	if (!code || !clientId || !issuedClient(clientId) || (attempt.clientId && callbackClient && callbackClient !== attempt.clientId))
		throw new ChatGPTPlanError('invalid_callback');
	const body = await requestJson(
		TOKEN,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: clientId,
				code,
				code_verifier: attempt.codeVerifier,
				redirect_uri: attempt.redirectUri,
				resource: RESOURCE
			})
		},
		fetcher
	);
	return credentialsFromResponse(
		body,
		{ clientId, hostId: attempt.hostId, nonce: attempt.nonce, subject: attempt.expectedSubject },
		undefined,
		options
	);
}
export async function refreshCredentials(
	credentials: ChatGPTCredentials,
	fetcher: typeof fetch = fetch,
	options: ChatGPTVerificationOptions = {}
): Promise<ChatGPTCredentials> {
	if (!issuedClient(credentials.clientId) || !credentials.refreshToken) throw new ChatGPTPlanError('invalid_client');
	const body = await requestJson(
		TOKEN,
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: credentials.clientId,
				refresh_token: credentials.refreshToken,
				resource: RESOURCE
			})
		},
		fetcher
	);
	return credentialsFromResponse(
		body,
		{ clientId: credentials.clientId, hostId: credentials.hostId, subject: credentials.subject },
		credentials,
		options
	);
}
export async function revokeCredentials(credentials: ChatGPTCredentials, fetcher: typeof fetch = fetch): Promise<void> {
	const discovery = object(await requestJson(DISCOVERY, {}, fetcher));
	let endpoint: URL;
	try {
		endpoint = new URL(String(discovery?.revocation_endpoint));
	} catch {
		throw new ChatGPTPlanError('invalid_discovery', 502);
	}
	if (discovery?.issuer !== ISSUER || endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.hash)
		throw new ChatGPTPlanError('invalid_discovery', 502);
	await requestJson(
		endpoint.toString(),
		{
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token: credentials.refreshToken, token_type_hint: 'refresh_token', client_id: credentials.clientId })
		},
		fetcher
	);
}
export async function listModels(credentials: ChatGPTCredentials, fetcher: typeof fetch = fetch): Promise<ChatGPTModel[]> {
	if (!credentials.scopes.includes(PLAN_SCOPE)) throw new ChatGPTPlanError('plan_permission_missing', 403);
	const data = object(await requestJson(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${credentials.accessToken}` } }, fetcher));
	if (!Array.isArray(data?.models)) throw new ChatGPTPlanError('invalid_model_catalog', 502);
	return data.models.flatMap((value: unknown) => {
		const model = object(value);
		return model?.visibility === 'list' && text(model.slug) && text(model.display_name)
			? [{ slug: model.slug as string, displayName: model.display_name as string }]
			: [];
	});
}
const unsupportedFields = [
	'background',
	'conversation',
	'max_output_tokens',
	'max_tool_calls',
	'metadata',
	'moderation',
	'multi_agent',
	'prompt',
	'prompt_cache_retention',
	'safety_identifier',
	'temperature',
	'top_logprobs',
	'top_p',
	'truncation',
	'user',
	'previous_response_id'
];
const functionTypes = new Set(['function', 'custom']);
function validateTool(value: unknown): Record<string, unknown> {
	const tool = object(value);
	if (
		!tool ||
		(!functionTypes.has(String(tool.type)) &&
			!['namespace', 'web_search', 'web_search_preview', 'web_search_preview_2025_03_11'].includes(String(tool.type)))
	)
		throw new ChatGPTPlanError('subscription_sharing_unsupported_capability', 400, undefined, 'tools');
	if (
		tool.type === 'namespace' &&
		(!text(tool.name) || !Array.isArray(tool.tools) || tool.tools.some((child) => !functionTypes.has(String(object(child)?.type))))
	)
		throw new ChatGPTPlanError('subscription_sharing_unsupported_capability', 400, undefined, 'tools');
	return tool;
}
export function adaptChatGPTResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(body.input)) throw new ChatGPTPlanError('invalid_request');
	const adapted: Record<string, unknown> = { ...body, store: false, stream: true };
	for (const field of unsupportedFields) delete adapted[field];
	adapted.input = body.input.map((value) => {
		const item = object(value);
		if (item?.type === 'additional_tools') {
			if (!Array.isArray(item.tools)) throw new ChatGPTPlanError('invalid_request');
			return { ...item, tools: item.tools.map(validateTool) };
		}
		return item?.role === 'system' ? { ...item, role: 'developer' } : value;
	});
	if (body.tools !== undefined) {
		if (!Array.isArray(body.tools)) throw new ChatGPTPlanError('invalid_request');
		const tools = body.tools.map(validateTool);
		const functions = tools.filter((tool) => functionTypes.has(String(tool.type)));
		adapted.tools = tools.filter((tool) => !functionTypes.has(String(tool.type)));
		if (functions.length) {
			if (tools.some((tool) => tool.type === 'namespace' && tool.name === 'thingtime')) throw new ChatGPTPlanError('invalid_request');
			(adapted.tools as unknown[]).push({ type: 'namespace', name: 'thingtime', description: 'Thingtime actions', tools: functions });
		}
	}
	return adapted;
}
