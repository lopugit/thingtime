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

test('desktop redirects accept explicit unprivileged IPv4 and IPv6 loopback ports', () => {
	assert.deepEqual(normalizeDesktopRedirectUri('http://127.0.0.1:45432/oauth/callback'), {
		uri: 'http://127.0.0.1:45432/oauth/callback',
		origin: 'http://127.0.0.1:45432'
	});
	assert.deepEqual(normalizeDesktopRedirectUri('http://[::1]:45432/oauth/callback'), {
		uri: 'http://[::1]:45432/oauth/callback',
		origin: 'http://[::1]:45432'
	});
});

test('desktop redirects accept only a structurally exact reverse-domain native callback', () => {
  assert.deepEqual(normalizeDesktopRedirectUri('com.thingtime.commander://oauth/callback'), {
    uri: 'com.thingtime.commander://oauth/callback',
    origin: 'com.thingtime.commander://oauth/callback',
    native: true
  });
  for (const value of [
    'commander://oauth/callback',
    'com.thingtime.commander://other/callback',
    'com.thingtime.commander://oauth/callback?preexisting=1',
    'com.thingtime.commander://oauth:444/callback',
    'https://thingtime.com/oauth/callback'
  ]) assert.equal(normalizeDesktopRedirectUri(value), null, value);
});

test('desktop redirects reject non-loopback, localhost aliases, unsafe URL parts, and privileged ports', () => {
	const rejected = [
		'https://127.0.0.1:45432/oauth/callback',
		'http://localhost:45432/oauth/callback',
		'http://0.0.0.0:45432/oauth/callback',
		'http://127.0.0.1/oauth/callback',
		'http://127.0.0.1:80/oauth/callback',
		'http://user:password@127.0.0.1:45432/oauth/callback',
		'http://127.0.0.1:45432/oauth/callback?existing=1',
		'http://127.0.0.1:45432/oauth/callback#fragment'
	];
	for (const value of rejected) assert.equal(normalizeDesktopRedirectUri(value), null, value);
});

test('PKCE accepts S256 only and verifies the RFC verifier alphabet in constant-length form', () => {
	assert.equal(normalizePkceVerifier(verifier), verifier);
	assert.equal(challenge.length, 43);
	assert.equal(normalizePkceChallenge(challenge, 'S256'), challenge);
	assert.equal(normalizePkceChallenge(challenge, 'plain'), null);
	assert.equal(normalizePkceVerifier('too-short'), null);
	assert.equal(pkceVerifierMatches(verifier, challenge), true);
	assert.equal(pkceVerifierMatches(`${verifier.slice(0, -1)}F`, challenge), false);
});

test('desktop state is mandatory and bounded', () => {
	assert.equal(normalizeDesktopState('0123456789abcdef'), '0123456789abcdef');
	assert.equal(normalizeDesktopState('too-short'), null);
	assert.equal(normalizeDesktopState('x'.repeat(513)), null);
});

test('authorization result appends only server-owned callback parameters', () => {
	assert.equal(
		appendDesktopAuthorizationResult('http://127.0.0.1:45432/oauth/callback', {
			code: 'one-time-code',
			state: 'request-state'
		}),
		'http://127.0.0.1:45432/oauth/callback?code=one-time-code&state=request-state'
	);
	assert.equal(
		appendDesktopAuthorizationResult('http://127.0.0.1:45432/oauth/callback', {
			error: 'access_denied',
			errorDescription: 'The user cancelled',
			state: 'request-state'
		}),
		'http://127.0.0.1:45432/oauth/callback?error=access_denied&error_description=The+user+cancelled&state=request-state'
	);
});

test('one-time OAuth codes cannot authenticate as full Thingtime accounts', () => {
	assert.equal(sessionPurposeCanActAsAccount('browser'), true);
	assert.equal(sessionPurposeCanActAsAccount('service'), true);
	assert.equal(sessionPurposeCanActAsAccount(undefined), true); // legacy browser sessions
	assert.equal(sessionPurposeCanActAsAccount('app'), false);
	assert.equal(sessionPurposeCanActAsAccount('app-sandbox'), false);
	assert.equal(sessionPurposeCanActAsAccount('pat'), false);
	assert.equal(sessionPurposeCanActAsAccount('oauth-code'), false);
	assert.equal(sessionPurposeCanActAsAccount('future-scoped-credential'), false);
});
