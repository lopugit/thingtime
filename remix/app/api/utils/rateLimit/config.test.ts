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

// Round-2 spec: the subspace write keys. Every mutation shares the 60/min
// write budget, while the two fan-out emits (a join request and a NEW report
// each ring every moderator) sit under tighter, separate windows — 20/min for
// join / request-to-join and 30/min for reports — so a request → cancel →
// request loop or a report burst can't become a per-moderator bell amplifier.
test('the subspace write, join and report keys keep their round-2 windows', () => {
	assert.deepEqual(RATE_LIMIT_DEFAULTS['subspaces.write'], { limit: 60, windowMs: 60_000, enabled: true });
	assert.deepEqual(RATE_LIMIT_DEFAULTS['subspaces.join'], { limit: 20, windowMs: 60_000, enabled: true });
	assert.deepEqual(RATE_LIMIT_DEFAULTS['subspaces.report'], { limit: 30, windowMs: 60_000, enabled: true });
	assert.ok(RATE_LIMIT_DEFAULTS['subspaces.join'].limit < RATE_LIMIT_DEFAULTS['subspaces.write'].limit);
	assert.ok(RATE_LIMIT_DEFAULTS['subspaces.report'].limit < RATE_LIMIT_DEFAULTS['subspaces.write'].limit);
});

test('upload policy admits two full composer selections without an hour-long lockout', async () => {
	const { MAX_POST_ATTACHMENTS } = await import('../../../components/Attachments/attachmentUiCore');
	const { normalizeRateLimitConfig } = await import('./config');
	for (const stored of [null, { 'attachments.start': { limit: 30, windowMs: 3_600_000, enabled: true } }]) {
		const rule = normalizeRateLimitConfig(stored)['attachments.start'];
		assert.equal(rule.enabled, true);
		assert.ok(rule.limit >= 2 * MAX_POST_ATTACHMENTS + 3, 'two 25-file selections plus in-flight retry headroom');
		assert.ok(rule.limit <= 60, 'upload admission remains bounded');
		assert.equal(rule.windowMs, 60_000, 'old uploads cannot block the next hour');
	}
});

test('legacy upload policy upgrade preserves custom limits, disabled rules and unrelated policies', async () => {
	const { normalizeRateLimitConfig } = await import('./config');
	for (const rule of [
		{ limit: 12, windowMs: 3_600_000, enabled: true },
		{ limit: 30, windowMs: 120_000, enabled: true },
		{ limit: 30, windowMs: 3_600_000, enabled: false }
	]) assert.deepEqual(normalizeRateLimitConfig({ 'attachments.start': rule })['attachments.start'], rule);
	const other = { limit: 17, windowMs: 600_000, enabled: true };
	assert.deepEqual(normalizeRateLimitConfig({ 'auth.register': other })['auth.register'], other);
});

test('new explicit admin policy can retain the old numerical limit after migration', async () => {
	const { normalizeRateLimitConfig } = await import('./config');
	const rule = { limit: 30, windowMs: 3_600_000, enabled: true };
	assert.deepEqual(normalizeRateLimitConfig({ 'attachments.start': rule }, 1)['attachments.start'], rule);
});
