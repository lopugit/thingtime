// Production route + real accounted replica transactions, with a controllable
// synthetic provider at the transport boundary. No direct database mutations.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
const base = process.env.MAIL_TEST_BASE;
if (!base || new URL(base).hostname !== '127.0.0.1' || !process.env.MONGODB_CONNECTION_STRING?.includes('127.0.0.1:20437/'))
	throw new Error('Use the disposable mail replica only.');
const status = await fetch(base + '/api/v1/mongodb/status').then((r) => r.json());
assert.equal(status.replicaSet, 'mail-qa-rs');
const fixture = JSON.parse(readFileSync('/tmp/thingtime-mail-qa/browser-fixture.json', 'utf8'));
const login = await fetch(base + '/api/v1/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', Origin: base },
	body: JSON.stringify({ username: fixture.username, password: fixture.password })
});
assert.equal(login.status, 200);
const cookie = login.headers
	.getSetCookie()
	.map((v) => v.split(';')[0])
	.join('; ');
const { createMailHandler } = await import('../app/routes/api/v1/mail/_mail');
const { syncMailAccount, googleMailAction } = await import('../app/api/utils/mail/store');
const { createGoogleMailOAuth } = await import('../app/api/utils/mail/googleOAuth');
const { createGoogleMailCallback } = await import('../app/routes/api/v1/mail/google/callback/_callback');
const googleMailOAuth = createGoogleMailOAuth({
	googleMailConfig: async () => ({ clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: base + '/api/v1/mail/google/callback' }),
	exchangeGoogleMail: async () => ({
		address: 'gmail-fixture@example.test',
		grant: { subject: 'fixture-subject', refreshToken: 'fixture-private-refresh', clientId: 'fixture-client' }
	})
});
const googleCallback = createGoogleMailCallback(googleMailOAuth.callback);
const { folderFor, parseMailMessage } = await import('../app/api/utils/mail/provider');
let gate: Promise<void> | null = null,
	started: (() => void) | null = null;
let actionCalls = 0;
const { MailActionError } = await import('../app/mail/model');
const handler = createMailHandler({
	googleMailAction: (owner, input, signal) =>
		googleMailAction(owner, input, signal, async (_account, mutation) => {
			actionCalls++;
			if (mutation.action === 'send') throw new MailActionError(409, 'Synthetic uncertain send', 'uncertain');
			return { remoteId: 'message123', labelIds: ['INBOX'], unread: false };
		}),
	googleMailOAuth,
	syncMailAccount: (owner, id, request, signal, _fetch, deviceOnly) =>
		syncMailAccount(
			owner,
			id,
			request,
			signal,
			async (account) => {
				started?.();
				if (gate) await gate;
				if (account.provider === 'gmail') assert.equal(account.googleGrant?.refreshToken, 'fixture-private-refresh');
				const folder = folderFor(account.id, request.protocol, 'INBOX');
				const message = await parseMailMessage(
					Buffer.from('From: sender@example.test\r\nSubject: Atomic fixture\r\n\r\nSynthetic content'),
					folder,
					request.protocol === 'gmail' ? 'message123' : '7:1'
				);
				return { folders: [folder], messages: [message], nextCursor: null };
			},
			deviceOnly
		)
});
const server = createServer(async (req, res) => {
	try {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const response = await (req.url?.startsWith('/api/v1/mail/google/callback') ? googleCallback : handler)({
			request: new Request(base + req.url, {
				method: req.method,
				headers: req.headers as any,
				...(chunks.length ? { body: Buffer.concat(chunks) } : {})
			})
		});
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(await response.text());
	} catch {
		res.writeHead(500);
		res.end('{}');
	}
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${(server.address() as any).port}/api/v1/mail?expectedOwnerId=${fixture.ownerId}`;
async function call(body?: object, kind?: string) {
	const response = await fetch(url + (kind ? `&kind=${kind}` : ''), {
		method: body ? 'POST' : 'GET',
		headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
		...(body ? { body: JSON.stringify({ ...body, expectedOwnerId: fixture.ownerId }) } : {})
	});
	return { status: response.status, data: await response.json() };
}
try {
	const account = {
		id: randomUUID(),
		revision: 0,
		name: 'Storage fixture',
		address: 'reader@example.test',
		sync: { cloud: true, local: false },
		servers: { imap: { host: 'mail.example.test', port: 993, security: 'tls', username: 'reader', password: 'synthetic-only' } }
	};
	const saved = await call({ operation: 'save-account', account, writeId: randomUUID() });
	assert.equal(saved.status, 200, JSON.stringify(saved.data));
	const sync = () => call({ operation: 'sync', id: account.id, protocol: 'imap' });
	const first = await sync();
	assert.equal(first.status, 200, JSON.stringify(first.data));
	assert.equal((await sync()).status, 200);
	const messages = await call(undefined, 'mail-message');
	assert.equal(messages.data.records.filter((v: any) => v.accountId === account.id).length, 1, 'repeated sync converges');
	const proxy = { id: randomUUID(), revision: 0, name: 'Proxy fixture', folderIds: [first.data.folders[0].id] };
	assert.equal((await call({ operation: 'save-inbox', inbox: proxy, writeId: randomUUID() })).status, 200);
	let release!: () => void;
	gate = new Promise((resolve) => (release = resolve));
	const reached = new Promise<void>((resolve) => (started = resolve));
	const staleSync = sync();
	await reached;
	assert.equal((await call({ operation: 'delete', kind: 'mail-account', id: account.id, revision: 1 })).status, 200);
	release();
	assert.equal((await staleSync).status, 409, 'in-flight sync cannot resurrect a deleted account');
	const remaining = await call(undefined, 'mail-message');
	assert.equal(
		remaining.data.records.some((v: any) => v.accountId === account.id),
		false
	);
	assert.equal((await call({ operation: 'delete', kind: 'mail-inbox', id: proxy.id, revision: 1 })).status, 200);
	gate = null;
	started = null;
	const begin = await call({ operation: 'google-begin' });
	assert.equal(begin.status, 200, JSON.stringify(begin.data));
	const consent = new URL(begin.data.authorizeUrl);
	const cbUrl = new URL(url);
	cbUrl.pathname = '/api/v1/mail/google/callback';
	cbUrl.search = new URLSearchParams({ state: consent.searchParams.get('state')!, code: 'synthetic-code' }).toString();
	assert.equal((await fetch(cbUrl)).status, 200);
	const pending = await call({ operation: 'google-status', flowId: begin.data.flowId });
	assert.equal(pending.data.address, 'gmail-fixture@example.test');
	assert.equal(JSON.stringify(pending.data).includes('fixture-private-refresh'), false);
	const finish = { operation: 'google-finish', flowId: begin.data.flowId, address: pending.data.address };
	assert.equal((await call(finish)).status, 200);
	assert.equal((await call(finish)).status, 200);
	const gmail = (await call(undefined, 'mail-account')).data.records.find((a: any) => a.id === begin.data.flowId);
	assert.equal(gmail.provider, 'gmail');
	assert.equal(gmail.sync.cloud, false);
	assert.equal(gmail.googleGrant, undefined);
	const deviceBatch = await call({ operation: 'google-relay', id: gmail.id, protocol: 'gmail' });
	assert.equal(deviceBatch.status, 200, JSON.stringify(deviceBatch.data));
	assert.equal(deviceBatch.data.messages.length, 1);
	assert.equal(
		(await call(undefined, 'mail-message')).data.records.some((m: any) => m.accountId === gmail.id),
		false
	);
	assert.equal(
		(await call({ operation: 'save-account', account: { ...gmail, sync: { ...gmail.sync, cloud: true } }, writeId: randomUUID() })).status,
		200
	);
	assert.equal((await call({ operation: 'sync', id: gmail.id, protocol: 'gmail' })).status, 200);
	assert.equal((await call(undefined, 'mail-message')).data.records.filter((m: any) => m.accountId === gmail.id).length, 1);
	const readAction = {
		operation: 'google-action',
		id: gmail.id,
		revision: 2,
		writeId: randomUUID(),
		mutation: { action: 'read', remoteId: 'message123' }
	};
	assert.equal((await call(readAction)).status, 200);
	assert.equal((await call(readAction)).status, 200);
	assert.equal(actionCalls, 1);
	assert.equal((await call({ ...readAction, mutation: { ...readAction.mutation, action: 'unread' } })).status, 409);
	const cachedGmail = (await call(undefined, 'mail-message')).data.records.find((m: any) => m.accountId === gmail.id);
	assert.equal(cachedGmail.unread, false);
	const uncertain = {
		...readAction,
		writeId: randomUUID(),
		mutation: {
			action: 'send',
			draftId: 'draft123',
			messageId: 'message123',
			compose: { to: 'synthetic@example.test', cc: '', bcc: '', subject: 'Fixture only', text: 'Never sent' }
		}
	};
	assert.equal((await call(uncertain)).status, 409);
	assert.equal((await call(uncertain)).status, 409);
	assert.equal(actionCalls, 2, 'uncertain send is never replayed');
	gate = new Promise((resolve) => (release = resolve));
	const gmailReached = new Promise<void>((resolve) => (started = resolve));
	const staleGmailSync = call({ operation: 'sync', id: gmail.id, protocol: 'gmail' });
	await gmailReached;
	assert.equal((await call({ ...readAction, writeId: randomUUID() })).status, 200);
	release();
	assert.equal((await staleGmailSync).status, 409, 'a sync started before a Gmail action cannot overwrite its cache result');
	gate = null;
	started = null;
	console.log('PASS: completed action retry once, changed-payload refusal, uncertain send no replay, controlled Gmail action/sync race');
	if (process.env.KEEP_GMAIL_FIXTURE === '1') {
		console.log('PASS: retained synthetic Gmail fixture for local UI validation');
		server.close();
		process.exit(0);
	}
	assert.equal((await call({ operation: 'delete', kind: 'mail-account', id: gmail.id, revision: 2 })).status, 200);
	assert.equal((await call({ operation: 'google-relay', id: gmail.id, protocol: 'gmail' })).status, 404);
	console.log(
		'PASS: real session-bound OAuth flow, encrypted grant, redacted projections, idempotent finish, device-only no-persistence, cloud edit preserves grant, removal fences relay'
	);
	console.log(
		'PASS: real HTTP session, encrypted folder/message persistence, repeated-sync convergence, proxy ownership, controlled sync/delete race'
	);
	server.close();
	process.exit(0);
} catch (error) {
	server.close();
	console.error(error instanceof Error ? error.message : 'Mail storage integration failed');
	process.exit(1);
}
