#!/usr/bin/env node
/** Run AFTER the canonical build. Imports only the supplied compiled Nitro
 * node_middleware entry; never starts Vite, builds, loads .env or opens a DB. */
import assert from 'node:assert/strict';
import { mkdtemp, chmod, realpath, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';

export const BUILT_BATCH_SMOKE_PORT = 28164;
const PUBLIC_MANIFEST = '/.well-known/thingtime-capabilities.json';
const ENDPOINT = '/api/v1/files/batches';

export async function resolveCompiledEntry(bundle) {
	assert.equal(typeof bundle, 'string', 'Pass --bundle <compiled .output, server directory, or server/index.mjs>');
	const root = await realpath(resolve(bundle));
	const info = await stat(root);
	const candidates = info.isDirectory() ? [join(root, 'server/index.mjs'), join(root, 'index.mjs')] : [root];
	for (const candidate of candidates) {
		try {
			const entry = await realpath(candidate);
			if ((await stat(entry)).isFile() && basename(entry) === 'index.mjs' && basename(dirname(entry)) === 'server') return entry;
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	throw Error(
		'Expected compiled Nitro server/index.mjs. The supported adapter is the named middleware(req,res) export produced by node_middleware, as used by Desktop.'
	);
}
export function assertBuiltBatchManifest(manifest, origin) {
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.origin, origin);
	assert.equal(manifest.features?.['api.file-sync-batches']?.version, '1.0.0');
	assert.ok(
		manifest.operations?.some(
			(op) => op.feature === 'api.file-sync-batches' && op.path === ENDPOINT && op.methods.length === 1 && op.methods[0] === 'POST'
		)
	);
	assert.ok(
		manifest.operations?.some((op) => op.feature === 'api.file-sync-batches' && op.path === ENDPOINT + '-docs' && op.methods.includes('GET'))
	);
}

async function worker(entry, directory) {
	const actual = await realpath(directory);
	assert.equal(dirname(actual), await realpath(tmpdir()));
	assert.ok(basename(actual).startsWith('thingtime-built-batch-smoke-'));
	assert.equal((await stat(actual)).mode & 0o077, 0);
	assert.equal(process.env.HOME, actual);
	assert.equal(process.cwd(), actual);
	assert.equal(process.env.MONGODB_CONNECTION_STRING, undefined);
	// Same adapter contract as electron/lib/renderer-server.cjs. No guessed
	// handler/default exports or alternate HTTP startup for unsupported presets.
	const application = await import(pathToFileURL(entry).href);
	assert.equal(
		typeof application.middleware,
		'function',
		'Compiled entry must export middleware(req,res); build with Nitro node_middleware. No fallback is permitted.'
	);
	const origin = `http://127.0.0.1:${BUILT_BATCH_SMOKE_PORT}`;
	const server = createServer((request, response) => {
		Promise.resolve()
			.then(() => application.middleware(request, response))
			.catch(() => {
				if (!response.headersSent) response.writeHead(500);
				response.end();
			});
	});
	try {
		server.listen({ host: '127.0.0.1', port: BUILT_BATCH_SMOKE_PORT, exclusive: true });
		await once(server, 'listening');
		const get = async (path) => {
			const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(8000) });
			assert.equal(response.status, 200, path);
			assert.match(response.headers.get('content-type') || '', /application\/json/);
			return response.json();
		};
		const manifest = await get(PUBLIC_MANIFEST);
		assertBuiltBatchManifest(manifest, origin);
		const registry = await get('/api/v1/capabilities');
		assert.equal(registry.features?.['api.file-sync-batches'], '1.0.0');
		assert.ok(registry.features?.['route.v1.files.batches']);
		const docs = await get(ENDPOINT + '-docs');
		assert.equal(docs.ok, true);
		assert.equal(docs.docs.id, 'file-sync-batches');
		assert.equal(docs.docs.contractVersion, '1.0.0');
		for (const phase of ['observe', 'prepare', 'verify', 'commit'])
			assert.ok(
				docs.docs.steps.some((step) => step.includes(`phase=${phase}`)),
				`compiled docs ${phase}`
			);
		const denied = await fetch(origin + ENDPOINT, {
			method: 'POST',
			headers: { Origin: origin, 'Content-Type': 'application/json' },
			body: JSON.stringify({ phase: 'observe' }),
			redirect: 'error',
			signal: AbortSignal.timeout(8000)
		});
		assert.equal(denied.status, 401, 'Unauthenticated same-origin route must execute its local full-session gate without DB/remote auth');
		assert.match(denied.headers.get('cache-control') || '', /no-store/);
		assert.equal((await denied.json()).ok, false);
		console.log(
			JSON.stringify({
				builtBatchManifestProof: true,
				adapter: 'compiled-node_middleware',
				origin,
				feature: 'api.file-sync-batches',
				version: '1.0.0',
				postRegistered: true,
				docsPhases: 4,
				unauthenticatedStatus: 401,
				databaseConfigured: false
			})
		);
	} finally {
		server.closeAllConnections();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
	}
}

export async function runBuiltBatchSmoke(bundle) {
	const entry = await resolveCompiledEntry(bundle);
	const deadline = Date.now() + 60_000;
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'thingtime-built-batch-smoke-')));
	await chmod(directory, 0o700);
	const origin = `http://127.0.0.1:${BUILT_BATCH_SMOKE_PORT}`;
	const env = {
		PATH: process.env.PATH,
		HOME: directory,
		TMPDIR: directory,
		NODE_ENV: 'production',
		HOST: '127.0.0.1',
		NITRO_HOST: '127.0.0.1',
		PORT: String(BUILT_BATCH_SMOKE_PORT),
		NITRO_PORT: String(BUILT_BATCH_SMOKE_PORT),
		APP_URL: origin,
		JWT_SECRET: randomUUID() + randomUUID(),
		THINGTIME_DESKTOP_API_MODE: 'local'
	};
	let child, timer, killTimer;
	let childExited = false;
	const alive = () => child && !childExited && child.exitCode === null && child.signalCode === null;
	let cancelled = false,
		output = '';
	const terminate = () => {
		cancelled = true;
		if (alive()) {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => {
				if (alive()) child.kill('SIGKILL');
			}, 1000);
		}
	};
	process.once('SIGINT', terminate);
	process.once('SIGTERM', terminate);
	try {
		// The preflight itself binds only its task-owned loopback test listeners and
		// fails on occupied ports. It verifies redirect, hostname and direct-IP denial.
		await verifyAccountBackupIsolation(BUILT_BATCH_SMOKE_PORT, env);
		assert.ok(!cancelled && Date.now() < deadline, 'Smoke cancelled or deadline expired before bundle admission');
		child = isolatedAccountBackupProcess(
			process.execPath,
			[import.meta.filename, '--isolated-worker', entry, directory],
			{ cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] },
			BUILT_BATCH_SMOKE_PORT,
			true
		);
		child.once('exit', () => {
			childExited = true;
		});
		child.once('error', () => {
			childExited = true;
		});
		const append = (bytes) => {
			output = (output + bytes).slice(-64 * 1024);
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		timer = setTimeout(terminate, Math.max(1, deadline - Date.now()));
		const [code] = await once(child, 'exit');
		const proof = output.split('\n').find((line) => line.startsWith('{"builtBatchManifestProof":'));
		if (code !== 0 || !proof) {
			const log = join(tmpdir(), 'thingtime-built-batch-smoke-failure.log');
			await writeFile(log, output.replaceAll(env.JWT_SECRET, '[fixture secret withheld]').replace(/https?:\/\/[^\s"<>]+/g, '[url withheld]'), {
				mode: 0o600
			});
			throw Error('Built bundle smoke failed; bounded private diagnostic: ' + log);
		}
		console.log(JSON.stringify({ ...JSON.parse(proof), isolation: 'OS loopback-only; redirect/hostname/direct-IP denial verified' }));
	} finally {
		clearTimeout(timer);
		terminate();
		if (alive()) await once(child, 'exit');
		clearTimeout(killTimer);
		process.removeListener('SIGINT', terminate);
		process.removeListener('SIGTERM', terminate);
		await rm(directory, { recursive: true, force: true });
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		if (process.argv[2] === '--isolated-worker') {
			await worker(process.argv[3], process.argv[4]);
			process.exit(0);
		} else {
			assert.equal(
				process.argv.length,
				4,
				'Usage: node remix/scripts/smoke-built-file-sync-batches.mjs --bundle <compiled .output or server/index.mjs>'
			);
			assert.equal(process.argv[2], '--bundle');
			await runBuiltBatchSmoke(process.argv[3]);
		}
	} catch (error) {
		console.error(error.message);
		if (process.argv[2] === '--isolated-worker') process.exit(1);
		process.exitCode = 1;
	}
}
