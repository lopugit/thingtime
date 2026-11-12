import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
	readLoginChallengeCookie,
	readRegistrationChallengeCookie,
	serializeLoginChallengeCookie,
	serializeRegistrationChallengeCookie,
	clearLoginChallengeCookie,
	responseChallenge
} from './webauthnChallenge';
const origin = 'https://pr-635.previews.dev.thingtime.com';
const assertion = (challenge: string) => ({ response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge })).toString('base64url') } });
const request = (cookies: string[] = []) => new Request(origin, { headers: { Cookie: cookies.map((c) => c.split(';')[0]).join('; ') } });
const challenge = () => randomBytes(32).toString('base64url');
test('two tabs keep independent login challenges; clearing one preserves the other', async () => {
	const a = { challenge: challenge(), rpID: 'thingtime.com', origin };
	const b = { ...a, challenge: challenge() };
	const ca = await serializeLoginChallengeCookie(a, request());
	const cb = await serializeLoginChallengeCookie(b, request(ca));
	const ra = await readLoginChallengeCookie(request([...ca, ...cb]), assertion(a.challenge));
	const rb = await readLoginChallengeCookie(request([...ca, ...cb]), assertion(b.challenge));
	assert.equal(ra?.challenge, a.challenge);
	assert.equal(rb?.challenge, b.challenge);
	assert.notEqual(ra?.cookieName, rb?.cookieName);
	assert.ok((await clearLoginChallengeCookie(ra!)).startsWith(ra!.cookieName + '=;'));
	assert.equal((await readLoginChallengeCookie(request(cb), assertion(b.challenge)))?.challenge, b.challenge);
	assert.equal(await readLoginChallengeCookie(request(cb), assertion(a.challenge)), null);
});
test('registration is owner-bound and cannot substitute for login', async () => {
	const payload = { challenge: challenge(), rpID: 'thingtime.com', origin, userId: 'test-owner' };
	const cookies = await serializeRegistrationChallengeCookie(payload, request());
	assert.equal((await readRegistrationChallengeCookie(request(cookies), assertion(payload.challenge)))?.userId, 'test-owner');
	assert.equal(await readLoginChallengeCookie(request(cookies), assertion(payload.challenge)), null);
});
test('forged clientData, malformed cookies and unknown challenges fail closed', async () => {
	assert.equal(responseChallenge({ response: { clientDataJSON: 'invalid' } }), null);
	const payload = { challenge: challenge(), rpID: 'thingtime.com', origin };
	const cookies = await serializeLoginChallengeCookie(payload, request());
	assert.equal(await readLoginChallengeCookie(request(cookies.map((c) => c.replace(/=.+?;/, '=%XX;'))), assertion(payload.challenge)), null);
	assert.equal(await readLoginChallengeCookie(request(cookies), assertion(challenge())), null);
});
test('pending challenge cookies are bounded', async () => {
	const cookies: string[] = [];
	for (let i = 0; i < 3; i++)
		cookies.push(...(await serializeLoginChallengeCookie({ challenge: challenge(), rpID: 'thingtime.com', origin }, request(cookies))));
	const next = await serializeLoginChallengeCookie({ challenge: challenge(), rpID: 'thingtime.com', origin }, request(cookies));
	assert.equal(next.length, 2);
	assert.match(next[0], /Max-Age=0/);
	assert.match(next[1], /HttpOnly/);
});
