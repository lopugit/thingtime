import { getSubscription } from '../subscriptions/subscriptions';
import { enforceRateLimit, type RateLimitOutcome } from './enforce';

// Explicit product allowlist: authentication, credential confirmation, admin
// controls, upload safety and all other endpoint limits are NOT exempted.
export type SubscriptionRateLimitProduct = 'ai.complete' | 'lopu.recordings';
const products = {
	'ai.complete': { rule: 'ai.complete', prefix: 'ai-complete:' },
	'lopu.recordings': { rule: 'things.write', prefix: 'recordings:' }
} as const;

export const createSubscriptionRateLimiter = (dependencies: {
	subscription: typeof getSubscription;
	limit: typeof enforceRateLimit;
}) => async (request: Request, product: SubscriptionRateLimitProduct, userId: string): Promise<RateLimitOutcome> => {
	const unavailable = (): RateLimitOutcome => ({ allowed: false, unavailable: true, limit: 0, remaining: 0, resetAt: new Date().toISOString() });
	if (!Object.prototype.hasOwnProperty.call(products, product) || !userId) return unavailable();
	try {
		// Home-pinned, protected assignment. Never trust a request's tier or an
		// unprotected user profile field. Re-resolve on every request so upgrades
		// and downgrades take effect without stale entitlement caches.
		const subscription = await dependencies.subscription('user', userId);
		if (subscription.subjectType !== 'user' || subscription.subjectId !== userId) return unavailable();
		if (subscription.tier === 'pro' || subscription.tier === 'payg')
			return { allowed: true, limit: 0, remaining: 0, resetAt: new Date().toISOString() };
		const selected = products[product];
		// Keep the pre-existing account bucket and time window. Switching tier,
		// session, IP or device cannot reset finite usage; unknown/custom tiers
		// receive the Free policy rather than accidentally granting unlimited.
		return await dependencies.limit(request, selected.rule, `${selected.prefix}${userId}`, {
			failClosed: true, limitMultiplier: subscription.tier === 'plus' ? 5 : 1
		});
	} catch {
		return unavailable();
	}
};

export const enforceSubscriptionRateLimit = createSubscriptionRateLimiter({ subscription: getSubscription, limit: enforceRateLimit });
