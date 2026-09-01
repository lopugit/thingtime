import assert from 'node:assert/strict';
import test from 'node:test';

import { getDeploymentDataEnvironment, isSameDataEnvironment } from './dataEnvironment';

test('data environments expose only stable public authority metadata', () => {
	assert.deepEqual(getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'production' }), {
		schemaVersion: 1,
		id: 'production',
		kind: 'production',
		federationId: 'production',
		authorityOrigin: 'https://thingtime.com'
	});
	assert.deepEqual(getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'development' }), {
		schemaVersion: 1,
		id: 'development',
		kind: 'development',
		federationId: 'development',
		authorityOrigin: 'https://dev.thingtime.com'
	});
});

test('custom data environments require a configured authority and may share a federation', () => {
	assert.equal(getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'custom:demo' }), null);
	const first = getDeploymentDataEnvironment({
		THINGTIME_DATA_ENV: 'custom:demo',
		THINGTIME_DATA_AUTHORITY_ORIGIN: 'https://demo.thingtime.com',
		THINGTIME_FEDERATION_ID: 'demo-shared'
	});
	const alias = getDeploymentDataEnvironment({
		THINGTIME_DATA_ENV: 'custom:demo-preview',
		THINGTIME_DATA_AUTHORITY_ORIGIN: 'https://demo.thingtime.com',
		THINGTIME_FEDERATION_ID: 'demo-shared'
	});
	assert.equal(first?.authorityOrigin, 'https://demo.thingtime.com');
	assert.equal(isSameDataEnvironment(first, alias), true);
	assert.equal(isSameDataEnvironment(first, getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'production' })), false);
});

test('data environment identifiers and origins fail closed', () => {
	assert.equal(getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'preview' }), null);
	assert.equal(
		getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'custom:valid', THINGTIME_DATA_AUTHORITY_ORIGIN: 'http://example.test' }),
		null
	);
	assert.equal(getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'custom:../../escape' }), null);
});
