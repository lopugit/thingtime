// Own one disposable replica and all fixture files. No app env or existing DB.
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
import { mkdtemp, rm, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const port = 28162;
const probe = createServer();
await new Promise((resolve, reject) => {
	probe.once('error', reject);
	probe.listen(port, '127.0.0.1', resolve);
});
await new Promise((resolve) => probe.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-attachment-retention-'));
await chmod(directory, 0o700);
await mkdir(join(directory, 'db'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
const uri = `mongodb://127.0.0.1:${port}/thingtime?replicaSet=attachment-retention`;
try {
	await verifyAccountBackupIsolation(port, env);
} catch (error) {
	await rm(directory, { recursive: true, force: true });
	throw error;
}
const mongo = isolatedAccountBackupProcess(
	process.env.THINGTIME_TEST_MONGOD || 'mongod',
	[
		'--bind_ip',
		'127.0.0.1',
		'--port',
		String(port),
		'--dbpath',
		join(directory, 'db'),
		'--replSet',
		'attachment-retention',
		'--logpath',
		join(directory, 'mongod.log'),
		'--wiredTigerCacheSizeGB',
		'0.25',
		'--nounixsocket'
	],
	{ env, stdio: 'ignore' },
	port,
	true
);
let child,
	cancelled = false;
const stopped = once(mongo, 'exit').catch(() => []);
const terminate = () => {
	cancelled = true;
	child?.kill('SIGTERM');
	mongo.kill('SIGTERM');
};
process.once('SIGTERM', terminate);
process.once('SIGINT', terminate);
try {
	// mongosh's initial selection timeout can expire while mongod is still
	// creating its data files. Wait for THIS child's readiness, not a guessed
	// sleep or a connection to whichever process happens to own the port.
	const deadline = Date.now() + 30000;
	let ready = false;
	while (Date.now() < deadline && !ready) {
		assert.ok(!cancelled && mongo.exitCode === null && mongo.signalCode === null, 'Disposable mongod stopped before readiness');
		const log = await readFile(join(directory, 'mongod.log'), 'utf8').catch((error) => {
			if (error.code === 'ENOENT') return '';
			throw error;
		});
		ready = log.includes('"msg":"Waiting for connections"');
		if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.ok(ready && !cancelled, 'Disposable mongod did not become ready');
	const shell = isolatedAccountBackupProcess(
		'mongosh',
		[
			'--quiet',
			`mongodb://127.0.0.1:${port}/?directConnection=true`,
			'--eval',
			`rs.initiate({_id:'attachment-retention',members:[{_id:0,host:'127.0.0.1:${port}'}]}); while(!db.hello().isWritablePrimary){sleep(100)}`
		],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] },
		port
	);
	child = shell;
	let bootstrapOutput = '';
	shell.stdout.on('data', (b) => (bootstrapOutput += b));
	shell.stderr.on('data', (b) => (bootstrapOutput += b));
	const bootstrapTimer = setTimeout(() => shell.kill('SIGTERM'), 30000);
	const [bootstrapCode] = await once(shell, 'exit');
	clearTimeout(bootstrapTimer);
	assert.equal(bootstrapCode, 0, 'Disposable replica bootstrap failed: ' + bootstrapOutput.slice(-1000));
	assert.equal(cancelled, false, 'Fixture was cancelled');
	child = isolatedAccountBackupProcess(
		process.execPath,
		['--import', 'tsx', 'scripts/attachment-retention.integration.mts'],
		{
			cwd: resolve(import.meta.dirname, '..'),
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...env,
				MONGODB_CONNECTION_STRING: uri,
				THINGTIME_ATTACHMENT_RETENTION_TEST_DIRECTORY: directory,
				THINGTIME_EMAIL_PROVIDER: 'console',
				NODE_ENV: 'test'
			}
		},
		port
	);
	let output = '';
	child.stdout.on('data', (b) => (output += b));
	child.stderr.on('data', (b) => (output += b));
	const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
	const [code] = await once(child, 'exit');
	clearTimeout(timer);
	// Console email output can include one-use fixture links. Never forward it.
	const result = output.split('\n').find((line) => line.startsWith('{"attachmentRetentionProof":'));
	if (code !== 0 || !result) {
		const { writeFile } = await import('node:fs/promises');
		const failureLog = join(tmpdir(), 'thingtime-attachment-retention-failure.log');
		await writeFile(failureLog, output.replace(/https?:\/\/[^\s"<>]+/g, '[url withheld]'), { mode: 0o600 });
		throw Error('Attachment retention API proof failed; private diagnostic log: ' + failureLog);
	}
	console.log(JSON.stringify({ ...JSON.parse(result), isolation: 'OS-enforced loopback-only; redirects, hostname and direct-IP denial verified' }));
} finally {
	terminate();
	await stopped;
	await rm(directory, { recursive: true, force: true });
}
