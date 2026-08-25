import { json } from '~/api/http';
import { mergeAccountSession } from '~/api/utils/auth/accounts';
import { serializeAuthCookie } from '~/api/utils/auth/authCookie';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createTemporaryUserSession } from '~/api/utils/auth/temporaryUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const firstForwardedValue = (value: string | null) => value?.split(',')[0]?.trim() || '';

export const isSameOriginPost = (request: Request): boolean => {
	const origin = request.headers.get('Origin');
	if (!origin) return true;

	try {
		const requestUrl = new URL(request.url);
		const allowedOrigins = new Set([requestUrl.origin]);
		const publicHost = firstForwardedValue(request.headers.get('x-forwarded-host')) || request.headers.get('host')?.trim();
		if (publicHost) {
			const forwardedProtocol = firstForwardedValue(request.headers.get('x-forwarded-proto'));
			const protocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, '')}:` : requestUrl.protocol;
			allowedOrigins.add(new URL(`${protocol}//${publicHost}`).origin);
		}

		return allowedOrigins.has(new URL(origin).origin);
	} catch {
		return false;
	}
};

// POST /api/v1/auth/temporary — idempotently gives a first-time browser a
// real, recoverable session user. Existing sessions are returned unchanged;
// only a genuinely anonymous browser can consume the account-creation budget.
export const action = async ({ request }: { request: Request }) => {
	if (!isSameOriginPost(request)) {
		return json({ ok: false, error: 'Cross-origin temporary sessions are not allowed' }, { status: 403 });
	}

	const currentUser = await getCurrentUser(request);
	if (currentUser) {
		return json({ ok: true, user: currentUser, reused: true });
	}

	// This path performs bcrypt work and permanently creates a user Thing plus
	// subscription ledger, so it fails closed and is intentionally much tighter
	// than ordinary writes. A normal reload never reaches this bucket because
	// the session check above reuses the active account.
	const limit = await enforceRateLimit(request, 'auth.temporary', null, { failClosed: true });
	if (!limit.allowed) {
		return json(
			{ ok: false, error: 'Could not start another temporary space yet — please try again later' },
			rateLimitedResponseInit(limit)
		);
	}

	const created = await createTemporaryUserSession();
	if (created.ok === false) {
		return json({ ok: false, error: created.error }, { status: created.status });
	}

	const rosterCookies = await mergeAccountSession(request, { userId: created.user.id, jti: created.jti });
	const headers = new Headers();
	headers.append('Set-Cookie', await serializeAuthCookie(created.jwt));
	for (const cookie of rosterCookies) headers.append('Set-Cookie', cookie);

	return json({ ok: true, user: created.user, reused: false }, { status: 201, headers });
};
