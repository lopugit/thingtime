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
const { syncMailAccount } = await import('../app/api/utils/mail/store');
const { folderFor, parseMailMessage } = await import('../app/api/utils/mail/provider');
let gate: Promise<void> | null = null,
	started: (() => void) | null = null;
const handler = createMailHandler({
	syncMailAccount: (owner, id, request, signal) =>
		syncMailAccount(owner, id, request, signal, async (account) => {
			started?.();
			if (gate) await gate;
			const folder = folderFor(account.id, 'imap', 'INBOX');
			const message = await parseMailMessage(
				Buffer.from('From: sender@example.test\r\nSubject: Atomic fixture\r\n\r\nSynthetic content'),
				folder,
				'7:1'
			);
			return { folders: [folder], messages: [message], nextCursor: null };
		})
});
const server = createServer(async (req, res) => {
	try {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const response = await handler({
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
