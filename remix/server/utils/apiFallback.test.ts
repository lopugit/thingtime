import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiFallbackOrigin, shouldProxyApiToFallback } from './apiFallback';

const ENV_KEYS = ['JWT_PRIVATE_KEY', 'JWT_SECRET', 'MONGODB_CONNECTION_STRING', 'THINGTIME_API_FALLBACK_ORIGIN'] as const;

const withFallbackEnv = async (fallbackOrigin: string | undefined, run: () => Promise<void> | void) => {
	const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	delete process.env.JWT_PRIVATE_KEY;
	delete process.env.JWT_SECRET;
	delete process.env.MONGODB_CONNECTION_STRING;
	if (fallbackOrigin === undefined) delete process.env.THINGTIME_API_FALLBACK_ORIGIN;
	else process.env.THINGTIME_API_FALLBACK_ORIGIN = fallbackOrigin;

	try {
		await run();
	} finally {
		for (const key of ENV_KEYS) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

test('API fallback defaults to production and accepts only HTTPS or loopback HTTP targets', async () => {
	await withFallbackEnv(undefined, () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
	await withFallbackEnv('https://pr-68.previews.dev.thingtime.com/path?ignored=true', () => {
		assert.equal(getApiFallbackOrigin(), 'https://pr-68.previews.dev.thingtime.com');
	});
	await withFallbackEnv('http://127.0.0.1:18280/', () => {
		assert.equal(getApiFallbackOrigin(), 'http://127.0.0.1:18280');
	});
	await withFallbackEnv('http://example.com/', () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
	await withFallbackEnv('https://user:secret@example.com/', () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
});

test('API fallback compares complete origins so two loopback ports do not bypass the proxy', async () => {
	await withFallbackEnv('http://127.0.0.1:18280/', () => {
		assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:59892/api/v1/devices')), true);
		assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:18280/api/v1/devices')), false);
	});
});
