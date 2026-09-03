import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LOPU_VAULT_HOST_NOT_ALLOWED_REASON,
	LOPU_VAULT_NO_MODEL_REASON,
	LOPU_VAULT_PROVIDER_PUBLIC_KEYS,
	LOPU_VAULT_UNCONFIGURED_REASON,
	applyProviderDevRewrite,
	endpointHostOf,
	friendlyVaultProviderError,
	parseProviderDevRewrites,
	providerDevRewritesAllowed,
	publicVaultProvider,
	publicVaultProviders,
	resolveVaultTurnModel,
	vaultGuardError,
	vaultProviderBaseUrl,
	vaultProviderToolProtocol,
	vaultProviderTransport
} from './vaultProviders.ts';

const openAll = { vaultConfigured: true, hostAllowed: () => true };

// The redacted vault entry the projection reads — deliberately carrying every
// field a stored provider row has beyond the encrypted token, plus a few
// decoys a careless spread would leak.
const entry = {
	id: 'prov-0123456789',
	kind: 'provider' as const,
	name: 'My Claude',
	groupId: 'grp-0123456789',
	provider: 'anthropic',
	endpoint: 'https://api.anthropic.com/v1/extra?x=1',
	model: 'claude-sonnet-4-6',
	hasValue: true as const,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-02T00:00:00.000Z',
	token: 'sk-ant-should-never-appear',
	encryptedValue: { cipherText: 'zzz', iv: 'iv', tag: 'tag' }
};

test('publicVaultProvider publishes only the contract keys — never a token, an endpoint, or a group', () => {
	const projected = publicVaultProvider(entry, openAll)!;
	assert.deepEqual(projected, { id: 'prov-0123456789', name: 'My Claude', kind: 'anthropic', model: 'claude-sonnet-4-6', endpointHost: 'api.anthropic.com', available: true });
	for (const key of Object.keys(projected)) assert.ok((LOPU_VAULT_PROVIDER_PUBLIC_KEYS as readonly string[]).includes(key), `unexpected key ${key}`);
	const wire = JSON.stringify(projected);
	assert.doesNotMatch(wire, /sk-ant|encryptedValue|cipherText|groupId|\/v1\/extra|x=1|hasValue/);
	// non-provider records never project at all
	assert.equal(publicVaultProvider({ ...entry, kind: 'secret' }, openAll), null);
	assert.equal(publicVaultProvider({ ...entry, id: '' }, openAll), null);
	assert.equal(publicVaultProviders([entry, { ...entry, id: 'grp-0123456789', kind: 'group' }], openAll).length, 1);
});

test('availability explains itself: vault key, allowlist, model — in that order', () => {
	const unconfigured = publicVaultProvider(entry, { vaultConfigured: false, hostAllowed: () => true })!;
	assert.equal(unconfigured.available, false);
	assert.equal(unconfigured.reason, LOPU_VAULT_UNCONFIGURED_REASON);

	const blocked = publicVaultProvider(entry, { vaultConfigured: true, hostAllowed: (host) => host !== 'api.anthropic.com' })!;
	assert.equal(blocked.available, false);
	assert.equal(blocked.reason, LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
	assert.equal(blocked.endpointHost, 'api.anthropic.com');

	const modelless = publicVaultProvider({ ...entry, model: '   ' }, openAll)!;
	assert.equal(modelless.available, false);
	assert.equal(modelless.model, null);
	assert.equal(modelless.reason, LOPU_VAULT_NO_MODEL_REASON);

	const unknownKind = publicVaultProvider({ ...entry, provider: 'gemini-native' }, openAll)!;
	assert.equal(unknownKind.available, false);
	assert.equal(unknownKind.kind, 'compatible');

	const noEndpoint = publicVaultProvider({ ...entry, endpoint: 'not a url' }, openAll)!;
	assert.equal(noEndpoint.available, false);
	assert.equal(noEndpoint.endpointHost, null);

	assert.equal(endpointHostOf('https://Api.OpenAI.com/v1'), 'api.openai.com');
	assert.equal(endpointHostOf(''), null);
	assert.equal(endpointHostOf(42), null);
});

test('kind → transport / tool protocol / base URL', () => {
	assert.equal(vaultProviderTransport('anthropic'), 'anthropic');
	for (const kind of ['openai', 'openrouter', 'xai', 'google', 'compatible'] as const) assert.equal(vaultProviderTransport(kind), 'openai');
	// vendors that document function calling get native tools; an unknown compatible host gets the text protocol
	for (const kind of ['anthropic', 'openai', 'openrouter', 'xai', 'google'] as const) assert.equal(vaultProviderToolProtocol(kind), 'native');
	assert.equal(vaultProviderToolProtocol('compatible'), 'text');
	assert.equal(vaultProviderBaseUrl('openai', 'https://api.openai.com/v1/'), 'https://api.openai.com/v1');
	assert.equal(vaultProviderBaseUrl('google', 'https://generativelanguage.googleapis.com/v1beta'), 'https://generativelanguage.googleapis.com/v1beta/openai');
	assert.equal(vaultProviderBaseUrl('google', 'https://generativelanguage.googleapis.com/v1beta/openai/'), 'https://generativelanguage.googleapis.com/v1beta/openai');
	assert.equal(vaultProviderBaseUrl('anthropic', 'https://api.anthropic.com'), 'https://api.anthropic.com');
});

test('resolveVaultTurnModel prefers the connection, borrows the request only when the connection has none', () => {
	assert.equal(resolveVaultTurnModel('gpt-5.4', 'claude-opus-5'), 'gpt-5.4');
	assert.equal(resolveVaultTurnModel('', 'claude-opus-5'), 'claude-opus-5');
	assert.equal(resolveVaultTurnModel(undefined, 'default'), null);
	assert.equal(resolveVaultTurnModel(null, null), null);
});

test('friendlyVaultProviderError names the connection, never the URL or the key', () => {
	const status = (code: number, message = 'nope') => Object.assign(new Error(message), { status: code });
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(401)), /^My Claude rejected the saved key \(HTTP 401\)/);
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(403)), /HTTP 403/);
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(404)), /does not know the model "claude-x"/);
	assert.match(friendlyVaultProviderError('My Claude', null, status(404)), /does not know the model \(HTTP 404\)/);
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(429)), /rate-limiting/);
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(402)), /no remaining credit/);
	assert.match(friendlyVaultProviderError('My Claude', 'claude-x', status(503)), /having trouble right now \(HTTP 503\)/);
	const bad = friendlyVaultProviderError('My Claude', 'claude-x', status(400, `bad request for Bearer sk-live-abcdefghijklmnop at https://api.example.com/v1 ${'x'.repeat(400)}`));
	assert.match(bad, /^My Claude rejected the request \(HTTP 400\): /);
	assert.doesNotMatch(bad, /sk-live-abcdefghijklmnop/);
	assert.ok(bad.length < 260, 'detail is bounded');
	const connection = Object.assign(new Error('fetch failed'), { name: 'APIConnectionError' });
	assert.match(friendlyVaultProviderError('Grok', 'grok-4', connection), /Grok could not be reached/);
	assert.match(friendlyVaultProviderError('Grok', 'grok-4', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), /could not be reached/);
	// a guard refusal is already user-facing and passes through verbatim
	assert.equal(friendlyVaultProviderError('Grok', 'grok-4', vaultGuardError(LOPU_VAULT_HOST_NOT_ALLOWED_REASON)), LOPU_VAULT_HOST_NOT_ALLOWED_REASON);
	assert.match(friendlyVaultProviderError('', 'm', new Error('weird')), /^Your provider did not answer: weird/);
});

test('dev endpoint rewrites parse only outside production and only origin → origin pairs', () => {
	const raw = 'https://lopu-fake-provider.invalid=http://127.0.0.1:18170, https://other.example=https://localhost:9,junk,https://x.example=ftp://nope,https://same.example=https://same.example';
	const table = parseProviderDevRewrites({ THINGTIME_LOPU_PROVIDER_DEV_REWRITES: raw });
	assert.deepEqual([...table.entries()], [
		['https://lopu-fake-provider.invalid', 'http://127.0.0.1:18170'],
		['https://other.example', 'https://localhost:9']
	]);
	assert.equal(applyProviderDevRewrite('https://lopu-fake-provider.invalid/v1', table), 'http://127.0.0.1:18170/v1');
	assert.equal(applyProviderDevRewrite('https://lopu-fake-provider.invalid', table), 'http://127.0.0.1:18170');
	assert.equal(applyProviderDevRewrite('https://api.openai.com/v1', table), null);
	assert.equal(applyProviderDevRewrite('not a url', table), null);
	assert.equal(applyProviderDevRewrite('https://lopu-fake-provider.invalid/v1', new Map()), null);

	for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { VERCEL_TARGET_ENV: 'production' }]) {
		assert.equal(providerDevRewritesAllowed(env), false);
		assert.equal(parseProviderDevRewrites({ ...env, THINGTIME_LOPU_PROVIDER_DEV_REWRITES: raw }).size, 0, `ignored under ${JSON.stringify(env)}`);
	}
	assert.equal(providerDevRewritesAllowed({ NODE_ENV: 'development' }), true);
	assert.equal(parseProviderDevRewrites({}).size, 0);
});
