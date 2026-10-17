import test from 'node:test';
import assert from 'node:assert/strict';
import { googleJson, exchangeGoogleMail, fetchGoogleMailBatch, GMAIL_SCOPE, type PrivateMailAccount } from './google';
import { publicMailAccount, validateMailAccount } from '~/mail/model';
const config = {
	clientId: 'fixture-client',
	clientSecret: 'private-client-secret',
	redirectUri: 'https://thingtime.test/api/v1/mail/google/callback'
};
const account: PrivateMailAccount = {
	id: 'gmail_account',
	name: 'Gmail',
	address: 'reader@example.com',
	revision: 1,
	provider: 'gmail',
	servers: {},
	sync: { cloud: false, local: true, transport: 'relay' },
	googleGrant: { refreshToken: 'private-refresh', subject: 'google-subject', clientId: config.clientId }
};
const reply = (body: any, status = 200) => new Response(JSON.stringify(body), { status });
test('Gmail public and validation projections remove all provider secrets', () => {
	for (const result of [publicMailAccount(account), validateMailAccount(account)]) {
		assert.equal(result.provider, 'gmail');
		assert.equal(result.sync.cloud, false);
		assert.equal(JSON.stringify(result).includes('private-refresh'), false);
		assert.equal('googleGrant' in result, false);
	}
	assert.throws(() => validateMailAccount({ ...account, sync: { ...account.sync, transport: 'native' } }));
});
test('Google exchange requires modify scope, offline token and verified matching mailbox', async () => {
	const fetcher: typeof fetch = async (url, init) => {
		assert.equal(init?.redirect, 'error');
		if (String(url).includes('/token')) {
			assert.equal(new URLSearchParams(String(init?.body)).get('code_verifier'), 'verifier');
			return reply({ access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', scope: GMAIL_SCOPE });
		}
		return reply(
			String(url).includes('userinfo') ? { sub: 'subject', email: account.address, email_verified: true } : { emailAddress: account.address }
		);
	};
	const result = await exchangeGoogleMail(config, 'code', 'verifier', fetcher);
	assert.equal(result.address, account.address);
	assert.equal(result.grant.refreshToken, 'private-refresh');
	await assert.rejects(
		exchangeGoogleMail(config, 'code', 'verifier', async () => reply({ access_token: 'x', token_type: 'Bearer', scope: 'openid' })),
		/Gmail.*access/
	);
	await assert.rejects(
		exchangeGoogleMail(config, 'code', 'verifier', async (url, init) =>
			String(url).includes('userinfo') ? reply({ sub: 'subject', email: account.address, email_verified: false }) : fetcher(url, init)
		),
		/confirm/
	);
});
test('Gmail refresh and bounded MIME page share canonical records without modifying mailbox', async () => {
	const calls: string[] = [];
	const fetcher: typeof fetch = async (url, init) => {
		const path = String(url);
		calls.push(path);
		assert.equal(init?.redirect, 'error');
		if (path.endsWith('/token')) {
			assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), 'private-refresh');
			return reply({ access_token: 'access', token_type: 'Bearer', scope: GMAIL_SCOPE });
		}
		assert.equal(init?.method, undefined);
		assert.equal((init?.headers as any).Authorization, 'Bearer access');
		if (path.endsWith('/labels')) return reply({ labels: [{ id: 'INBOX', name: 'Inbox' }] });
		if (path.includes('messages?')) return reply({ messages: [{ id: 'abc123' }, { id: 'large456' }], nextPageToken: 'next-page' });
		if (path.includes('format=metadata'))
			return reply({
				sizeEstimate: path.includes('large456') ? 1000000 : 100,
				labelIds: ['UNREAD'],
				payload: { headers: [{ name: 'Subject', value: 'Big message' }] }
			});
		return reply({
			raw: Buffer.from('Subject: Hello\r\nContent-Type: text/html\r\n\r\n<p>Hi</p><img src="https://tracker.test/pixel">').toString('base64url')
		});
	};
	const batch = await fetchGoogleMailBatch(account, { protocol: 'gmail', path: 'INBOX' }, undefined, async () => config, fetcher);
	assert.equal(batch.messages.length, 2);
	assert.match(batch.messages[0].text, /^Hi/);
	assert.equal(batch.messages[1].truncated, true);
	assert.equal(batch.folders[0].protocol, 'gmail');
	assert.equal(batch.nextCursor, 'next-page');
	assert.equal(
		calls.some((url) => url.includes('tracker') || url.includes('large456?format=raw')),
		false
	);
	assert.equal(JSON.stringify(batch).includes('private-'), false);
});
test('Google HTTP boundary rejects redirects, unbounded bodies and redacts provider errors', async () => {
	await assert.rejects(
		googleJson('https://evil.test', {}, async () => {
			throw new Error('must not fetch');
		}),
		/endpoint/
	);
	await assert.rejects(
		googleJson('https://gmail.googleapis.com/test', {}, async () => reply({ secret: 'provider-secret' }, 401)),
		/authorization expired/
	);
	await assert.rejects(
		googleJson('https://gmail.googleapis.com/test', {}, async () => reply('x'.repeat(500)), 32),
		/oversized/
	);
});
