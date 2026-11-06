import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

export function accountBackupSandbox(port, inbound = false) {
	assert.ok(Number.isInteger(port) && port > 1024 && port < 65535);
	return `(version 1) (allow default) (deny network*)
		(allow network-outbound (remote ip "localhost:${port}"))
		${inbound ? `(allow network-inbound (local ip "localhost:${port}"))` : ''}`;
}

export function isolatedAccountBackupProcess(command, args, options, port, inbound = false) {
	assert.equal(process.platform, 'darwin', 'This fixture requires verified macOS network isolation; no permissive fallback');
	return spawn('/usr/bin/sandbox-exec', ['-p', accountBackupSandbox(port, inbound), command, ...args], options);
}

/** Prove the OS denies forbidden connections, including redirects and direct
 * IPs. An application-level request interceptor or test label is not the gate. */
export async function verifyAccountBackupIsolation(port, env) {
	let deniedRequests = 0;
	const deniedPort = port + 2;
	const denied = createServer((_request, response) => {
		deniedRequests++;
		response.end('must never be reached');
	});
	const allowed = createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, { Location: `http://127.0.0.1:${deniedPort}/blocked` });
			response.end();
		} else response.end('allowed-test-destination');
	});
	try {
		for (const [server, listener] of [
			[denied, deniedPort],
			[allowed, port]
		]) {
			server.listen(listener, '127.0.0.1');
			await once(server, 'listening');
		}
		const code = `
			const assert = require('node:assert/strict');
			const net = require('node:net');
			const blocked = error => ['EPERM', 'EACCES'].includes(error?.code) ||
				blockedCause(error?.cause) || (error?.errors || []).some(blockedCause);
			function blockedCause(error) { return !!error && blocked(error); }
			async function deny(host, port) {
				await assert.rejects(new Promise((resolve, reject) => {
					const socket = net.connect({host,port,family:4});
					socket.once('connect', () => { socket.destroy(); resolve(); });
					socket.once('error', reject);
					socket.setTimeout(3000, () => { socket.destroy(); reject(Error('Not an enforced denial')); });
				}), blocked);
			}
			(async () => {
				assert.equal(await fetch('http://127.0.0.1:${port}/ok').then(r => r.text()), 'allowed-test-destination');
				await deny('127.0.0.1', ${deniedPort});
				await deny('localhost', ${deniedPort});
				await deny('192.0.2.1', 443);
				await assert.rejects(fetch('http://127.0.0.1:${port}/redirect'), blocked);
				console.log('ACCOUNT_BACKUP_NETWORK_ISOLATED');
			})().catch(() => { process.exitCode = 1; });
		`;
		const child = isolatedAccountBackupProcess(process.execPath, ['-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] }, port);
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		const timer = setTimeout(() => child.kill('SIGTERM'), 15000);
		let status;
		try {
			[status] = await once(child, 'exit');
		} finally {
			clearTimeout(timer);
		}
		assert.equal(status, 0, 'Operating-system isolation preflight failed; fixture will not start: ' + output.slice(-1000));
		assert.equal(output.trim(), 'ACCOUNT_BACKUP_NETWORK_ISOLATED');
		assert.equal(deniedRequests, 0);
	} finally {
		for (const server of [allowed, denied]) {
			server.closeAllConnections();
			if (server.listening) await new Promise((resolve) => server.close(resolve));
		}
	}
}
