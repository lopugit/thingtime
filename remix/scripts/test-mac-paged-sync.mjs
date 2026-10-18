/** Disposable built-HTTP + Swift adapter acceptance; never touches the installed app. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { accountBackupSandbox, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
const apiPort = 28311,
	dbPort = 28312,
	base = `http://127.0.0.1:${apiPort}`,
	root = resolve(import.meta.dirname, '..');
const clean = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
if (!process.env.TT_MAC_PAGED_WORKER) {
	for (const port of [apiPort, dbPort]) {
		const server = createServer();
		server.listen(port, '127.0.0.1');
		await once(server, 'listening');
		await new Promise((r) => server.close(r));
	}
	await verifyAccountBackupIsolation(apiPort, clean);
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-mac-paged-'));
	await chmod(directory, 0o700);
	let timer;
	try {
		const binary = join(directory, 'MacFolderSyncFixture');
		await copyFile(resolve(root, '../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), binary);
		await chmod(binary, 0o700);
		const entitlements = join(directory, 'fixture.entitlements');
		await writeFile(
			entitlements,
			'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>'
		);
		const signing =
			process.env.THINGTIME_TEST_SIGNING_IDENTITY ||
			execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).match(/([A-F0-9]{40}) "Apple Development:/)?.[1];
		assert.ok(signing, 'A stable Apple Development identity is required for the test bookmark entitlement');
		execFileSync(
			'codesign',
			[
				'--force',
				'--sign',
				signing,
				'--timestamp=none',
				'--identifier',
				'com.thingtime.tests.mac-paged-sync',
				'--entitlements',
				entitlements,
				binary
			],
			{ stdio: 'pipe' }
		);
		execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'pipe' });
		const policy =
			accountBackupSandbox(apiPort, true) +
			`\n(allow network-outbound (remote ip "localhost:${dbPort}"))\n(allow network-inbound (local ip "localhost:${dbPort}"))`;
		const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, process.execPath, import.meta.filename], {
			cwd: root,
			env: { ...clean, TT_MAC_PAGED_WORKER: directory, THINGTIME_MAC_SYNC_FIXTURE_BIN: binary },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (b) => {
			output += b;
			for (const line of String(b).split('\n')) if (line.startsWith('MAC_PAGED_STAGE ')) console.log(line);
		});
		child.stderr.on('data', (b) => (output += b));
		const stop = () => child.kill('SIGTERM');
		process.once('SIGINT', stop);
		process.once('SIGTERM', stop);
		timer = setTimeout(stop, 600000);
		const [code] = await once(child, 'exit');
		const result = output.split('\n').find((line) => line.startsWith('{"macPagedSyncProof":'));
		if (code !== 0 || !result) {
			const log = join(tmpdir(), 'thingtime-mac-paged-failure.log');
			await writeFile(log, output.replace(/https?:\/\/[^\s"<>]+/g, '[url withheld]'), { mode: 0o600 });
			throw Error('Mac paged acceptance failed; private diagnostics: ' + log);
		}
		console.log(result);
	} finally {
		clearTimeout(timer);
		await rm(directory, { recursive: true, force: true });
	}
} else {
	const directory = process.env.TT_MAC_PAGED_WORKER;
	await mkdir(join(directory, 'db'));
	await mkdir(join(directory, 'objects'));
	// This worker and all descendants share the OS boundary. Test its exact policy.
	for (const [host, port] of [
		['127.0.0.1', 28313],
		['localhost', 28313],
		['192.0.2.1', 443]
	]) {
		await assert.rejects(
			new Promise((res, rej) => {
				const s = connect({ host, port, family: 4 });
				s.once('connect', () => {
					s.destroy();
					res();
				});
				s.once('error', rej);
				s.setTimeout(3000, () => {
					s.destroy();
					rej(Error('No enforced denial'));
				});
			}),
			(e) => ['EPERM', 'EACCES'].includes(e.code)
		);
	}
	const children = new Set();
	let server;
	const start = (command, args, env = clean) => {
		const c = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
		children.add(c);
		c.once('exit', () => children.delete(c));
		return c;
	};
	const stop = async (c) => {
		if (c && c.exitCode === null && c.signalCode === null) {
			const exited = once(c, 'exit');
			c.kill('SIGTERM');
			const deadline = setTimeout(() => c.kill('SIGKILL'), 5000);
			try {
				await exited;
			} finally {
				clearTimeout(deadline);
			}
		}
	};
	let stopping = false;
	const terminate = () => {
		stopping = true;
		for (const c of children) c.kill('SIGTERM');
	};
	process.once('SIGTERM', terminate);
	process.once('SIGINT', terminate);
	const collect = (c) => {
		let text = '';
		c.stdout.on('data', (b) => (text += b));
		c.stderr.on('data', (b) => (text += b));
		return () => text;
	};
	const wait = async (predicate, label) => {
		const end = Date.now() + 30000;
		while (Date.now() < end) {
			assert.ok(!stopping, 'Acceptance cancelled');
			if (await predicate()) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw Error(label + ' did not become ready');
	};
	const mongo = start('mongod', [
		'--bind_ip',
		'127.0.0.1',
		'--port',
		String(dbPort),
		'--dbpath',
		join(directory, 'db'),
		'--replSet',
		'mac-paged-sync',
		'--logpath',
		join(directory, 'mongod.log'),
		'--wiredTigerCacheSizeGB',
		'0.25',
		'--nounixsocket'
	]);
	collect(mongo);
	const secret = randomUUID() + randomUUID(),
		username = 'macpaged-' + randomUUID().slice(0, 8),
		password = randomUUID() + '-Disposable!';
	const env = {
		...clean,
		NODE_ENV: 'test',
		NITRO_HOST: '127.0.0.1',
		NITRO_PORT: String(apiPort),
		APP_URL: base,
		JWT_SECRET: secret,
		THINGTIME_EMAIL_PROVIDER: 'console',
		MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${dbPort}/thingtime?replicaSet=mac-paged-sync`,
		THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(directory, 'objects'),
		THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN: base
	};
	const startServer = async (admin = false) => {
		server = start(process.execPath, ['.output/server/index.mjs'], { ...env, ...(admin ? { ADMIN_USERNAMES: username } : {}) });
		const output = collect(server);
		await wait(async () => {
			assert.equal(server.exitCode, null, 'Built server exited: ' + output().slice(-500));
			try {
				return (await fetch(base + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(1000) })).ok;
			} catch {
				return false;
			}
		}, 'Built server');
	};
	try {
		await wait(async () => {
			assert.equal(mongo.exitCode, null);
			return (await readFile(join(directory, 'mongod.log'), 'utf8').catch(() => '')).includes('"msg":"Waiting for connections"');
		}, 'Disposable MongoDB');
		const shell = start('mongosh', [
			'--quiet',
			`mongodb://127.0.0.1:${dbPort}/?directConnection=true`,
			'--eval',
			`rs.initiate({_id:'mac-paged-sync',members:[{_id:0,host:'127.0.0.1:${dbPort}'}]});while(!db.hello().isWritablePrimary){sleep(100)}`
		]);
		collect(shell);
		assert.equal((await once(shell, 'exit'))[0], 0);
		await startServer();
		console.log('MAC_PAGED_STAGE signup');
		const manifest = await fetch(base + '/.well-known/thingtime-capabilities.json').then((r) => r.json());
		assert.equal(manifest.origin, base);
		assert.equal(manifest.features['api.files'].version, '1.6.0');
		const registered = await fetch(base + '/api/v1/auth/register', {
			method: 'POST',
			headers: { Origin: base, 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password, email: username + '@example.invalid', displayName: 'Paged sync acceptance' })
		});
		const data = await registered.json();
		assert.equal(registered.status, 200, 'Disposable API signup: ' + JSON.stringify(data));
		assert.ok(data.user.id);
		const fixturePath = join(directory, 'fixture.json');
		await writeFile(fixturePath, JSON.stringify({ base, username, password, userId: data.user.id }), { mode: 0o600 });
		await stop(server);
		await startServer(true);
		console.log('MAC_PAGED_STAGE native-transfers');
		const test = start(
			process.execPath,
			['--import', 'tsx', 'scripts/mac-file-sync.integration.mts', fixturePath, '--paged', '--large-upload', '--large-download'],
			{ ...clean, THINGTIME_MAC_SYNC_FIXTURE_BIN: process.env.THINGTIME_MAC_SYNC_FIXTURE_BIN }
		);
		const output = collect(test);
		const [code] = await once(test, 'exit');
		if (code !== 0) throw Error('Native transfer child failed: ' + output().replaceAll(password, '[secret]').replaceAll(secret, '[secret]'));
		const result = output()
			.split('\n')
			.find((line) => line.startsWith('{"ok":true'));
		assert.ok(result);
		console.log(
			JSON.stringify({
				macPagedSyncProof: true,
				...JSON.parse(result),
				isolation: 'OS-enforced disposable loopback API and Mongo replica; synthetic picker and credential store; not installed UI acceptance'
			})
		);
	} finally {
		terminate();
		await Promise.all([...children].map((c) => stop(c)));
	}
}
