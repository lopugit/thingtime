import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	appendDesktopAuthorizationResult,
	normalizeDesktopRedirectUri,
	normalizeDesktopState,
	normalizePkceChallenge,
	normalizePkceVerifier,
	pkceChallengeForVerifier,
	pkceVerifierMatches
} from './desktopOAuthCore.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { sessionPurposeCanActAsAccount } from '../auth/credentialPurpose.ts';

const verifier = '0123456789abcdefghijklmnopqrstuvwxyz-._~ABCDE';
const challenge = pkceChallengeForVerifier(verifier);

test('desktop redirects accept only explicit unprivileged loopback ports', () => {
	assert.deepEqual(normalizeDesktopRedirectUri('http://127.0.0.1:45432/oauth/callback'), {
		uri: 'http://127.0.0.1:45432/oauth/callback',
		origin: 'http://127.0.0.1:45432'
	});
	assert.deepEqual(normalizeDesktopRedirectUri('http://[::1]:45432/oauth/callback'), {
		uri: 'http://[::1]:45432/oauth/callback',
		origin: 'http://[::1]:45432'
	});
	for (const value of [
		'https://127.0.0.1:45432/oauth/callback',
		'http://localhost:45432/oauth/callback',
		'http://0.0.0.0:45432/oauth/callback',
		'http://127.0.0.1/oauth/callback',
		'http://127.0.0.1:80/oauth/callback',
		'http://user:password@127.0.0.1:45432/oauth/callback',
		'http://127.0.0.1:45432/oauth/callback?existing=1'
	])
		assert.equal(normalizeDesktopRedirectUri(value), null, value);
});

test('desktop PKCE requires S256 and does not elevate its short-lived code session', () => {
	assert.equal(normalizePkceVerifier(verifier), verifier);
	assert.equal(normalizePkceChallenge(challenge, 'S256'), challenge);
	assert.equal(normalizePkceChallenge(challenge, 'plain'), null);
	assert.equal(pkceVerifierMatches(verifier, challenge), true);
	assert.equal(pkceVerifierMatches(`${verifier.slice(0, -1)}F`, challenge), false);
	assert.equal(sessionPurposeCanActAsAccount('oauth-code'), false);
	assert.equal(sessionPurposeCanActAsAccount('browser'), true);
});

test('desktop callback returns only server-owned result parameters', () => {
	assert.equal(normalizeDesktopState('0123456789abcdef'), '0123456789abcdef');
	assert.equal(normalizeDesktopState('too-short'), null);
	assert.equal(
		appendDesktopAuthorizationResult('http://127.0.0.1:45432/oauth/callback', {
			code: 'one-time-code',
			state: 'request-state'
		}),
		'http://127.0.0.1:45432/oauth/callback?code=one-time-code&state=request-state'
	);
});
