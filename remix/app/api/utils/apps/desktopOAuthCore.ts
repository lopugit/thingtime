import { createHash, timingSafeEqual } from 'node:crypto';

export { appendDesktopAuthorizationResult, normalizeDesktopRedirectUri, normalizeDesktopState, normalizePkceChallenge } from './desktopOAuthRedirect';

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
