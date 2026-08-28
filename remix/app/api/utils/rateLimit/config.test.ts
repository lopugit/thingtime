import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test through the tsx loader.
import { RATE_LIMIT_DEFAULTS } from './config.ts';

test('registration keeps the established shared rate-limit policy', () => {
	assert.deepEqual(RATE_LIMIT_DEFAULTS['auth.register'], {
		limit: 10,
		windowMs: 15 * 60_000,
		enabled: true
	});
});
