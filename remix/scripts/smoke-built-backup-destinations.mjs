/** Compiled Nitro routing proof. Owns only an ephemeral loopback HTTP listener;
 * uses no authenticated session, app env, private vault or reachable database. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCompiledEntry } from './smoke-built-file-sync-batches.mjs';

if (process.argv[2] === '--worker') {
	const { middleware } = await import(pathToFileURL(process.argv[3]).href);
	assert.equal(typeof middleware, 'function');
	const server = createServer((request, response) => Promise.resolve(middleware(request, response)).catch(() => {
		if (!response.headersSent) response.writeHead(500); response.end();
	}));
	try {
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const origin = `http://127.0.0.1:${server.address().port}`;
		const get = path => fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(8000) });
		const manifestResponse = await get('/.well-known/thingtime-capabilities.json');
		assert.equal(manifestResponse.status, 200); assert.match(manifestResponse.headers.get('content-type'), /application\/json/);
		const manifest = await manifestResponse.json();
		assert.equal(manifest.origin, origin); assert.equal(manifest.features['api.backup-destinations'].version, '1.0.0');
		assert.ok(manifest.operations.some(op => op.path === '/api/v1/backups/destinations' && op.methods.join(',') === 'GET'));
		const sourceResponse = await get('/api/v1/capabilities');
		assert.equal(sourceResponse.status, 200);
		assert.equal((await sourceResponse.json()).features['api.backup-destinations'], '1.0.0');
		const docsResponse = await get('/api/v1/backups/destinations-docs');
		assert.equal(docsResponse.status, 200); assert.match(docsResponse.headers.get('content-type'), /application\/json/);
		assert.match(JSON.stringify(await docsResponse.json()), /configured-unverified/);
		const denied = await get('/api/v1/backups/destinations');
		assert.equal(denied.status, 401); assert.match(denied.headers.get('cache-control'), /private.*no-store/);
		assert.deepEqual(await denied.json(), { ok: false, error: 'Unauthorized' });
		console.log(JSON.stringify({ builtBackupDestinationProof: true, adapter: 'compiled-node_middleware',
			manifestVersion: '1.0.0', docsRegistered: true, unauthenticatedStatus: 401,
			privateVaultRead: false, providerNetwork: false, authenticatedProviderAcceptance: false }));
	} finally { server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done)); }
	process.exit(0);
} else {
	assert.equal(process.argv.length, 4, 'Usage: node remix/scripts/smoke-built-backup-destinations.mjs --bundle <compiled .output>');
	assert.equal(process.argv[2], '--bundle');
	const entry = await resolveCompiledEntry(process.argv[3]);
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-backup-destinations-built-'));
	const child = spawn(process.execPath, [resolve(process.argv[1]), '--worker', entry], { cwd: directory,
		env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, NODE_ENV: 'production',
			MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/thingtime-unreachable-backup-smoke?serverSelectionTimeoutMS=100',
			JWT_SECRET: randomUUID() + randomUUID(), THINGTIME_DESKTOP_API_MODE: 'local' }, stdio: 'inherit' });
	const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
	try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
	finally { clearTimeout(timer); if (child.exitCode === null && !child.signalCode) child.kill('SIGTERM'); await rm(directory, { recursive: true, force: true }); }
}
