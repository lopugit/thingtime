// Real connector HTTP/CORS/auth boundary with synthetic provider data only.
// --serve keeps a local browser fixture alive; production CLI never imports it.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createMailConnector } from './mail-connector.mts';
import { folderFor, parseMailMessage } from '../app/api/utils/mail/provider';
const origin = process.env.MAIL_TEST_BASE || 'http://127.0.0.1:13760';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Use a loopback test origin.');
const token = 'synthetic-mail-browser-fixture-only-2026';
const server = createMailConnector({
	origin,
	token,
	fetchBatch: async (account, request) => {
		const protocol = request.protocol === 'pop3' ? 'pop3' : 'imap';
		const folders = [folderFor(account.id, protocol, 'INBOX'), ...(protocol === 'imap' ? [folderFor(account.id, protocol, 'Friends')] : [])];
		const folder = folders.find((value) => value.path === (request.path || 'INBOX'))!;
		const messages = request.discover
			? []
			: await Promise.all(
					[1, 2].map(async (id) =>
						parseMailMessage(
							Buffer.from(
								[
									'From: Friend <friend@example.test>',
									`To: ${account.address}`,
									`Subject: ${account.name} — ${folder.name} — ${id === 1 ? 'Hello from your inbox' : 'Weekend plans'}`,
									`Date: Fri, 16 Oct 2026 12:0${id}:00 +0000`,
									'Content-Type: text/plain; charset=utf-8',
									'',
									'This is synthetic mail for browser verification.\r\nYour original mailbox stays exactly where it is.\r\n<script>alert("never execute")</script>'
								].join('\r\n')
							),
							folder,
							String(id)
						)
					)
			  );
		return { folders: request.discover ? folders : [folder], messages, nextCursor: null };
	}
});
server.listen(17879, '127.0.0.1');
await once(server, 'listening');
try {
	const url = 'http://127.0.0.1:17879/sync';
	assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://wrong.example' } })).status, 403);
	const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin } });
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
	assert.equal((await fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
	const account = {
		id: 'fixture_account',
		revision: 0,
		name: 'Personal',
		address: 'reader@example.test',
		sync: { cloud: false, local: false },
		servers: { imap: { host: 'mail.example.test', port: 993, security: 'tls', username: 'reader', password: 'synthetic-only' } }
	};
	const request = (value: object) =>
		fetch(url, {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(value)
		});
	assert.equal((await request({ account, protocol: 'imap' })).status, 403);
	account.sync.local = true;
	const response = await request({ account, protocol: 'imap' });
	assert.equal(response.status, 200);
	const batch = await response.json();
	assert.equal(batch.messages.length, 2);
	assert.equal(JSON.stringify(batch).includes('synthetic-only'), false);
	console.log('PASS: connector origin, preflight, bearer authentication, local opt-out, versioned message response');
} catch (error) {
	server.close();
	throw error;
}
if (process.argv.includes('--serve')) console.log('Synthetic connector fixture ready on 127.0.0.1:17879. Stop after browser checks.');
else server.close();
