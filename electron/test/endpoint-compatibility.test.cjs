'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
	DESKTOP_REQUIRED_CAPABILITIES,
	checkEndpointCompatibility,
	probeBundledProxy,
	probeEndpointCapabilities,
	probeEndpointDevices,
	responseSupportsDevices,
	hasDeploymentDataEnvironment,
	supportsVersion
} = require('../lib/endpoint-compatibility.cjs');

test('device capability accepts authenticated and successful JSON routes, but not an arbitrary success response', () => {
	assert.equal(responseSupportsDevices(401, ''), true);
	assert.equal(responseSupportsDevices(403, 'text/plain'), true);
	assert.equal(responseSupportsDevices(200, 'application/json; charset=utf-8'), true);
	assert.equal(responseSupportsDevices(200, 'text/html'), false);
	assert.equal(responseSupportsDevices(404, 'application/json'), false);
});

test('the packaged proxy must identify the currently selected endpoint', async () => {
	const compatible = await probeBundledProxy({
		endpointUrl: 'https://preview.example.com/',
		origin: 'http://127.0.0.1:40123',
		fetchImpl: async () => new Response(null, { status: 401, headers: { 'x-thingtime-api-fallback': 'https://preview.example.com' } })
	});
	assert.equal(compatible.status, 'compatible');

	const mismatch = await probeBundledProxy({
		endpointUrl: 'https://preview.example.com/',
		origin: 'http://127.0.0.1:40123',
		fetchImpl: async () => new Response(null, { status: 401, headers: { 'x-thingtime-api-fallback': 'https://thingtime.com' } })
	});
	assert.deepEqual(
		{ status: mismatch.status, message: mismatch.message },
		{
			status: 'incompatible',
			message: 'The packaged API proxy is not using the selected endpoint.'
		}
	);
});

test('a direct incompatibility prevents the proxy leg from being treated as healthy', async () => {
	const result = await checkEndpointCompatibility({ endpointUrl: 'not a URL', origin: 'http://127.0.0.1:40123' });
	assert.equal(result.status, 'incompatible');
	assert.equal(result.proxy, null);
});

test('capability contracts use compatible major versions and reject a missing or breaking feature', async () => {
	assert.equal(supportsVersion('1.2.0', '^1.0.0'), true);
	assert.equal(supportsVersion('2.0.0', '^1.0.0'), false);
	assert.equal(supportsVersion('invalid', '^1.0.0'), false);
	assert.equal(DESKTOP_REQUIRED_CAPABILITIES['api.devices'], '^1.8.0');
	assert.equal(DESKTOP_REQUIRED_CAPABILITIES['api.capabilities'], '^1.1.0');
	assert.equal(supportsVersion('1.7.0', DESKTOP_REQUIRED_CAPABILITIES['api.devices']), false);

	const server = http.createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify({
				ok: true,
				schemaVersion: 1,
				features: { 'api.capabilities': '1.1.0', 'api.devices': '1.8.0', 'api.posts': '1.0.0' },
				dataEnvironment: {
					schemaVersion: 1,
					id: 'development',
					kind: 'development',
					federationId: 'development',
					authorityOrigin: 'https://dev.thingtime.com'
				}
			})
		);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	try {
		const supported = await probeEndpointCapabilities(`http://127.0.0.1:${port}/`);
		assert.equal(supported.status, 'compatible');
		const breaking = await probeEndpointCapabilities(`http://127.0.0.1:${port}/`, { required: { 'api.devices': '^2.0.0' } });
		assert.equal(breaking.status, 'incompatible');
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});

test('a selected endpoint must publish a safe data-environment identity', () => {
	assert.equal(
		hasDeploymentDataEnvironment({
			schemaVersion: 1,
			id: 'development',
			kind: 'development',
			federationId: 'development',
			authorityOrigin: 'https://dev.thingtime.com'
		}),
		true
	);
	assert.equal(hasDeploymentDataEnvironment({ schemaVersion: 1, id: 'production', kind: 'production', federationId: 'production' }), false);
});

test('the direct endpoint probe distinguishes an authenticated computers route from a missing one', async () => {
	const server = http.createServer((request, response) => {
		response.statusCode = request.url?.startsWith('/api/v1/devices') ? 401 : 404;
		response.setHeader('content-type', 'application/json');
		response.end('{"ok":false}');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	try {
		const available = await probeEndpointDevices(`http://127.0.0.1:${port}/`);
		assert.equal(available.status, 'compatible');
	} finally {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
