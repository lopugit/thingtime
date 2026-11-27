import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { GOOGLE_OAUTH_CREDENTIAL_LABEL, type CredentialImportTarget } from '../../../credentials/importContract';
import { parseOAuthClientConfig } from '../connections/oauthConfig';
import {
	challengeForImportVerifier, fingerprintImportPayload, mergeScopedOAuthImport, parseImportProof, parseImportTarget,
	prepareCredentialImport, validateImportOrigin
} from './importCore';

const origin = 'https://thingtime.test', environment = 'production';
const callback = origin + '/api/v1/connections/oauth/callback';
const target: CredentialImportTarget = {
	destination: 'admin-provider-vault', format: 'google-oauth', label: GOOGLE_OAUTH_CREDENTIAL_LABEL,
	environment, callbackUrl: callback, overwrite: { mode: 'create' }
};
const sample = (redirects: string[] = [callback]) => ({ web: {
	client_id: 'fixture.apps.googleusercontent.com', client_secret: 'synthetic-provider-value', redirect_uris: redirects,
	auth_uri: 'https://unused.fixture.test', project_id: 'fixture-project'
} });
const utf8 = (input: string) => new TextEncoder().encode(input);
const code = (code: string) => ({ code });

test('the target binds the deployment, exact callback and overwrite metadata', () => {
	assert.deepEqual(parseImportTarget(target, origin, environment), target);
	const longLabel = '長い設定名'.repeat(100);
	assert.equal(parseImportTarget({ ...target, label: longLabel, format: 'text', callbackUrl: undefined }, origin, environment).label, longLabel);
	for (const wrong of [
		{ environment: 'development' }, { overwrite: { mode: 'replace' } }, { format: 'other' },
		{ destination: 'personal-passwords' }, { unexpected: 'ignored' }
	]) assert.throws(() => parseImportTarget({ ...target, ...wrong }, origin, environment), code('invalid_target'));
	assert.throws(() => parseImportTarget({ ...target, callbackUrl: callback + '?alternate=1' }, origin, environment), code('redirect_mismatch'));
	assert.throws(() => parseImportTarget({ ...target, format: 'json', callbackUrl: undefined }, origin, environment), code('invalid_target'));
	assert.throws(() => validateImportOrigin('http://localhost:28427', 'production'), code('origin_mismatch'));
	assert.throws(() => validateImportOrigin('http://example.test', 'development'), code('unavailable'));
	const local = 'http://127.0.0.1:28427';
	validateImportOrigin(local, 'development');
	assert.equal(parseImportTarget({ ...target, environment: 'development', callbackUrl: local + new URL(callback).pathname }, local, 'development').environment, 'development');
});

test('Google web downloads must explicitly register the exact current callback', () => {
	assert.deepEqual(prepareCredentialImport(target, utf8(JSON.stringify(sample()))), { type: 'oauth-client', client: {
		clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'synthetic-provider-value', redirectUri: callback
	} });
	assert.throws(() => prepareCredentialImport(target, utf8(JSON.stringify(sample([callback + '/', callback + '?alternate=1'])))), code('redirect_mismatch'));
	for (const invalid of ['{broken', 'null', JSON.stringify({ installed: sample().web }), JSON.stringify({ ...sample(), installed: {} }),
		JSON.stringify({ web: { ...sample().web, client_id: 'not-google' } }), JSON.stringify({ web: { ...sample().web, client_secret: '' } })]) {
		assert.throws(() => prepareCredentialImport(target, utf8(invalid)), code('invalid_credential'));
	}
});

test('Google writes the canonical runtime bundle and preserves other scopes and bundle metadata', () => {
	const previous = { environments: {
		production: { marker: 'retain', origins: { 'https://other.test': { opaque: 'retain' }, [origin]: { old: true } } },
		development: { origins: { 'http://localhost:28427': { opaque: 'retain' } } }
	}, metadata: ['retain'] };
	const prepared = prepareCredentialImport(target, utf8(JSON.stringify(sample())));
	assert.equal(prepared.type, 'oauth-client');
	if (prepared.type !== 'oauth-client') return;
	const updated = mergeScopedOAuthImport(JSON.stringify(previous), environment, origin, prepared.client);
	const decoded = JSON.parse(updated);
	assert.deepEqual(decoded.metadata, previous.metadata);
	assert.deepEqual(decoded.environments.development, previous.environments.development);
	assert.deepEqual(decoded.environments.production.origins['https://other.test'], previous.environments.production.origins['https://other.test']);
	assert.equal(decoded.environments.production.marker, 'retain');
	assert.equal(parseOAuthClientConfig(updated, 'GOOGLE_CLIENT_ID', origin, environment)?.clientId, prepared.client.clientId);
	assert.equal(parseOAuthClientConfig(updated, 'GOOGLE_CLIENT_ID', origin, 'development'), null);
	for (const invalid of ['broken', '{}', '{"environments":{"production":null}}']) {
		assert.throws(() => mergeScopedOAuthImport(invalid, environment, origin, prepared.client), code('conflict'));
	}
});

test('a scoped Connections import binds the registered label and callback and accepts only one client', () => {
	const facebook: CredentialImportTarget = { ...target, format: 'oauth-client', label: 'connections-facebook-oauth' };
	assert.deepEqual(parseImportTarget(facebook, origin, environment), facebook);
	for (const label of ['arbitrary-label', GOOGLE_OAUTH_CREDENTIAL_LABEL, 'connections-chatgpt-oauth']) {
		assert.throws(() => parseImportTarget({ ...facebook, label }, origin, environment), code('invalid_target'));
	}
	assert.throws(() => parseImportTarget({ ...facebook, callbackUrl: callback + '/' }, origin, environment), code('redirect_mismatch'));
	const client = { clientId: '123456789', clientSecret: 'synthetic-app-secret', redirectUri: callback };
	const prepare = (value: unknown) => prepareCredentialImport(facebook, utf8(JSON.stringify(value)));
	assert.deepEqual(prepare(client), { type: 'oauth-client', client });
	assert.throws(() => prepare({ ...client, redirectUri: callback + '/' }), code('redirect_mismatch'));
	for (const invalid of [{ ...client, environments: {} }, { ...client, clientSecret: '' }, { ...client, clientId: 'invalid id' }]) {
		assert.throws(() => prepare(invalid), code('invalid_credential'));
	}
	const bundle = mergeScopedOAuthImport(null, environment, origin, client);
	assert.equal(parseOAuthClientConfig(bundle, 'FACEBOOK_APP_ID', origin, environment)?.clientId, client.clientId);
	assert.equal(parseOAuthClientConfig(bundle, 'FACEBOOK_APP_ID', 'https://other.test', environment), null);
});

test('literal imports preserve bytes and reject malformed UTF-8 or JSON', () => {
	const input = '\uFEFF  {"sample":[1,2]}\n';
	for (const format of ['json', 'text'] as const) {
		assert.deepEqual(prepareCredentialImport({ ...target, format }, utf8(input)), { type: 'literal', value: input });
		assert.throws(() => prepareCredentialImport({ ...target, format }, new Uint8Array([0xff])), code('invalid_credential'));
	}
	assert.throws(() => prepareCredentialImport({ ...target, format: 'json' }, utf8('{broken')), code('invalid_credential'));
});

test('the S256 proof is canonical and receipt fingerprints bind exact bytes', () => {
	const verifier = randomBytes(32).toString('base64url');
	assert.equal(parseImportProof(verifier), verifier);
	assert.equal(parseImportProof(verifier + '='), null);
	assert.equal(parseImportProof(challengeForImportVerifier(verifier))?.length, 43);
	assert.equal(fingerprintImportPayload(verifier, utf8('same')), fingerprintImportPayload(verifier, utf8('same')));
	assert.notEqual(fingerprintImportPayload(verifier, utf8('same')), fingerprintImportPayload(verifier, utf8('same\n')));
	assert.notEqual(fingerprintImportPayload(verifier, utf8('same')), fingerprintImportPayload(randomBytes(32).toString('base64url'), utf8('same')));
});
