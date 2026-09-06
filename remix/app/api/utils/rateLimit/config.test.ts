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

// S6 review: the subspace directory (GET /api/v1/subspaces) is a public read
// whose ranked sorts aggregate per call, so it carries the same ceiling as
// the sibling public reads it is modelled on (things.search / users.search)
test('the subspace directory read carries the shared public-read ceiling', () => {
	assert.deepEqual(RATE_LIMIT_DEFAULTS['subspaces.list'], { limit: 120, windowMs: 60_000, enabled: true });
	assert.deepEqual(RATE_LIMIT_DEFAULTS['subspaces.list'], RATE_LIMIT_DEFAULTS['things.search']);
});
