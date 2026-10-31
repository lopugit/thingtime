import { json } from '../http';
import { getAuthToken } from './auth/authCookie';
import { getCurrentUser } from './auth/getCurrentUser';
import { resolveAppToken } from './apps/appTokens';
import { scopeCovers } from './apps/scopes';
import { getSubscription } from './subscriptions/subscriptions';
import { speedTestsPerHour } from './subscriptions/tierCatalog';
import { enforceQuotaRateLimit, enforceRateLimit, rateLimitedResponseInit } from './rateLimit/enforce';

// Anonymous callers retain the bounded public diagnostic. Supplying an invalid
// or revoked credential fails authentication; it never silently spends an IP
// bucket or accepts a tier/user id from the request.
export async function networkProbeAccess(request: Request, direction: 'download' | 'upload' | 'ping'): Promise<Response | null> {
	const token = await getAuthToken(request);
	if (!token && !request.headers.has('authorization')) {
		const outcome = await enforceRateLimit(request, direction === 'ping' ? 'networkProbe.ping' : direction === 'download' ? 'networkProbe.download' : 'networkProbe.upload.v2', null, {
			failClosed: true
		});
		if (outcome.unavailable) return json({ ok: false, error: 'Speed-test allowance is temporarily unavailable' }, { status: 503 });
		return outcome.allowed
			? null
			: json({ ok: false, error: 'Guest speed-test allowance reached. Sign in for your account allowance.' }, rateLimitedResponseInit(outcome));
	}

	const app = await resolveAppToken(request);
	if (
		app &&
		(app.sandbox || !scopeCovers(app.scopes, 'profile.username') || (request.headers.get('origin') && request.headers.get('origin') !== app.origin))
	)
		return json({ ok: false, error: 'This credential cannot run account speed tests' }, { status: 403 });
	const user = app?.user ?? (await getCurrentUser(request));
	if (!user) return json({ ok: false, error: 'Sign in again to use your account speed-test allowance' }, { status: 401 });
	// The tiny latency preflight must not impose a hidden IP cooldown on an
	// authenticated speed test. Only the payload ladder spends its allowance.
	if (direction === 'ping') return null;

	// Home-plane protected subscription, including pinned revision and overrides.
	const subscription = await getSubscription('user', user.id);
	const allowance = speedTestsPerHour(subscription.tier, subscription.effective);
	if (allowance === null) return null; // Pro: no hidden IP/time/request quota.
	if (allowance === 0) return json({ ok: false, error: 'Speed tests are disabled for this account tier' }, { status: 403 });
	// Each full run uses five download packets and eleven upload chunks. Shared
	// sliding windows count actual attempts; partial tests spend only their work.
	const outcome = await enforceQuotaRateLimit(`network-probe.${direction}`, user.id, allowance * (direction === 'download' ? 5 : 11));
	if (outcome.unavailable) return json({ ok: false, error: 'Speed-test allowance is temporarily unavailable' }, { status: 503 });
	return outcome.allowed
		? null
		: json({ ok: false, error: `Account speed-test allowance reached (${allowance} tests/hour).` }, rateLimitedResponseInit(outcome));
}
