import assert from 'node:assert/strict';
import test from 'node:test';
import { beginSsoRedirect, consumeSsoReturn, isFirstPartyPasskeyHost, ssoReturnUrl, SSO_RETURN_KEY } from './ssoNavigation';

const storage = () => { const entries = new Map<string, string>(); return { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v), removeItem: (k: string) => entries.delete(k) } as Storage; };
test('same-tab sign-in returns only to the initiating origin and consumes state once', () => {
	const store = storage(); let redirect = '';
	beginSsoRedirect('https://dev.thingtime.com', { origin: 'https://preview.vercel.app', pathname: '/feed', search: '?sort=new', hash: '', assign: url => { redirect = String(url); } }, store);
	const auth = new URL(redirect);
	assert.equal(auth.origin, 'https://dev.thingtime.com');
	const state = auth.searchParams.get('state')!;
	const callback = new URL(ssoReturnUrl('https://preview.vercel.app', state, { code: 'test-code' })!);
	assert.equal(callback.pathname, '/login');
	assert.equal(callback.search, ''); // codes never enter server logs/referrers
	assert.equal(consumeSsoReturn('https://other.vercel.app', callback.hash, store), null);
	assert.deepEqual(consumeSsoReturn(callback.origin, callback.hash, store), { code: 'test-code', returnTo: '/feed' });
	assert.equal(consumeSsoReturn(callback.origin, callback.hash, store), null);
});
test('callbacks reject invalid schemes, paths, state, expiry and unsafe return paths', () => {
	const state = crypto.randomUUID();
	for (const origin of ['javascript:alert(1)', 'https://example.com/path', 'https://example.com@evil.test/path']) assert.equal(ssoReturnUrl(origin, state, { code: 'x' }), null);
	assert.equal(ssoReturnUrl('https://thingtime.com', 'bad', { code: 'x' }), null);
	const store = storage();
	store.setItem(SSO_RETURN_KEY, JSON.stringify({ state, origin: 'https://example.com', createdAt: 0, returnTo: '//evil.test' }));
	const hash = new URL(ssoReturnUrl('https://example.com', state, { code: 'x' })!).hash;
	assert.equal(consumeSsoReturn('https://example.com', hash, store, 600_001), null);
	assert.deepEqual(consumeSsoReturn('https://example.com', hash, store, 1), { code: 'x', returnTo: '/' });
});
test('saved Thingtime passkeys are not offered directly on unrelated preview hosts', () => {
	for (const host of ['thingtime.com', 'dev.thingtime.com', 'pr-1.previews.dev.thingtime.com', 'localhost']) assert.equal(isFirstPartyPasskeyHost(host), true);
	for (const host of ['thingtime.vercel.app', 'thingtime.com.evil.test']) assert.equal(isFirstPartyPasskeyHost(host), false);
});

test('sign-in return state never persists auth or invitation query/fragment tokens', () => {
 const store = storage();
 beginSsoRedirect('https://dev.thingtime.com', { origin: 'https://preview.vercel.app', pathname: '/invite', search: '?token=secret', hash: '#token=secret', assign: () => {} }, store);
 assert.equal(store.getItem(SSO_RETURN_KEY)?.includes('secret'), false);
});
