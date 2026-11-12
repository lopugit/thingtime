// Real TLS sockets + real protocol clients against a disposable synthetic server.
// No Thingtime DB writes, provider accounts or external mail are used.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import tls from 'node:tls';
import net from 'node:net';
import { once } from 'node:events';
import { fetchMailBatch } from './provider';
import { Pop3Reader } from './pop3';
import type { MailAccount } from '../../../mail/model';
if (!process.env.MAIL_FIXTURE_CERT) {
	const dir = mkdtempSync(join(tmpdir(), 'tt-mail-tls-'));
	try {
		execFileSync(
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-nodes',
				'-keyout',
				join(dir, 'key.pem'),
				'-out',
				join(dir, 'cert.pem'),
				'-days',
				'1',
				'-subj',
				'/CN=mail.fixture.test',
				'-addext',
				'subjectAltName=DNS:mail.fixture.test'
			],
			{ stdio: 'ignore' }
		);
		const child = spawnSync(process.execPath, ['--import', 'tsx', import.meta.filename], {
			stdio: 'inherit',
			env: { ...process.env, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem'), MAIL_FIXTURE_CERT: dir }
		});
		if (child.status) process.exitCode = child.status;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
} else {
	const dir = process.env.MAIL_FIXTURE_CERT,
		commands: string[] = [];
	const raw = Buffer.from(
		'From: Sender <sender@example.test>\r\nTo: Reader <reader@example.test>\r\nSubject: Transport fixture\r\nDate: Fri, 16 Oct 2026 12:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nFirst line\r\n.dot-stuffed line\r\n'
	);
	const server = tls.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) });
	server.on('secureConnection', (socket) => {
		socket.on('error', () => {});
		socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] ready\r\n');
		let pending = '';
		socket.on('data', (chunk) => {
			pending += chunk.toString();
			let lineEnd;
			while ((lineEnd = pending.indexOf('\r\n')) >= 0) {
				const line = pending.slice(0, lineEnd);
				pending = pending.slice(lineEnd + 2);
				const [tag, verb] = line.split(' ');
				commands.push(verb);
				if (verb === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n' + tag + ' OK done\r\n');
				else if (verb === 'LOGIN' || verb === 'AUTHENTICATE') socket.write(tag + ' OK authenticated\r\n');
				else if (verb === 'LIST' || verb === 'LSUB') socket.write('* LIST () "/" "INBOX"\r\n* LIST () "/" "Friends"\r\n' + tag + ' OK done\r\n');
				else if (verb === 'EXAMINE')
					socket.write(
						'* FLAGS (\\Seen)\r\n* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 7]\r\n* OK [UIDNEXT 3]\r\n' + tag + ' OK [READ-ONLY] done\r\n'
					);
				else if (verb === 'FETCH') {
					for (let seq = 1; seq <= 2; seq++) {
						socket.write(
							`* ${seq} FETCH (UID ${seq} FLAGS () INTERNALDATE "16-Oct-2026 12:00:00 +0000" RFC822.SIZE ${raw.length} BODY[] {${raw.length}}\r\n`
						);
						socket.write(raw);
						socket.write(')\r\n');
					}
					socket.write(tag + ' OK done\r\n');
				} else socket.write(tag + ' BAD unsupported\r\n');
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as any).port;
	// Keep the production account validator's standard port; this internal-only
	// fixture factory redirects the validated TLS client's socket to our server.
	const original = tls.connect;
	(tls as any).connect = function (options: any, ...rest: any[]) {
		return original.call(tls, { ...options, port }, ...rest);
	};
	const account: MailAccount = {
		id: 'account_fixture',
		name: 'Fixture',
		address: 'reader@example.test',
		revision: 0,
		sync: { cloud: true, local: true },
		servers: { imap: { host: 'mail.fixture.test', port: 993, security: 'tls', username: 'reader', password: 'synthetic-only' } }
	};
	try {
		const deps = { resolveMailHost: async () => ({ address: '127.0.0.1', family: 4 }) };
		const discovered = await fetchMailBatch(account, { protocol: 'imap', discover: true }, undefined, deps);
		assert.equal(discovered.folders.length, 2);
		const batch = await fetchMailBatch(account, { protocol: 'imap' }, undefined, deps);
		assert.equal(batch.messages.length, 2);
		assert.equal(batch.messages[0].subject, 'Transport fixture');
		assert.match(batch.messages[0].text, /dot-stuffed/);
		assert.ok(commands.includes('EXAMINE'));
		assert.equal(
			commands.some((command) => ['SELECT', 'STORE', 'MOVE', 'COPY', 'EXPUNGE'].includes(command)),
			false
		);
	} finally {
		(tls as any).connect = original;
		server.close();
	}
	const popCommands: string[] = [];
	const pop = tls.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (socket) => {
		socket.on('error', () => {});
		socket.write('+OK ready\r\n');
		let pending = '';
		socket.on('data', (chunk) => {
			pending += chunk.toString();
			let end;
			while ((end = pending.indexOf('\r\n')) >= 0) {
				const line = pending.slice(0, end);
				pending = pending.slice(end + 2);
				const verb = line.split(' ')[0];
				popCommands.push(verb);
				if (verb === 'USER' || verb === 'PASS') socket.write('+OK\r\n');
				else if (verb === 'UIDL') socket.write('+OK\r\n1 stable-one\r\n.\r\n');
				else if (verb === 'LIST') socket.write(`+OK\r\n1 ${raw.length}\r\n.\r\n`);
				else if (verb === 'RETR') socket.write('+OK\r\n' + raw.toString().replace(/\r\n\./g, '\r\n..') + '.\r\n');
				else socket.write('-ERR unsupported\r\n');
			}
		});
	});
	await new Promise<void>((resolve) => pop.listen(0, '127.0.0.1', resolve));
	try {
		const reader = await Pop3Reader.connect(
			{ host: 'mail.fixture.test', port: (pop.address() as any).port, security: 'tls', username: 'reader', password: 'synthetic-only' },
			'127.0.0.1',
			AbortSignal.timeout(5000)
		);
		try {
			assert.equal((await reader.list())[0].uid, 'stable-one');
			assert.deepEqual(await reader.retrieve(1, 65536), raw);
		} finally {
			reader.close();
		}
		assert.deepEqual(popCommands, ['USER', 'PASS', 'UIDL', 'LIST', 'RETR']);
	} finally {
		pop.close();
	}
	// STARTTLS credentials must follow a verified TLS upgrade, never plaintext.
	const plainCommands: string[] = [],
		secureCommands: string[] = [];
	const starttls = net.createServer((socket) => {
		socket.on('error', () => {});
		socket.write('+OK ready\r\n');
		socket.once('data', (chunk) => {
			plainCommands.push(chunk.toString().trim());
			socket.write('+OK Begin TLS\r\n');
			const secure = new tls.TLSSocket(socket, {
				isServer: true,
				secureContext: tls.createSecureContext({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) })
			});
			secure.on('error', () => {});
			secure.on('data', (chunk) => {
				secureCommands.push(chunk.toString().split(' ')[0]);
				secure.write('+OK\r\n');
			});
		});
	});
	await new Promise<void>((resolve) => starttls.listen(0, '127.0.0.1', resolve));
	try {
		const reader = await Pop3Reader.connect(
			{ host: 'mail.fixture.test', port: (starttls.address() as any).port, security: 'starttls', username: 'reader', password: 'synthetic-only' },
			'127.0.0.1',
			AbortSignal.timeout(5000)
		);
		reader.close();
		assert.deepEqual(plainCommands, ['STLS']);
		assert.deepEqual(secureCommands, ['USER', 'PASS']);
	} finally {
		starttls.close();
	}
	const refusalCommands: string[] = [];
	const refuses = net.createServer((socket) => {
		socket.on('error', () => {});
		socket.write('+OK ready\r\n');
		socket.on('data', (chunk) => {
			refusalCommands.push(chunk.toString().trim());
			socket.write('-ERR STLS unavailable\r\n');
		});
	});
	await new Promise<void>((resolve) => refuses.listen(0, '127.0.0.1', resolve));
	try {
		await assert.rejects(
			Pop3Reader.connect(
				{ host: 'mail.fixture.test', port: (refuses.address() as any).port, security: 'starttls', username: 'reader', password: 'synthetic-only' },
				'127.0.0.1',
				AbortSignal.timeout(5000)
			)
		);
		assert.deepEqual(refusalCommands, ['STLS']);
	} finally {
		refuses.close();
	}
	console.log(
		'PASS: verified TLS, IMAP read-only EXAMINE/FETCH, POP3 UIDL/LIST/RETR, STLS upgrade and plaintext-downgrade refusal; no remote mutations'
	);
}
