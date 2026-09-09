import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionRateLimiter } from '../rateLimit/subscription';
import { rateLimitRuleWithMultiplier } from '../rateLimit/enforce';

const request = new Request('https://thingtime.test/api/v1/ai/complete', { headers: { 'x-tier': 'pro', 'x-user-id': 'someone-else' } });
const result = { allowed: false, limit: 20, remaining: 0, resetAt: '2026-09-09T00:00:00.000Z' };
test('Pro and PAYG product allowances bypass the limiter only after protected account resolution', async () => {
	for (const tier of ['pro', 'payg']) {
		const limit = createSubscriptionRateLimiter({ subscription: async (kind, id) => {
			assert.equal(kind, 'user'); assert.equal(id, 'owner');
			return { subjectType: kind, subjectId: id, tier } as any;
		}, limit: async () => { throw new Error('Unlimited must not touch the limiter'); } });
		for (const product of ['ai.complete', 'lopu.recordings'] as const) assert.equal((await limit(request, product, 'owner')).allowed, true);
	}
});
test('Free, Plus and unknown tiers keep account buckets and fail-closed finite policy', async () => {
	for (const [tier, multiplier] of [['free', 1], ['plus', 5], ['custom', 1]] as const) {
		const limit = createSubscriptionRateLimiter({
			subscription: async () => ({ subjectType: 'user', subjectId: 'owner', tier }) as any,
			limit: async (received, rule, identity, options) => {
				assert.equal(received, request); assert.equal(rule, 'ai.complete'); assert.equal(identity, 'ai-complete:owner');
				assert.deepEqual(options, { failClosed: true, limitMultiplier: multiplier }); return result;
			}
		});
		assert.deepEqual(await limit(request, 'ai.complete', 'owner'), result);
	}
});
test('recording settings, retries and todo mutations retain their existing account bucket', async () => {
	const limit = createSubscriptionRateLimiter({ subscription: async () => ({ subjectType: 'user', subjectId: 'owner', tier: 'plus' }) as any,
		limit: async (_request, rule, identity, options) => {
			assert.equal(rule, 'things.write'); assert.equal(identity, 'recordings:owner'); assert.equal(options?.limitMultiplier, 5); return result;
		} });
	assert.deepEqual(await limit(request, 'lopu.recordings', 'owner'), result);
});
test('tier changes re-resolve without changing finite usage identity', async () => {
	let tier = 'free'; const identities: string[] = [];
	const limit = createSubscriptionRateLimiter({ subscription: async () => ({ subjectType: 'user', subjectId: 'owner', tier }) as any,
		limit: async (_request, _rule, identity) => { identities.push(identity!); return result; } });
	await limit(request, 'ai.complete', 'owner'); tier = 'pro';
	assert.equal((await limit(request, 'ai.complete', 'owner')).allowed, true); tier = 'free';
	assert.equal((await limit(request, 'ai.complete', 'owner')).allowed, false);
	assert.deepEqual(identities, ['ai-complete:owner', 'ai-complete:owner']);
});
test('subscription outages, mismatched accounts and non-product security rules fail closed', async () => {
	for (const subscription of [async () => { throw new Error('private database diagnostic'); }, async () => ({ subjectType: 'user', subjectId: 'other', tier: 'pro' })]) {
		const limit = createSubscriptionRateLimiter({ subscription: subscription as any, limit: async () => { throw Error('No consumption'); } });
		const outcome = await limit(request, 'ai.complete', 'owner');
		assert.equal(outcome.allowed, false); assert.equal(outcome.unavailable, true);
		assert.equal(JSON.stringify(outcome).includes('private database diagnostic'), false);
	}
	const limit = createSubscriptionRateLimiter({ subscription: async () => { throw Error('Must not resolve'); }, limit: async () => result });
	for (const rule of ['auth.login', 'attachments.start', '__proto__', 'constructor']) assert.equal((await limit(request, rule as any, 'owner')).allowed, false);
});
test('tier multiplier preserves windows, disabled rules and ordinary callers; only bounded 5x is accepted', () => {
	const rule = { limit: 20, windowMs: 600_000, enabled: true };
	assert.deepEqual(rateLimitRuleWithMultiplier(rule, 5), { ...rule, limit: 100 });
	for (const multiplier of [undefined, 0, -1, Infinity, NaN, 1000]) assert.deepEqual(rateLimitRuleWithMultiplier(rule, multiplier), rule);
	assert.deepEqual(rateLimitRuleWithMultiplier({ ...rule, enabled: false }, 5), { ...rule, enabled: false, limit: 100 });
	assert.equal(rateLimitRuleWithMultiplier(undefined, 5), undefined);
});
