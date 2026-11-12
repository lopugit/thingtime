import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT, type JWTPayload, type KeyLike } from 'jose';
import {
	AUTH,
	TOKEN,
	RESOURCE,
	ISSUER,
	SCOPES,
	PLAN_SCOPE,
	DISCOVERY,
	ChatGPTPlanError,
	buildAuthorizationUrl,
	exchangeAuthorization,
	validateChatGPTIdentity,
	refreshCredentials,
	revokeCredentials,
	listModels,
	mapChatGPTError,
	normaliseChatGPTPlanError,
	adaptChatGPTResponsesRequest,
	type ChatGPTAuthorizationAttempt,
	type ChatGPTCredentials
} from './chatgptPlanProtocol';

const attempt: ChatGPTAuthorizationAttempt = {
	hostId: 'urn:uuid:85977bcd-4728-4b3b-af90-81d0c86a3e63',
	redirectUri: 'http://127.0.0.1:18271/auth/callback',
	state: 'fresh-state',
	nonce: 'fresh-nonce',
	codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
};
const now = 1792281600000;
const clientId = 'oaiapp_test';
const credentials: ChatGPTCredentials = {
	clientId,
	hostId: attempt.hostId,
	issuer: ISSUER,
	subject: 'account-a',
	email: 'person@example.test',
	idToken: 'retained-id-token',
	accessToken: 'test-access',
	refreshToken: 'test-refresh',
	tokenType: 'Bearer',
	scopes: [...SCOPES],
	expiresAt: now + 3600000
};
const callback = (fields: Record<string, string> = {}) =>
	new URLSearchParams({ state: attempt.state, code: 'one-use-code', client_id: clientId, ...fields });
const matches = (code: string) => (error: unknown) => error instanceof ChatGPTPlanError && error.code === code;
const response = (body: unknown, status = 200) => Response.json(body, { status });
const mockFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
	((url: string | URL | Request, init?: RequestInit) => Promise.resolve(handler(String(url), init ?? {}))) as typeof fetch;
const keys = generateKeyPair('RS256');
async function signed(claims: JWTPayload = {}, privateKey?: KeyLike) {
	return new SignJWT({
		sub: 'account-a',
		iss: ISSUER,
		aud: clientId,
		iat: now / 1000,
		exp: now / 1000 + 3600,
		nonce: attempt.nonce,
		email: 'person@example.test',
		...claims
	})
		.setProtectedHeader({ alg: 'RS256' })
		.sign(privateKey ?? (await keys).privateKey);
}
async function tokenResponse(overrides: Record<string, unknown> = {}) {
	return {
		id_token: await signed(),
		access_token: 'new-access',
		refresh_token: 'new-refresh',
		token_type: 'Bearer',
		expires_in: 3600,
		scope: SCOPES.join(' '),
		...overrides
	};
}

test('new public registration uses PKCE and exact loopback; returning sign-in retains registration', () => {
	const url = new URL(buildAuthorizationUrl(attempt));
	assert.equal(url.origin + url.pathname, AUTH);
	assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
	assert.equal(url.searchParams.get('agent_name_hint'), 'Thingtime');
	assert.equal(url.searchParams.get('redirect_uri'), attempt.redirectUri);
	assert.equal(url.searchParams.get('scope'), SCOPES.join(' '));
	assert.equal(url.searchParams.get('resource'), RESOURCE);
	assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(url.searchParams.get('code_challenge'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	assert.equal(url.searchParams.has('code_verifier'), false);
	const returning = new URL(
		buildAuthorizationUrl({ ...attempt, clientId, idTokenHint: 'retained', loginHint: 'person@example.test', forceConsent: true })
	);
	assert.equal(returning.searchParams.get('client_id'), clientId);
	assert.equal(returning.searchParams.has('agent_name_hint'), false);
	assert.equal(returning.searchParams.get('prompt'), 'consent');
	assert.equal(returning.searchParams.has('force_reconsent'), false);
	for (const redirectUri of [
		'http://localhost:18271/auth/callback',
		'https://127.0.0.1/auth/callback',
		'https://evil.test/callback',
		'http://127.0.0.1:18271/auth/callback?x=1'
	]) {
		assert.throws(() => buildAuthorizationUrl({ ...attempt, redirectUri }), matches('invalid_callback'));
	}
});

test('callback validates state/client/errors before any exchange and never trusts callback scope', async () => {
	let calls = 0;
	const fetcher = mockFetch(async (_url, init) => {
		calls++;
		const form = init.body as URLSearchParams;
		assert.equal(form.get('client_id'), clientId);
		assert.equal(form.get('code_verifier'), attempt.codeVerifier);
		assert.equal(form.get('redirect_uri'), attempt.redirectUri);
		assert.equal(form.get('resource'), RESOURCE);
		assert.equal(form.has('client_secret'), false);
		assert.equal(init.redirect, 'error');
		return response(await tokenResponse({ scope: 'openid profile email offline_access' }));
	});
	for (const params of [
		callback({ state: 'wrong' }),
		callback({ client_id: 'dynamic_agent_client' }),
		new URLSearchParams({ state: attempt.state, code: 'code' }),
		callback({ error: 'access_denied' })
	]) {
		await assert.rejects(exchangeAuthorization(attempt, params, fetcher), (error) => error instanceof ChatGPTPlanError);
	}
	await assert.rejects(exchangeAuthorization({ ...attempt, clientId: 'oaiapp_other' }, callback(), fetcher), matches('invalid_callback'));
	await assert.rejects(exchangeAuthorization({ ...attempt, expiresAt: now - 1 }, callback(), fetcher, { now }), matches('invalid_callback'));
	const duplicate = callback();
	duplicate.append('state', attempt.state);
	await assert.rejects(exchangeAuthorization(attempt, duplicate, fetcher), matches('invalid_callback'));
	assert.equal(calls, 0);
	const result = await exchangeAuthorization(attempt, callback({ scope: PLAN_SCOPE }), fetcher, { key: (await keys).publicKey, now });
	assert.equal(result.subject, 'account-a');
	assert.equal(result.clientId, clientId);
	assert.equal(result.scopes.includes(PLAN_SCOPE), false);
	assert.equal(result.expiresAt, now + 3600000);
	assert.equal(calls, 1);
});

test('signature, issuer, audience, expiry, nonce and returning account identity are enforced', async () => {
	const options = { key: (await keys).publicKey, now };
	const valid = await signed();
	assert.equal((await validateChatGPTIdentity(valid, clientId, { nonce: attempt.nonce }, options)).subject, 'account-a');
	for (const changes of [
		{ iss: 'https://evil.test' },
		{ aud: 'oaiapp_other' },
		{ aud: [clientId, 'oaiapp_other'] },
		{ azp: 'oaiapp_other' },
		{ exp: now / 1000 - 60 },
		{ nonce: 'wrong' },
		{ sub: '' }
	]) {
		await assert.rejects(validateChatGPTIdentity(await signed(changes), clientId, { nonce: attempt.nonce }, options), matches('invalid_identity'));
	}
	await assert.rejects(
		validateChatGPTIdentity(await signed({}, (await generateKeyPair('RS256')).privateKey), clientId, {}, options),
		matches('invalid_identity')
	);
	await assert.rejects(
		exchangeAuthorization(
			{ ...attempt, clientId, expectedSubject: 'account-b' },
			callback(),
			mockFetch(async () => response(await tokenResponse())),
			options
		),
		matches('invalid_identity')
	);
});

test('returning callback may omit client ID and still exchanges with selected registration', async () => {
	const params = callback();
	params.delete('client_id');
	const result = await exchangeAuthorization(
		{ ...attempt, clientId, expectedSubject: 'account-a' },
		params,
		mockFetch(async (_url, init) => {
			assert.equal((init.body as URLSearchParams).get('client_id'), clientId);
			return response(await tokenResponse());
		}),
		{ key: (await keys).publicKey, now }
	);
	assert.equal(result.clientId, clientId);
});

test('refresh rotates credentials together, keeps identity and does not narrow scope', async () => {
	const rotated = await refreshCredentials(
		credentials,
		mockFetch(async (url, init) => {
			assert.equal(url, TOKEN);
			const form = init.body as URLSearchParams;
			assert.equal(form.get('refresh_token'), credentials.refreshToken);
			assert.equal(form.get('client_id'), clientId);
			assert.equal(form.get('resource'), RESOURCE);
			assert.equal(form.has('scope'), false);
			return response({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer' });
		}),
		{ now }
	);
	assert.equal(rotated.accessToken, 'rotated-access');
	assert.equal(rotated.refreshToken, 'rotated-refresh');
	assert.equal(rotated.idToken, credentials.idToken);
	assert.deepEqual(rotated.scopes, credentials.scopes);
	assert.equal(credentials.refreshToken, 'test-refresh');
	await assert.rejects(
		refreshCredentials(
			credentials,
			mockFetch(async () => response(await tokenResponse({ id_token: await signed({ sub: 'account-b' }) }))),
			{ key: (await keys).publicKey, now }
		),
		matches('invalid_identity')
	);
	await assert.rejects(
		refreshCredentials(
			credentials,
			mockFetch(() => response({ access_token: 'new', expires_in: 3600, token_type: 'Bearer' }))
		),
		matches('invalid_token_response')
	);
});

test('failure handling separates unusable refresh grants from transient outages and redacts diagnostics', async () => {
	for (const code of ['invalid_grant', 'invalid_refresh_token', 'refresh_token_reused']) {
		await assert.rejects(
			refreshCredentials(
				credentials,
				mockFetch(() => response({ error: code, error_description: credentials.refreshToken }, 400))
			),
			(error) => error instanceof ChatGPTPlanError && error.reauthenticate && !error.message.includes(credentials.refreshToken)
		);
	}
	const transient = mapChatGPTError(503, { detail: credentials.accessToken }, 'req_test');
	assert.equal(transient.retryable, true);
	assert.equal(transient.reauthenticate, false);
	assert.equal(JSON.stringify(transient).includes(credentials.accessToken), false);
	const unsafe = mapChatGPTError(
		401,
		{ error: { code: credentials.accessToken, message: credentials.refreshToken, param: credentials.idToken } },
		'bad\nheader'
	);
	assert.equal(unsafe.code, 'provider_error');
	assert.equal(unsafe.param, undefined);
	assert.equal(unsafe.requestId, undefined);
	const limit = mapChatGPTError(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } });
	assert.equal(limit.retryable, false);
	assert.equal(limit.reauthenticate, false);
});

test('revoke discovers and pins OpenAI origin before sending renewable session; empty 200 is success', async () => {
	const calls: string[] = [];
	await revokeCredentials(
		credentials,
		mockFetch((url, init) => {
			calls.push(url);
			if (url === DISCOVERY) return response({ issuer: ISSUER, revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke` });
			assert.equal((init.body as URLSearchParams).get('token'), credentials.refreshToken);
			assert.equal((init.body as URLSearchParams).get('token_type_hint'), 'refresh_token');
			assert.equal(init.redirect, 'error');
			return new Response(null, { status: 200 });
		})
	);
	assert.equal(calls.length, 2);
	let badCalls = 0;
	await assert.rejects(
		revokeCredentials(
			credentials,
			mockFetch(() => {
				badCalls++;
				return response({ issuer: ISSUER, revocation_endpoint: 'https://evil.test/revoke' });
			})
		),
		matches('invalid_discovery')
	);
	assert.equal(badCalls, 1);
});

test('model list uses account OAuth models shape and only projects listed names in server order', async () => {
	const result = await listModels(
		credentials,
		mockFetch((url, init) => {
			assert.equal(url, `${RESOURCE}/models`);
			assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${credentials.accessToken}`);
			return response({
				models: [
					{ slug: 'b', display_name: 'B', visibility: 'list', secret: 'omit' },
					{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
					{ slug: 'a', display_name: 'A', visibility: 'list' }
				]
			});
		})
	);
	assert.deepEqual(result, [
		{ slug: 'b', displayName: 'B' },
		{ slug: 'a', displayName: 'A' }
	]);
	await assert.rejects(
		listModels(
			credentials,
			mockFetch(() => response({ data: [] }))
		),
		matches('invalid_model_catalog')
	);
	await assert.rejects(
		listModels(
			{ ...credentials, scopes: ['openid'] },
			mockFetch(() => {
				throw new Error('must not fetch');
			})
		),
		matches('plan_permission_missing')
	);
});

test('plan request adaptation preserves context and namespaced local tools while dropping incompatible fields', () => {
	const input = [
		{ type: 'message', role: 'system', content: 'Be helpful' },
		{ role: 'user', content: 'Hello' },
		{ type: 'function_call_output', call_id: 'a', output: 'result' }
	];
	const request = {
		model: 'account-model',
		input,
		tools: [{ type: 'function', name: 'echo', parameters: { type: 'object' } }],
		max_output_tokens: 50,
		temperature: 1,
		previous_response_id: 'old',
		metadata: { private: 'omit' },
		store: true,
		stream: false,
		reasoning: { effort: 'high' }
	};
	const adapted = adaptChatGPTResponsesRequest(request);
	assert.equal(adapted.store, false);
	assert.equal(adapted.stream, true);
	for (const name of ['max_output_tokens', 'temperature', 'previous_response_id', 'metadata']) assert.equal(name in adapted, false);
	assert.equal((adapted.input as any[])[0].role, 'developer');
	assert.deepEqual((adapted.input as any[])[2], input[2]);
	assert.deepEqual(adapted.tools, [{ type: 'namespace', name: 'thingtime', description: 'Thingtime actions', tools: request.tools }]);
	assert.equal(input[0].role, 'system');
	assert.equal(request.store, true);
	for (const type of ['tool_search', 'mcp', 'computer', 'code_interpreter', 'image_generation', 'programmatic_tool_calling']) {
		assert.throws(() => adaptChatGPTResponsesRequest({ input: [], tools: [{ type }] }), matches('subscription_sharing_unsupported_capability'));
		assert.throws(
			() => adaptChatGPTResponsesRequest({ input: [{ type: 'additional_tools', tools: [{ type }] }] }),
			matches('subscription_sharing_unsupported_capability')
		);
	}
});

test('SDK and streamed failure normalization retain safe code/status without exposing provider content', () => {
	const sdk = normaliseChatGPTPlanError({
		status: 403,
		request_id: 'req_123',
		error: { code: 'subscription_sharing_user_not_eligible', message: credentials.accessToken }
	});
	assert.equal(sdk.status, 403);
	assert.equal(sdk.code, 'subscription_sharing_user_not_eligible');
	assert.equal(sdk.requestId, 'req_123');
	assert.equal(sdk.message.includes(credentials.accessToken), false);
	const streamed = normaliseChatGPTPlanError({
		type: 'response.failed',
		response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: credentials.refreshToken } }
	});
	assert.equal(streamed.status, 429);
	assert.equal(streamed.code, 'subscription_sharing_usage_limit_exceeded');
	assert.equal(streamed.retryable, false);
	assert.equal(normaliseChatGPTPlanError(sdk), sdk);
	assert.equal(normaliseChatGPTPlanError(new Error(credentials.accessToken)).message.includes(credentials.accessToken), false);
});
