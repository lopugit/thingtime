import { createHash, timingSafeEqual } from 'node:crypto';

export { appendDesktopAuthorizationResult, normalizeDesktopRedirectUri, normalizeDesktopState, normalizePkceChallenge } from './desktopOAuthRedirect';

// RFC 8252 loopback redirects for installed apps. We deliberately accept IP
// literals only: `localhost` can be resolved or intercepted differently across
// machines, while 127.0.0.1 / ::1 are unambiguously local. Commander binds the
// listener before opening the system browser and registers the exact origin
// (including its stable, unprivileged port) on its Thingtime app.
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export const normalizePkceVerifier = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	return PKCE_VERIFIER_RE.test(value) ? value : null;
};

export const pkceChallengeForVerifier = (verifier: string): string => createHash('sha256').update(verifier, 'ascii').digest('base64url');

export const pkceVerifierMatches = (verifier: unknown, expectedChallenge: unknown): boolean => {
	const normalizedVerifier = normalizePkceVerifier(verifier);
	if (!normalizedVerifier || typeof expectedChallenge !== 'string') return false;

	const actual = Buffer.from(pkceChallengeForVerifier(normalizedVerifier), 'ascii');
	const expected = Buffer.from(expectedChallenge, 'ascii');
	return actual.length === expected.length && timingSafeEqual(actual, expected);
};
