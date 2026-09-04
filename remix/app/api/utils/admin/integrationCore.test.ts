import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeEndpointInput,
	normalizeProxyHeaders,
	redactSensitiveValue,
	resolveEndpointPath,
	vercelCreateOnlyIdentity
} from './integrationCore.ts';

const secretId = 'secret_0123456789abcdefghijklmnopqrstuvwxyz';

test('Vercel endpoint policies are closed and create-only is provider-specific', () => {
	const endpoint = normalizeEndpointInput({
		label: 'Vercel production',
		provider: 'vercel',
		origin: 'https://api.vercel.com',
		secretId,
		allowedPathPrefixes: ['/v9/projects', '/v10/projects'],
		allowRead: true,
		writeMode: 'create-only'
	});
	assert.equal(endpoint?.origin, 'https://api.vercel.com');
	assert.equal(
		normalizeEndpointInput({
			label: 'No blind generic create',
			provider: 'generic',
			origin: 'https://example.com',
			secretId,
			allowedPathPrefixes: ['/v1'],
			allowRead: true,
			writeMode: 'create-only'
		}),
		null
	);
	assert.equal(
		normalizeEndpointInput({
			label: 'SSRF attempt',
			provider: 'vercel',
			origin: 'https://127.0.0.1',
			secretId,
			allowedPathPrefixes: ['/v9/projects'],
			allowRead: true,
			writeMode: 'none'
		}),
		null
	);
});

test('proxy paths, headers, and response projections fail closed', () => {
	const endpoint = {
		origin: 'https://api.vercel.com',
		allowedPathPrefixes: ['/v9/projects']
	};
	assert.equal(
		resolveEndpointPath(endpoint, '/v9/projects/example/env', { teamId: 'team_123' })?.toString(),
		'https://api.vercel.com/v9/projects/example/env?teamId=team_123'
	);
	assert.equal(resolveEndpointPath(endpoint, '/v9/projects/../secrets'), null);
	assert.equal(resolveEndpointPath(endpoint, 'https://evil.example/x'), null);
	assert.deepEqual(normalizeProxyHeaders({ Accept: 'application/json', 'Idempotency-Key': 'safe' }), {
		Accept: 'application/json',
		'Idempotency-Key': 'safe'
	});
	assert.equal(normalizeProxyHeaders({ Authorization: 'Bearer steal' }), null);
	assert.deepEqual(redactSensitiveValue({ project: 'thingtime', token: 'nope', nested: { value: 'hidden', okay: true } }), {
		project: 'thingtime',
		token: '[redacted]',
		nested: { value: '[redacted]', okay: true }
	});
});

test('Vercel create-only identity requires a supported project env POST body', () => {
	const target = new URL('https://api.vercel.com/v10/projects/thingtime/env');
	assert.deepEqual(vercelCreateOnlyIdentity(target, { key: 'THINGTIME_NEW_SECRET', value: 'value', target: ['preview', 'production'] }), {
		project: 'thingtime',
		key: 'THINGTIME_NEW_SECRET',
		targets: ['preview', 'production'],
		resourceKey: 'thingtime:THINGTIME_NEW_SECRET:preview,production'
	});
	assert.equal(vercelCreateOnlyIdentity(target, { key: 'X', value: 'value', target: 'staging' }), null);
	assert.equal(
		vercelCreateOnlyIdentity(new URL('https://api.vercel.com/v10/projects/thingtime/env/X'), { key: 'X', value: 'v', target: 'preview' }),
		null
	);
});
