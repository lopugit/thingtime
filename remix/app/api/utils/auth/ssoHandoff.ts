import { signJwt, signPurposeToken, verifyPurposeToken } from './jwt';
import { resolvePublicOrigin } from './publicOrigin';
import { createSession, getLiveSession, revokeSession } from './sessions';
import { findUserById, toPublicUserWithStorage } from './users';
import type { PublicUser } from './users';
import { getSessionsCollection } from '../mongodb/collections';

// Cross-origin session handoff: how a Thingtime deployment OUTSIDE the
// *.thingtime.com cookie family (an immutable *.vercel.app preview, a future
// custom domain) gets a first-class browser session from a signed-in
// thingtime.com surface — without any cookie crossing a site boundary and
// without a central session store.
//
// Flow: the first-party surface (the /authorize?self=1 popup, or the FedCM
// assertion endpoint) mints a SHORT-LIVED, AUD-BOUND, SINGLE-USE code for the
// requesting origin. The foreign page hands the code to ITS OWN deployment's
// /api/v1/auth/sso-session, which verifies the signature (deployments share
// JWT key material), checks the aud against its own public origin (the
// owner's "protect per-token origin binding" rule — origins stay default-open,
// the binding is per-code), claims it exactly once, and only then does the
// normal login tail (auth cookie + roster merge + hints pointer).
//
// The pre-minted session starts with a 2-minute expiry: an unclaimed code's
// session dies on its own. Claiming extends it to the normal 30 days. Sessions
// live in the MINTING deployment's database, so redemption only succeeds on
// deployments sharing that database (an immutable preview and its alias twin
// do) — a different-environment redemption fails closed with a clear error,
// never a half-session.

const UNCLAIMED_TTL_MS = 1000 * 60 * 2;
const CLAIMED_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const CODE_TTL = '2m';

export type SsoHandoffFail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): SsoHandoffFail => ({ ok: false, status, error });

const normalizeWebOrigin = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value || value.length > 256) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.origin === value ? url.origin : null;
	} catch {
		return null;
	}
};

// Mint a handoff code for the signed-in user, bound to the target origin.
export const issueSsoHandoffCode = async (
	userId: string,
	targetOrigin: unknown,
	request: Request
): Promise<SsoHandoffFail | { ok: true; code: string; aud: string; expiresAt: string }> => {
	const aud = normalizeWebOrigin(targetOrigin);
	if (!aud) return fail(400, 'origin must be a valid web origin');

	const from = resolvePublicOrigin(request).origin;
	const now = Date.now();
	const session = await createSession(String(userId), {
		purpose: 'browser',
		expiresAt: new Date(now + UNCLAIMED_TTL_MS),
		meta: { method: 'sso-handoff', from, aud }
	});
	const code = await signPurposeToken('sso-handoff', { jti: session.jti, sub: String(userId), aud }, CODE_TTL);
	return { ok: true, code, aud, expiresAt: new Date(now + UNCLAIMED_TTL_MS).toISOString() };
};

export type ClaimedSsoSession = { ok: true; user: PublicUser; jwt: string; jti: string };

// Redeem a handoff code at the RECEIVING deployment. Generic errors on every
// rejection path so codes can't be probed.
export const claimSsoHandoffCode = async (request: Request, code: unknown): Promise<SsoHandoffFail | ClaimedSsoSession> => {
	if (typeof code !== 'string' || !code || code.length > 2048) {
		return fail(400, 'code is required');
	}

	const payload = await verifyPurposeToken(code, 'sso-handoff');
	if (!payload || typeof payload.jti !== 'string' || typeof payload.sub !== 'string' || typeof payload.aud !== 'string') {
		return fail(401, 'This sign-in link is no longer valid — try again');
	}

	// Per-code origin binding: the code only redeems on the deployment whose
	// public origin it was minted for.
	const myOrigin = resolvePublicOrigin(request).origin;
	if (payload.aud !== myOrigin) {
		return fail(403, 'This sign-in link belongs to a different site');
	}

	// Single use, atomically: first claim wins; a second claim is a theft
	// signal, so the session is revoked outright.
	const sessions = await getSessionsCollection();
	const claim = await sessions.updateOne(
		{ jti: payload.jti, 'meta.method': 'sso-handoff', 'meta.aud': payload.aud, 'meta.claimedAt': { $exists: false }, revokedAt: null },
		{ $set: { 'meta.claimedAt': new Date(), expiresAt: new Date(Date.now() + CLAIMED_TTL_MS) } }
	);
	if (claim.matchedCount === 0) {
		await revokeSession(payload.jti);
		return fail(401, 'This sign-in link is no longer valid — try again');
	}

	// A deployment on a different database matches nothing above and lands
	// here via the missing session instead — same generic error either way.
	const session = await getLiveSession(payload.jti);
	if (!session || String(session.userId) !== payload.sub) {
		return fail(401, 'This sign-in link is no longer valid — try again');
	}

	const user = await findUserById(payload.sub);
	if (!user) return fail(401, 'This sign-in link is no longer valid — try again');

	const jwt = await signJwt({ sub: payload.sub, jti: payload.jti });
	return { ok: true, user: await toPublicUserWithStorage(user), jwt, jti: payload.jti };
};
